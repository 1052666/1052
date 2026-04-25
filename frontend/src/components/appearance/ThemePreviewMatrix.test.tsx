import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AppearanceReviewReport, ThemeSpec } from '../../api/appearance'
import ThemePreviewMatrix, { THEME_PREVIEW_SURFACES } from './ThemePreviewMatrix'

const theme: ThemeSpec = {
  schemaVersion: 1,
  name: 'Test Theme',
  mode: 'dark',
  scope: 'workspace',
  safetyLevel: 'safe',
  coreTokens: {
    bg: '#08111f',
    surface: '#f8fafc',
    fg: '#f8fafc',
    accent: '#38bdf8',
    success: '#34d399',
    danger: '#fb7185',
  },
  tokens: {
    bg: '#08111f',
    surface: '#f8fafc',
    fg: '#f8fafc',
    accent: '#38bdf8',
    success: '#34d399',
    danger: '#fb7185',
    bgGrad1: '#3f4850',
    bgGrad2: '#08111f',
    surface0: 'rgba(248, 250, 252, 0.030)',
    surface1: 'rgba(248, 250, 252, 0.070)',
    surface2: 'rgba(248, 250, 252, 0.100)',
    surface3: 'rgba(248, 250, 252, 0.140)',
    surfaceHover: 'rgba(248, 250, 252, 0.090)',
    hairline: 'rgba(248, 250, 252, 0.080)',
    hairline2: 'rgba(248, 250, 252, 0.140)',
    hairlineStrong: 'rgba(248, 250, 252, 0.220)',
    fg2: '#c9d0d9',
    fg3: '#8f9aa8',
    fg4: '#697584',
    accent2: '#61c9fa',
    accentSoft: 'rgba(56, 189, 248, 0.140)',
    accentRing: 'rgba(56, 189, 248, 0.340)',
  },
}

const review: AppearanceReviewReport = {
  passed: true,
  safetyLevel: 'safe',
  blockingIssues: [],
  warnings: [],
}

describe('ThemePreviewMatrix', () => {
  it('renders every fixed preview surface without business data inputs', () => {
    const html = renderToStaticMarkup(<ThemePreviewMatrix theme={theme} review={review} />)

    for (const surface of THEME_PREVIEW_SURFACES) {
      expect(html).toContain(`data-preview-surface="${surface}"`)
    }
    expect(html).toContain('Fixed Preview Matrix')
    expect(html).toContain('Create a focused brief.')
    expect(html).not.toContain('SELECT')
    expect(html).toContain('Status')
    expect(html).toContain('Token')
    expect(html).toContain('Disabled')
    expect(html).toContain('OK')
    expect(html).not.toContain(theme.name)
  })

  it('keeps compact previews small and omits the checklist', () => {
    const html = renderToStaticMarkup(
      <ThemePreviewMatrix theme={theme} review={review} density="compact" />,
    )

    expect(html).toContain('theme-preview-matrix compact')
    expect(html).not.toContain('Theme preview checklist')
    expect(html).not.toContain('preview_draft')
  })

  it('marks blocking review checks as failed', () => {
    const html = renderToStaticMarkup(
      <ThemePreviewMatrix
        theme={{ ...theme, safetyLevel: 'rejected' }}
        review={{
          passed: false,
          safetyLevel: 'rejected',
          blockingIssues: [
            {
              code: 'contrast-too-low',
              path: 'coreTokens.fg:coreTokens.bg',
              message: 'bad contrast',
              suggestedFix: 'fix colors',
            },
          ],
          warnings: [],
        }}
      />,
    )

    expect(html).toContain('rejected')
    expect(html).toContain('Block')
    expect(html).toContain('Readable contrast')
  })
})
