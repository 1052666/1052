import fs from 'node:fs/promises'
import path from 'node:path'
import { readJson, writeJson } from '../../storage.js'
import { config } from '../../config.js'
import { listWikiPages } from '../wiki/wiki.service.js'
import { listMemories } from '../memory/memory.service.js'
import { listSkills } from '../skills/skills.service.js'
import { listResources } from '../resources/resources.service.js'
import { listCalendarEvents } from '../calendar/calendar.service.js'
import { listScheduledTasks } from '../calendar/calendar.schedule.service.js'
import type { PkmIndexEntry, PkmInvertedIndex, PkmThesaurusEntry, PkmSummary, PkmSource, PkmCategory } from './pkm.types.js'

const INDEX_FILE = 'pkm/index.json'
const INVERTED_INDEX_FILE = 'pkm/inverted-index.json'
const THESAURUS_FILE = 'pkm/thesaurus.json'

// --- Auto reindex ---

let reindexTimer: ReturnType<typeof setTimeout> | null = null

/** Schedule a debounced reindex (5s). Multiple calls within 5s collapse into one. */
export function schedulePkmReindex(): void {
  if (reindexTimer) clearTimeout(reindexTimer)
  reindexTimer = setTimeout(() => {
    reindexTimer = null
    reindexPkm().catch(() => {})
  }, 5000)
}

/** Ensure PKM index exists. Call on startup. */
export async function ensurePkmIndex(): Promise<void> {
  const indexPath = path.join(config.dataDir, INDEX_FILE)
  try {
    await fs.access(indexPath)
  } catch {
    // Index file doesn't exist, build it
    await reindexPkm().catch(() => {})
  }
}

const SOURCE_LABELS: Record<PkmSource, string> = {
  wiki: 'Wiki',
  memory: '记忆',
  skill: '技能',
  resource: '资源',
  'calendar-event': '日历事件',
  'calendar-task': '定时任务',
}

const WIKI_CATEGORY_MAP: Record<string, PkmCategory> = {
  entity: 'knowledge',
  concept: 'knowledge',
  synthesis: 'knowledge',
  experience: 'experience',
}

function mapWikiPages(pages: Awaited<ReturnType<typeof listWikiPages>>): PkmIndexEntry[] {
  return pages.map((page) => ({
    id: `wiki:${page.path}`,
    source: 'wiki' as PkmSource,
    sourceId: page.path,
    category: WIKI_CATEGORY_MAP[page.category] ?? 'knowledge',
    title: page.title,
    summary: page.summary,
    content: page.content.slice(0, 2000),
    keywords: page.keywords ?? [],
    subjectTerms: page.subjectTerms ?? [],
    aliases: page.aliases ?? [],
    tags: page.tags,
    scene: page.scene ?? '',
    navigateUrl: `/wiki?page=${encodeURIComponent(page.path)}`,
    createdAt: page.updatedAt,
    updatedAt: page.updatedAt,
  }))
}

function mapMemories(memories: Awaited<ReturnType<typeof listMemories>>): PkmIndexEntry[] {
  return memories.map((m) => ({
    id: `memory:${m.id}`,
    source: 'memory' as PkmSource,
    sourceId: m.id,
    category: 'memory' as PkmCategory,
    title: m.title,
    summary: m.content.slice(0, 200),
    content: m.content.slice(0, 2000),
    keywords: [],
    subjectTerms: [],
    aliases: [],
    tags: m.tags,
    scene: '',
    navigateUrl: `/memory?id=${encodeURIComponent(m.id)}`,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }))
}

function mapSkills(skills: Awaited<ReturnType<typeof listSkills>>): PkmIndexEntry[] {
  return skills.map((s) => ({
    id: `skill:${s.id}`,
    source: 'skill' as PkmSource,
    sourceId: s.id,
    category: 'skill' as PkmCategory,
    title: s.name,
    summary: s.description,
    content: s.description,
    keywords: [],
    subjectTerms: [],
    aliases: [],
    tags: [],
    scene: '',
    navigateUrl: `/skills?id=${encodeURIComponent(s.id)}`,
    createdAt: s.updatedAt,
    updatedAt: s.updatedAt,
  }))
}

function mapResources(resources: Awaited<ReturnType<typeof listResources>>): PkmIndexEntry[] {
  return resources.map((r) => ({
    id: `resource:${r.id}`,
    source: 'resource' as PkmSource,
    sourceId: r.id,
    category: 'resource' as PkmCategory,
    title: r.title,
    summary: r.note || r.content.slice(0, 200),
    content: r.content.slice(0, 2000),
    keywords: [],
    subjectTerms: [],
    aliases: [],
    tags: r.tags,
    scene: '',
    navigateUrl: `/resources?id=${encodeURIComponent(r.id)}`,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
}

function mapCalendarEvents(events: Awaited<ReturnType<typeof listCalendarEvents>>): PkmIndexEntry[] {
  return events.map((e) => ({
    id: `calendar-event:${e.id}`,
    source: 'calendar-event' as PkmSource,
    sourceId: e.id,
    category: 'action' as PkmCategory,
    title: e.title,
    summary: e.notes || `${e.date} ${e.startTime}-${e.endTime}`,
    content: `${e.date} ${e.startTime}-${e.endTime}\n${e.location}\n${e.notes}`,
    keywords: [],
    subjectTerms: [],
    aliases: [],
    tags: [],
    scene: '',
    navigateUrl: `/calendar?date=${encodeURIComponent(e.date)}`,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }))
}

function mapScheduledTasks(tasks: Awaited<ReturnType<typeof listScheduledTasks>>): PkmIndexEntry[] {
  return tasks.map((t) => ({
    id: `calendar-task:${t.id}`,
    source: 'calendar-task' as PkmSource,
    sourceId: t.id,
    category: 'action' as PkmCategory,
    title: t.title,
    summary: t.notes || t.prompt || t.command,
    content: `${t.notes}\n${t.prompt}\n${t.command}`.slice(0, 2000),
    keywords: [],
    subjectTerms: [],
    aliases: [],
    tags: [],
    scene: '',
    navigateUrl: `/calendar/schedule?id=${encodeURIComponent(t.id)}`,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }))
}

export function tokenize(text: string): string[] {
  const tokens = new Set<string>()

  // Extract CJK character sequences (2+ consecutive CJK characters)
  const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}]{2,}/gu
  let match: RegExpExecArray | null
  while ((match = cjkPattern.exec(text)) !== null) {
    const str = match[0]
    tokens.add(str)
    // Also add bigrams for better matching
    for (let i = 0; i < str.length - 1; i++) {
      tokens.add(str.slice(i, i + 2))
    }
  }

  // Extract English words
  const enPattern = /[a-zA-Z][a-zA-Z0-9_-]{1,}/g
  while ((match = enPattern.exec(text)) !== null) {
    tokens.add(match[0].toLowerCase())
  }

  return [...tokens]
}

export function buildInvertedIndex(entries: PkmIndexEntry[]): PkmInvertedIndex {
  const index: PkmInvertedIndex = {}

  const addToken = (token: string, entryId: string, weight: number, field: 'title' | 'summary' | 'index' | 'content') => {
    const key = token.toLowerCase()
    if (!index[key]) {
      index[key] = { term: key, entries: [] }
    }
    const existing = index[key].entries.find((e) => e.id === entryId && e.matchedField === field)
    if (existing) {
      existing.weight = Math.max(existing.weight, weight)
    } else {
      index[key].entries.push({ id: entryId, weight, matchedField: field })
    }
  }

  for (const entry of entries) {
    // Title: weight 4
    for (const token of tokenize(entry.title)) {
      addToken(token, entry.id, 4, 'title')
    }
    // Summary: weight 3
    for (const token of tokenize(entry.summary)) {
      addToken(token, entry.id, 3, 'summary')
    }
    // Scene: weight 3
    if (entry.scene) {
      for (const token of tokenize(entry.scene)) {
        addToken(token, entry.id, 3, 'summary')
      }
    }
    // Keywords, subjectTerms, aliases, tags: weight 2
    for (const kw of [...entry.keywords, ...entry.subjectTerms, ...entry.aliases, ...entry.tags]) {
      for (const token of tokenize(kw)) {
        addToken(token, entry.id, 2, 'index')
      }
      // Also add the raw keyword itself
      addToken(kw.toLowerCase(), entry.id, 2, 'index')
    }
    // Content: weight 1
    for (const token of tokenize(entry.content)) {
      addToken(token, entry.id, 1, 'content')
    }
  }

  return index
}

export async function buildPkmIndex(): Promise<{ entries: PkmIndexEntry[]; invertedIndex: PkmInvertedIndex }> {
  const [wikiPages, memories, skills, resources, calendarEvents, scheduledTasks] = await Promise.all([
    listWikiPages().catch(() => []),
    listMemories().catch(() => []),
    listSkills().catch(() => []),
    listResources().catch(() => []),
    listCalendarEvents().catch(() => []),
    listScheduledTasks().catch(() => []),
  ])

  const entries: PkmIndexEntry[] = [
    ...mapWikiPages(wikiPages),
    ...mapMemories(memories),
    ...mapSkills(skills),
    ...mapResources(resources),
    ...mapCalendarEvents(calendarEvents),
    ...mapScheduledTasks(scheduledTasks),
  ]

  const invertedIndex = buildInvertedIndex(entries)
  return { entries, invertedIndex }
}

export async function savePkmIndex(entries: PkmIndexEntry[]): Promise<void> {
  await writeJson(INDEX_FILE, entries)
}

export async function loadPkmIndex(): Promise<PkmIndexEntry[]> {
  return readJson<PkmIndexEntry[]>(INDEX_FILE, [])
}

export async function saveInvertedIndex(index: PkmInvertedIndex): Promise<void> {
  await writeJson(INVERTED_INDEX_FILE, index)
}

export async function loadInvertedIndex(): Promise<PkmInvertedIndex> {
  return readJson<PkmInvertedIndex>(INVERTED_INDEX_FILE, {})
}

export async function reindexPkm(): Promise<{ totalEntries: number; bySource: Record<string, number>; byCategory: Record<string, number> }> {
  const { entries, invertedIndex } = await buildPkmIndex()
  await Promise.all([
    savePkmIndex(entries),
    saveInvertedIndex(invertedIndex),
  ])

  const bySource: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  for (const entry of entries) {
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1
  }

  return { totalEntries: entries.length, bySource, byCategory }
}

export async function getPkmSummary(): Promise<PkmSummary> {
  const entries = await loadPkmIndex()
  const thesaurus = await listThesaurusEntries()

  const bySource: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  let lastUpdatedAt = 0

  for (const entry of entries) {
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1
    if (entry.updatedAt > lastUpdatedAt) lastUpdatedAt = entry.updatedAt
  }

  return {
    totalEntries: entries.length,
    bySource,
    byCategory,
    thesaurusSize: thesaurus.length,
    lastIndexAt: lastUpdatedAt > 0 ? new Date(lastUpdatedAt).toISOString() : null,
  }
}

// Thesaurus CRUD
export async function listThesaurusEntries(): Promise<PkmThesaurusEntry[]> {
  return readJson<PkmThesaurusEntry[]>(THESAURUS_FILE, [])
}

export async function upsertThesaurusEntry(input: {
  term: string
  synonyms: string[]
  category?: PkmCategory | 'all'
}): Promise<PkmThesaurusEntry> {
  const entries = await listThesaurusEntries()
  const now = new Date().toISOString()
  const existing = entries.find((e) => e.term === input.term)
  const entry: PkmThesaurusEntry = {
    term: input.term,
    synonyms: input.synonyms,
    category: input.category ?? 'all',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const updated = existing
    ? entries.map((e) => (e.term === input.term ? entry : e))
    : [...entries, entry]
  await writeJson(THESAURUS_FILE, updated)
  return entry
}

export async function deleteThesaurusEntry(term: string): Promise<void> {
  const entries = await listThesaurusEntries()
  await writeJson(THESAURUS_FILE, entries.filter((e) => e.term !== term))
}

export async function expandSynonyms(term: string): Promise<string[]> {
  const entries = await listThesaurusEntries()
  return expandSynonymsWithEntries(entries, term)
}

export function expandSynonymsWithEntries(entries: PkmThesaurusEntry[], term: string): string[] {
  const expanded = new Set<string>([term])
  for (const entry of entries) {
    const allTerms = [entry.term, ...entry.synonyms]
    if (allTerms.some((t) => t.toLowerCase() === term.toLowerCase())) {
      for (const t of allTerms) expanded.add(t)
    }
  }
  return [...expanded]
}

export function getSourceLabel(source: PkmSource): string {
  return SOURCE_LABELS[source] ?? source
}
