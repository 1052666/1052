import type { AgentTool } from '../agent.tool.types.js'
import { performOcr } from '../../ocr/ocr.service.js'

export const ocrTools: AgentTool[] = [
  {
    name: 'ocr_recognize',
    description:
      'Recognize and extract text from an image using OCR. Accepts a base64-encoded image string or a publicly accessible image URL. The backend automatically routes to either the built-in UAPIs OCR or a user-configured custom vision model based on settings. Use this when the user asks to read, extract, or recognize text from an image, screenshot, photo, scan, or document image.',
    parameters: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description:
            'The image to recognize: either a base64-encoded image string or a publicly accessible URL (http/https).',
        },
      },
      required: ['image'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as { image?: string }
      if (!input.image || typeof input.image !== 'string') {
        return { ok: false, error: '缺少 image 参数：需要 base64 图片数据或图片 URL' }
      }
      return performOcr(input.image)
    },
  },
]
