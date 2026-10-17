import { app, type BrowserWindow } from 'electron'
import { agentHookServer } from '../agent-hooks/server'
import { registerNotchHandlers } from '../ipc/notch'
import { getTrustedUIRendererWindow } from '../ipc/ui'
import { NotchStatusService } from '../notch/notch-status-service'
import {
  NOTCH_QUIT_ABORT_GRACE_MS,
  shouldRestoreNotchAfterQuitAttempt
} from '../notch/notch-quit-restore'
import { buildNotchRows } from '../notch/notch-rows'
import {
  closeNotchWindow,
  closeNotchWindowForQuit,
  createNotchWindow,
  getNotchWindow,
  setNotchExpanded
} from '../notch/notch-window'
import { findAppWindow } from '../window/app-window-lookup'
import { safelyRevealWindow } from '../window/focus-existing-window'
import {
  NOTCH_REVEAL_PANE_CHANNEL,
  type NotchFocusPaneRequest
} from '../../shared/notch/notch-snapshot'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { mainProcessState as state } from './main-process-state'

// Why main reads agentHookServer directly: the main window's status IPC detaches when the window
// closes, and the notch exists for exactly that state.
let notchStatusService: NotchStatusService | null = null
let openMainWindow: (() => BrowserWindow) | null = null
// Buffered until the app renderer acks its listener: a freshly opened window drops IPC sent
// before its React effect attaches.
let pendingNotchReveal: NotchFocusPaneRequest | null = null
let notchQuitCommitted = false
let notchRestorePending = false

function getWorkspaceDisplayName(worktreeId: string): string | null {
  const store = state.store
  return (
    store?.getWorktreeMeta(worktreeId)?.displayName ??
    store
      ?.getFolderWorkspaces()
      .find((workspace) => folderWorkspaceKey(workspace.id) === worktreeId)?.name ??
    null
  )
}

export function syncNotchStatus(showNotchStatus: boolean): void {
  if (process.platform !== 'darwin' || state.isServeMode) {
    return
  }
  if (!showNotchStatus) {
    closeNotchWindow()
    notchStatusService?.stop()
    notchStatusService = null
    return
  }
  if (!notchStatusService) {
    notchStatusService = new NotchStatusService({ source: agentHookServer })
    notchStatusService.start()
  }
  const service = notchStatusService
  createNotchWindow({
    getSummary: () => service.getSummary(),
    subscribe: (listener) => service.subscribe(listener),
    buildRows: (summary) =>
      buildNotchRows({
        sessions: summary.sessions,
        lookup: { getDisplayName: getWorkspaceDisplayName },
        fallbackTitle: 'Agent'
      })
  })
}

function flushNotchReveal(): void {
  const args = pendingNotchReveal
  pendingNotchReveal = null
  const window = getTrustedUIRendererWindow()
  if (!args || !window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }
  window.webContents.send(NOTCH_REVEAL_PANE_CHANNEL, args)
}

// Why it reopens a closed window: a row click with no app window is the case the notch exists for.
function revealNotchPane(args: NotchFocusPaneRequest): void {
  const existing = getTrustedUIRendererWindow()
  const window = existing ?? openMainWindow?.()
  if (!window) {
    return
  }
  safelyRevealWindow(window)
  if (existing && !existing.webContents.isLoading()) {
    existing.webContents.send(NOTCH_REVEAL_PANE_CHANNEL, args)
  } else {
    pendingNotchReveal = args
  }
  try {
    app.focus({ steal: true })
  } catch {
    // Best-effort; safelyRevealWindow may still have raised it.
  }
}

// Why on before-quit: an always-on-top window suppresses `window-all-closed`, which completes a
// deferred Cmd+Q. A vetoed quit restores the bar after a grace period.
function installNotchQuitHandlers(): void {
  app.on('will-quit', () => {
    notchQuitCommitted = true
  })
  app.on('before-quit', () => {
    // Why captured per attempt: two vetoed quits inside the grace window must not cancel each other.
    const wasOpen = getNotchWindow() !== null || notchRestorePending
    closeNotchWindowForQuit()
    if (!wasOpen) {
      return
    }
    notchRestorePending = true
    const timer = setTimeout(() => {
      notchRestorePending = false
      if (
        shouldRestoreNotchAfterQuitAttempt({
          quitCommitted: notchQuitCommitted,
          hasAppWindow: findAppWindow() !== null,
          settingEnabled: state.store?.getSettings().showNotchStatus === true,
          wasOpenBeforeQuit: wasOpen
        })
      ) {
        syncNotchStatus(true)
      }
    }, NOTCH_QUIT_ABORT_GRACE_MS)
    timer.unref?.()
  })
}

/** Installs the notch's IPC and app listeners once, after the main quit handlers. */
export function installNotchStatus(options: { openMainWindow: () => BrowserWindow }): void {
  if (process.platform !== 'darwin') {
    return
  }
  openMainWindow = options.openMainWindow
  registerNotchHandlers({
    getService: () => notchStatusService,
    revealPane: revealNotchPane,
    onRevealRendererReady: flushNotchReveal
  })
  // Why: the panel is non-focusable and never blurs, so close it when attention moves elsewhere.
  app.on('did-resign-active', () => setNotchExpanded(false))
  app.on('browser-window-focus', () => setNotchExpanded(false))
  installNotchQuitHandlers()
}
