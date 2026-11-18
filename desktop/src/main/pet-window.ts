import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import path from 'path'

export interface PetDesktopMode {
  desktopWindow: boolean
  enabled: boolean
}

interface PetWindowDeps {
  getMainWindow: () => BrowserWindow | null
  showMainWindow: () => void
  onTrayStateChange?: () => void
}

let deps: PetWindowDeps | null = null
let petWindow: BrowserWindow | null = null
let petPageHealthy = false
let backendPort = 0
let mode: PetDesktopMode = { desktopWindow: true, enabled: true }
let ipcInitialized = false
let shortcutRegistered = false
let displayHooked = false

function isActiveOverlay(): boolean {
  return mode.desktopWindow && mode.enabled && backendPort > 0
}

function syncGlobalShortcut(): void {
  const want = isActiveOverlay()
  if (want && !shortcutRegistered) {
    try {
      shortcutRegistered = globalShortcut.register('Alt+P', () => {
        if (!isActiveOverlay()) return
        if (!petWindow || petWindow.isDestroyed()) {
          ensurePetWindow()
        }
        if (!petWindow || petWindow.isDestroyed()) return
        if (!petWindow.isVisible()) petWindow.showInactive()
        try {
          petWindow.setIgnoreMouseEvents(false)
          petWindow.setFocusable(true)
          petWindow.focus()
        } catch {
          // ignore window focus quirks
        }
        petWindow.webContents.send('pet-toggle-quick-chat')
      })
      if (!shortcutRegistered) {
        console.warn('[pet-window] Failed to register global shortcut Alt+P (already in use?)')
      }
    } catch (err) {
      shortcutRegistered = false
      console.warn('[pet-window] globalShortcut.register error:', (err as Error)?.message || err)
    }
  } else if (!want && shortcutRegistered) {
    try {
      globalShortcut.unregister('Alt+P')
    } catch {
      // ignore
    }
    shortcutRegistered = false
  }
}

function syncPetWindowBounds(): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const wa = screen.getPrimaryDisplay().workArea
  petWindow.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height })
}

function ensurePetWindow(): BrowserWindow | null {
  if (backendPort <= 0) return null
  if (petWindow && !petWindow.isDestroyed()) return petWindow

  const wa = screen.getPrimaryDisplay().workArea
  petWindow = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  try {
    petWindow.setAlwaysOnTop(true, 'screen-saver')
    if (process.platform === 'darwin') {
      petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
  } catch {
    // ignore unsupported platform options
  }

  petWindow.setIgnoreMouseEvents(true, { forward: true })
  petWindow.on('page-title-updated', (e) => e.preventDefault())

  const url = `http://127.0.0.1:${backendPort}/pet`
  petPageHealthy = false
  void petWindow.loadURL(url)

  petWindow.webContents.on('did-navigate', (_event, _navUrl, httpResponseCode) => {
    petPageHealthy = httpResponseCode >= 200 && httpResponseCode < 400
    if (!petPageHealthy) {
      console.warn(`[pet-window] /pet returned HTTP ${httpResponseCode}; hiding overlay`)
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.hide()
      }
    }
  })

  petWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    petPageHealthy = false
    console.warn(`[pet-window] /pet failed to load (${errorCode}): ${errorDescription}`)
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.hide()
    }
  })

  petWindow.once('ready-to-show', () => {
    if (!petWindow || petWindow.isDestroyed()) return
    if (petPageHealthy && isActiveOverlay()) {
      petWindow.showInactive()
    }
  })

  petWindow.webContents.on('did-finish-load', () => {
    if (!petWindow || petWindow.isDestroyed()) return
    if (!petPageHealthy) {
      petWindow.hide()
      return
    }
    if (isActiveOverlay() && !petWindow.isVisible()) {
      petWindow.showInactive()
    }
    petWindow.webContents.send('pet-config-changed', { ...mode })
  })

  petWindow.on('closed', () => {
    petWindow = null
    petPageHealthy = false
  })

  if (!displayHooked) {
    displayHooked = true
    screen.on('display-metrics-changed', syncPetWindowBounds)
    screen.on('display-removed', syncPetWindowBounds)
  }

  return petWindow
}

function applyPetWindowState(): void {
  if (isActiveOverlay()) {
    const win = ensurePetWindow()
    if (win && !win.isDestroyed()) {
      const targetUrl = `http://127.0.0.1:${backendPort}/pet`
      if (win.webContents.getURL() !== targetUrl) {
        petPageHealthy = false
        void win.loadURL(targetUrl)
      } else if (petPageHealthy && !win.isVisible()) {
        win.showInactive()
      }
    }
  } else if (petWindow && !petWindow.isDestroyed()) {
    try {
      petWindow.setFocusable(false)
      petWindow.setIgnoreMouseEvents(true, { forward: true })
      petWindow.hide()
    } catch {
      // ignore
    }
  }
  syncGlobalShortcut()
  deps?.onTrayStateChange?.()
}

export function initPetWindowSystem(options: PetWindowDeps): void {
  deps = options
  if (ipcInitialized) return
  ipcInitialized = true

  ipcMain.on('pet-set-ignore-mouse', (event, ignore: boolean) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return
    try {
      if (ignore) petWindow.setIgnoreMouseEvents(true, { forward: true })
      else petWindow.setIgnoreMouseEvents(false)
    } catch {
      // ignore
    }
  })

  ipcMain.on('pet-set-focusable', (event, focusable: boolean) => {
    if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return
    try {
      petWindow.setFocusable(Boolean(focusable))
      if (focusable) petWindow.focus()
    } catch {
      // ignore
    }
  })

  ipcMain.handle('pet-get-desktop-mode', () => ({ ...mode }))

  ipcMain.handle('pet-set-desktop-mode', (event, next: Partial<PetDesktopMode>) => {
    const desktopWindow = typeof next?.desktopWindow === 'boolean' ? next.desktopWindow : mode.desktopWindow
    const enabled = typeof next?.enabled === 'boolean' ? next.enabled : mode.enabled
    const changed = desktopWindow !== mode.desktopWindow || enabled !== mode.enabled
    mode = { desktopWindow, enabled }
    applyPetWindowState()
    if (changed) {
      const mainWin = deps?.getMainWindow()
      if (mainWin && !mainWin.isDestroyed() && event.sender !== mainWin.webContents) {
        mainWin.webContents.send('pet-config-changed', { ...mode })
      }
      if (petWindow && !petWindow.isDestroyed() && event.sender !== petWindow.webContents) {
        petWindow.webContents.send('pet-config-changed', { ...mode })
      }
    }
    return { ...mode }
  })

  ipcMain.handle('pet-quick-message', (_event, text: string) => {
    const cleaned = typeof text === 'string' ? text.trim() : ''
    if (!cleaned) return false
    const mainWin = deps?.getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) return false
    mainWin.webContents.send('pet-quick-message', cleaned)
    return true
  })

  ipcMain.handle('pet-open-main-chat', () => {
    deps?.showMainWindow()
    const mainWin = deps?.getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('menu-action', 'open-chat')
    }
    return true
  })

  ipcMain.on('pet-sync-to-overlay', (_event, payload: unknown) => {
    if (!petWindow || petWindow.isDestroyed()) return
    petWindow.webContents.send('pet-sync-event', payload)
  })

  ipcMain.on('pet-config-changed', (event, patch: Record<string, unknown>) => {
    const mainWin = deps?.getMainWindow()
    if (mainWin && !mainWin.isDestroyed() && event.sender !== mainWin.webContents) {
      mainWin.webContents.send('pet-config-changed', patch)
    }
    if (petWindow && !petWindow.isDestroyed() && event.sender !== petWindow.webContents) {
      petWindow.webContents.send('pet-config-changed', patch)
    }
  })
}

export function setPetBackendPort(port: number): void {
  backendPort = Number(port) || 0
  if (backendPort > 0) {
    applyPetWindowState()
  }
}

export function getPetDesktopMode(): PetDesktopMode {
  return { ...mode }
}

export function togglePetFromTray(): PetDesktopMode {
  if (!mode.desktopWindow) {
    mode = { desktopWindow: true, enabled: true }
  } else {
    mode = { ...mode, enabled: !mode.enabled }
  }
  applyPetWindowState()
  const mainWin = deps?.getMainWindow()
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('pet-config-changed', { ...mode })
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-config-changed', { ...mode })
  }
  return { ...mode }
}

export function destroyPetWindow(): void {
  if (shortcutRegistered) {
    try {
      globalShortcut.unregister('Alt+P')
    } catch {
      // ignore
    }
    shortcutRegistered = false
  }
  if (displayHooked) {
    displayHooked = false
    screen.removeListener('display-metrics-changed', syncPetWindowBounds)
    screen.removeListener('display-removed', syncPetWindowBounds)
  }
  if (petWindow && !petWindow.isDestroyed()) {
    try {
      petWindow.destroy()
    } catch {
      // ignore
    }
  }
  petWindow = null
}
