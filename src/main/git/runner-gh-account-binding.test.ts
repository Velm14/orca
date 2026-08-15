import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  execFileMock,
  resolveGhAccountTokenMock,
  buildBoundGhChildEnvMock,
  createGhBoundAccountHostMismatchErrorMock
} = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  resolveGhAccountTokenMock: vi.fn(),
  buildBoundGhChildEnvMock: vi.fn(),
  createGhBoundAccountHostMismatchErrorMock: vi.fn(
    (binding: { host: string; user: string }, host?: string) =>
      Object.assign(
        new Error(
          host
            ? `host mismatch ${binding.host} vs ${host}`
            : `host required for ${binding.user}@${binding.host}`
        ),
        { code: 'gh_bound_account_host_mismatch', stderr: 'host mismatch' }
      )
  )
}))

vi.mock('child_process', () => ({
  execFile: execFileMock,
  execFileSync: vi.fn(),
  spawn: vi.fn()
}))

import type * as GhAccountTokenModule from '../github/gh-account-token'

vi.mock('../github/gh-account-token', async (importOriginal) => {
  const actual = await importOriginal<typeof GhAccountTokenModule>()
  return {
    ...actual,
    resolveGhAccountToken: resolveGhAccountTokenMock,
    buildBoundGhChildEnv: buildBoundGhChildEnvMock,
    createGhBoundAccountHostMismatchError: createGhBoundAccountHostMismatchErrorMock
  }
})

import { ghExecFileAsync } from './runner'
import { _resetGhRateLimitBreaker } from './gh-rate-limit-breaker'

type MockChildProcess = EventEmitter & {
  pid: number
  kill: ReturnType<typeof vi.fn>
  unref: ReturnType<typeof vi.fn>
}

function createMockChildProcess(pid: number): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.pid = pid
  child.kill = vi.fn()
  child.unref = vi.fn()
  return child
}

describe('ghExecFileAsync account binding', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    resolveGhAccountTokenMock.mockReset()
    buildBoundGhChildEnvMock.mockReset()
    createGhBoundAccountHostMismatchErrorMock.mockClear()
    _resetGhRateLimitBreaker()
    resolveGhAccountTokenMock.mockResolvedValue('bound-token')
    buildBoundGhChildEnvMock.mockImplementation(
      ({
        baseEnv,
        binding,
        token
      }: {
        baseEnv?: NodeJS.ProcessEnv
        binding: { host: string; user: string }
        token: string
      }) => ({
        ...(baseEnv ?? process.env),
        GH_PROMPT_DISABLED: '1',
        GH_TOKEN: binding.host === 'github.com' ? token : undefined,
        GH_ENTERPRISE_TOKEN: binding.host === 'github.com' ? undefined : token
      })
    )
  })

  afterEach(() => {
    _resetGhRateLimitBreaker()
  })

  it('injects bound token env for non-auth calls with matching host', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined
    execFileMock.mockImplementation((_cmd, _args, opts, cb) => {
      capturedEnv = opts.env
      cb(null, '[]', '')
      return createMockChildProcess(1)
    })

    await ghExecFileAsync(['api', 'user'], {
      host: 'github.com',
      ghAccount: { host: 'github.com', user: 'Alice' },
      env: { ...process.env, GH_TOKEN: 'ambient' }
    })

    expect(resolveGhAccountTokenMock).toHaveBeenCalledWith(
      { host: 'github.com', user: 'Alice' },
      expect.any(Object)
    )
    expect(buildBoundGhChildEnvMock).toHaveBeenCalled()
    expect(capturedEnv?.GH_TOKEN).toBe('bound-token')
  })

  it('skips injection for auth probes', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined
    execFileMock.mockImplementation((_cmd, _args, opts, cb) => {
      capturedEnv = opts.env
      cb(null, '', '')
      return createMockChildProcess(1)
    })

    await ghExecFileAsync(['auth', 'status'], {
      host: 'github.com',
      ghAccount: { host: 'github.com', user: 'Alice' },
      env: { ...process.env, GH_TOKEN: 'ambient' }
    })

    expect(resolveGhAccountTokenMock).not.toHaveBeenCalled()
    expect(capturedEnv?.GH_TOKEN).toBe('ambient')
  })

  it('pins options.host from the binding when callers omit host', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined
    execFileMock.mockImplementation((_cmd, _args, opts, cb) => {
      capturedEnv = opts.env
      cb(null, '[]', '')
      return createMockChildProcess(1)
    })

    await ghExecFileAsync(['api', 'user'], {
      ghAccount: { host: 'github.com', user: 'Alice' }
    })

    expect(resolveGhAccountTokenMock).toHaveBeenCalled()
    expect(capturedEnv?.GH_TOKEN).toBe('bound-token')
  })

  it('fails closed when argv host signals disagree with the binding', async () => {
    await expect(
      ghExecFileAsync(['pr', 'list', '--repo', 'github.acme.com/a/b'], {
        host: 'github.com',
        ghAccount: { host: 'github.com', user: 'Alice' }
      })
    ).rejects.toMatchObject({ code: 'gh_bound_account_host_mismatch' })
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
