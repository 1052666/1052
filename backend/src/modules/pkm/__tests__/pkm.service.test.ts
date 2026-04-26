import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock all external module dependencies
vi.mock('../../../storage.js', () => ({
  readJson: vi.fn(),
  writeJson: vi.fn(),
}))

vi.mock('../../wiki/wiki.service.js', () => ({
  listWikiPages: vi.fn(),
}))

vi.mock('../../memory/memory.service.js', () => ({
  listMemories: vi.fn(),
}))

vi.mock('../../skills/skills.service.js', () => ({
  listSkills: vi.fn(),
}))

vi.mock('../../resources/resources.service.js', () => ({
  listResources: vi.fn(),
}))

vi.mock('../../calendar/calendar.service.js', () => ({
  listCalendarEvents: vi.fn(),
}))

vi.mock('../../calendar/calendar.schedule.service.js', () => ({
  listScheduledTasks: vi.fn(),
}))

import { readJson, writeJson } from '../../../storage.js'
import { listWikiPages } from '../../wiki/wiki.service.js'
import { listMemories } from '../../memory/memory.service.js'
import { listSkills } from '../../skills/skills.service.js'
import { listResources } from '../../resources/resources.service.js'
import { listCalendarEvents } from '../../calendar/calendar.service.js'
import { listScheduledTasks } from '../../calendar/calendar.schedule.service.js'
import {
  buildPkmIndex,
  tokenize,
  buildInvertedIndex,
  savePkmIndex,
  loadPkmIndex,
  saveInvertedIndex,
  loadInvertedIndex,
  reindexPkm,
  getPkmSummary,
  listThesaurusEntries,
  upsertThesaurusEntry,
  deleteThesaurusEntry,
  expandSynonyms,
  getSourceLabel,
} from '../pkm.service.js'
import type { PkmIndexEntry } from '../pkm.types.js'

const mockReadJson = vi.mocked(readJson)
const mockWriteJson = vi.mocked(writeJson)
const mockListWikiPages = vi.mocked(listWikiPages)
const mockListMemories = vi.mocked(listMemories)
const mockListSkills = vi.mocked(listSkills)
const mockListResources = vi.mocked(listResources)
const mockListCalendarEvents = vi.mocked(listCalendarEvents)
const mockListScheduledTasks = vi.mocked(listScheduledTasks)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// --- Sample data factories ---
function makeWikiPage(overrides: Record<string, unknown> = {}) {
  return {
    path: '实体/React.md',
    title: 'React Hooks',
    category: 'concept' as const,
    tags: ['react', 'hooks'],
    sourceCount: 0,
    sources: [],
    summary: 'React Hooks 是 React 16.8 引入的特性',
    lastUpdated: '2025-01-01',
    links: [],
    backlinks: [],
    content: 'React Hooks 允许在函数组件中使用状态和副作用。',
    raw: '',
    size: 100,
    updatedAt: 1704067200000,
    hasFrontmatter: true,
    keywords: ['hooks', '函数组件'],
    subjectTerms: ['React'],
    aliases: ['钩子'],
    scene: '函数组件开发',
    titleStandard: 'React Hooks',
    ...overrides,
  }
}

function makeMemory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    category: 'preference' as const,
    title: '偏好设置',
    content: '用户偏好深色模式',
    tags: ['偏好', 'UI'],
    scope: 'global' as const,
    priority: 'normal' as const,
    source: 'user_explicit' as const,
    confidence: 'confirmed' as const,
    active: true,
    createdAt: 1704067200000,
    updatedAt: 1704067200000,
    lastUsedAt: null,
    ...overrides,
  }
}

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1',
    name: '代码审查',
    description: '自动代码审查技能',
    enabled: true,
    path: '/skills/code-review.md',
    updatedAt: 1704067200000,
    size: 500,
    ...overrides,
  }
}

function makeResource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    title: 'TypeScript 文档',
    content: 'TypeScript 是 JavaScript 的超集',
    note: '官方文档',
    tags: ['typescript', '文档'],
    status: 'active' as const,
    createdAt: 1704067200000,
    updatedAt: 1704067200000,
    ...overrides,
  }
}

function makeCalendarEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    title: '团队会议',
    date: '2025-01-15',
    startTime: '10:00',
    endTime: '11:00',
    location: '会议室A',
    notes: '讨论技术方案',
    createdAt: 1704067200000,
    updatedAt: 1704067200000,
    ...overrides,
  }
}

function makeScheduledTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: '每日备份',
    notes: '定时备份数据',
    target: 'agent' as const,
    mode: 'recurring' as const,
    startDate: '2025-01-01',
    time: '02:00',
    timezone: 'Asia/Hong_Kong' as const,
    repeatUnit: 'day' as const,
    repeatInterval: 1,
    repeatWeekdays: [],
    endDate: '',
    prompt: '备份数据',
    command: '',
    shell: 'bash' as const,
    delivery: {
      wechat: { mode: 'auto' as const, accountId: '', peerId: '' },
      feishu: { mode: 'auto' as const, receiveIdType: 'chat_id' as const, receiveId: '', chatType: 'p2p' as const },
    },
    enabled: true,
    createdAt: 1704067200000,
    updatedAt: 1704067200000,
    lastRunAt: null,
    nextRunAt: null,
    lastRunStatus: null,
    lastRunSummary: '',
    ...overrides,
  }
}

// --- Tests ---

describe('pkm.service — 索引构建', () => {
  it('从各模块读取数据，正确映射字段', async () => {
    mockListWikiPages.mockResolvedValue([makeWikiPage()])
    mockListMemories.mockResolvedValue([makeMemory()])
    mockListSkills.mockResolvedValue([makeSkill()])
    mockListResources.mockResolvedValue([makeResource()])
    mockListCalendarEvents.mockResolvedValue([makeCalendarEvent()])
    mockListScheduledTasks.mockResolvedValue([makeScheduledTask()])

    const { entries } = await buildPkmIndex()

    expect(entries).toHaveLength(6)

    // Wiki entry
    const wikiEntry = entries.find((e) => e.source === 'wiki')!
    expect(wikiEntry.id).toBe('wiki:实体/React.md')
    expect(wikiEntry.source).toBe('wiki')
    expect(wikiEntry.category).toBe('knowledge')
    expect(wikiEntry.title).toBe('React Hooks')
    expect(wikiEntry.keywords).toEqual(['hooks', '函数组件'])
    expect(wikiEntry.subjectTerms).toEqual(['React'])
    expect(wikiEntry.aliases).toEqual(['钩子'])
    expect(wikiEntry.scene).toBe('函数组件开发')
    expect(wikiEntry.navigateUrl).toBe('/wiki?page=' + encodeURIComponent('实体/React.md'))

    // Memory entry
    const memEntry = entries.find((e) => e.source === 'memory')!
    expect(memEntry.id).toBe('memory:mem-1')
    expect(memEntry.category).toBe('memory')
    expect(memEntry.title).toBe('偏好设置')
    expect(memEntry.tags).toEqual(['偏好', 'UI'])

    // Skill entry
    const skillEntry = entries.find((e) => e.source === 'skill')!
    expect(skillEntry.id).toBe('skill:skill-1')
    expect(skillEntry.category).toBe('skill')
    expect(skillEntry.title).toBe('代码审查')

    // Resource entry
    const resEntry = entries.find((e) => e.source === 'resource')!
    expect(resEntry.id).toBe('resource:res-1')
    expect(resEntry.category).toBe('resource')
    expect(resEntry.title).toBe('TypeScript 文档')

    // Calendar event
    const evtEntry = entries.find((e) => e.source === 'calendar-event')!
    expect(evtEntry.id).toBe('calendar-event:evt-1')
    expect(evtEntry.category).toBe('action')
    expect(evtEntry.title).toBe('团队会议')

    // Scheduled task
    const taskEntry = entries.find((e) => e.source === 'calendar-task')!
    expect(taskEntry.id).toBe('calendar-task:task-1')
    expect(taskEntry.category).toBe('action')
    expect(taskEntry.title).toBe('每日备份')
  })

  it('Wiki experience category 映射为 experience', async () => {
    mockListWikiPages.mockResolvedValue([
      makeWikiPage({ category: 'experience', path: '经验/部署.md', title: '部署经验' }),
    ])
    mockListMemories.mockResolvedValue([])
    mockListSkills.mockResolvedValue([])
    mockListResources.mockResolvedValue([])
    mockListCalendarEvents.mockResolvedValue([])
    mockListScheduledTasks.mockResolvedValue([])

    const { entries } = await buildPkmIndex()
    expect(entries[0].category).toBe('experience')
  })

  it('模块读取失败时返回空数组不报错', async () => {
    mockListWikiPages.mockRejectedValue(new Error('wiki error'))
    mockListMemories.mockRejectedValue(new Error('memory error'))
    mockListSkills.mockResolvedValue([])
    mockListResources.mockResolvedValue([])
    mockListCalendarEvents.mockResolvedValue([])
    mockListScheduledTasks.mockResolvedValue([])

    const { entries } = await buildPkmIndex()
    expect(entries).toHaveLength(0)
  })

  it('content 字段截断为 2000 字符', async () => {
    const longContent = 'x'.repeat(5000)
    mockListWikiPages.mockResolvedValue([
      makeWikiPage({ content: longContent }),
    ])
    mockListMemories.mockResolvedValue([])
    mockListSkills.mockResolvedValue([])
    mockListResources.mockResolvedValue([])
    mockListCalendarEvents.mockResolvedValue([])
    mockListScheduledTasks.mockResolvedValue([])

    const { entries } = await buildPkmIndex()
    expect(entries[0].content.length).toBeLessThanOrEqual(2000)
  })
})

describe('pkm.service — 倒排索引构建', () => {
  const sampleEntry: PkmIndexEntry = {
    id: 'wiki:test',
    source: 'wiki',
    sourceId: 'test',
    category: 'knowledge',
    title: 'React Hooks 入门',
    summary: 'React Hooks 是 React 16.8 引入的新特性',
    content: '使用 useState 和 useEffect 创建函数组件',
    keywords: ['hooks', '函数组件'],
    subjectTerms: ['React'],
    aliases: ['钩子'],
    tags: ['react', 'frontend'],
    scene: '函数组件开发场景',
    navigateUrl: '/wiki?page=test',
    createdAt: 1704067200000,
    updatedAt: 1704067200000,
  }

  it('title 权重为 4', () => {
    const index = buildInvertedIndex([sampleEntry])
    // "React" should appear in title with weight 4
    const reactEntries = index['react']?.entries ?? []
    const titleMatch = reactEntries.find((e) => e.matchedField === 'title')
    expect(titleMatch).toBeDefined()
    expect(titleMatch!.weight).toBe(4)
  })

  it('summary 权重为 3', () => {
    const index = buildInvertedIndex([sampleEntry])
    const summaryEntries = index['hooks']?.entries ?? []
    const summaryMatch = summaryEntries.find((e) => e.matchedField === 'summary')
    expect(summaryMatch).toBeDefined()
    expect(summaryMatch!.weight).toBe(3)
  })

  it('scene 权重为 3', () => {
    const index = buildInvertedIndex([sampleEntry])
    // "场景" appears in scene field
    const sceneEntries = index['场景']?.entries ?? []
    const sceneMatch = sceneEntries.find((e) => e.matchedField === 'summary')
    expect(sceneMatch).toBeDefined()
    expect(sceneMatch!.weight).toBe(3)
  })

  it('keywords/subjectTerms/aliases/tags 权重为 2', () => {
    const index = buildInvertedIndex([sampleEntry])
    // "hooks" from keywords — weight 2 for index field
    const hooksEntries = index['hooks']?.entries ?? []
    const indexMatch = hooksEntries.find((e) => e.matchedField === 'index')
    expect(indexMatch).toBeDefined()
    expect(indexMatch!.weight).toBe(2)
  })

  it('content 权重为 1', () => {
    const index = buildInvertedIndex([sampleEntry])
    // "useState" appears in content
    const useStateEntries = index['usestate']?.entries ?? []
    const contentMatch = useStateEntries.find((e) => e.matchedField === 'content')
    expect(contentMatch).toBeDefined()
    expect(contentMatch!.weight).toBe(1)
  })

  it('空 entries 生成空索引', () => {
    const index = buildInvertedIndex([])
    expect(Object.keys(index)).toHaveLength(0)
  })
})

describe('pkm.service — 中文分词 tokenize', () => {
  it('提取 CJK 连续字符', () => {
    const tokens = tokenize('React Hooks 是一种新特性')
    // Should include CJK bigrams
    expect(tokens.some((t) => t.includes('一种') || t.includes('新特') || t.includes('特性'))).toBe(true)
  })

  it('提取英文单词（小写化）', () => {
    const tokens = tokenize('React Hooks TypeScript')
    expect(tokens).toContain('react')
    expect(tokens).toContain('hooks')
    expect(tokens).toContain('typescript')
  })

  it('中文 bigram 正确生成', () => {
    const tokens = tokenize('知识管理系统')
    // "知识管理系统" as full match, plus bigrams
    expect(tokens).toContain('知识管理系统')
    expect(tokens).toContain('知识')
    expect(tokens).toContain('识管')
    expect(tokens).toContain('管理')
    expect(tokens).toContain('理系')
    expect(tokens).toContain('系统')
  })

  it('空字符串返回空数组', () => {
    expect(tokenize('')).toEqual([])
  })

  it('单个 CJK 字符不生成 bigram', () => {
    const tokens = tokenize('好')
    expect(tokens).toEqual([])
  })

  it('数字字母混合提取', () => {
    const tokens = tokenize('vite_v2 config-value')
    expect(tokens).toContain('vite_v2')
    expect(tokens).toContain('config-value')
  })
})

describe('pkm.service — 索引持久化', () => {
  it('savePkmIndex 调用 writeJson', async () => {
    const entries: PkmIndexEntry[] = [
      {
        id: 'test',
        source: 'wiki',
        sourceId: 's1',
        category: 'knowledge',
        title: 'T',
        summary: '',
        content: '',
        keywords: [],
        subjectTerms: [],
        aliases: [],
        tags: [],
        scene: '',
        navigateUrl: '',
        createdAt: 0,
        updatedAt: 0,
      },
    ]
    await savePkmIndex(entries)
    expect(mockWriteJson).toHaveBeenCalledWith('pkm/index.json', entries)
  })

  it('loadPkmIndex 调用 readJson', async () => {
    const mockEntries: PkmIndexEntry[] = []
    mockReadJson.mockResolvedValue(mockEntries)
    const result = await loadPkmIndex()
    expect(mockReadJson).toHaveBeenCalledWith('pkm/index.json', [])
    expect(result).toBe(mockEntries)
  })

  it('saveInvertedIndex + loadInvertedIndex 一致', async () => {
    const invIndex = { react: { term: 'react', entries: [{ id: 'e1', weight: 4, matchedField: 'title' as const }] } }
    mockReadJson.mockResolvedValue(invIndex)
    await saveInvertedIndex(invIndex)
    const loaded = await loadInvertedIndex()
    expect(mockWriteJson).toHaveBeenCalledWith('pkm/inverted-index.json', invIndex)
    expect(loaded).toEqual(invIndex)
  })
})

describe('pkm.service — 词表 CRUD', () => {
  it('创建词条', async () => {
    mockReadJson.mockResolvedValue([])
    const entry = await upsertThesaurusEntry({
      term: '前端',
      synonyms: ['frontend', 'front-end'],
      category: 'knowledge',
    })
    expect(entry.term).toBe('前端')
    expect(entry.synonyms).toEqual(['frontend', 'front-end'])
    expect(entry.category).toBe('knowledge')
    expect(entry.createdAt).toBeTruthy()
    expect(entry.updatedAt).toBeTruthy()
    expect(mockWriteJson).toHaveBeenCalled()
  })

  it('更新词条（保持 createdAt）', async () => {
    const existing = {
      term: '前端',
      synonyms: ['old'],
      category: 'knowledge' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
    mockReadJson.mockResolvedValue([existing])
    const updated = await upsertThesaurusEntry({
      term: '前端',
      synonyms: ['frontend', 'front-end'],
      category: 'knowledge',
    })
    expect(updated.createdAt).toBe('2024-01-01T00:00:00.000Z')
    expect(updated.synonyms).toEqual(['frontend', 'front-end'])
  })

  it('删除词条', async () => {
    const entries = [
      { term: '前端', synonyms: ['frontend'], category: 'all' as const, createdAt: '', updatedAt: '' },
      { term: '后端', synonyms: ['backend'], category: 'all' as const, createdAt: '', updatedAt: '' },
    ]
    mockReadJson.mockResolvedValue(entries)
    await deleteThesaurusEntry('前端')
    const writeCall = mockWriteJson.mock.calls[0]
    expect(writeCall[1]).toEqual([entries[1]])
  })

  it('查询词条列表', async () => {
    const entries = [
      { term: '前端', synonyms: ['frontend'], category: 'all' as const, createdAt: '', updatedAt: '' },
    ]
    mockReadJson.mockResolvedValue(entries)
    const result = await listThesaurusEntries()
    expect(result).toEqual(entries)
  })

  it('空词条列表', async () => {
    mockReadJson.mockResolvedValue([])
    const result = await listThesaurusEntries()
    expect(result).toEqual([])
  })

  it('upsertThesaurusEntry 默认 category 为 all', async () => {
    mockReadJson.mockResolvedValue([])
    const entry = await upsertThesaurusEntry({
      term: '测试',
      synonyms: ['test'],
    })
    expect(entry.category).toBe('all')
  })
})

describe('pkm.service — 同义词扩展', () => {
  it('扩展同义词', async () => {
    const entries = [
      { term: '前端', synonyms: ['frontend', 'front-end'], category: 'all' as const, createdAt: '', updatedAt: '' },
    ]
    mockReadJson.mockResolvedValue(entries)
    const expanded = await expandSynonyms('前端')
    expect(expanded).toContain('前端')
    expect(expanded).toContain('frontend')
    expect(expanded).toContain('front-end')
  })

  it('通过同义词反向扩展', async () => {
    const entries = [
      { term: '前端', synonyms: ['frontend'], category: 'all' as const, createdAt: '', updatedAt: '' },
    ]
    mockReadJson.mockResolvedValue(entries)
    const expanded = await expandSynonyms('frontend')
    expect(expanded).toContain('前端')
    expect(expanded).toContain('frontend')
  })

  it('无匹配词条时返回自身', async () => {
    mockReadJson.mockResolvedValue([])
    const expanded = await expandSynonyms('不存在')
    expect(expanded).toEqual(['不存在'])
  })

  it('大小写不敏感匹配', async () => {
    const entries = [
      { term: 'React', synonyms: ['reactjs'], category: 'all' as const, createdAt: '', updatedAt: '' },
    ]
    mockReadJson.mockResolvedValue(entries)
    const expanded = await expandSynonyms('react')
    expect(expanded).toContain('React')
    expect(expanded).toContain('reactjs')
  })
})

describe('pkm.service — reindexPkm', () => {
  it('构建并保存索引，返回统计', async () => {
    mockListWikiPages.mockResolvedValue([makeWikiPage(), makeWikiPage({ path: '经验/测试.md', title: '测试经验', category: 'experience' })])
    mockListMemories.mockResolvedValue([makeMemory()])
    mockListSkills.mockResolvedValue([])
    mockListResources.mockResolvedValue([])
    mockListCalendarEvents.mockResolvedValue([])
    mockListScheduledTasks.mockResolvedValue([])

    const result = await reindexPkm()
    expect(result.totalEntries).toBe(3)
    expect(result.bySource.wiki).toBe(2)
    expect(result.bySource.memory).toBe(1)
    expect(result.byCategory.knowledge).toBe(1)
    expect(result.byCategory.experience).toBe(1)
    expect(result.byCategory.memory).toBe(1)
    expect(mockWriteJson).toHaveBeenCalledTimes(2) // index + inverted index
  })
})

describe('pkm.service — getPkmSummary', () => {
  it('返回正确概览统计', async () => {
    const entries: PkmIndexEntry[] = [
      {
        id: 'wiki:a',
        source: 'wiki',
        sourceId: 'a',
        category: 'knowledge',
        title: 'A',
        summary: '',
        content: '',
        keywords: [],
        subjectTerms: [],
        aliases: [],
        tags: [],
        scene: '',
        navigateUrl: '',
        createdAt: 1704067200000,
        updatedAt: 1704067200000,
      },
      {
        id: 'memory:b',
        source: 'memory',
        sourceId: 'b',
        category: 'memory',
        title: 'B',
        summary: '',
        content: '',
        keywords: [],
        subjectTerms: [],
        aliases: [],
        tags: [],
        scene: '',
        navigateUrl: '',
        createdAt: 1704153600000,
        updatedAt: 1704153600000,
      },
    ]
    mockReadJson.mockImplementation((file: string) => {
      if (file === 'pkm/index.json') return Promise.resolve(entries)
      if (file === 'pkm/thesaurus.json') return Promise.resolve([{ term: '前端', synonyms: ['frontend'], category: 'all', createdAt: '', updatedAt: '' }])
      return Promise.resolve([])
    })

    const summary = await getPkmSummary()
    expect(summary.totalEntries).toBe(2)
    expect(summary.bySource.wiki).toBe(1)
    expect(summary.bySource.memory).toBe(1)
    expect(summary.byCategory.knowledge).toBe(1)
    expect(summary.byCategory.memory).toBe(1)
    expect(summary.thesaurusSize).toBe(1)
    expect(summary.lastIndexAt).toBeTruthy()
  })

  it('空索引返回 lastIndexAt 为 null', async () => {
    mockReadJson.mockImplementation((file: string) => {
      if (file === 'pkm/index.json') return Promise.resolve([])
      if (file === 'pkm/thesaurus.json') return Promise.resolve([])
      return Promise.resolve([])
    })

    const summary = await getPkmSummary()
    expect(summary.totalEntries).toBe(0)
    expect(summary.lastIndexAt).toBeNull()
  })
})

describe('pkm.service — getSourceLabel', () => {
  it('返回正确的来源标签', () => {
    expect(getSourceLabel('wiki')).toBe('Wiki')
    expect(getSourceLabel('memory')).toBe('记忆')
    expect(getSourceLabel('skill')).toBe('技能')
    expect(getSourceLabel('resource')).toBe('资源')
    expect(getSourceLabel('calendar-event')).toBe('日历事件')
    expect(getSourceLabel('calendar-task')).toBe('定时任务')
  })
})
