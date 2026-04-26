import { chatCompletion } from '../agent/llm.client.js'
import type { LLMConfig, LLMConversationMessage } from '../agent/llm.client.js'
import { getSettings, resolveLlmConfigForTask } from '../settings/settings.service.js'
import type { PkmIndexSuggestion, PkmCategory } from './pkm.types.js'

const SYSTEM_PROMPT = `你是一个知识标引助手。你的任务是为给定的知识条目建议合适的标引信息。

请根据提供的标题、内容和分类，生成以下标引建议：
- keywords: 3-5 个核心关键词
- subjectTerms: 2-3 个标准主题词（使用专业术语而非口语表达）
- aliases: 1-3 个常见别名或同义表达
- scene: 一句话描述该知识适用的场景
- titleStandard: 标准化的标题（去掉口语化表达，使用规范用词）

请以 JSON 格式返回，格式如下：
{
  "keywords": ["关键词1", "关键词2"],
  "subjectTerms": ["主题词1", "主题词2"],
  "aliases": ["别名1", "别名2"],
  "scene": "适用场景描述",
  "titleStandard": "标准化标题"
}

只返回 JSON，不要返回其他内容。`

function buildSuggestMessages(input: {
  title: string
  content: string
  category: PkmCategory
}): LLMConversationMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `标题: ${input.title}\n分类: ${input.category}\n内容:\n${input.content.slice(0, 3000)}`,
    },
  ]
}

async function resolveLLMConfig(): Promise<LLMConfig> {
  const settings = await getSettings()
  const routed = resolveLlmConfigForTask(settings.llm, 'pkm-index')
  return {
    baseUrl: routed.baseUrl,
    modelId: routed.modelId,
    apiKey: routed.apiKey,
    kind: routed.kind,
    provider: routed.provider,
  }
}

function parseSuggestion(raw: string): PkmIndexSuggestion | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    return {
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
      subjectTerms: Array.isArray(parsed.subjectTerms) ? parsed.subjectTerms.map(String) : [],
      aliases: Array.isArray(parsed.aliases) ? parsed.aliases.map(String) : [],
      category: (parsed.category as PkmCategory) ?? 'knowledge',
      scene: typeof parsed.scene === 'string' ? parsed.scene : '',
      titleStandard: typeof parsed.titleStandard === 'string' ? parsed.titleStandard : '',
    }
  } catch {
    return null
  }
}

const EMPTY_SUGGESTION: PkmIndexSuggestion = {
  keywords: [],
  subjectTerms: [],
  aliases: [],
  category: 'knowledge',
  scene: '',
  titleStandard: '',
}

export async function suggestPageIndexing(input: {
  title: string
  content: string
  category: PkmCategory
}): Promise<PkmIndexSuggestion> {
  try {
    const cfg = await resolveLLMConfig()
    const messages = buildSuggestMessages(input)
    const response = await chatCompletion(cfg, messages)
    const content = response.content ?? ''
    return parseSuggestion(content) ?? EMPTY_SUGGESTION
  } catch (error) {
    console.warn('[pkm-ai] suggestPageIndexing failed:', error instanceof Error ? error.message : error)
    return EMPTY_SUGGESTION
  }
}

export async function batchSuggestIndexing(
  pages: Array<{ title: string; content: string; category: PkmCategory }>,
): Promise<PkmIndexSuggestion[]> {
  const concurrency = 3
  const results: PkmIndexSuggestion[] = []
  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map((page) => suggestPageIndexing(page)))
    results.push(...batchResults)
  }
  return results
}
