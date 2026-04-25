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

export type OutputProfileInput = {
  title?: unknown
  description?: unknown
  active?: unknown
  isDefault?: unknown
  priority?: unknown
  modes?: unknown
  tags?: unknown
  cognitiveModels?: unknown
  writingStyles?: unknown
  materials?: unknown
  instructions?: unknown
  guardrails?: unknown
  sampleOutput?: unknown
}

export type OutputProfileQuery = {
  query?: unknown
  active?: unknown
  limit?: unknown
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
