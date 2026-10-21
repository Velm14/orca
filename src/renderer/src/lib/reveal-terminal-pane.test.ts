import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'

const mocks = vi.hoisted(() => ({
  activateAndRevealWorkspace: vi.fn(),
  activateTabAndFocusPane: vi.fn(),
  activateTerminalTabOnOwner: vi.fn(),
  minimizeFloatingWorkspacePanel: vi.fn(),
  state: {}
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: mocks.activateAndRevealWorkspace
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: mocks.activateTabAndFocusPane
}))
vi.mock('@/lib/terminal-tab-owner-activation', () => ({
  activateTerminalTabOnOwner: mocks.activateTerminalTabOnOwner
}))
vi.mock('@/lib/floating-workspace-panel-reveal', () => ({
  minimizeFloatingWorkspacePanel: mocks.minimizeFloatingWorkspacePanel
}))

import { revealTerminalPane } from './reveal-terminal-pane'

const pane = { tabId: 'tab-1', leafId: 'leaf-1', executionHostId: null }

describe('revealTerminalPane', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.activateAndRevealWorkspace.mockReturnValue(true)
  })

  it('minimizes the floating panel before focusing a pane it would cover', () => {
    expect(revealTerminalPane({ worktreeId: 'repo-1::/srv/app', ...pane })).toBe(true)

    expect(mocks.minimizeFloatingWorkspacePanel).toHaveBeenCalledWith(mocks.state)
    expect(mocks.minimizeFloatingWorkspacePanel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activateTabAndFocusPane.mock.invocationCallOrder[0]
    )
  })

  it('keeps the panel for a floating pane and when the workspace is unknown', () => {
    revealTerminalPane({ worktreeId: FLOATING_TERMINAL_WORKTREE_ID, ...pane })
    mocks.activateAndRevealWorkspace.mockReturnValue(false)
    expect(revealTerminalPane({ worktreeId: 'repo-1::/srv/app', ...pane })).toBe(false)

    expect(mocks.minimizeFloatingWorkspacePanel).not.toHaveBeenCalled()
  })
})
