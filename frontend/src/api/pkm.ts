import { api } from './client'

export type PkmCategory = 'knowledge' | 'experience' | 'skill' | 'memory' | 'resource' | 'action'
export type PkmSource = 'wiki' | 'memory' | 'skill' | 'resource' | 'calendar-event' | 'calendar-task'

export type PkmSummary = {
  totalEntries: number
  bySource: Record<string, number>
  byCategory: Record<string, number>
  thesaurusSize: number
  lastIndexAt: string | null
}

export type PkmSearchResult = {
  entry: {
    id: string
    source: PkmSource
    sourceId: string
    category: PkmCategory
    title: string
    summary: string
    content: string
    keywords: string[]
    subjectTerms: string[]
    aliases: string[]
    tags: string[]
    scene: string
    navigateUrl: string
    createdAt: number
    updatedAt: number
  }
  score: number
  matches: Array<{ field: string; snippet: string }>
  sourceLabel: string
  navigateUrl: string
}

export type PkmSearchResponse = {
  results: PkmSearchResult[]
  total: number
  fallbackUsed?: string
}

export type PkmThesaurusEntry = {
  term: string
  synonyms: string[]
  category: PkmCategory | 'all'
  createdAt: string
  updatedAt: string
}

export type PkmIndexSuggestion = {
  keywords: string[]
  subjectTerms: string[]
  aliases: string[]
  category: PkmCategory
  scene: string
  titleStandard: string
}

export type PkmSopStep = {
  title: string
  description: string
  tips: string[]
}

export type PkmSop = {
  title: string
  description: string
  steps: PkmSopStep[]
}

export const PkmApi = {
  getSummary: () => api.get<PkmSummary>('/pkm/summary'),
  search: (expression: string, categories?: PkmCategory[], sources?: PkmSource[]) =>
    api.post<PkmSearchResponse>('/pkm/search', { expression, categories, sources }),
  reindex: () => api.post<{ totalEntries: number; bySource: Record<string, number>; byCategory: Record<string, number> }>('/pkm/reindex', {}),
  listThesaurus: () => api.get<PkmThesaurusEntry[]>('/pkm/thesaurus'),
  upsertThesaurus: (term: string, synonyms: string[], category?: PkmCategory | 'all') =>
    api.post<PkmThesaurusEntry>('/pkm/thesaurus', { term, synonyms, category }),
  deleteThesaurus: (term: string) => api.delete<{ ok: boolean }>(`/pkm/thesaurus/${encodeURIComponent(term)}`),
  suggestIndexing: (title: string, content: string, category: PkmCategory = 'knowledge') =>
    api.post<PkmIndexSuggestion>('/pkm/suggest-indexing', { title, content, category }),
  batchIndex: (pages: Array<{ title: string; content: string; category: PkmCategory }>) =>
    api.post<PkmIndexSuggestion[]>('/pkm/batch-index', { pages }),
  getStoreSop: () => api.get<PkmSop>('/pkm/sop/store'),
  getRetrieveSop: () => api.get<PkmSop>('/pkm/sop/retrieve'),
}
