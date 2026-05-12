// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { setDirty, clearDirty, hasDirty, getDirtyScopes, getDirty } from './dirtyGuard'

describe('dirtyGuard', () => {
  beforeEach(() => sessionStorage.clear())

  it('hasDirty returns false initially', () => {
    expect(hasDirty()).toBe(false)
  })

  it('setDirty makes hasDirty true', () => {
    setDirty('settings', { fieldA: 'value' })
    expect(hasDirty()).toBe(true)
  })

  it('clearDirty removes the scope', () => {
    setDirty('settings', { a: 1 })
    setDirty('chat-draft', 'hello')
    clearDirty('settings')
    expect(hasDirty()).toBe(true)
    expect(getDirtyScopes()).toEqual(['chat-draft'])
  })

  it('clearDirty on last scope returns hasDirty=false', () => {
    setDirty('settings', { a: 1 })
    clearDirty('settings')
    expect(hasDirty()).toBe(false)
  })

  it('getDirty returns the saved state', () => {
    const payload = { unsaved: ['a', 'b'] }
    setDirty('settings', payload)
    expect(getDirty('settings')).toEqual(payload)
  })

  it('survives malformed sessionStorage entry', () => {
    sessionStorage.setItem('mirror_dirty_state', '{{ not json')
    expect(hasDirty()).toBe(false)
    expect(() => setDirty('a', 1)).not.toThrow()
  })
})
