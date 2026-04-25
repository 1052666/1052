import type { CSSProperties } from 'react'
import type { AppearanceReviewReport, ThemeSpec } from '../../api/appearance'

export type ThemePreviewDensity = 'compact' | 'full'

type ThemePreviewMatrixProps = {
  theme: ThemeSpec
  review: AppearanceReviewReport
  density?: ThemePreviewDensity
}

export const THEME_PREVIEW_SURFACES = [
  'navigation',
  'chat',
  'markdown',
  'settings',
  'sql',
  'status',
] as const

const STATUS_ITEMS = [
  ['success', 'Success', 'Sync complete'],
  ['warning', 'Warning', 'Review contrast'],
  ['danger', 'Danger', 'Blocked action'],
] as const

function previewStyle(theme: ThemeSpec): CSSProperties {
  return {
    '--preview-bg': theme.tokens.bg,
    '--preview-bg-grad-1': theme.tokens.bgGrad1,
    '--preview-bg-grad-2': theme.tokens.bgGrad2,
    '--preview-surface-0': theme.tokens.surface0,
    '--preview-surface-1': theme.tokens.surface1,
    '--preview-surface-2': theme.tokens.surface2,
    '--preview-surface-3': theme.tokens.surface3,
    '--preview-surface-hover': theme.tokens.surfaceHover,
    '--preview-hairline': theme.tokens.hairline,
    '--preview-hairline-2': theme.tokens.hairline2,
    '--preview-hairline-strong': theme.tokens.hairlineStrong,
    '--preview-fg': theme.tokens.fg,
    '--preview-fg-2': theme.tokens.fg2,
    '--preview-fg-3': theme.tokens.fg3,
    '--preview-fg-4': theme.tokens.fg4,
    '--preview-accent': theme.tokens.accent,
    '--preview-accent-2': theme.tokens.accent2,
    '--preview-accent-soft': theme.tokens.accentSoft,
    '--preview-accent-ring': theme.tokens.accentRing,
    '--preview-success': theme.tokens.success,
    '--preview-danger': theme.tokens.danger,
  } as CSSProperties
}

function ReviewChecklist({ review }: { review: AppearanceReviewReport }) {
  const items = [
    {
      label: 'No layout tokens',
      ok: !review.blockingIssues.some((item) =>
        /layout|unknown-field/.test(item.code) &&
        /(display|position|margin|padding|width|height|zIndex|selector|className|style|css)/.test(
          item.path,
        ),
      ),
    },
    {
      label: 'No background image',
      ok: !review.blockingIssues.some((item) => item.path.includes('background')),
    },
    {
      label: 'Readable contrast',
      ok: !review.blockingIssues.some((item) => item.code === 'contrast-too-low'),
    },
    {
      label: 'Derived tokens generated',
      ok: review.passed,
    },
  ]

  return (
    <div className="theme-preview-checklist" aria-label="Theme preview checklist">
      {items.map((item) => (
        <span key={item.label} className={item.ok ? 'pass' : 'fail'}>
          {item.ok ? 'OK' : 'Block'} · {item.label}
        </span>
      ))}
    </div>
  )
}

export default function ThemePreviewMatrix({
  theme,
  review,
  density = 'full',
}: ThemePreviewMatrixProps) {
  const compact = density === 'compact'

  return (
    <section
      className={`theme-preview-matrix ${compact ? 'compact' : 'full'} ${review.safetyLevel}`}
      style={previewStyle(theme)}
      aria-label="Fixed theme preview matrix"
    >
      <div className="theme-preview-head">
        <div>
          <strong>Fixed Preview Matrix</strong>
          <small>{theme.mode} · {theme.scope} · {review.safetyLevel}</small>
        </div>
        <span>{review.safetyLevel}</span>
      </div>

      <div className="theme-preview-surfaces">
        <div className="theme-preview-surface surface-navigation" data-preview-surface="navigation">
          <div className="theme-preview-nav-item active">
            <span />
            <strong>Workspace</strong>
            <small>Active</small>
          </div>
          {!compact ? (
            <div className="theme-preview-nav-item">
              <span />
              <strong>Memory</strong>
              <small>Idle</small>
            </div>
          ) : null}
        </div>

        <div className="theme-preview-surface surface-chat" data-preview-surface="chat">
          <div className="theme-preview-message theme-preview-message-user">
            Create a focused brief.
          </div>
          <div className="theme-preview-message theme-preview-message-assistant">
            Draft ready with source checks and next actions.
          </div>
          {!compact ? <div className="theme-preview-tool">tool · preview_draft · passed</div> : null}
        </div>

        <div className="theme-preview-surface surface-markdown" data-preview-surface="markdown">
          <h4>Markdown Snapshot</h4>
          <p>Readable paragraph text with an inline <code>token</code>.</p>
          {!compact ? (
            <>
              <blockquote>Fixed mock quote for review.</blockquote>
              <div className="theme-preview-code">const status = "safe"</div>
              <table>
                <tbody>
                  <tr>
                    <th>Token</th>
                    <td>Core</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : null}
        </div>

        <div className="theme-preview-surface surface-settings" data-preview-surface="settings">
          <label>
            <span>Model route</span>
            <input readOnly value="local-first" aria-label="Preview model route" />
          </label>
          {!compact ? (
            <div className="theme-preview-button-row">
              <button type="button">Save</button>
              <button type="button" disabled>
                Disabled
              </button>
            </div>
          ) : null}
        </div>

        <div className="theme-preview-surface surface-sql" data-preview-surface="sql">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>passed</td>
                <td>24</td>
              </tr>
              {!compact ? (
                <tr>
                  <td>review</td>
                  <td>3</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="theme-preview-surface surface-status" data-preview-surface="status">
          {STATUS_ITEMS.map(([kind, label, value]) => (
            <div key={kind} className={`theme-preview-status ${kind}`}>
              <strong>{label}</strong>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {!compact ? <ReviewChecklist review={review} /> : null}
    </section>
  )
}
