import { HttpError } from '../../http-error.js'
import { getSettings } from '../settings/settings.service.js'
import { UAPIS_BASE_URL } from '../uapis/uapis.catalog.js'

export type OcrResult = {
  provider: 'uapis' | 'custom-model'
  text: string
}

/**
 * Perform OCR on an image.
 *
 * Accepts either a base64-encoded image string or a publicly accessible URL.
 * The provider is determined by the user's OCR settings:
 *   - `uapis`: calls the built-in UAPIs OCR endpoint (POST /api/v1/image/ocr)
 *   - `custom-model`: calls an OpenAI-compatible vision model endpoint
 */
export async function performOcr(image: string): Promise<OcrResult> {
  if (!image || typeof image !== 'string') {
    throw new HttpError(400, 'OCR 输入不能为空：需要 base64 图片数据或图片 URL')
  }

  const settings = await getSettings()
  const { provider } = settings.ocr

  if (provider === 'custom-model') {
    return performOcrWithModel(image, settings.ocr)
  }

  return performOcrWithUapis(image, settings.uapis.apiKey)
}

async function performOcrWithUapis(
  image: string,
  uapisApiKey: string,
): Promise<OcrResult> {
  const url = `${UAPIS_BASE_URL}/api/v1/image/ocr`
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  }
  if (uapisApiKey) {
    headers.authorization = `Bearer ${uapisApiKey}`
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ image }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new HttpError(
      res.status,
      `UAPIs OCR 请求失败 (HTTP ${res.status}): ${body || res.statusText}`,
    )
  }

  const data = (await res.json()) as { text?: string; result?: string; data?: unknown }
  const text =
    typeof data.text === 'string'
      ? data.text
      : typeof data.result === 'string'
        ? data.result
        : JSON.stringify(data.data ?? data)

  return { provider: 'uapis', text }
}

async function performOcrWithModel(
  image: string,
  ocr: { customBaseUrl: string; customModelId: string; customApiKey: string },
): Promise<OcrResult> {
  if (!ocr.customBaseUrl.trim()) {
    throw new HttpError(400, 'OCR 自定义模型的 Base URL 未配置，请前往设置页填写')
  }
  if (!ocr.customModelId.trim()) {
    throw new HttpError(400, 'OCR 自定义模型的 Model ID 未配置，请前往设置页填写')
  }

  // Determine if image is a URL or base64
  const isUrl = /^https?:\/\//i.test(image.trim())
  const imageContent = isUrl
    ? { type: 'image_url' as const, image_url: { url: image.trim() } }
    : {
        type: 'image_url' as const,
        image_url: {
          url: image.startsWith('data:') ? image : `data:image/png;base64,${image}`,
        },
      }

  const baseUrl = ocr.customBaseUrl.trim().replace(/\/+$/, '')
  const endpoint = `${baseUrl}/v1/chat/completions`

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (ocr.customApiKey.trim()) {
    headers.authorization = `Bearer ${ocr.customApiKey.trim()}`
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: ocr.customModelId.trim(),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '请识别并提取图片中的所有文字内容。只输出识别到的文字，不要添加任何解释或格式化。如果图片中没有文字，回复"（无文字内容）"。',
            },
            imageContent,
          ],
        },
      ],
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new HttpError(
      res.status,
      `OCR 自定义模型请求失败 (HTTP ${res.status}): ${body || res.statusText}`,
    )
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content ?? ''

  return { provider: 'custom-model', text }
}
