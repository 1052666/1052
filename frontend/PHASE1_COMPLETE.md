# 1052-OS Mirror Chrome Phase 1 — Complete

**Branch**: `feature/p3-mirror-chrome-phase1`
**Base**: `ff7939e` (main at branch creation)
**HEAD**: `1813643` (smoke fix on top of `2fe53bd`)
**Spec**: `~/OnlyClaude/2-Projects/1052OS/2026-05-11-mirror-chrome-phase1-design.md` v2
**Plan**: `~/OnlyClaude/2-Projects/1052OS/2026-05-11-mirror-chrome-phase1-plan.md`

## Summary

Built a dedicated component tree (`src/mirror/`) for the "液镜" (liquid graphite) profile, with:

- Pixel-aligned Settings page + Sidebar + chat doc rendered through a separate render tree gated by `activeProfileId === 'builtin:mirror-dark'`
- 3 physical-causality wow features (cursor tracking / cross-card light coupling / theme-switch liquid pour)
- Full a11y compliance (WCAG AA contrast, keyboard nav, reduced-motion audit)
- Visual regression + a11y test suite (Playwright + pixelmatch + axe-core)

Hook-extraction PR0 cleanly separates page logic from rendering so Mirror Chrome reuses the same models as the classic profile.

## Stats

- **Tests**: 85 (pre-branch) → **160 vitest + 18 Playwright = 178 total** (+93 net)
- **Commits**: 51 between `ff7939e..HEAD`
- **Files changed**: 59
- **LOC delta (frontend/)**: +7,539 / −1,114 (net +6,425)
  - `src/mirror/` new tree: ~2,845 LOC (9 primitives + Sidebar + PageHeader + PageWrapper + MirrorChrome + MirrorSettings + MirrorChat + wow controllers + nav + css)
  - `src/pages/Settings.tsx`: 2,129 → 2,052 (−77; hook extraction)
  - `src/pages/Chat.tsx`: 1,485 → 810 (−675; hook extraction)
  - Remainder: hooks (`useSettingsPageModel`, `useChatModel`), CSS tokens, theme @property, tests, baseline snapshots

## PR proposal — Stacked 4 PRs

**PR0 — Hook extraction (zero behavior change)** · ~3 commits
- Extract `useSettingsPageModel` + `useChatModel` so pages become render-only consumers
- Parity tests + chat-hook guards (loading/uploading/historyLoaded before /new + /compact)
- Commits: `36163ef` → `7c6578e`
- Risk: low; pure refactor; tested by 160 vitest

**PR1 — MirrorChrome shell + primitives + cursor tracking** · ~14 commits
- Register `@property` for animating CSS vars (`--mr-light-x/y`, `--mr-hover-boost`)
- 9 primitives: MirrorCard, MirrorText, StatCard, Button, Chip, Collapsible, ProgressBar, Input, PresetCard
- MirrorSidebar (left-accent-bar idiom), MirrorPageHeader, MirrorPageWrapper, MirrorChrome
- Dirty guard for profile switch (sessionStorage-backed)
- Commits: `40fc703` → `f234085`
- Risk: medium (new render tree); classic profile fully bypasses it

**PR2 — MirrorSettings** · ~7 commits
- 2-col console layout + subtitle + save chip
- LLM 接入 card (Base URL / Model ID / API Key) + preset grid (OpenAI / MiniMax Global / MiniMax 中国区 / Gemini OpenAI / DeepSeek / Moonshot / Smaller LLMs)
- Token 可视化面板 + Cache + 来源与时间窗口 (right col)
- Surface token-usage error + clarify pctOf/coverage semantics
- Commits: `f224a31` → `10958bb`
- Risk: low; reuses `useSettingsPageModel`

**PR3 — MirrorChat + Wow Layer + Tests** · ~13 commits
- Liquid-doc chat layout: vertical bar idiom, time-sep dividers, floating composer with 8x8 dot send
- Wow A — cross-card light coupling: cardCoupling controller + decay rules + React context + rAF loop + scroll-refresh
- Wow B — liquid-pour theme switch: sessionStorage gate + LiquidPourOverlay (cubic-bezier mask)
- Reduced-motion audit across all animations
- Playwright + pixelmatch + axe-core test infra
- Visual regression baselines (chromium + webkit, mirror settings/chat/sidebar)
- WCAG AA contrast tests + keyboard nav test
- Classic profile snapshot guard (regression safety net)
- Smoke test title fix (`/Agent|1052/i`)
- Commits: `b4cb284` → `1813643`
- Risk: medium (wow features add 3 globally-listening effects); fully gated by `prefers-reduced-motion`

## Visual comparison vs target image

Target image at `~/.claude/image-cache/63c2783a-9b51-404c-898d-04a7f2cc3d99/7.jpeg` was not present at IU-20 capture time. Comparing instead against the "liquid graphite console" subjective description and the locked baseline snapshots in `frontend/e2e/baseline/`.

**Captured screenshots** (transient, regenerable via `iu20-snap.mjs`):
- `/tmp/iu20-settings.png` — 1440x900 mirror settings
- `/tmp/iu20-chat.png` — 1440x900 mirror chat
- `/tmp/iu20-sidebar.png` — 240x900 sidebar crop

**What looks right**:
- Sidebar: nav items in single column with subtle dividers, profile chip pill (`1052`/`01`-`06`), avatar with online dot — matches "liquid graphite" intent
- Chat: clean empty state ("— 与你的本地 Agent 开始对话 —"), floating composer with `+` attach + placeholder + 8x8 dot send anchored to bottom — matches floating-doc aesthetic
- Color palette: `bg=#111315`, `surface=#1B1E22`, `accent=#7C8EA3` produces the calm graphite tone with no jarring contrast
- Settings: 2-col layout visible with LLM section left and Token/Cache panels right; preset cards in 2-col grid

**What still differs / could improve**:
- **Font**: still uses system stack; target aesthetic implied Inter / IBM Plex Sans (deferred to Phase 2)
- **Big numbers**: "0 / 0 / 0 / 0" displayed plainly — target likely uses 万/M compact form (deferred)
- **Idle dim**: page doesn't soft-dim after 60s of no interaction (deferred)
- **Hover micro-anim on big numbers**: no scrub effect yet (deferred)
- **Theme onboarding modal**: still triggers on first load for users who haven't completed it; not a Mirror Chrome bug but worth UX polish in a follow-up

**Estimated overall visual match**: **~85-90%** (subjective). All structural/spatial decisions match target; remaining gaps are typography + micro-anim polish, not architectural.

## Recommended next steps

1. User reviews `PHASE1_COMPLETE.md` + the 3 screenshots in `/tmp/iu20-*.png`
2. User approves push (per CLAUDE.md push policy)
3. Push branch + open 4 stacked PRs in dependency order (PR0 → PR1 → PR2 → PR3)
4. Codex review PR0 (per locked decision #1) before merging to main
5. Once PR0 merged, PR1–3 sequential review and merge

Push commands (do NOT run until user approves):

```bash
cd ~/Projects/1052-OS && git push -u origin feature/p3-mirror-chrome-phase1
# Then via gh: open 4 separate PRs with stack notes in description, or 1 big PR with the stack noted
```

## Phase 2 deferred items

- Custom font import (Inter / IBM Plex Sans)
- "万 / M" compact form for big numbers
- Hover scrub micro-animation on big numbers
- Idle deep state (UI dim after 60s without interaction)
- Sound design (micro-tap / ripple / chime on key interactions)
- Classic page wrappers eliminating double-header artifact
- Mirror-light profile parity (currently mirror-dark only; mirror-light is experimental)

## IU-20 final self-check

- [x] Smoke test fix verified (`/Agent|1052/i`) — `1813643`
- [x] 160 vitest PASS
- [x] 18 Playwright PASS (chromium + webkit × 9 specs incl. smoke)
- [x] Screenshots captured (settings / chat / sidebar)
- [x] Visual comparison documented above
- [x] Working tree clean after commits
- [x] **No push to remote** — awaiting explicit user approval

Ready for user review + push approval.
