import { describe, it, expect } from 'vitest'
import { parseFrontmatter, renderFrontmatter, normalizePageFromRaw } from '../wiki.markdown.js'

describe('wiki.markdown — PKM Phase 1 改造', () => {
  describe('parseFrontmatter — 解析新字段', () => {
    it('解析包含所有新字段的 frontmatter', () => {
      const raw = [
        '---',
        'tags: [tag1, tag2]',
        'category: entity',
        'source_count: 3',
        'last_updated: 2025-01-15',
        'sources: [a.md, b.md]',
        'summary: 测试摘要',
        'keywords: [关键词1, 关键词2, 关键词3]',
        'subject_terms: [主题词1, 主题词2]',
        'aliases: [别名1, 别名2]',
        'scene: 适用场景描述',
        'title_standard: 标准化标题',
        '---',
        '',
        '# 正文内容',
      ].join('\n')

      const result = parseFrontmatter(raw)
      expect(result.frontmatter).not.toBeNull()
      const fm = result.frontmatter!

      expect(fm.tags).toEqual(['tag1', 'tag2'])
      expect(fm.category).toBe('entity')
      expect(fm.summary).toBe('测试摘要')
      expect(fm.keywords).toEqual(['关键词1', '关键词2', '关键词3'])
      expect(fm.subject_terms).toEqual(['主题词1', '主题词2'])
      expect(fm.aliases).toEqual(['别名1', '别名2'])
      expect(fm.scene).toBe('适用场景描述')
      expect(fm.title_standard).toBe('标准化标题')
      expect(result.body.trim()).toBe('# 正文内容')
    })

    it('解析不包含新字段的旧 frontmatter（向后兼容）', () => {
      const raw = [
        '---',
        'tags: [old-tag]',
        'category: concept',
        'source_count: 1',
        'last_updated: 2024-06-01',
        'sources: [src.md]',
        'summary: 旧格式摘要',
        '---',
        '',
        '# 旧页面',
      ].join('\n')

      const result = parseFrontmatter(raw)
      expect(result.frontmatter).not.toBeNull()
      const fm = result.frontmatter!

      expect(fm.tags).toEqual(['old-tag'])
      expect(fm.category).toBe('concept')
      expect(fm.summary).toBe('旧格式摘要')
      // 新字段应返回空数组/空字符串
      expect(fm.keywords).toEqual([])
      expect(fm.subject_terms).toEqual([])
      expect(fm.aliases).toEqual([])
      expect(fm.scene).toBe('')
      expect(fm.title_standard).toBe('')
    })

    it('解析没有 frontmatter 的原始文本', () => {
      const raw = '# 无 frontmatter 的页面\n\n正文内容'
      const result = parseFrontmatter(raw)
      expect(result.frontmatter).toBeNull()
      expect(result.body).toBe(raw)
    })

    it('解析只有部分新字段的 frontmatter', () => {
      const raw = [
        '---',
        'tags: [tag]',
        'category: synthesis',
        'source_count: 0',
        'last_updated: 2025-03-01',
        'sources: []',
        'summary: 部分',
        'keywords: [kw1]',
        'scene: 部分场景',
        '---',
        '',
        '# 部分',
      ].join('\n')

      const result = parseFrontmatter(raw)
      const fm = result.frontmatter!
      expect(fm.keywords).toEqual(['kw1'])
      expect(fm.subject_terms).toEqual([])
      expect(fm.aliases).toEqual([])
      expect(fm.scene).toBe('部分场景')
      expect(fm.title_standard).toBe('')
    })
  })

  describe('renderFrontmatter — 渲染新字段', () => {
    it('有新字段时输出对应行', () => {
      const fm = {
        tags: ['tag1'],
        category: 'entity' as const,
        source_count: 2,
        last_updated: '2025-01-01',
        sources: ['a.md', 'b.md'],
        summary: '测试摘要',
        keywords: ['kw1', 'kw2'],
        subject_terms: ['st1'],
        aliases: ['alias1'],
        scene: '使用场景',
        title_standard: '标准标题',
      }

      const rendered = renderFrontmatter(fm)

      expect(rendered).toContain('keywords: [kw1, kw2]')
      expect(rendered).toContain('subject_terms: [st1]')
      expect(rendered).toContain('aliases: [alias1]')
      expect(rendered).toContain('scene: 使用场景')
      expect(rendered).toContain('title_standard: 标准标题')
    })

    it('无新字段时不输出额外行', () => {
      const fm = {
        tags: ['tag1'],
        category: 'concept' as const,
        source_count: 0,
        last_updated: '2024-01-01',
        sources: [] as string[],
        summary: '旧摘要',
        keywords: [] as string[],
        subject_terms: [] as string[],
        aliases: [] as string[],
        scene: '',
        title_standard: '',
      }

      const rendered = renderFrontmatter(fm)

      expect(rendered).not.toContain('keywords:')
      expect(rendered).not.toContain('subject_terms:')
      expect(rendered).not.toContain('aliases:')
      expect(rendered).not.toContain('scene:')
      expect(rendered).not.toContain('title_standard:')
      expect(rendered).toContain('tags: [tag1]')
      expect(rendered).toContain('category: concept')
    })
  })

  describe('experience 分类推断', () => {
    it('路径前缀为 "经验/" 时推断为 experience', () => {
      const page = normalizePageFromRaw({
        path: '经验/部署踩坑.md',
        raw: '# 部署踩坑\n\n正文',
        size: 100,
        updatedAt: Date.now(),
      })
      expect(page.category).toBe('experience')
    })

    it('路径前缀为 "实体/" 时推断为 entity', () => {
      const page = normalizePageFromRaw({
        path: '实体/React.md',
        raw: '# React\n\n正文',
        size: 100,
        updatedAt: Date.now(),
      })
      expect(page.category).toBe('entity')
    })

    it('路径前缀为 "综合分析/" 时推断为 synthesis', () => {
      const page = normalizePageFromRaw({
        path: '综合分析/前端趋势.md',
        raw: '# 前端趋势\n\n正文',
        size: 100,
        updatedAt: Date.now(),
      })
      expect(page.category).toBe('synthesis')
    })

    it('默认路径推断为 concept', () => {
      const page = normalizePageFromRaw({
        path: '核心理念/设计原则.md',
        raw: '# 设计原则\n\n正文',
        size: 100,
        updatedAt: Date.now(),
      })
      expect(page.category).toBe('concept')
    })

    it('有合法 frontmatter 时忽略路径推断', () => {
      const raw = [
        '---',
        'tags: [tag]',
        'category: experience',
        'source_count: 0',
        'last_updated: 2025-01-01',
        'sources: []',
        'summary: 有分类',
        '---',
        '',
        '# 正文',
      ].join('\n')

      const page = normalizePageFromRaw({
        path: '核心理念/实际是经验.md',
        raw,
        size: 200,
        updatedAt: Date.now(),
      })
      expect(page.category).toBe('experience')
    })
  })

  describe('normalizePageFromRaw — 新字段传递', () => {
    it('将 frontmatter 的新字段映射到 WikiPage', () => {
      const raw = [
        '---',
        'tags: [t1]',
        'category: entity',
        'source_count: 1',
        'last_updated: 2025-04-01',
        'sources: [s.md]',
        'summary: 摘要',
        'keywords: [kw1, kw2]',
        'subject_terms: [st1]',
        'aliases: [alias1]',
        'scene: 场景',
        'title_standard: 标准标题',
        '---',
        '',
        '# 页面标题',
      ].join('\n')

      const page = normalizePageFromRaw({
        path: '实体/测试.md',
        raw,
        size: 300,
        updatedAt: Date.now(),
      })

      expect(page.keywords).toEqual(['kw1', 'kw2'])
      expect(page.subjectTerms).toEqual(['st1'])
      expect(page.aliases).toEqual(['alias1'])
      expect(page.scene).toBe('场景')
      expect(page.titleStandard).toBe('标准标题')
      expect(page.title).toBe('页面标题')
      expect(page.hasFrontmatter).toBe(true)
    })

    it('无 frontmatter 时新字段为空值', () => {
      const page = normalizePageFromRaw({
        path: '经验/无格式.md',
        raw: '# 无格式页面\n\n内容',
        size: 50,
        updatedAt: Date.now(),
      })

      expect(page.keywords).toEqual([])
      expect(page.subjectTerms).toEqual([])
      expect(page.aliases).toEqual([])
      expect(page.scene).toBe('')
      expect(page.titleStandard).toBe('')
      expect(page.hasFrontmatter).toBe(false)
    })
  })
})
