// Regression test for the page-level send guard.
//
// Background: Chat.tsx used to have a single top-of-`send` guard
//
//   if (loading || uploading || !historyLoaded) return
//
// covering every branch. The useChatModel migration (commit 73b20c4) moved
// the normal-send guard into the hook but did not preserve the guard for
// the page-level command branches (/new, /compact). That regression let
//
//   * `/new` clear the conversation while a stream was still running,
//     so streamed deltas continued to write into the freshly-cleared
//     history; and
//   * `/compact` race the in-flight stream, with both ends mutating
//     conversation state concurrently.
//
// decideSend (in ./chat-send.ts) now hosts the page-level decision as a
// pure function. These tests pin the guard semantics so the regression
// can't sneak back in via a future Chat.tsx refactor — the hook-level
// tests can't catch it because it lives above the hook.
import { describe, expect, it } from 'vitest'
import { decideSend, type SendDecisionInput } from './chat-send'

function input(overrides: Partial<SendDecisionInput> = {}): SendDecisionInput {
  return {
    text: '',
    pendingUploadsCount: 0,
    loading: false,
    uploading: false,
    historyLoaded: true,
    ...overrides,
  }
}

describe('decideSend — page-level guard regression', () => {
  it('blocks /new while a stream is running', () => {
    expect(decideSend(input({ text: '/new', loading: true }))).toEqual({
      kind: 'blocked',
      reason: 'loading',
    })
  })

  it('blocks /compact while a stream is running', () => {
    expect(decideSend(input({ text: '/compact', loading: true }))).toEqual({
      kind: 'blocked',
      reason: 'loading',
    })
  })

  it('blocks an ordinary send while a stream is running', () => {
    expect(decideSend(input({ text: 'hello', loading: true }))).toEqual({
      kind: 'blocked',
      reason: 'loading',
    })
  })

  it('blocks every branch while an upload is in flight', () => {
    expect(decideSend(input({ text: '/new', uploading: true }))).toEqual({
      kind: 'blocked',
      reason: 'uploading',
    })
    expect(decideSend(input({ text: '/compact', uploading: true }))).toEqual({
      kind: 'blocked',
      reason: 'uploading',
    })
    expect(decideSend(input({ text: 'hi', uploading: true }))).toEqual({
      kind: 'blocked',
      reason: 'uploading',
    })
  })

  it('blocks every branch while initial history has not loaded', () => {
    expect(decideSend(input({ text: '/new', historyLoaded: false }))).toEqual({
      kind: 'blocked',
      reason: 'historyNotLoaded',
    })
    expect(decideSend(input({ text: '/compact', historyLoaded: false }))).toEqual({
      kind: 'blocked',
      reason: 'historyNotLoaded',
    })
    expect(decideSend(input({ text: 'hi', historyLoaded: false }))).toEqual({
      kind: 'blocked',
      reason: 'historyNotLoaded',
    })
  })
})

describe('decideSend — happy path', () => {
  it('routes /new to clearConversation when idle', () => {
    expect(decideSend(input({ text: '/new' }))).toEqual({ kind: 'new' })
  })

  it('routes /compact to compactConversation when idle', () => {
    expect(decideSend(input({ text: '/compact' }))).toEqual({ kind: 'compact' })
  })

  it('routes ordinary text to a normal send when idle', () => {
    expect(decideSend(input({ text: 'hello world' }))).toEqual({ kind: 'send' })
  })

  it('routes an upload-only submission (no text) to a normal send when idle', () => {
    expect(decideSend(input({ text: '', pendingUploadsCount: 1 }))).toEqual({
      kind: 'send',
    })
  })

  it('normalizes the `-new` / `-compact` shorthand (leading dash → slash command)', () => {
    expect(decideSend(input({ text: '-new' }))).toEqual({ kind: 'new' })
    expect(decideSend(input({ text: '-compact' }))).toEqual({ kind: 'compact' })
  })

  it('treats a no-text + no-uploads submission as a no-op, even with no busy state', () => {
    expect(decideSend(input({ text: '' }))).toEqual({ kind: 'empty' })
  })

  it('no-op check runs before the busy guard: empty input while loading is empty, not blocked', () => {
    // Documents the chosen precedence — pressing Enter on an empty textarea
    // mid-stream should be a silent no-op, not surface a "blocked" state.
    expect(decideSend(input({ text: '', loading: true }))).toEqual({ kind: 'empty' })
  })
})
