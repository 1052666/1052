import { test, expect, type Page, type TestInfo } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BASELINE_DIR = path.join(__dirname, 'baseline')
// Classic profile = no active mirror/gpt theme. The reset endpoint clears
// activeProfileId, restoring the default classic palette.
const RESET_API = '/api/appearance/themes/reset'
// Restore mirror after each test so we don't leave global state polluted
// for subsequent suites.
const APPLY_MIRROR_API = '/api/appearance/themes/builtin%3Amirror-dark/apply'

// Classic should be byte-identical-ish: the mirror PR must not touch classic UI.
// Tighter threshold than mirror visual (0.05 vs 0.15) + higher floor (0.99 vs 0.85).
const CLASSIC_PIXEL_THRESHOLD = 0.05
const CLASSIC_MATCH_FLOOR = 0.99

function baselinePath(testInfo: TestInfo, name: string): string {
  return path.join(BASELINE_DIR, `${testInfo.project.name}-${name}`)
}

async function applyClassicProfile(page: Page): Promise<void> {
  await page.evaluate(async (apiPath: string) => {
    await fetch(apiPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    })
  }, RESET_API)
}

async function restoreMirrorProfile(page: Page): Promise<void> {
  await page.evaluate(async (apiPath: string) => {
    await fetch(apiPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    })
  }, APPLY_MIRROR_API)
}

async function comparePngOrCapture(
  actual: Buffer,
  baselinePath: string,
): Promise<number | null> {
  if (!fs.existsSync(baselinePath)) {
    fs.writeFileSync(baselinePath, actual)
    console.log(`Captured classic baseline (first run): ${baselinePath}`)
    return null
  }
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath))
  const current = PNG.sync.read(actual)
  if (current.width !== baseline.width || current.height !== baseline.height) {
    throw new Error(
      `Size mismatch for ${path.basename(baselinePath)}: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height}`,
    )
  }
  const diff = new PNG({ width: current.width, height: current.height })
  const diffCount = pixelmatch(
    current.data,
    baseline.data,
    diff.data,
    current.width,
    current.height,
    { threshold: CLASSIC_PIXEL_THRESHOLD },
  )
  fs.writeFileSync(
    baselinePath.replace(/\.png$/, '.diff.png'),
    PNG.sync.write(diff),
  )
  return 1 - diffCount / (current.width * current.height)
}

test.describe('classic regression', () => {
  // Always restore mirror after each test so /chat tests in other suites still
  // see the expected mirror state.
  test.afterEach(async ({ page }) => {
    try {
      await page.goto('/')
      await restoreMirrorProfile(page)
    } catch {
      // best-effort cleanup; don't mask test failure
    }
  })

  test('classic /settings unchanged vs pre-mirror baseline', async ({ page }, testInfo) => {
    await page.goto('/')
    await applyClassicProfile(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    const screenshot = await page.screenshot({ fullPage: false })
    const result = await comparePngOrCapture(
      screenshot,
      baselinePath(testInfo, 'classic-settings.png'),
    )
    if (result !== null) {
      expect(result).toBeGreaterThanOrEqual(CLASSIC_MATCH_FLOOR)
    }
  })

  test('classic /chat unchanged vs pre-mirror baseline', async ({ page }, testInfo) => {
    await page.goto('/')
    await applyClassicProfile(page)
    await page.goto('/chat', { waitUntil: 'domcontentloaded' })
    // Classic chat doesn't have .mr-sidebar; just give the SPA time to mount.
    await page.waitForTimeout(1200)

    const screenshot = await page.screenshot({ fullPage: false })
    const result = await comparePngOrCapture(
      screenshot,
      baselinePath(testInfo, 'classic-chat.png'),
    )
    if (result !== null) {
      expect(result).toBeGreaterThanOrEqual(CLASSIC_MATCH_FLOOR)
    }
  })
})
