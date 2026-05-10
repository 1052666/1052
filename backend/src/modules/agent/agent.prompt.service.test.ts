import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('agent prompt fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('keeps the fallback system prompt aligned with agent-system.md', async () => {
    const promptPath = path.resolve(process.cwd(), 'prompts', 'agent-system.md')
    const expected = (await fs.readFile(promptPath, 'utf-8')).replace(/\r\n/g, '\n').trim()
    vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('prompt file unavailable'))

    const { getAgentSystemPrompt } = await import('./agent.prompt.service.js')

    await expect(getAgentSystemPrompt()).resolves.toBe(expected)
  })
})
