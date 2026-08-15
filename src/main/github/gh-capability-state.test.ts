import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { commandExecFileAsyncMock } = vi.hoisted(() => ({
  commandExecFileAsyncMock: vi.fn()
}))

vi.mock('../git/runner', () => ({
  commandExecFileAsync: commandExecFileAsyncMock
}))

import {
  clearGhCapabilityStateForTests,
  getGhExecutionHostKey,
  getGhMultiAccountCapability,
  invalidateGhMultiAccountCapability
} from './gh-capability-state'

describe('gh-capability-state', () => {
  beforeEach(() => {
    clearGhCapabilityStateForTests()
    commandExecFileAsyncMock.mockReset()
  })

  afterEach(() => {
    clearGhCapabilityStateForTests()
  })

  it('keys local vs wsl execution hosts', () => {
    expect(getGhExecutionHostKey({})).toBe('local')
    expect(getGhExecutionHostKey({ wslDistro: 'Ubuntu' })).toBe('wsl:Ubuntu')
  })

  it('reports supported when help lists --user', async () => {
    commandExecFileAsyncMock.mockResolvedValue({
      stdout: 'Usage: gh auth token [--user login]',
      stderr: ''
    })
    await expect(getGhMultiAccountCapability()).resolves.toBe('supported')
    expect(commandExecFileAsyncMock).toHaveBeenCalledWith(
      'gh',
      ['auth', 'token', '--help'],
      expect.objectContaining({ timeout: 10_000 })
    )
  })

  it('reports unsupported when help omits --user', async () => {
    commandExecFileAsyncMock.mockResolvedValue({
      stdout: 'Usage: gh auth token',
      stderr: ''
    })
    await expect(getGhMultiAccountCapability({ wslDistro: 'Ubuntu' })).resolves.toBe('unsupported')
  })

  it('caches per runtime and invalidates on request', async () => {
    commandExecFileAsyncMock.mockResolvedValue({
      stdout: 'Usage: gh auth token [--user login]',
      stderr: ''
    })
    await getGhMultiAccountCapability({ wslDistro: 'Ubuntu' })
    await getGhMultiAccountCapability({ wslDistro: 'Ubuntu' })
    expect(commandExecFileAsyncMock).toHaveBeenCalledTimes(1)

    invalidateGhMultiAccountCapability({ wslDistro: 'Ubuntu' })
    await getGhMultiAccountCapability({ wslDistro: 'Ubuntu' })
    expect(commandExecFileAsyncMock).toHaveBeenCalledTimes(2)
  })
})
