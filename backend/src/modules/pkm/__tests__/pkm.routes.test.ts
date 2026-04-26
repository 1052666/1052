import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock pkm.service
vi.mock('../pkm.service.js', () => ({
  getPkmSummary: vi.fn(),
  reindexPkm: vi.fn(),
  listThesaurusEntries: vi.fn(),
  upsertThesaurusEntry: vi.fn(),
  deleteThesaurusEntry: vi.fn(),
  expandSynonyms: vi.fn(),
}))

// Mock pkm.search
vi.mock('../pkm.search.js', () => ({
  searchPkmEntries: vi.fn(),
}))

// Mock pkm.sop
vi.mock('../pkm.sop.js', () => ({
  getStoreSop: vi.fn(),
  getRetrieveSop: vi.fn(),
}))

// Mock pkm.ai
vi.mock('../pkm.ai.js', () => ({
  suggestPageIndexing: vi.fn(),
  batchSuggestIndexing: vi.fn(),
}))

// Mock http-error
vi.mock('../../../http-error.js', () => ({
  httpError: (status: number, message: string) => {
    const err = new Error(message)
    ;(err as any).status = status
    return err
  },
}))

import { getPkmSummary, reindexPkm, listThesaurusEntries, upsertThesaurusEntry, deleteThesaurusEntry } from '../pkm.service.js'
import { searchPkmEntries } from '../pkm.search.js'
import { getStoreSop, getRetrieveSop } from '../pkm.sop.js'
import { suggestPageIndexing, batchSuggestIndexing } from '../pkm.ai.js'
import { pkmRouter } from '../pkm.routes.js'

const mockGetPkmSummary = vi.mocked(getPkmSummary)
const mockReindexPkm = vi.mocked(reindexPkm)
const mockListThesaurusEntries = vi.mocked(listThesaurusEntries)
const mockUpsertThesaurusEntry = vi.mocked(upsertThesaurusEntry)
const mockDeleteThesaurusEntry = vi.mocked(deleteThesaurusEntry)
const mockSearchPkmEntries = vi.mocked(searchPkmEntries)
const mockGetStoreSop = vi.mocked(getStoreSop)
const mockGetRetrieveSop = vi.mocked(getRetrieveSop)
const mockSuggestPageIndexing = vi.mocked(suggestPageIndexing)
const mockBatchSuggestIndexing = vi.mocked(batchSuggestIndexing)

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pkm', pkmRouter)
  // Error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status || 500).json({ error: err.message })
  })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pkm.routes — GET /api/pkm/summary', () => {
  it('返回概览统计', async () => {
    const summary = {
      totalEntries: 10,
      bySource: { wiki: 5, memory: 3, skill: 2 },
      byCategory: { knowledge: 5, memory: 3, skill: 2 },
      thesaurusSize: 3,
      lastIndexAt: '2025-01-01T00:00:00.000Z',
    }
    mockGetPkmSummary.mockResolvedValue(summary)

    const app = createApp()
    const res = await request(app).get('/api/pkm/summary')

    expect(res.status).toBe(200)
    expect(res.body.totalEntries).toBe(10)
    expect(res.body.bySource.wiki).toBe(5)
    expect(res.body.thesaurusSize).toBe(3)
  })
})

describe('pkm.routes — POST /api/pkm/search', () => {
  it('搜索请求返回结果', async () => {
    const searchResponse = {
      results: [
        {
          entry: { id: 'wiki:test', title: '测试', source: 'wiki', category: 'knowledge' },
          score: 10,
          matches: [{ field: 'title', snippet: '...测试...' }],
          sourceLabel: 'wiki',
          navigateUrl: '/wiki?page=test',
        },
      ],
      total: 1,
    }
    mockSearchPkmEntries.mockResolvedValue(searchResponse as any)

    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/search')
      .send({ expression: '测试' })

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.results[0].entry.title).toBe('测试')
  })

  it('expression 不是字符串返回 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/search')
      .send({ expression: 123 })

    expect(res.status).toBe(400)
  })

  it('带 scope 参数搜索', async () => {
    mockSearchPkmEntries.mockResolvedValue({ results: [], total: 0 })

    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/search')
      .send({
        expression: '测试',
        categories: ['knowledge'],
        sources: ['wiki'],
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      })

    expect(res.status).toBe(200)
    expect(mockSearchPkmEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        expression: '测试',
        categories: ['knowledge'],
        sources: ['wiki'],
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      }),
    )
  })

  it('无 body 时返回 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/search')
      .send()

    expect(res.status).toBe(400)
  })
})

describe('pkm.routes — POST /api/pkm/reindex', () => {
  it('重建索引返回统计', async () => {
    mockReindexPkm.mockResolvedValue({
      totalEntries: 5,
      bySource: { wiki: 5 },
      byCategory: { knowledge: 5 },
    })

    const app = createApp()
    const res = await request(app).post('/api/pkm/reindex')

    expect(res.status).toBe(200)
    expect(res.body.totalEntries).toBe(5)
  })
})

describe('pkm.routes — GET /api/pkm/thesaurus', () => {
  it('获取词表', async () => {
    const entries = [
      { term: '前端', synonyms: ['frontend'], category: 'all', createdAt: '', updatedAt: '' },
    ]
    mockListThesaurusEntries.mockResolvedValue(entries as any)

    const app = createApp()
    const res = await request(app).get('/api/pkm/thesaurus')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].term).toBe('前端')
  })
})

describe('pkm.routes — POST /api/pkm/thesaurus', () => {
  it('创建/更新词条', async () => {
    const entry = {
      term: '前端',
      synonyms: ['frontend', 'front-end'],
      category: 'knowledge',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    mockUpsertThesaurusEntry.mockResolvedValue(entry as any)

    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/thesaurus')
      .send({ term: '前端', synonyms: ['frontend', 'front-end'], category: 'knowledge' })

    expect(res.status).toBe(200)
    expect(res.body.term).toBe('前端')
    expect(mockUpsertThesaurusEntry).toHaveBeenCalledWith({
      term: '前端',
      synonyms: ['frontend', 'front-end'],
      category: 'knowledge',
    })
  })

  it('term 为空字符串返回 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/thesaurus')
      .send({ term: '  ', synonyms: ['a'] })

    expect(res.status).toBe(400)
  })

  it('term 不是字符串返回 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/thesaurus')
      .send({ term: 123, synonyms: ['a'] })

    expect(res.status).toBe(400)
  })

  it('synonyms 不是数组返回 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/thesaurus')
      .send({ term: '前端', synonyms: 'not-array' })

    expect(res.status).toBe(400)
  })

  it('synonyms 中的空字符串被过滤', async () => {
    mockUpsertThesaurusEntry.mockResolvedValue({} as any)

    const app = createApp()
    await request(app)
      .post('/api/pkm/thesaurus')
      .send({ term: '测试', synonyms: ['a', '', '  ', 'b'] })

    expect(mockUpsertThesaurusEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        synonyms: ['a', 'b'],
      }),
    )
  })
})

describe('pkm.routes — DELETE /api/pkm/thesaurus/:term', () => {
  it('删除词条', async () => {
    mockDeleteThesaurusEntry.mockResolvedValue(undefined)

    const app = createApp()
    const res = await request(app).delete('/api/pkm/thesaurus/%E5%89%8D%E7%AB%AF')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(mockDeleteThesaurusEntry).toHaveBeenCalledWith('前端')
  })
})

describe('pkm.routes — GET /api/pkm/sop/store', () => {
  it('获取存储 SOP', async () => {
    const sop = {
      title: '知识存储 SOP',
      description: '三步引导流程',
      steps: [
        { title: '步骤1', description: '描述1', tips: ['提示1'] },
      ],
    }
    mockGetStoreSop.mockReturnValue(sop)

    const app = createApp()
    const res = await request(app).get('/api/pkm/sop/store')

    expect(res.status).toBe(200)
    expect(res.body.title).toBe('知识存储 SOP')
    expect(res.body.steps).toHaveLength(1)
  })
})

describe('pkm.routes — GET /api/pkm/sop/retrieve', () => {
  it('获取检索 SOP', async () => {
    const sop = {
      title: '知识检索 SOP',
      description: '四步引导流程',
      steps: [
        { title: '步骤1', description: '描述1', tips: [] },
      ],
    }
    mockGetRetrieveSop.mockReturnValue(sop)

    const app = createApp()
    const res = await request(app).get('/api/pkm/sop/retrieve')

    expect(res.status).toBe(200)
    expect(res.body.title).toBe('知识检索 SOP')
  })
})

describe('pkm.routes — POST /api/pkm/suggest-indexing', () => {
  it('AI 标引建议', async () => {
    const suggestion = {
      keywords: ['k1', 'k2'],
      subjectTerms: ['s1'],
      aliases: [],
      category: 'knowledge' as const,
      scene: '场景',
      titleStandard: '标准标题',
    }
    mockSuggestPageIndexing.mockResolvedValue(suggestion)

    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/suggest-indexing')
      .send({ title: '测试', content: '内容', category: 'knowledge' })

    expect(res.status).toBe(200)
    expect(res.body.keywords).toEqual(['k1', 'k2'])
  })

  it('title 为空返回 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/suggest-indexing')
      .send({ title: '  ', content: '内容' })

    expect(res.status).toBe(400)
  })

  it('content 不是字符串返回 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/suggest-indexing')
      .send({ title: '测试', content: 123 })

    expect(res.status).toBe(400)
  })
})

describe('pkm.routes — POST /api/pkm/batch-index', () => {
  it('批量标引', async () => {
    mockBatchSuggestIndexing.mockResolvedValue([
      { keywords: ['k1'], subjectTerms: [], aliases: [], category: 'knowledge', scene: '', titleStandard: '' },
      { keywords: ['k2'], subjectTerms: [], aliases: [], category: 'knowledge', scene: '', titleStandard: '' },
    ])

    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/batch-index')
      .send({
        pages: [
          { title: '页面1', content: '内容1', category: 'knowledge' },
          { title: '页面2', content: '内容2', category: 'experience' },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })

  it('pages 不是数组返回 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/pkm/batch-index')
      .send({ pages: 'not-array' })

    expect(res.status).toBe(400)
  })

  it('超过 20 页时截断', async () => {
    mockBatchSuggestIndexing.mockResolvedValue([])

    const pages = Array.from({ length: 25 }, (_, i) => ({
      title: `页面${i}`,
      content: `内容${i}`,
      category: 'knowledge',
    }))

    const app = createApp()
    await request(app)
      .post('/api/pkm/batch-index')
      .send({ pages })

    // Should only send 20 pages to batchSuggestIndexing
    expect(mockBatchSuggestIndexing).toHaveBeenCalledTimes(1)
    const calledPages = mockBatchSuggestIndexing.mock.calls[0][0]
    expect(calledPages).toHaveLength(20)
  })
})
