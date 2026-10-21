import { toRuntimeExecutionHostId } from '../shared/execution-host'
import type { RuntimeTerminalShow } from '../shared/runtime-types'
import type { RuntimeTerminalReveal } from '../shared/terminal-pane-reveal'
import { RuntimeClient } from './runtime-client'
import { resolveEnvironment } from './runtime/environments'

// Why: just past the desktop's own 10 s wait for its renderer, so a stalled local app delays the
// paired host's fallback by seconds rather than the client's default request timeout.
const LOCAL_DESKTOP_REVEAL_TIMEOUT_MS = 12_000

/**
 * The desktop app on this machine shows a paired environment's panes under the same ids and can
 * reveal one; it is the window the person running the CLI is looking at (#24688, #31073).
 * Resolves false when no local desktop shows the environment; the paired host then navigates.
 */
export async function revealPairedTerminalOnLocalDesktop(
  client: RuntimeClient,
  handle: string
): Promise<boolean> {
  if (!client.environmentSelector) {
    return false
  }
  try {
    const environment = resolveEnvironment(client.userDataPath, client.environmentSelector)
    const { terminal } = (
      await client.call<{ terminal: RuntimeTerminalShow }>('terminal.show', { terminal: handle })
    ).result
    const desktop = new RuntimeClient(client.userDataPath, undefined, null, null)
    const revealed = await desktop.call<{ reveal: RuntimeTerminalReveal }>(
      'terminal.reveal',
      {
        worktreeId: terminal.worktreeId,
        tabId: terminal.tabId,
        leafId: terminal.leafId,
        executionHostId: toRuntimeExecutionHostId(environment.id)
      },
      { timeoutMs: LOCAL_DESKTOP_REVEAL_TIMEOUT_MS }
    )
    return revealed.result.reveal.navigated
  } catch {
    // Why: no desktop here, one without terminal.reveal, a headless one, or a handle gone since.
    return false
  }
}
