const KEY = 'mirror_dirty_state'

interface DirtyMap {
  [scope: string]: unknown  // scope = 'settings' | 'chat-draft' | etc.
}

export const SCOPE_LABELS: Record<string, string> = {
  settings: '设置表单',
  'chat-draft': '聊天草稿',
}

function read(): DirtyMap {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || '{}') as DirtyMap
  } catch {
    return {}
  }
}

function write(map: DirtyMap): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* sessionStorage may be unavailable in private mode */
  }
}

export function setDirty(scope: string, state: unknown): void {
  const map = read()
  map[scope] = state
  write(map)
}

export function clearDirty(scope: string): void {
  const map = read()
  delete map[scope]
  write(map)
}

export function hasDirty(): boolean {
  return Object.keys(read()).length > 0
}

export function getDirtyScopes(): string[] {
  return Object.keys(read())
}

export function getDirty(scope: string): unknown {
  return read()[scope]
}
