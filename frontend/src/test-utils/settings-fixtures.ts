// Shared test fixtures for Settings hook / parity tests.
//
// Why this exists: useSettingsPageModel.test.ts and settings-page-parity.test.ts
// both need a complete PublicSettings to drive the hook. Inlining the same
// 60-line factory in two places drifts over time. Keep one source of truth.
import type { PublicSettings } from '../api/settings'

export function makeSettings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  const base: PublicSettings = {
    llm: {
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o-mini',
      kind: 'cloud',
      provider: 'openai-compatible',
      apiFormat: 'openai-compatible',
      activeProfileId: 'profile-1',
      profiles: [],
      taskRoutes: [],
      hasApiKey: true,
      apiKeyMask: 'sk-***',
    },
    imageGeneration: {
      apiFormat: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-image-1',
      size: 'auto',
      quality: 'auto',
      background: 'auto',
      outputFormat: 'png',
      outputCompression: 80,
      hasApiKey: false,
      apiKeyMask: '',
    },
    appearance: { theme: 'dark', language: 'zh-CN' },
    agent: {
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
    },
    ocr: {
      provider: 'uapis',
      customBaseUrl: '',
      customModelId: '',
      hasCustomApiKey: false,
      customApiKeyMask: '',
    },
    uapis: {
      hasApiKey: false,
      apiKeyMask: '',
      mode: 'free-ip-quota',
      home: 'https://uapis.cn',
      console: 'https://uapis.cn/console',
      anonymousMonthlyCredits: 1500,
      apiKeyMonthlyCredits: 3500,
    },
  }
  return { ...base, ...overrides }
}
