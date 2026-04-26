import { searchPkmEntries } from '../../pkm/pkm.search.js'
import { getPkmSummary, reindexPkm } from '../../pkm/pkm.service.js'
import type { AgentTool } from '../agent.tool.types.js'

export const pkmTools: AgentTool[] = [
  {
    name: 'pkm_search',
    description:
      'Search across all knowledge sources (Wiki, Memory, Skills, Resources, Calendar) using boolean query expressions. Supports AND (implicit), OR, NOT, quoted exact match, category/source filters, and date ranges. Automatically expands synonyms from the thesaurus.',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Search expression. Supports AND, OR, NOT operators and "exact match". Multiple terms default to AND.' },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional category filters: knowledge, experience, skill, memory, resource, action.',
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional source filters: wiki, memory, skill, resource, calendar-event, calendar-task.',
        },
      },
      required: ['expression'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return searchPkmEntries({
        expression: String(input.expression ?? ''),
        categories: Array.isArray(input.categories) ? input.categories : undefined,
        sources: Array.isArray(input.sources) ? input.sources : undefined,
      })
    },
  },
  {
    name: 'pkm_summary',
    description: 'Get PKM system summary: total entries, counts by source and category, thesaurus size, last index time.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => getPkmSummary(),
  },
  {
    name: 'pkm_reindex',
    description: 'Rebuild the PKM unified index from all data sources (Wiki, Memory, Skills, Resources, Calendar). Use when data has changed significantly.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => reindexPkm(),
  },
]
