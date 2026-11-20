// ============================================================
// Electron bridge (minimal surface used by the desktop BootShell)
// ============================================================

/** Why the backend failed. Mirrors BackendErrorCode in main/python-manager.ts. */
export type BackendErrorCode =
  | 'backend_removed'
  | 'backend_missing'
  | 'backend_blocked'
  | 'backend_crashed'
  | 'backend_timeout'
  | 'backend_unresponsive'

export interface BackendFailure {
  code: BackendErrorCode
  message: string
  path?: string
}

export interface BackendStatusEvent {
  // 'lost' means a previously-ready backend stopped answering and the main
  // process is restarting it.
  status: 'ready' | 'error' | 'starting' | 'lost'
  port?: number
  error?: string
  // Present on 'error': lets the UI explain the specific failure and what to
  // do about it, rather than falling back to one generic sentence.
  code?: BackendErrorCode
  path?: string
}

export interface ElectronAPI {
  getBackendPort: () => Promise<number | null>
  getBackendStatus: () => Promise<string>
  /** The last backend failure, queryable so it can't be missed by timing. */
  getBackendError: () => Promise<BackendFailure | null>
  /** Data dir holding config.json and run.log (~/.cow in packaged builds). */
  getDataDir: () => Promise<string>
  restartBackend: () => Promise<boolean>
  /** Open a local file or folder with the OS default app. Resolves to '' on success. */
  openPath: (targetPath: string) => Promise<string>
  // Listener registrars return an unsubscribe fn for cleanup.
  onBackendStatus: (callback: (data: BackendStatusEvent) => void) => () => void
  platform: string
  // OS UI language (e.g. "zh-CN"); used to default the language on first run.
  systemLocale?: string
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
