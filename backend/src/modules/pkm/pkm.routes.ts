import { Router } from 'express'
import { httpError } from '../../http-error.js'
import { getPkmSummary, reindexPkm, listThesaurusEntries, upsertThesaurusEntry, deleteThesaurusEntry } from './pkm.service.js'
import { searchPkmEntries } from './pkm.search.js'
import { getStoreSop, getRetrieveSop } from './pkm.sop.js'
import { suggestPageIndexing, batchSuggestIndexing } from './pkm.ai.js'

export const pkmRouter: Router = Router()

// Summary
pkmRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await getPkmSummary())
  } catch (error) {
    next(error)
  }
})

// Reindex
pkmRouter.post('/reindex', async (_req, res, next) => {
  try {
    res.json(await reindexPkm())
  } catch (error) {
    next(error)
  }
})

// Search
pkmRouter.post('/search', async (req, res, next) => {
  try {
    const query = req.body ?? {}
    if (typeof query.expression !== 'string') throw httpError(400, 'expression 必须是字符串')
    res.json(await searchPkmEntries({
      expression: query.expression,
      categories: Array.isArray(query.categories) ? query.categories : undefined,
      sources: Array.isArray(query.sources) ? query.sources : undefined,
      dateFrom: typeof query.dateFrom === 'string' ? query.dateFrom : undefined,
      dateTo: typeof query.dateTo === 'string' ? query.dateTo : undefined,
    }))
  } catch (error) {
    next(error)
  }
})

// Thesaurus
pkmRouter.get('/thesaurus', async (_req, res, next) => {
  try {
    res.json(await listThesaurusEntries())
  } catch (error) {
    next(error)
  }
})

pkmRouter.post('/thesaurus', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    if (typeof body.term !== 'string' || !body.term.trim()) throw httpError(400, 'term 必须是非空字符串')
    if (!Array.isArray(body.synonyms)) throw httpError(400, 'synonyms 必须是数组')
    res.json(await upsertThesaurusEntry({
      term: body.term.trim(),
      synonyms: body.synonyms.map(String).map((s: string) => s.trim()).filter(Boolean),
      category: body.category,
    }))
  } catch (error) {
    next(error)
  }
})

pkmRouter.delete('/thesaurus/:term', async (req, res, next) => {
  try {
    const term = req.params.term
    if (!term) throw httpError(400, 'term 不能为空')
    await deleteThesaurusEntry(decodeURIComponent(term))
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

// SOP
pkmRouter.get('/sop/store', (_req, res) => {
  res.json(getStoreSop())
})

pkmRouter.get('/sop/retrieve', (_req, res) => {
  res.json(getRetrieveSop())
})

// AI-assisted indexing
pkmRouter.post('/suggest-indexing', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    if (typeof body.title !== 'string' || !body.title.trim()) throw httpError(400, 'title 必须是非空字符串')
    if (typeof body.content !== 'string') throw httpError(400, 'content 必须是字符串')
    res.json(await suggestPageIndexing({
      title: body.title.trim(),
      content: body.content,
      category: body.category ?? 'knowledge',
    }))
  } catch (error) {
    next(error)
  }
})

pkmRouter.post('/batch-index', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    if (!Array.isArray(body.pages)) throw httpError(400, 'pages 必须是数组')
    const pages = body.pages.slice(0, 20).map((p: Record<string, unknown>) => ({
      title: String(p.title ?? ''),
      content: String(p.content ?? ''),
      category: (p.category ?? 'knowledge') as string,
    }))
    res.json(await batchSuggestIndexing(pages))
  } catch (error) {
    next(error)
  }
})
