import { api } from './client'

export type OutputProfilePriority = 'high' | 'normal' | 'low'

export type OutputProfileRefType =
  | 'memory'
  | 'wiki'
  | 'raw'
  | 'resource'
  | 'note'
  | 'tag'
  | 'freeform'

export type OutputProfileRef = {
  type: OutputProfileRefType
  ref: string
  label: string
  note: string
}

export type OutputProfile = {
  id: string
  title: string
  description: string
  active: boolean
  isDefault: boolean
  priority: OutputProfilePriority
  modes: string[]
  tags: string[]
  cognitiveModels: OutputProfileRef[]
  writingStyles: OutputProfileRef[]
  materials: OutputProfileRef[]
  instructions: string
  guardrails: string[]
  sampleOutput: string
  createdAt: number
  updatedAt: number
}

export type OutputProfilePayload = {
  title?: string
  description?: string
  active?: boolean
  isDefault?: boolean
  priority?: OutputProfilePriority
  modes?: string[]
  tags?: string[]
  cognitiveModels?: OutputProfileRef[]
  writingStyles?: OutputProfileRef[]
  materials?: OutputProfileRef[]
  instructions?: string
  guardrails?: string[]
  sampleOutput?: string
}

export type OutputProfileSummary = {
  counts: {
    total: number
    active: number
    defaultProfiles: number
    highPriority: number
  }
  recent: OutputProfile[]
}

export type OutputProfileRuntimePreview = {
  request: string
  active: OutputProfile[]
  rendered: string
}

export const OutputProfilesApi = {
  summary: () => api.get<OutputProfileSummary>('/output-profiles/summary'),
  runtimePreview: (request = '') =>
    api.get<OutputProfileRuntimePreview>(
      '/output-profiles/runtime-preview?q=' + encodeURIComponent(request),
    ),
  list: (query = '') =>
    api.get<OutputProfile[]>(
      '/output-profiles' + (query.trim() ? '?query=' + encodeURIComponent(query.trim()) : ''),
    ),
  create: (payload: OutputProfilePayload) => api.post<OutputProfile>('/output-profiles', payload),
  read: (id: string) => api.get<OutputProfile>('/output-profiles/' + encodeURIComponent(id)),
  update: (id: string, payload: OutputProfilePayload) =>
    api.put<OutputProfile>('/output-profiles/' + encodeURIComponent(id), payload),
  delete: (id: string) =>
    api.delete<{ ok: true; deleted: OutputProfile }>('/output-profiles/' + encodeURIComponent(id)),
}
