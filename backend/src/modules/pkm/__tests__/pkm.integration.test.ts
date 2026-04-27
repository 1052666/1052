import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-pkm-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('PKM integration', () => {
  it('builds index from wiki pages and searches them', async () => {
    const wikiService = await import('../../wiki/wiki.service.js')
    const pkmService = await import('../pkm.service.js')
    const pkmSearch = await import('../pkm.search.js')

    // Create a wiki page
    await wikiService.writeWikiPage({
      title: 'React Hooks',
      category: 'concept',
      tags: ['react', 'hooks', 'frontend'],
      summary: 'React Hooks 是 React 16.8 引入的特性',
      content: '# React Hooks\n\nReact Hooks 是 React 16.8 引入的新特性，允许在函数组件中使用状态和副作用。',
    })

    await wikiService.writeWikiPage({
      title: 'TypeScript 泛型',
      category: 'concept',
      tags: ['typescript', 'generics'],
      summary: 'TypeScript 泛型提供了类型参数化的能力',
      content: '# TypeScript 泛型\n\n泛型允许创建可复用的类型安全组件。',
    })

    // Build PKM index
    const result = await pkmService.reindexPkm()
    expect(result.totalEntries).toBeGreaterThanOrEqual(2)

    // Get summary
    const summary = await pkmService.getPkmSummary()
    expect(summary.totalEntries).toBeGreaterThanOrEqual(2)
    expect(summary.bySource.wiki).toBeGreaterThanOrEqual(2)
    expect(summary.byCategory.knowledge).toBeGreaterThanOrEqual(2)

    // Search
    const searchResult = await pkmSearch.searchPkmEntries({ expression: 'React' })
    expect(searchResult.total).toBeGreaterThanOrEqual(1)
    expect(searchResult.results.some((r) => r.entry.title.includes('React'))).toBe(true)

    // Search with NOT
    const notResult = await pkmSearch.searchPkmEntries({ expression: 'TypeScript NOT React' })
    expect(notResult.results.some((r) => r.entry.title.includes('TypeScript'))).toBe(true)
  })

  it('manages thesaurus entries and expands synonyms', async () => {
    const pkmService = await import('../pkm.service.js')

    // Create thesaurus entry
    const entry = await pkmService.upsertThesaurusEntry({
      term: '前端',
      synonyms: ['frontend', 'front-end'],
      category: 'knowledge',
    })
    expect(entry.term).toBe('前端')
    expect(entry.synonyms).toContain('frontend')

    // List entries
    const entries = await pkmService.listThesaurusEntries()
    expect(entries.length).toBeGreaterThanOrEqual(1)

    // Expand synonyms
    const expanded = await pkmService.expandSynonyms('前端')
    expect(expanded).toContain('前端')
    expect(expanded).toContain('frontend')

    // Delete entry
    await pkmService.deleteThesaurusEntry('前端')
    const afterDelete = await pkmService.listThesaurusEntries()
    expect(afterDelete.find((e) => e.term === '前端')).toBeUndefined()
  })

  it('tokenizes Chinese and English text', async () => {
    const { tokenize } = await import('../pkm.service.js')

    const tokens = tokenize('React Hooks 是 React 16.8 的特性')
    // Should extract CJK bigrams and English words
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.some((t) => t.toLowerCase().includes('react'))).toBe(true)
  })

  it('searches with category filters', async () => {
    const wikiService = await import('../../wiki/wiki.service.js')
    const pkmService = await import('../pkm.service.js')
    const pkmSearch = await import('../pkm.search.js')

    await wikiService.writeWikiPage({
      title: '部署经验',
      category: 'experience',
      content: '# 部署经验\n\n部署到生产环境的经验总结。',
    })

    await pkmService.reindexPkm()

    const allResults = await pkmSearch.searchPkmEntries({ expression: '部署' })
    expect(allResults.total).toBeGreaterThanOrEqual(1)

    const filteredResults = await pkmSearch.searchPkmEntries({
      expression: '部署',
      categories: ['experience'],
    })
    expect(filteredResults.results.every((r) => r.entry.category === 'experience')).toBe(true)
  })

  it('stores and loads thesaurus via JSON persistence', async () => {
    const pkmService = await import('../pkm.service.js')

    // Initially empty
    const initial = await pkmService.listThesaurusEntries()
    expect(initial).toEqual([])

    // Add entries
    await pkmService.upsertThesaurusEntry({
      term: '知识管理',
      synonyms: ['PKM', 'personal knowledge management'],
    })
    await pkmService.upsertThesaurusEntry({
      term: '数据库',
      synonyms: ['DB', 'database'],
    })

    // Reload and verify persistence
    const entries = await pkmService.listThesaurusEntries()
    expect(entries.length).toBe(2)
  })
})
