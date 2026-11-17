import React from 'react'
import StatusScreen from './components/StatusScreen'
import { useBackend } from './hooks/useBackend'

/**
 * Lightweight Electron boot/error shell.
 * Once the Python backend reaches 'ready', the main process navigates the
 * BrowserWindow directly to the backend's local Web Console URL.
 */
const BootShell: React.FC = () => {
  const backend = useBackend()

  return (
    <StatusScreen
      status={backend.status === 'error' ? 'error' : 'connecting'}
      error={backend.error}
      code={backend.code}
      path={backend.path}
      slow={backend.slow}
      reconnecting={backend.reconnecting}
      onRetry={backend.restart}
    />
  )
}

export default BootShell
