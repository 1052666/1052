import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SettingsApi,
  type LlmApiFormat,
  type LlmTaskKind,
  type LlmTaskRoute,
  type PublicSettings,
  type SettingsPatch,
} from '../api/settings'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface UseSettingsPageModelReturn {
  loaded: PublicSettings | null

  // LLM
  baseUrl: string
  setBaseUrl: (value: string) => void
  modelId: string
  setModelId: (value: string) => void
  llmApiFormat: LlmApiFormat
  setLlmApiFormat: (value: LlmApiFormat) => void
  apiKey: string
  setApiKey: (value: string) => void
  llmTaskRoutes: LlmTaskRoute[]
  setLlmTaskRoutes: (value: LlmTaskRoute[]) => void
  updateTaskRoute: (task: LlmTaskKind, profileId: string) => void
  taskRouteProfileId: (task: LlmTaskKind) => string

  // Image generation
  imageApiFormat: PublicSettings['imageGeneration']['apiFormat']
  setImageApiFormat: (value: PublicSettings['imageGeneration']['apiFormat']) => void
  imageBaseUrl: string
  setImageBaseUrl: (value: string) => void
  imageModelId: string
  setImageModelId: (value: string) => void
  imageApiKey: string
  setImageApiKey: (value: string) => void
  imageSize: PublicSettings['imageGeneration']['size']
  setImageSize: (value: PublicSettings['imageGeneration']['size']) => void
  imageQuality: PublicSettings['imageGeneration']['quality']
  setImageQuality: (value: PublicSettings['imageGeneration']['quality']) => void
  imageBackground: PublicSettings['imageGeneration']['background']
  setImageBackground: (value: PublicSettings['imageGeneration']['background']) => void
  imageOutputFormat: PublicSettings['imageGeneration']['outputFormat']
  setImageOutputFormat: (value: PublicSettings['imageGeneration']['outputFormat']) => void
  imageOutputCompression: number
  setImageOutputCompression: (value: number) => void

  // OCR
  ocrProvider: PublicSettings['ocr']['provider']
  setOcrProvider: (value: PublicSettings['ocr']['provider']) => void
  ocrCustomBaseUrl: string
  setOcrCustomBaseUrl: (value: string) => void
  ocrCustomModelId: string
  setOcrCustomModelId: (value: string) => void
  ocrCustomApiKey: string
  setOcrCustomApiKey: (value: string) => void

  // UAPIs
  uapisApiKey: string
  setUapisApiKey: (value: string) => void

  // Appearance (language only — theme lives in ThemeContext)
  uiLanguage: PublicSettings['appearance']['language']
  setUiLanguage: (value: PublicSettings['appearance']['language']) => void

  // Agent
  userPrompt: string
  setUserPrompt: (value: string) => void
  streaming: boolean
  setStreaming: (value: boolean) => void
  fullAccess: boolean
  setFullAccess: (value: boolean) => void
  contextMessageLimit: number
  setContextMessageLimit: (value: number) => void
  progressiveDisclosureEnabled: boolean
  setProgressiveDisclosureEnabled: (value: boolean) => void
  providerCachingEnabled: boolean
  setProviderCachingEnabled: (value: boolean) => void
  checkpointEnabled: boolean
  setCheckpointEnabled: (value: boolean) => void
  seedOnResumeEnabled: boolean
  setSeedOnResumeEnabled: (value: boolean) => void
  upgradeDebugEventsEnabled: boolean
  setUpgradeDebugEventsEnabled: (value: boolean) => void
  autoCompactEnabled: boolean
  setAutoCompactEnabled: (value: boolean) => void
  autoCompactThreshold: number
  setAutoCompactThreshold: (value: number) => void
  morningBriefEnabled: boolean
  setMorningBriefEnabled: (value: boolean) => void
  morningBriefTime: string
  setMorningBriefTime: (value: string) => void

  // Save flow
  saveState: SaveState
  error: string
  save: (theme: PublicSettings['appearance']['theme']) => Promise<void>
  buildPatch: (theme: PublicSettings['appearance']['theme']) => SettingsPatch
  isDirty: boolean

  // Composite helpers
  applyLlmPreset: (preset: { baseUrl: string; modelId: string }) => void
  applyImagePreset: (preset: {
    apiFormat: PublicSettings['imageGeneration']['apiFormat']
    baseUrl: string
    modelId: string
  }) => void

  // External sync (e.g. after LLM profile activate / upsert)
  syncLlmSettings: (settings: PublicSettings) => void
  applyLoaded: (settings: PublicSettings) => void
}

// Pure helper exported for parity test: build SettingsPatch from current state.
// Keeping this pure (no hook deps) lets us assert payload shape without React.
export interface SettingsPatchInputs {
  baseUrl: string
  modelId: string
  llmApiFormat: LlmApiFormat
  apiKey: string
  llmTaskRoutes: LlmTaskRoute[]
  imageApiFormat: PublicSettings['imageGeneration']['apiFormat']
  imageBaseUrl: string
  imageModelId: string
  imageApiKey: string
  imageSize: PublicSettings['imageGeneration']['size']
  imageQuality: PublicSettings['imageGeneration']['quality']
  imageBackground: PublicSettings['imageGeneration']['background']
  imageOutputFormat: PublicSettings['imageGeneration']['outputFormat']
  imageOutputCompression: number
  ocrProvider: PublicSettings['ocr']['provider']
  ocrCustomBaseUrl: string
  ocrCustomModelId: string
  ocrCustomApiKey: string
  uapisApiKey: string
  theme: PublicSettings['appearance']['theme']
  uiLanguage: PublicSettings['appearance']['language']
  userPrompt: string
  streaming: boolean
  fullAccess: boolean
  contextMessageLimit: number
  progressiveDisclosureEnabled: boolean
  providerCachingEnabled: boolean
  checkpointEnabled: boolean
  seedOnResumeEnabled: boolean
  upgradeDebugEventsEnabled: boolean
  autoCompactEnabled: boolean
  autoCompactThreshold: number
  morningBriefEnabled: boolean
  morningBriefTime: string
}

export function buildSettingsPatch(inputs: SettingsPatchInputs): SettingsPatch {
  return {
    llm: {
      baseUrl: inputs.baseUrl.trim(),
      modelId: inputs.modelId.trim(),
      apiFormat: inputs.llmApiFormat,
      taskRoutes: inputs.llmTaskRoutes,
      ...(inputs.apiKey.trim() ? { apiKey: inputs.apiKey.trim() } : {}),
    },
    imageGeneration: {
      apiFormat: inputs.imageApiFormat,
      baseUrl: inputs.imageBaseUrl.trim(),
      modelId: inputs.imageModelId.trim(),
      ...(inputs.imageApiKey.trim() ? { apiKey: inputs.imageApiKey.trim() } : {}),
      size: inputs.imageSize,
      quality: inputs.imageQuality,
      background: inputs.imageBackground,
      outputFormat: inputs.imageOutputFormat,
      outputCompression: inputs.imageOutputCompression,
    },
    ocr: {
      provider: inputs.ocrProvider,
      customBaseUrl: inputs.ocrCustomBaseUrl.trim(),
      customModelId: inputs.ocrCustomModelId.trim(),
      ...(inputs.ocrCustomApiKey.trim() ? { customApiKey: inputs.ocrCustomApiKey.trim() } : {}),
    },
    uapis: {
      ...(inputs.uapisApiKey.trim() ? { apiKey: inputs.uapisApiKey.trim() } : {}),
    },
    appearance: { theme: inputs.theme, language: inputs.uiLanguage },
    agent: {
      streaming: inputs.streaming,
      userPrompt: inputs.userPrompt,
      fullAccess: inputs.fullAccess,
      contextMessageLimit: inputs.contextMessageLimit,
      progressiveDisclosureEnabled: inputs.progressiveDisclosureEnabled,
      providerCachingEnabled: inputs.providerCachingEnabled,
      checkpointEnabled: inputs.checkpointEnabled,
      seedOnResumeEnabled: inputs.seedOnResumeEnabled,
      upgradeDebugEventsEnabled: inputs.upgradeDebugEventsEnabled,
      autoCompactEnabled: inputs.autoCompactEnabled,
      autoCompactThreshold: inputs.autoCompactThreshold,
      morningBrief: {
        enabled: inputs.morningBriefEnabled,
        time: inputs.morningBriefTime,
      },
    },
  }
}

export function useSettingsPageModel(): UseSettingsPageModelReturn {
  const [loaded, setLoaded] = useState<PublicSettings | null>(null)

  // LLM state
  const [baseUrl, setBaseUrl] = useState('')
  const [modelId, setModelId] = useState('')
  const [llmApiFormat, setLlmApiFormat] = useState<LlmApiFormat>('openai-compatible')
  const [apiKey, setApiKey] = useState('')
  const [llmTaskRoutes, setLlmTaskRoutes] = useState<LlmTaskRoute[]>([])

  // Image state
  const [imageApiFormat, setImageApiFormat] =
    useState<PublicSettings['imageGeneration']['apiFormat']>('openai-compatible')
  const [imageBaseUrl, setImageBaseUrl] = useState('')
  const [imageModelId, setImageModelId] = useState('')
  const [imageApiKey, setImageApiKey] = useState('')
  const [imageSize, setImageSize] = useState<PublicSettings['imageGeneration']['size']>('auto')
  const [imageQuality, setImageQuality] =
    useState<PublicSettings['imageGeneration']['quality']>('auto')
  const [imageBackground, setImageBackground] =
    useState<PublicSettings['imageGeneration']['background']>('auto')
  const [imageOutputFormat, setImageOutputFormat] =
    useState<PublicSettings['imageGeneration']['outputFormat']>('png')
  const [imageOutputCompression, setImageOutputCompression] = useState(80)

  // OCR state
  const [ocrProvider, setOcrProvider] = useState<PublicSettings['ocr']['provider']>('uapis')
  const [ocrCustomBaseUrl, setOcrCustomBaseUrl] = useState('')
  const [ocrCustomModelId, setOcrCustomModelId] = useState('')
  const [ocrCustomApiKey, setOcrCustomApiKey] = useState('')

  // UAPIs state
  const [uapisApiKey, setUapisApiKey] = useState('')

  // Appearance language state (theme stays in ThemeContext, passed at save time)
  const [uiLanguage, setUiLanguage] =
    useState<PublicSettings['appearance']['language']>('zh-CN')

  // Agent state
  const [userPrompt, setUserPrompt] = useState('')
  const [streaming, setStreaming] = useState(true)
  const [fullAccess, setFullAccess] = useState(false)
  const [contextMessageLimit, setContextMessageLimit] = useState(50)
  const [progressiveDisclosureEnabled, setProgressiveDisclosureEnabled] = useState(true)
  const [providerCachingEnabled, setProviderCachingEnabled] = useState(true)
  const [checkpointEnabled, setCheckpointEnabled] = useState(true)
  const [seedOnResumeEnabled, setSeedOnResumeEnabled] = useState(true)
  const [upgradeDebugEventsEnabled, setUpgradeDebugEventsEnabled] = useState(true)
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(true)
  const [autoCompactThreshold, setAutoCompactThreshold] = useState(100)
  const [morningBriefEnabled, setMorningBriefEnabled] = useState(false)
  const [morningBriefTime, setMorningBriefTime] = useState('09:30')

  // Save flow
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState('')

  const savedTimerRef = useRef<number | null>(null)

  // Apply full PublicSettings to local state (initial fetch).
  // Note: appearance.theme is owned by ThemeContext; caller wires it separately.
  const applyLoaded = useCallback((settings: PublicSettings) => {
    setLoaded(settings)
    setBaseUrl(settings.llm.baseUrl)
    setModelId(settings.llm.modelId)
    setLlmApiFormat(settings.llm.apiFormat)
    setLlmTaskRoutes(settings.llm.taskRoutes)
    setImageApiFormat(settings.imageGeneration.apiFormat)
    setImageBaseUrl(settings.imageGeneration.baseUrl)
    setImageModelId(settings.imageGeneration.modelId)
    setImageSize(settings.imageGeneration.size)
    setImageQuality(settings.imageGeneration.quality)
    setImageBackground(settings.imageGeneration.background)
    setImageOutputFormat(settings.imageGeneration.outputFormat)
    setImageOutputCompression(settings.imageGeneration.outputCompression)
    setOcrProvider(settings.ocr.provider)
    setOcrCustomBaseUrl(settings.ocr.customBaseUrl)
    setOcrCustomModelId(settings.ocr.customModelId)
    setUserPrompt(settings.agent.userPrompt)
    setStreaming(settings.agent.streaming)
    setFullAccess(settings.agent.fullAccess)
    setContextMessageLimit(settings.agent.contextMessageLimit)
    setProgressiveDisclosureEnabled(settings.agent.progressiveDisclosureEnabled)
    setProviderCachingEnabled(settings.agent.providerCachingEnabled)
    setCheckpointEnabled(settings.agent.checkpointEnabled)
    setSeedOnResumeEnabled(settings.agent.seedOnResumeEnabled)
    setUpgradeDebugEventsEnabled(settings.agent.upgradeDebugEventsEnabled)
    setAutoCompactEnabled(settings.agent.autoCompactEnabled)
    setAutoCompactThreshold(settings.agent.autoCompactThreshold)
    setMorningBriefEnabled(settings.agent.morningBrief.enabled)
    setMorningBriefTime(settings.agent.morningBrief.time)
    setUiLanguage(settings.appearance.language)
  }, [])

  // Initial load on mount.
  useEffect(() => {
    let cancelled = false
    SettingsApi.get()
      .then((settings) => {
        if (cancelled) return
        applyLoaded(settings)
      })
      .catch((err) => {
        if (cancelled) return
        const errorLike = err as { message?: string }
        setError(errorLike.message ?? '设置加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [applyLoaded])

  // Cleanup the "saved → idle" timer on unmount.
  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current)
      }
    }
  }, [])

  const updateTaskRoute = useCallback((task: LlmTaskKind, profileId: string) => {
    setLlmTaskRoutes((current) => {
      const remaining = current.filter((route) => route.task !== task)
      if (!profileId) return remaining
      return [...remaining, { task, profileId }]
    })
  }, [])

  const taskRouteProfileId = useCallback(
    (task: LlmTaskKind): string =>
      llmTaskRoutes.find((route) => route.task === task)?.profileId ?? '',
    [llmTaskRoutes],
  )

  const applyLlmPreset = useCallback(
    (preset: { baseUrl: string; modelId: string }) => {
      setBaseUrl(preset.baseUrl)
      setModelId(preset.modelId)
    },
    [],
  )

  const applyImagePreset = useCallback(
    (preset: {
      apiFormat: PublicSettings['imageGeneration']['apiFormat']
      baseUrl: string
      modelId: string
    }) => {
      setImageApiFormat(preset.apiFormat)
      setImageBaseUrl(preset.baseUrl)
      setImageModelId(preset.modelId)
    },
    [],
  )

  const syncLlmSettings = useCallback((settings: PublicSettings) => {
    setLoaded(settings)
    setBaseUrl(settings.llm.baseUrl)
    setModelId(settings.llm.modelId)
    setLlmApiFormat(settings.llm.apiFormat)
    setApiKey('')
    setLlmTaskRoutes(settings.llm.taskRoutes)
  }, [])

  const buildPatch = useCallback(
    (theme: PublicSettings['appearance']['theme']): SettingsPatch =>
      buildSettingsPatch({
        baseUrl,
        modelId,
        llmApiFormat,
        apiKey,
        llmTaskRoutes,
        imageApiFormat,
        imageBaseUrl,
        imageModelId,
        imageApiKey,
        imageSize,
        imageQuality,
        imageBackground,
        imageOutputFormat,
        imageOutputCompression,
        ocrProvider,
        ocrCustomBaseUrl,
        ocrCustomModelId,
        ocrCustomApiKey,
        uapisApiKey,
        theme,
        uiLanguage,
        userPrompt,
        streaming,
        fullAccess,
        contextMessageLimit,
        progressiveDisclosureEnabled,
        providerCachingEnabled,
        checkpointEnabled,
        seedOnResumeEnabled,
        upgradeDebugEventsEnabled,
        autoCompactEnabled,
        autoCompactThreshold,
        morningBriefEnabled,
        morningBriefTime,
      }),
    [
      baseUrl,
      modelId,
      llmApiFormat,
      apiKey,
      llmTaskRoutes,
      imageApiFormat,
      imageBaseUrl,
      imageModelId,
      imageApiKey,
      imageSize,
      imageQuality,
      imageBackground,
      imageOutputFormat,
      imageOutputCompression,
      ocrProvider,
      ocrCustomBaseUrl,
      ocrCustomModelId,
      ocrCustomApiKey,
      uapisApiKey,
      uiLanguage,
      userPrompt,
      streaming,
      fullAccess,
      contextMessageLimit,
      progressiveDisclosureEnabled,
      providerCachingEnabled,
      checkpointEnabled,
      seedOnResumeEnabled,
      upgradeDebugEventsEnabled,
      autoCompactEnabled,
      autoCompactThreshold,
      morningBriefEnabled,
      morningBriefTime,
    ],
  )

  const save = useCallback(
    async (theme: PublicSettings['appearance']['theme']) => {
      setSaveState('saving')
      setError('')
      const patch = buildPatch(theme)
      try {
        const settings = await SettingsApi.update(patch)
        setLoaded(settings)
        setLlmTaskRoutes(settings.llm.taskRoutes)
        setApiKey('')
        setImageApiKey('')
        setUapisApiKey('')
        setOcrCustomApiKey('')
        setSaveState('saved')
        if (savedTimerRef.current !== null) {
          window.clearTimeout(savedTimerRef.current)
        }
        savedTimerRef.current = window.setTimeout(() => {
          setSaveState('idle')
          savedTimerRef.current = null
        }, 1500)
      } catch (err) {
        const errorLike = err as { message?: string }
        setError(errorLike.message ?? '设置保存失败')
        setSaveState('error')
      }
    },
    [buildPatch],
  )

  // Dirty check: compare current local state vs `loaded` snapshot.
  // Excludes transient apiKey fields (they're "empty means unchanged").
  // Note: theme isn't tracked here (lives in ThemeContext); caller can layer on
  // their own theme-dirty check if needed.
  const isDirty = useMemo(() => {
    if (!loaded) return false
    const l = loaded
    if (baseUrl !== l.llm.baseUrl) return true
    if (modelId !== l.llm.modelId) return true
    if (llmApiFormat !== l.llm.apiFormat) return true
    if (apiKey.trim() !== '') return true
    if (
      llmTaskRoutes.length !== l.llm.taskRoutes.length ||
      llmTaskRoutes.some((route, idx) => {
        const other = l.llm.taskRoutes[idx]
        return !other || other.task !== route.task || other.profileId !== route.profileId
      })
    ) {
      return true
    }
    if (imageApiFormat !== l.imageGeneration.apiFormat) return true
    if (imageBaseUrl !== l.imageGeneration.baseUrl) return true
    if (imageModelId !== l.imageGeneration.modelId) return true
    if (imageApiKey.trim() !== '') return true
    if (imageSize !== l.imageGeneration.size) return true
    if (imageQuality !== l.imageGeneration.quality) return true
    if (imageBackground !== l.imageGeneration.background) return true
    if (imageOutputFormat !== l.imageGeneration.outputFormat) return true
    if (imageOutputCompression !== l.imageGeneration.outputCompression) return true
    if (ocrProvider !== l.ocr.provider) return true
    if (ocrCustomBaseUrl !== l.ocr.customBaseUrl) return true
    if (ocrCustomModelId !== l.ocr.customModelId) return true
    if (ocrCustomApiKey.trim() !== '') return true
    if (uapisApiKey.trim() !== '') return true
    if (uiLanguage !== l.appearance.language) return true
    if (userPrompt !== l.agent.userPrompt) return true
    if (streaming !== l.agent.streaming) return true
    if (fullAccess !== l.agent.fullAccess) return true
    if (contextMessageLimit !== l.agent.contextMessageLimit) return true
    if (progressiveDisclosureEnabled !== l.agent.progressiveDisclosureEnabled) return true
    if (providerCachingEnabled !== l.agent.providerCachingEnabled) return true
    if (checkpointEnabled !== l.agent.checkpointEnabled) return true
    if (seedOnResumeEnabled !== l.agent.seedOnResumeEnabled) return true
    if (upgradeDebugEventsEnabled !== l.agent.upgradeDebugEventsEnabled) return true
    if (autoCompactEnabled !== l.agent.autoCompactEnabled) return true
    if (autoCompactThreshold !== l.agent.autoCompactThreshold) return true
    if (morningBriefEnabled !== l.agent.morningBrief.enabled) return true
    if (morningBriefTime !== l.agent.morningBrief.time) return true
    return false
  }, [
    loaded,
    baseUrl,
    modelId,
    llmApiFormat,
    apiKey,
    llmTaskRoutes,
    imageApiFormat,
    imageBaseUrl,
    imageModelId,
    imageApiKey,
    imageSize,
    imageQuality,
    imageBackground,
    imageOutputFormat,
    imageOutputCompression,
    ocrProvider,
    ocrCustomBaseUrl,
    ocrCustomModelId,
    ocrCustomApiKey,
    uapisApiKey,
    uiLanguage,
    userPrompt,
    streaming,
    fullAccess,
    contextMessageLimit,
    progressiveDisclosureEnabled,
    providerCachingEnabled,
    checkpointEnabled,
    seedOnResumeEnabled,
    upgradeDebugEventsEnabled,
    autoCompactEnabled,
    autoCompactThreshold,
    morningBriefEnabled,
    morningBriefTime,
  ])

  return {
    loaded,
    baseUrl,
    setBaseUrl,
    modelId,
    setModelId,
    llmApiFormat,
    setLlmApiFormat,
    apiKey,
    setApiKey,
    llmTaskRoutes,
    setLlmTaskRoutes,
    updateTaskRoute,
    taskRouteProfileId,
    imageApiFormat,
    setImageApiFormat,
    imageBaseUrl,
    setImageBaseUrl,
    imageModelId,
    setImageModelId,
    imageApiKey,
    setImageApiKey,
    imageSize,
    setImageSize,
    imageQuality,
    setImageQuality,
    imageBackground,
    setImageBackground,
    imageOutputFormat,
    setImageOutputFormat,
    imageOutputCompression,
    setImageOutputCompression,
    ocrProvider,
    setOcrProvider,
    ocrCustomBaseUrl,
    setOcrCustomBaseUrl,
    ocrCustomModelId,
    setOcrCustomModelId,
    ocrCustomApiKey,
    setOcrCustomApiKey,
    uapisApiKey,
    setUapisApiKey,
    uiLanguage,
    setUiLanguage,
    userPrompt,
    setUserPrompt,
    streaming,
    setStreaming,
    fullAccess,
    setFullAccess,
    contextMessageLimit,
    setContextMessageLimit,
    progressiveDisclosureEnabled,
    setProgressiveDisclosureEnabled,
    providerCachingEnabled,
    setProviderCachingEnabled,
    checkpointEnabled,
    setCheckpointEnabled,
    seedOnResumeEnabled,
    setSeedOnResumeEnabled,
    upgradeDebugEventsEnabled,
    setUpgradeDebugEventsEnabled,
    autoCompactEnabled,
    setAutoCompactEnabled,
    autoCompactThreshold,
    setAutoCompactThreshold,
    morningBriefEnabled,
    setMorningBriefEnabled,
    morningBriefTime,
    setMorningBriefTime,
    saveState,
    error,
    save,
    buildPatch,
    isDirty,
    applyLlmPreset,
    applyImagePreset,
    syncLlmSettings,
    applyLoaded,
  }
}
