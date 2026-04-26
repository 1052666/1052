import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock LLM client
vi.mock('../../agent/llm.client.js', () => ({
  chatCompletion: vi.fn(),
}))

// Mock settings service
vi.mock('../../settings/settings.service.js', () => ({
  getSettings: vi.fn(),
  resolveLlmConfigForTask: vi.fn(),
}))

import { chatCompletion } from '../../agent/llm.client.js'
import { getSettings, resolveLlmConfigForTask } from '../../settings/settings.service.js'
import { suggestPageIndexing, batchSuggestIndexing } from '../pkm.ai.js'

const mockChatCompletion = vi.mocked(chatCompletion)
const mockGetSettings = vi.mocked(getSettings)
const mockResolveLlmConfigForTask = vi.mocked(resolveLlmConfigForTask)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSettings.mockResolvedValue({ llm: {} } as any)
  mockResolveLlmConfigForTask.mockReturnValue({
    baseUrl: 'https://api.example.com',
    modelId: 'test-model',
    apiKey: 'test-key',
    kind: 'fast',
    provider: 'openai',
  } as any)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pkm.ai — suggestPageIndexing', () => {
  it('mock LLM 返回合法 JSON，验证解析正确', async () => {
    const llmResponse = {
      keywords: ['React', 'Hooks', '函数组件', '状态管理', '副作用'],
      subjectTerms: ['React框架', '前端开发'],
      aliases: ['钩子', 'React Hooks'],
      category: 'knowledge' as const,
      scene: 'React 函数组件开发场景',
      titleStandard: 'React Hooks 入门',
    }

    mockChatCompletion.mockResolvedValue({
      role: 'assistant',
      content: JSON.stringify(llmResponse),
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })

    const result = await suggestPageIndexing({
      title: 'React Hooks 入门教程',
      content: 'React Hooks 是 React 16.8 引入的新特性...',
      category: 'knowledge',
    })

    expect(result.keywords).toEqual(llmResponse.keywords)
    expect(result.subjectTerms).toEqual(llmResponse.subjectTerms)
    expect(result.aliases).toEqual(llmResponse.aliases)
    expect(result.scene).toBe(llmResponse.scene)
    expect(result.titleStandard).toBe(llmResponse.titleStandard)
    expect(result.category).toBe('knowledge')
  })

  it('mock LLM 返回非法 JSON，验证降级（返回空建议不报错）', async () => {
    mockChatCompletion.mockResolvedValue({
      role: 'assistant',
      content: '这不是JSON格式的回复，只是一段普通文本',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })

    const result = await suggestPageIndexing({
      title: '测试标题',
      content: '测试内容',
      category: 'knowledge',
    })

    expect(result.keywords).toEqual([])
    expect(result.subjectTerms).toEqual([])
    expect(result.aliases).toEqual([])
    expect(result.scene).toBe('')
    expect(result.titleStandard).toBe('')
  })

  it('mock LLM 返回部分 JSON（无 keywords 字段），验证默认值', async () => {
    mockChatCompletion.mockResolvedValue({
      role: 'assistant',
      content: JSON.stringify({ scene: '测试场景' }),
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })

    const result = await suggestPageIndexing({
      title: '测试',
      content: '内容',
      category: 'knowledge',
    })

    expect(result.keywords).toEqual([])
    expect(result.scene).toBe('测试场景')
  })

  it('mock LLM 超时，验证降级', async () => {
    mockChatCompletion.mockRejectedValue(new Error('LLM timeout'))

    const result = await suggestPageIndexing({
      title: '测试超时',
      content: '超时内容',
      category: 'knowledge',
    })

    // Should return empty suggestion without throwing
    expect(result.keywords).toEqual([])
    expect(result.subjectTerms).toEqual([])
    expect(result.aliases).toEqual([])
    expect(result.scene).toBe('')
    expect(result.titleStandard).toBe('')
  })

  it('mock LLM 返回带额外文本的 JSON，验证提取', async () => {
    mockChatCompletion.mockResolvedValue({
      role: 'assistant',
      content: '好的，这是我的建议：\n```json\n{"keywords": ["A", "B"], "subjectTerms": ["C"], "aliases": [], "scene": "s", "titleStandard": "t"}\n```\n希望对你有帮助。',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })

    const result = await suggestPageIndexing({
      title: '测试提取',
      content: '内容',
      category: 'knowledge',
    })

    expect(result.keywords).toEqual(['A', 'B'])
    expect(result.subjectTerms).toEqual(['C'])
  })

  it('验证 LLM 调用参数正确', async () => {
    mockChatCompletion.mockResolvedValue({
      role: 'assistant',
      content: '{"keywords":[],"subjectTerms":[],"aliases":[],"scene":"","titleStandard":""}',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })

    await suggestPageIndexing({
      title: '测试标题',
      content: '测试内容',
      category: 'experience',
    })

    expect(mockChatCompletion).toHaveBeenCalledTimes(1)
    const call = mockChatCompletion.mock.calls[0]
    const messages = call[1] as Array<{ role: string; content: string }>
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('测试标题')
    expect(messages[1].content).toContain('experience')
    expect(messages[1].content).toContain('测试内容')
  })

  it('内容截断为 3000 字符', async () => {
    const longContent = 'x'.repeat(5000)
    mockChatCompletion.mockResolvedValue({
      role: 'assistant',
      content: '{"keywords":[],"subjectTerms":[],"aliases":[],"scene":"","titleStandard":""}',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })

    await suggestPageIndexing({
      title: '长内容',
      content: longContent,
      category: 'knowledge',
    })

    const messages = (mockChatCompletion.mock.calls[0][1]) as Array<{ content: string }>
    const userContent = messages[1].content
    // The content in the user message should be truncated
    expect(userContent.length).toBeLessThan(longContent.length + 100)
  })
})

describe('pkm.ai — batchSuggestIndexing', () => {
  it('多页批量处理', async () => {
    mockChatCompletion.mockResolvedValue({
      role: 'assistant',
      content: '{"keywords":["k1"],"subjectTerms":["s1"],"aliases":[],"scene":"","titleStandard":""}',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })

    const pages = [
      { title: '页面1', content: '内容1', category: 'knowledge' as const },
      { title: '页面2', content: '内容2', category: 'experience' as const },
      { title: '页面3', content: '内容3', category: 'skill' as const },
    ]

    const results = await batchSuggestIndexing(pages)

    expect(results).toHaveLength(3)
    expect(mockChatCompletion).toHaveBeenCalledTimes(3)
    for (const result of results) {
      expect(result.keywords).toEqual(['k1'])
      expect(result.subjectTerms).toEqual(['s1'])
    }
  })

  it('批量处理中某页失败不影响其他页', async () => {
    let callCount = 0
    mockChatCompletion.mockImplementation(() => {
      callCount++
      if (callCount === 2) {
        return Promise.reject(new Error('LLM error'))
      }
      return Promise.resolve({
        role: 'assistant',
        content: '{"keywords":["ok"],"subjectTerms":[],"aliases":[],"scene":"","titleStandard":""}',
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      })
    })

    const pages = [
      { title: '页面1', content: '内容1', category: 'knowledge' as const },
      { title: '页面2', content: '内容2', category: 'knowledge' as const },
      { title: '页面3', content: '内容3', category: 'knowledge' as const },
    ]

    const results = await batchSuggestIndexing(pages)

    expect(results).toHaveLength(3)
    // First page succeeds
    expect(results[0].keywords).toEqual(['ok'])
    // Second page fails, returns empty
    expect(results[1].keywords).toEqual([])
    // Third page succeeds
    expect(results[2].keywords).toEqual(['ok'])
  })

  it('空页面列表返回空数组', async () => {
    const results = await batchSuggestIndexing([])
    expect(results).toEqual([])
    expect(mockChatCompletion).not.toHaveBeenCalled()
  })
})
