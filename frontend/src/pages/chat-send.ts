// Page-level send dispatcher for Chat.tsx.
//
// Why this exists as a separate module:
// The page-level `send` wrapper in Chat.tsx must short-circuit certain
// commands (e.g. `/new`, `/compact`) BEFORE delegating to the hook's own
// send. The hook (useChatModel) has its own internal guard against re-entry
// during streaming/uploading/initial-history-load, but that guard only runs
// inside `sendModel`. Commands handled at the page layer (clearConversation,
// compactConversation) never reach that guard, so without a page-level
// guard they execute concurrently with an in-flight stream — corrupting
// state (e.g. `/new` clears the conversation while the streaming response
// continues writing into the new, supposedly-empty conversation).
//
// The pre-migration Chat.tsx had a single top-of-`send` guard that covered
// every branch; the hook migration (commit 73b20c4) preserved the guard
// for the normal-send path (inside the hook) but lost it for the
// page-level command branches. This module restores that guard and makes
// the decision pure + testable.

export type SendDecision =
  | { kind: 'blocked'; reason: 'loading' | 'uploading' | 'historyNotLoaded' }
  | { kind: 'empty' } // nothing to send: no text and no pending uploads
  | { kind: 'new' } // /new — clear conversation
  | { kind: 'compact' } // /compact — compact conversation
  | { kind: 'send' } // ordinary message send

export interface SendDecisionInput {
  text: string // input.trim()
  pendingUploadsCount: number
  loading: boolean
  uploading: boolean
  historyLoaded: boolean
}

// Mirrors normalizeCommandInput from Chat.tsx. Kept inlined (instead of
// imported from Chat.tsx) so this module has zero React/JSX dependencies
// and can be exercised in a plain unit test without a jsdom environment.
function normalizeCommandInput(value: string): string {
  const trimmed = value.trimStart()
  if (trimmed.startsWith('-')) return '/' + trimmed.slice(1)
  return trimmed
}

/**
 * Decide what the page-level send wrapper should do, given the current
 * input + chat-model state.
 *
 * Order of checks (matches pre-migration semantics):
 *   1. Empty input + no uploads → no-op (kind: 'empty').
 *   2. Busy state (loading / uploading / history-not-loaded) → blocked.
 *   3. Command match → 'new' or 'compact'.
 *   4. Fallback → 'send'.
 *
 * Note on step ordering: the empty-input check runs BEFORE the busy guard
 * because pressing Enter on an empty textarea while a stream is running
 * should still be a no-op (not surface a "blocked" indicator).
 */
export function decideSend(input: SendDecisionInput): SendDecision {
  const { text, pendingUploadsCount, loading, uploading, historyLoaded } = input

  // Pre-migration behavior: empty input AND no uploads → no-op.
  // For commands (/new, /compact) the text is non-empty so this branch
  // doesn't apply to them.
  if (!text && pendingUploadsCount === 0) {
    return { kind: 'empty' }
  }

  // The regression guard: block all branches (including commands) while
  // a stream is running, an upload is in flight, or initial history
  // hasn't loaded yet. Pre-migration Chat.tsx had this guard at the top
  // of `send`; the hook migration accidentally dropped it for the
  // page-level command branches.
  if (loading) return { kind: 'blocked', reason: 'loading' }
  if (uploading) return { kind: 'blocked', reason: 'uploading' }
  if (!historyLoaded) return { kind: 'blocked', reason: 'historyNotLoaded' }

  const normalized = normalizeCommandInput(text)
  if (normalized === '/new') return { kind: 'new' }
  if (normalized === '/compact') return { kind: 'compact' }
  return { kind: 'send' }
}
