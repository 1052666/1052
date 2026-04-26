import { loadPkmIndex, loadInvertedIndex, listThesaurusEntries, expandSynonymsWithEntries, tokenize, getSourceLabel, reindexPkm } from './pkm.service.js'
import type { PkmSearchQuery, PkmSearchResult, PkmSearchResponse, PkmIndexEntry } from './pkm.types.js'

// Boolean query AST node types
type BoolNode =
  | { type: 'term'; value: string; exact: boolean }
  | { type: 'and'; children: BoolNode[] }
  | { type: 'or'; children: BoolNode[] }
  | { type: 'not'; child: BoolNode }

const MAX_PARSE_DEPTH = 20

function parseBooleanQuery(expression: string): BoolNode {
  const tokens = tokenizeQuery(expression)
  const pos = { index: 0 }
  const depth = { value: 0 }
  const node = parseOrExpression(tokens, pos, depth)
  return node
}

function tokenizeQuery(expression: string): string[] {
  const tokens: string[] = []
  let i = 0
  const s = expression.trim()
  while (i < s.length) {
    if (s[i] === ' ' || s[i] === '\t') {
      i++
      continue
    }
    if (s.slice(i, i + 3).toUpperCase() === 'AND' && (i + 3 >= s.length || s[i + 3] === ' ' || s[i + 3] === '(' || s[i + 3] === ')')) {
      tokens.push('AND')
      i += 3
      continue
    }
    if (s.slice(i, i + 2).toUpperCase() === 'OR' && (i + 2 >= s.length || s[i + 2] === ' ' || s[i + 2] === '(' || s[i + 2] === ')')) {
      tokens.push('OR')
      i += 2
      continue
    }
    if (s.slice(i, i + 3).toUpperCase() === 'NOT' && (i + 3 >= s.length || s[i + 3] === ' ' || s[i + 3] === '(')) {
      tokens.push('NOT')
      i += 3
      continue
    }
    if (s[i] === '-' && tokens.length > 0 && (tokens[tokens.length - 1] === 'AND' || tokens[tokens.length - 1] === 'OR' || tokens[tokens.length - 1] === '(')) {
      tokens.push('NOT')
      i++
      continue
    }
    if (s[i] === '-' && tokens.length === 0) {
      tokens.push('NOT')
      i++
      continue
    }
    if (s[i] === '(') { tokens.push('('); i++; continue }
    if (s[i] === ')') { tokens.push(')'); i++; continue }
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1)
      if (end > i) {
        tokens.push(`"${s.slice(i + 1, end)}"`)
        i = end + 1
        continue
      }
    }
    // Regular term
    let term = ''
    while (i < s.length && s[i] !== ' ' && s[i] !== '(' && s[i] !== ')' && s[i] !== '"') {
      term += s[i]
      i++
    }
    if (term) tokens.push(term)
  }
  return tokens
}

function parseOrExpression(tokens: string[], pos: { index: number }, depth: { value: number }): BoolNode {
  if (++depth.value > MAX_PARSE_DEPTH) throw new Error('Query too deeply nested')
  try {
    const children: BoolNode[] = [parseAndExpression(tokens, pos, depth)]
    while (pos.index < tokens.length && tokens[pos.index] === 'OR') {
      pos.index++ // skip OR
      children.push(parseAndExpression(tokens, pos, depth))
    }
    return children.length === 1 ? children[0] : { type: 'or', children }
  } finally {
    depth.value--
  }
}

function parseAndExpression(tokens: string[], pos: { index: number }, depth: { value: number }): BoolNode {
  if (++depth.value > MAX_PARSE_DEPTH) throw new Error('Query too deeply nested')
  try {
    const children: BoolNode[] = [parseNotExpression(tokens, pos, depth)]
    while (pos.index < tokens.length && tokens[pos.index] !== 'OR' && tokens[pos.index] !== ')') {
      if (tokens[pos.index] === 'AND') pos.index++ // skip explicit AND
      children.push(parseNotExpression(tokens, pos, depth))
    }
    return children.length === 1 ? children[0] : { type: 'and', children }
  } finally {
    depth.value--
  }
}

function parseNotExpression(tokens: string[], pos: { index: number }, depth: { value: number }): BoolNode {
  if (pos.index < tokens.length && tokens[pos.index] === 'NOT') {
    pos.index++ // skip NOT
    return { type: 'not', child: parsePrimary(tokens, pos, depth) }
  }
  return parsePrimary(tokens, pos, depth)
}

function parsePrimary(tokens: string[], pos: { index: number }, depth: { value: number }): BoolNode {
  if (pos.index >= tokens.length) return { type: 'term', value: '', exact: false }
  if (tokens[pos.index] === '(') {
    pos.index++ // skip (
    const node = parseOrExpression(tokens, pos, depth)
    if (pos.index < tokens.length && tokens[pos.index] === ')') pos.index++ // skip )
    return node
  }
  const token = tokens[pos.index++]
  if (token.startsWith('"') && token.endsWith('"')) {
    return { type: 'term', value: token.slice(1, -1), exact: true }
  }
  return { type: 'term', value: token, exact: false }
}

type EntrySearchCache = {
  text: string
  tokens: string[]
}

function buildEntrySearchCache(entry: PkmIndexEntry): EntrySearchCache {
  const text = `${entry.title} ${entry.summary} ${entry.content} ${entry.tags.join(' ')} ${entry.keywords.join(' ')} ${entry.subjectTerms.join(' ')} ${entry.aliases.join(' ')} ${entry.scene}`.toLowerCase()
  const tokens = tokenize(text)
  return { text, tokens }
}

function evaluateNode(node: BoolNode, cache: EntrySearchCache, expandedTerms: Map<string, Set<string>>): boolean {
  switch (node.type) {
    case 'term': {
      if (!node.value) return true
      const { text, tokens } = cache
      if (node.exact) {
        return text.includes(node.value.toLowerCase())
      }
      // Check the term itself or any of its synonyms
      const synonyms = expandedTerms.get(node.value.toLowerCase()) ?? new Set([node.value.toLowerCase()])
      for (const syn of synonyms) {
        if (text.includes(syn.toLowerCase())) return true
      }
      // Also check prefix matching for CJK
      for (const t of tokens) {
        for (const syn of synonyms) {
          if (t.includes(syn.toLowerCase()) || syn.toLowerCase().includes(t)) return true
        }
      }
      return false
    }
    case 'and':
      return node.children.every((child) => evaluateNode(child, cache, expandedTerms))
    case 'or':
      return node.children.some((child) => evaluateNode(child, cache, expandedTerms))
    case 'not':
      return !evaluateNode(node.child, cache, expandedTerms)
  }
}

function scoreEntry(entry: PkmIndexEntry, terms: string[]): number {
  const titleLower = entry.title.toLowerCase()
  const summaryLower = entry.summary.toLowerCase()
  const indexTerms = [...entry.keywords, ...entry.subjectTerms, ...entry.aliases, ...entry.tags].join(' ').toLowerCase()
  const contentLower = entry.content.toLowerCase()

  let score = 0
  for (const term of terms) {
    const t = term.toLowerCase()
    if (titleLower.includes(t)) score += 4
    if (summaryLower.includes(t)) score += 3
    if (indexTerms.includes(t)) score += 2
    if (contentLower.includes(t)) score += 1
  }
  return score
}

function buildSnippet(text: string, term: string, maxLen = 120): string {
  const lower = text.toLowerCase()
  const idx = lower.indexOf(term.toLowerCase())
  if (idx < 0) return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '')
  const start = Math.max(0, idx - 40)
  const end = Math.min(text.length, idx + term.length + 40)
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
}

function extractTerms(node: BoolNode): string[] {
  switch (node.type) {
    case 'term': return node.value ? [node.value] : []
    case 'and':
    case 'or': return node.children.flatMap(extractTerms)
    case 'not': return extractTerms(node.child)
  }
}

export async function searchPkmEntries(query: PkmSearchQuery): Promise<PkmSearchResponse> {
  let entries = await loadPkmIndex()

  // Auto-reindex if index is empty
  if (entries.length === 0) {
    await reindexPkm().catch(() => {})
    entries = await loadPkmIndex()
  }

  // Filter by categories
  if (query.categories?.length) {
    const catSet = new Set(query.categories)
    entries = entries.filter((e) => catSet.has(e.category))
  }

  // Filter by sources
  if (query.sources?.length) {
    const srcSet = new Set(query.sources)
    entries = entries.filter((e) => srcSet.has(e.source))
  }

  // Filter by date range
  if (query.dateFrom) {
    const from = new Date(query.dateFrom).getTime()
    entries = entries.filter((e) => e.updatedAt >= from)
  }
  if (query.dateTo) {
    const to = new Date(query.dateTo).getTime() + 86400000 // include the end day
    entries = entries.filter((e) => e.updatedAt <= to)
  }

  // If no expression, return all filtered entries
  if (!query.expression?.trim()) {
    return {
      results: entries.map((entry) => ({
        entry,
        score: 0,
        matches: [],
        sourceLabel: getSourceLabel(entry.source),
        navigateUrl: entry.navigateUrl,
      })),
      total: entries.length,
    }
  }

  // Expand synonyms for all terms
  let ast: BoolNode
  let fallbackUsed: string | undefined
  try {
    ast = parseBooleanQuery(query.expression)
  } catch {
    // If parsing fails, treat entire expression as a single term
    ast = { type: 'term', value: query.expression, exact: false }
  }

  const terms = extractTerms(ast)
  const thesaurusEntries = await listThesaurusEntries()
  const expandedTerms = new Map<string, Set<string>>()
  for (const term of terms) {
    if (!expandedTerms.has(term.toLowerCase())) {
      const synonyms = expandSynonymsWithEntries(thesaurusEntries, term)
      expandedTerms.set(term.toLowerCase(), new Set(synonyms.map((s) => s.toLowerCase())))
    }
  }

  // Evaluate query against entries
  let matched = entries.filter((entry) => {
    const cache = buildEntrySearchCache(entry)
    return evaluateNode(ast, cache, expandedTerms)
  })

  // Fallback: if no results, try prefix matching
  if (matched.length === 0 && terms.length > 0) {
    fallbackUsed = 'prefix'
    const invIndex = await loadInvertedIndex()
    const entryMap = new Map(entries.map((e) => [e.id, e]))
    const matchedIds = new Set<string>()
    for (const term of terms) {
      const prefix = term.toLowerCase()
      for (const [key, value] of Object.entries(invIndex)) {
        if (key.startsWith(prefix) || prefix.startsWith(key)) {
          for (const e of value.entries) {
            if (entryMap.has(e.id)) matchedIds.add(e.id)
          }
        }
      }
    }
    matched = [...matchedIds].map((id) => entryMap.get(id)!).filter(Boolean)
  }

  // Fallback: still no results, try broader search with individual characters
  if (matched.length === 0 && terms.length > 0) {
    fallbackUsed = 'broad'
    const allText = entries.map((entry) => ({
      entry,
      text: `${entry.title} ${entry.summary} ${entry.content} ${entry.tags.join(' ')} ${entry.keywords.join(' ')} ${entry.scene}`.toLowerCase(),
    }))
    for (const term of terms) {
      const t = term.toLowerCase()
      for (const item of allText) {
        if (item.text.includes(t) && !matched.includes(item.entry)) {
          matched.push(item.entry)
        }
      }
    }
  }

  // Score and sort results
  const results: PkmSearchResult[] = matched.map((entry) => {
    const score = scoreEntry(entry, terms)
    const matches: Array<{ field: string; snippet: string }> = []
    for (const term of terms) {
      if (entry.title.toLowerCase().includes(term.toLowerCase())) {
        matches.push({ field: 'title', snippet: buildSnippet(entry.title, term) })
      }
      if (entry.summary.toLowerCase().includes(term.toLowerCase())) {
        matches.push({ field: 'summary', snippet: buildSnippet(entry.summary, term) })
      }
    }
    return {
      entry,
      score,
      matches: matches.slice(0, 5),
      sourceLabel: getSourceLabel(entry.source),
      navigateUrl: entry.navigateUrl,
    }
  })

  results.sort((a, b) => b.score - a.score)

  return {
    results,
    total: results.length,
    fallbackUsed,
  }
}
