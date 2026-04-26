export type PkmCategory = 'knowledge' | 'experience' | 'skill' | 'memory' | 'resource' | 'action'

export type PkmSource = 'wiki' | 'memory' | 'skill' | 'resource' | 'calendar-event' | 'calendar-task'

export type PkmIndexEntry = {
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

export type PkmThesaurusEntry = {
  term: string
  synonyms: string[]
  category: PkmCategory | 'all'
  createdAt: string
  updatedAt: string
}

export type PkmInvertedIndexEntry = {
  term: string
  entries: Array<{
    id: string
    weight: number
    matchedField: 'title' | 'summary' | 'index' | 'content'
  }>
}

export type PkmInvertedIndex = Record<string, PkmInvertedIndexEntry>

export type PkmSearchQuery = {
  expression: string
  categories?: PkmCategory[]
  sources?: PkmSource[]
  dateFrom?: string
  dateTo?: string
}

export type PkmSearchResult = {
  entry: PkmIndexEntry
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

export type PkmIndexSuggestion = {
  keywords: string[]
  subjectTerms: string[]
  aliases: string[]
  category: PkmCategory
  scene: string
  titleStandard: string
}

export type PkmSummary = {
  totalEntries: number
  bySource: Record<string, number>
  byCategory: Record<string, number>
  thesaurusSize: number
  lastIndexAt: string | null
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
