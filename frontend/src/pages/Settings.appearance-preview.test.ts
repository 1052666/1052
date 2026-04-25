import fs from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSettingsSource() {
  return fs.readFile(new URL('./Settings.tsx', import.meta.url), 'utf-8')
}

describe('Settings appearance preview wiring', () => {
  it('uses full Preview Matrix in apply confirmation and compact Preview Matrix in profile cards', async () => {
    const source = await readSettingsSource()

    expect(source).toContain("appearanceConfirmation.kind === 'apply' ? (")
    expect(source).toContain('theme={appearanceConfirmation.profile.theme}')
    expect(source).toContain('review={appearanceConfirmation.profile.review}')
    expect(source).toContain('density="compact"')
    expect(source).toContain('theme={profile.theme}')
    expect(source).toContain('review={profile.review}')
  })

  it('keeps rejected and experimental apply gates wired through confirmation state', async () => {
    const source = await readSettingsSource()

    expect(source).toContain("const rejected = profile.review.safetyLevel === 'rejected'")
    expect(source).toContain('disabled={Boolean(appearanceBusy) || active || rejected}')
    expect(source).toContain("appearanceConfirmation.profile.review.safetyLevel === 'experimental'")
    expect(source).toContain('appearanceExperimentalConfirmed')
    expect(source).toContain('allowExperimental')
  })
})
