export type AiSettings = {
  apiKey: string
  apiUrl: string
  baseUrl: string
  model: string
}

export const DEFAULT_AI_BASE_URL = "https://api.moonshot.cn/v1"
export const DEFAULT_AI_MODEL = "moonshot-v1-8k"

const AI_SETTINGS_STORAGE_KEY = "ai_pr_helper_settings_v1"

export const createDefaultAiSettings = (): AiSettings => ({
  apiKey: "",
  apiUrl: "",
  baseUrl: DEFAULT_AI_BASE_URL,
  model: DEFAULT_AI_MODEL
})

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, "")

const sanitizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : ""

export const sanitizeAiSettings = (settings: AiSettings): AiSettings => ({
  apiKey: sanitizeString(settings.apiKey),
  apiUrl: sanitizeString(settings.apiUrl),
  baseUrl: sanitizeString(settings.baseUrl),
  model: sanitizeString(settings.model)
})

export const hasRequiredAiSettings = (settings: AiSettings) => {
  const sanitized = sanitizeAiSettings(settings)
  return Boolean(
    sanitized.apiKey &&
      sanitized.model &&
      (sanitized.apiUrl || sanitized.baseUrl)
  )
}

export const resolveAiApiUrl = (settings: AiSettings) => {
  const sanitized = sanitizeAiSettings(settings)

  if (sanitized.apiUrl) {
    return sanitized.apiUrl
  }

  return `${normalizeUrl(sanitized.baseUrl)}/chat/completions`
}

export const getApiOriginPattern = (settings: AiSettings) => {
  const apiUrl = resolveAiApiUrl(settings)
  const origin = new URL(apiUrl).origin
  return `${origin}/*`
}

export const loadAiSettings = async (): Promise<AiSettings> => {
  const result = await chrome.storage.local.get(AI_SETTINGS_STORAGE_KEY)
  const saved = result?.[AI_SETTINGS_STORAGE_KEY]

  if (!saved || typeof saved !== "object") {
    return createDefaultAiSettings()
  }

  return sanitizeAiSettings({
    ...createDefaultAiSettings(),
    ...(saved as Partial<AiSettings>)
  })
}

export const saveAiSettings = async (settings: AiSettings) => {
  const sanitized = sanitizeAiSettings(settings)

  await chrome.storage.local.set({
    [AI_SETTINGS_STORAGE_KEY]: sanitized
  })
}

export const clearAiSettings = async () => {
  await chrome.storage.local.remove(AI_SETTINGS_STORAGE_KEY)
}

export const maskApiKey = (apiKey: string) => {
  const trimmed = apiKey.trim()

  if (trimmed.length <= 8) {
    return trimmed ? "********" : "未设置"
  }

  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}
