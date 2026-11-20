import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import path from 'path'
import {
  DEFAULT_PET_SHORTCUT,
  defaultPetPrefs,
  formatPetDisplayList,
  loadPetPrefs,
  normalizePetShortcut,
  resolvePetDisplay,
  savePetPrefs,
  type DisplayLike,
  type PetDisplayInfo,
  type PetPrefs,
} from './pet-prefs'

export type PetDesktopMode = PetPrefs

interface PetWindowDeps {
  getMainWindow: () => BrowserWindow | null
  showMainWindow: () => void
  onTrayStateChange?: () => void
}

let deps: PetWindowDeps | null = null
let petWindow: BrowserWindow | null = null
let petPageHealthy = false
let backendPort = 0
let prefs: PetPrefs = defaultPetPrefs()
let prefsLoaded = false
let ipcInitialized = false
let registeredShortcut: string | null = null
let shortcutPaused = false
let displayHooked = false

function getPrefsFilePath(): string {
  return path.join(app.getPath('userData'), 'pet-prefs.json')
}

function ensurePrefsLoaded(): void {
  if (prefsLoaded) return
  prefsLoaded = true
  try {
    prefs = loadPetPrefs(getPrefsFilePath())
  } catch {
    prefs = defaultPetPrefs()
  }
}

function persistPrefs(): void {
  try {
    savePetPrefs(getPrefsFilePath(), prefs)
  } catch {
    // ignore
  }
}

function isActiveOverlay(): boolean {
  return prefs.desktopWindow && prefs.enabled && backendPort > 0
}

function getDisplaySnapshot(): { displays: DisplayLike[]; primaryId: number | null } {
  const displays = screen.getAllDisplays() as unknown as DisplayLike[]
  const primary = screen.getPrimaryDisplay()
  return { displays, primaryId: primary?.id ?? null }
}

function getDisplayListPayload(): PetDisplayInfo[] {
  const { displays, primaryId } = getDisplaySnapshot()
  return formatPetDisplayList(displays, primaryId)
}

function broadcastToWindows(
  channel: string,
  payload: unknown,
  excludeSender?: Electron.WebContents,
): void {
  const mainWin = deps?.getMainWindow()
  if (mainWin && !mainWin.isDestroyed() && mainWin.webContents !== excludeSender) {
    mainWin.webContents.send(channel, payload)
  }
  if (petWindow && !petWindow.isDestroyed() && petWindow.webContents !== excludeSender) {
    petWindow.webContents.send(channel, payload)
  }
}

function triggerQuickChat(): void {
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
}

function unregisterCurrentShortcut(): void {
  if (!registeredShortcut) return
  try {
    globalShortcut.unregister(registeredShortcut)
  } catch {
    // ignore
  }
  registeredShortcut = null
}

function syncGlobalShortcut(): void {
  const want = isActiveOverlay() && !shortcutPaused && Boolean(prefs.shortcut)
  const target = want ? prefs.shortcut : null

  if (registeredShortcut && registeredShortcut !== target) {
    unregisterCurrentShortcut()
  }

  if (target && registeredShortcut !== target) {
    try {
      const ok = globalShortcut.register(target, triggerQuickChat)
      if (ok) {
        registeredShortcut = target
      } else {
        registeredShortcut = null
        console.warn(`[pet-window] Failed to register global shortcut ${target} (already in use?)`)
      }
    } catch (err) {
      registeredShortcut = null
      console.warn('[pet-window] globalShortcut.register error:', (err as Error)?.message || err)
    }
  }
}

function applyShortcutUpdate(rawShortcut: string): { ok: boolean; shortcut: string; error?: string } {
  shortcutPaused = false
  const normalized = normalizePetShortcut(rawShortcut)
  if (normalized === null) {
    syncGlobalShortcut()
    return { ok: false, shortcut: prefs.shortcut, error: 'invalid' }
  }

  if (normalized === '') {
    unregisterCurrentShortcut()
    prefs = { ...prefs, shortcut: '' }
    persistPrefs()
    broadcastToWindows('pet-config-changed', { shortcut: '' })
    return { ok: true, shortcut: '' }
  }

  if (normalized === prefs.shortcut) {
    syncGlobalShortcut()
    if (isActiveOverlay() && registeredShortcut !== normalized) {
      return { ok: false, shortcut: prefs.shortcut, error: 'conflict' }
    }
    return { ok: true, shortcut: prefs.shortcut }
  }

  const prevShortcut = prefs.shortcut
  unregisterCurrentShortcut()

  let registered = false
  try {
    registered = globalShortcut.register(normalized, triggerQuickChat)
  } catch {
    registered = false
  }

  if (!registered) {
    // Restore the previous working shortcut so the user isn't left without one.
    prefs = { ...prefs, shortcut: prevShortcut }
    syncGlobalShortcut()
    return { ok: false, shortcut: prevShortcut, error: 'conflict' }
  }

  prefs = { ...prefs, shortcut: normalized }
  if (isActiveOverlay()) {
    registeredShortcut = normalized
  } else {
    // Only keep OS globalShortcut claimed while the desktop overlay is active.
    try {
      globalShortcut.unregister(normalized)
    } catch {
      // ignore
    }
    registeredShortcut = null
  }
  persistPrefs()
  broadcastToWindows('pet-config-changed', { shortcut: prefs.shortcut })
  return { ok: true, shortcut: prefs.shortcut }
}

function resolveTargetWorkArea(): Electron.Rectangle {
  const { displays, primaryId } = getDisplaySnapshot()
  const resolved = resolvePetDisplay(displays, primaryId, prefs.displayId)
  if (resolved.fellBack && prefs.displayId !== resolved.effectiveDisplayId) {
    prefs = { ...prefs, displayId: resolved.effectiveDisplayId }
    persistPrefs()
    broadcastToWindows('pet-config-changed', { displayId: prefs.displayId })
  }
  if (resolved.display) {
    return resolved.display.workArea
  }
  return screen.getPrimaryDisplay().workArea
}

function syncPetWindowBounds(): void {
  const wa = resolveTargetWorkArea()
  if (!petWindow || petWindow.isDestroyed()) return
  try {
    petWindow.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height })
  } catch {
    // ignore transient display transition errors
  }
}

function handleDisplayTopologyChange(): void {
  syncPetWindowBounds()
  broadcastToWindows('pet-displays-changed', {
    displays: getDisplayListPayload(),
    displayId: prefs.displayId,
  })
}

function ensurePetWindow(): BrowserWindow | null {
  if (backendPort <= 0) return null
  if (petWindow && !petWindow.isDestroyed()) return petWindow

  const wa = resolveTargetWorkArea()
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
    petWindow.webContents.send('pet-config-changed', { ...prefs })
    petWindow.webContents.send('pet-displays-changed', {
      displays: getDisplayListPayload(),
      displayId: prefs.displayId,
    })
  })

  petWindow.on('closed', () => {
    petWindow = null
    petPageHealthy = false
  })

  if (!displayHooked) {
    displayHooked = true
    screen.on('display-added', handleDisplayTopologyChange)
    screen.on('display-metrics-changed', handleDisplayTopologyChange)
    screen.on('display-removed', handleDisplayTopologyChange)
  }

  return petWindow
}

function applyPetWindowState(): void {
  if (isActiveOverlay()) {
    const win = ensurePetWindow()
    if (win && !win.isDestroyed()) {
      syncPetWindowBounds()
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
  ensurePrefsLoaded()
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

  ipcMain.handle('pet-get-desktop-mode', () => {
    ensurePrefsLoaded()
    return { ...prefs }
  })

  ipcMain.handle('pet-set-desktop-mode', (event, next: Partial<PetPrefs>) => {
    ensurePrefsLoaded()
    const desktopWindow = typeof next?.desktopWindow === 'boolean' ? next.desktopWindow : prefs.desktopWindow
    const enabled = typeof next?.enabled === 'boolean' ? next.enabled : prefs.enabled
    let displayId = prefs.displayId
    if (typeof next?.displayId === 'string' && next.displayId.trim()) {
      displayId = next.displayId.trim()
    }
    const changed = desktopWindow !== prefs.desktopWindow || enabled !== prefs.enabled || displayId !== prefs.displayId
    prefs = { ...prefs, desktopWindow, enabled, displayId }
    if (changed) persistPrefs()
    applyPetWindowState()
    if (changed) {
      broadcastToWindows('pet-config-changed', { ...prefs }, event.sender)
    }
    return { ...prefs }
  })

  ipcMain.handle('pet-get-displays', () => {
    ensurePrefsLoaded()
    const displays = getDisplayListPayload()
    const { displays: rawDisplays, primaryId } = getDisplaySnapshot()
    const resolved = resolvePetDisplay(rawDisplays, primaryId, prefs.displayId)
    if (resolved.fellBack && prefs.displayId !== resolved.effectiveDisplayId) {
      prefs = { ...prefs, displayId: resolved.effectiveDisplayId }
      persistPrefs()
    }
    return { displays, displayId: prefs.displayId }
  })

  ipcMain.handle('pet-set-display', (event, nextDisplayId: string) => {
    ensurePrefsLoaded()
    const requested = typeof nextDisplayId === 'string' && nextDisplayId.trim() ? nextDisplayId.trim() : 'primary'
    const { displays: rawDisplays, primaryId } = getDisplaySnapshot()
    const resolved = resolvePetDisplay(rawDisplays, primaryId, requested)
    prefs = { ...prefs, displayId: resolved.effectiveDisplayId }
    persistPrefs()
    syncPetWindowBounds()
    broadcastToWindows('pet-config-changed', { displayId: prefs.displayId }, event.sender)
    return {
      ok: !resolved.fellBack || requested === 'primary',
      displayId: prefs.displayId,
      displays: getDisplayListPayload(),
    }
  })

  ipcMain.handle('pet-set-shortcut', (_event, rawShortcut: string) => {
    ensurePrefsLoaded()
    const nextRaw = typeof rawShortcut === 'string' ? rawShortcut : DEFAULT_PET_SHORTCUT
    return applyShortcutUpdate(nextRaw)
  })

  ipcMain.handle('pet-set-shortcut-paused', (_event, paused: boolean) => {
    shortcutPaused = Boolean(paused)
    syncGlobalShortcut()
    return true
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
    broadcastToWindows('pet-config-changed', patch, event.sender)
  })
}

export function setPetBackendPort(port: number): void {
  ensurePrefsLoaded()
  backendPort = Number(port) || 0
  if (backendPort > 0) {
    applyPetWindowState()
  }
}

export function getPetDesktopMode(): PetDesktopMode {
  ensurePrefsLoaded()
  return { ...prefs }
}

export function togglePetFromTray(): PetDesktopMode {
  ensurePrefsLoaded()
  if (!prefs.desktopWindow) {
    prefs = { ...prefs, desktopWindow: true, enabled: true }
  } else {
    prefs = { ...prefs, enabled: !prefs.enabled }
  }
  persistPrefs()
  applyPetWindowState()
  broadcastToWindows('pet-config-changed', { ...prefs })
  return { ...prefs }
}

export function destroyPetWindow(): void {
  unregisterCurrentShortcut()
  if (displayHooked) {
    displayHooked = false
    screen.removeListener('display-added', handleDisplayTopologyChange)
    screen.removeListener('display-metrics-changed', handleDisplayTopologyChange)
    screen.removeListener('display-removed', handleDisplayTopologyChange)
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
