// Parity test: assert the SettingsPatch produced by buildSettingsPatch (the
// pure helper exported from useSettingsPageModel) matches the payload shape
// Settings.tsx historically sent to SettingsApi.update.
//
// Why this lives in pages/ (not hooks/): it documents the page-level contract.
// If someone later bypasses the hook and goes back to direct SettingsApi.update,
// this test catches the divergence.
//
// Why this targets buildSettingsPatch (not the hook): the patch shape is a
// pure function of inputs. Asserting on the pure helper keeps the contract
// test free of React renderer churn and lets us snapshot many input shapes
// quickly without spinning up renderHook.
import { describe, expect, it } from 'vitest'
import type { PublicSettings, SettingsPatch } from '../api/settings'
import {
  buildSettingsPatch,
  type SettingsPatchInputs,
} from '../hooks/useSettingsPageModel'
import { makeSettings } from '../test-utils/settings-fixtures'

// Derive a SettingsPatchInputs that mirrors what the hook would hold immediately
// after applyLoaded(settings) — i.e. local state == loaded snapshot.
function inputsFromLoaded(
  loaded: PublicSettings,
  theme: PublicSettings['appearance']['theme'] = loaded.appearance.theme,
  overrides: Partial<SettingsPatchInputs> = {},
): SettingsPatchInputs {
  const base: SettingsPatchInputs = {
    baseUrl: loaded.llm.baseUrl,
    modelId: loaded.llm.modelId,
    llmApiFormat: loaded.llm.apiFormat,
    apiKey: '',
    llmTaskRoutes: loaded.llm.taskRoutes,
    imageApiFormat: loaded.imageGeneration.apiFormat,
    imageBaseUrl: loaded.imageGeneration.baseUrl,
    imageModelId: loaded.imageGeneration.modelId,
    imageApiKey: '',
    imageSize: loaded.imageGeneration.size,
    imageQuality: loaded.imageGeneration.quality,
    imageBackground: loaded.imageGeneration.background,
    imageOutputFormat: loaded.imageGeneration.outputFormat,
    imageOutputCompression: loaded.imageGeneration.outputCompression,
    ocrProvider: loaded.ocr.provider,
    ocrCustomBaseUrl: loaded.ocr.customBaseUrl,
    ocrCustomModelId: loaded.ocr.customModelId,
    ocrCustomApiKey: '',
    uapisApiKey: '',
    theme,
    uiLanguage: loaded.appearance.language,
    userPrompt: loaded.agent.userPrompt,
    streaming: loaded.agent.streaming,
    fullAccess: loaded.agent.fullAccess,
    contextMessageLimit: loaded.agent.contextMessageLimit,
    progressiveDisclosureEnabled: loaded.agent.progressiveDisclosureEnabled,
    providerCachingEnabled: loaded.agent.providerCachingEnabled,
    checkpointEnabled: loaded.agent.checkpointEnabled,
    seedOnResumeEnabled: loaded.agent.seedOnResumeEnabled,
    upgradeDebugEventsEnabled: loaded.agent.upgradeDebugEventsEnabled,
    autoCompactEnabled: loaded.agent.autoCompactEnabled,
    autoCompactThreshold: loaded.agent.autoCompactThreshold,
    morningBriefEnabled: loaded.agent.morningBrief.enabled,
    morningBriefTime: loaded.agent.morningBrief.time,
  }
  return { ...base, ...overrides }
}

describe('settings-page parity: buildSettingsPatch payload shape', () => {
  it('case 1 — single field update produces patch with that field changed and others mirrored from loaded', () => {
    const loaded = makeSettings()
    const inputs = inputsFromLoaded(loaded, 'dark', { modelId: 'gpt-4o' })

    const patch = buildSettingsPatch(inputs)
    expect(patch.llm).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o',
      apiFormat: 'openai-compatible',
      taskRoutes: [],
    })
    // apiKey omitted (transient field empty); other sections preserved.
    expect(patch.llm).not.toHaveProperty('apiKey')
    expect(patch.appearance).toEqual({ theme: 'dark', language: 'zh-CN' })
  })

  it('case 2 — multiple field updates across sections produce a coherent multi-section patch', () => {
    const loaded = makeSettings()
    const inputs = inputsFromLoaded(loaded, 'light', {
      baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat',
      streaming: false,
      autoCompactThreshold: 200,
      uiLanguage: 'en-US',
    })

    const patch = buildSettingsPatch(inputs)
    expect(patch.llm?.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(patch.llm?.modelId).toBe('deepseek-chat')
    expect(patch.agent?.streaming).toBe(false)
    expect(patch.agent?.autoCompactThreshold).toBe(200)
    expect(patch.appearance).toEqual({ theme: 'light', language: 'en-US' })
  })

  it('case 3 — applyLlmPreset-equivalent input reflects preset fields in patch and preserves api key when typed', () => {
    const loaded = makeSettings()
    const inputs = inputsFromLoaded(loaded, 'dark', {
      baseUrl: 'https://api.moonshot.cn/v1',
      modelId: 'kimi-k2-0711-preview',
      apiKey: 'sk-typed-by-user',
    })

    const patch = buildSettingsPatch(inputs)
    expect(patch.llm).toEqual({
      baseUrl: 'https://api.moonshot.cn/v1',
      modelId: 'kimi-k2-0711-preview',
      apiFormat: 'openai-compatible',
      taskRoutes: [],
      apiKey: 'sk-typed-by-user',
    })
  })

  it('case 4 — identical inputs from a freshly-loaded snapshot produce a patch whose llm/agent/appearance match the snapshot (idempotent save contract)', () => {
    const loaded = makeSettings({
      llm: {
        ...makeSettings().llm,
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4o-mini',
      },
    })
    const inputs = inputsFromLoaded(loaded, 'dark')
    const patch = buildSettingsPatch(inputs)

    expect(patch.llm?.baseUrl).toBe(loaded.llm.baseUrl)
    expect(patch.llm?.modelId).toBe(loaded.llm.modelId)
    expect(patch.agent?.streaming).toBe(loaded.agent.streaming)
    expect(patch.appearance).toEqual({
      theme: 'dark',
      language: loaded.appearance.language,
    })
  })

  it('case 5 — full patch shape matches the historical Settings.tsx payload (no missing/extra fields)', () => {
    const loaded = makeSettings()
    const patch: SettingsPatch = buildSettingsPatch(inputsFromLoaded(loaded, 'dark'))

    // Top-level keys mirror what Settings.tsx historically sent.
    expect(Object.keys(patch).sort()).toEqual(
      ['agent', 'appearance', 'imageGeneration', 'llm', 'ocr', 'uapis'].sort(),
    )

    // Snapshot of agent block matches loaded.agent (no morningBrief drift).
    expect(patch.agent).toEqual({
      streaming: true,
      userPrompt: '',
      fullAccess: false,
      contextMessageLimit: 50,
      progressiveDisclosureEnabled: true,
      providerCachingEnabled: true,
      checkpointEnabled: true,
      seedOnResumeEnabled: true,
      upgradeDebugEventsEnabled: true,
      autoCompactEnabled: true,
      autoCompactThreshold: 100,
      morningBrief: { enabled: false, time: '09:30' },
    })
    // OCR: trimmed strings + customApiKey omitted when blank.
    expect(patch.ocr).toEqual({
      provider: 'uapis',
      customBaseUrl: '',
      customModelId: '',
    })
    expect(patch.uapis).toEqual({}) // no key typed, no apiKey field
  })
})
