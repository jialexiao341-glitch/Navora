import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
// electron-updater is CommonJS: its members live on module.exports, with no
// meaningful default export. Under module=commonjs + esModuleInterop, a named
// import compiles to `electron_updater_1.autoUpdater` and resolves correctly,
// whereas `import pkg from 'electron-updater'` yields undefined.
import { autoUpdater } from 'electron-updater'
import { loadAppConfig } from './themes'

// Status payloads pushed to the renderer over the 'update-status' channel.
// The renderer drives the NavRail badge + update panel from these.
export type UpdateStatus =
  | { state: 'checking' }
  // userInitiated: the check came from an explicit "check for update" click
  // (not the startup/interval poll). The renderer uses this to decide whether
  // to auto-open the panel: automatic checks stay silent (dot only) once a
  // version was dismissed; a manual check always re-opens.
  | { state: 'available'; version: string; notes?: string; userInitiated?: boolean }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string; userInitiated?: boolean }

let getWindow: () => BrowserWindow | null = () => null

const GITHUB_OWNER = 'jialexiao341-glitch'
const GITHUB_REPO = 'Navora'

// A bundled app-config (or NAVORA_UPDATE_FEED_URL env) may point the updater at a
// custom generic feed URL; otherwise updates resolve against Navora's GitHub Releases
// repository. Never fall back to upstream CowAgent hosts.
const CONFIGURED_FEED = (
  process.env.NAVORA_UPDATE_FEED_URL ||
  loadAppConfig()?.updateFeedUrl ||
  ''
).trim()

// A channel set explicitly at build time (publish.channel) names a dedicated
// feed file, e.g. one per Windows generation. setFeedURL replaces the packaged
// app-update.yml, so that channel has to be passed along. The channel
// electron-builder derives from a pre-release version tag is left out, so
// those builds keep reading the default feed file.
let packagedChannelCache: string | null | undefined
function packagedChannel(): string | undefined {
  if (packagedChannelCache === undefined) {
    packagedChannelCache = null
    try {
      const text = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
      const channel = text.match(/^channel:\s*['"]?([\w.-]+)['"]?\s*$/m)?.[1]
      const versionTag = app.getVersion().split('-')[1]?.split('.')[0]?.toLowerCase()
      if (channel && channel !== 'latest' && channel.toLowerCase() !== versionTag) {
        packagedChannelCache = channel
      }
    } catch {
      // no packaged update config: use the default channel
    }
  }
  return packagedChannelCache ?? undefined
}

// Extra query parameters the renderer may attach to a custom generic feed URL.
let feedQuery: Record<string, string> = {}
const FEED_QUERY_KEY = /^[A-Za-z0-9_-]{1,32}$/
const FEED_QUERY_MAX_ENTRIES = 8
const FEED_QUERY_MAX_VALUE = 256

function withFeedQuery(url: string): string {
  const entries = Object.entries(feedQuery)
  if (entries.length === 0) return url
  try {
    const u = new URL(url)
    for (const [k, v] of entries) u.searchParams.set(k, v)
    return u.toString()
  } catch {
    return url
  }
}

function applyFeedUrl(): void {
  const channel = packagedChannel()
  try {
    if (CONFIGURED_FEED) {
      const parsed = new URL(CONFIGURED_FEED)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Unsupported update feed protocol: ${parsed.protocol}`)
      }
      const url = withFeedQuery(CONFIGURED_FEED)
      autoUpdater.setFeedURL({ provider: 'generic', url, ...(channel ? { channel } : {}) })
      log(`feed url set (generic): ${url}${channel ? ` (channel=${channel})` : ''}`)
      return
    }
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      ...(channel ? { channel } : {}),
    })
    log(`feed url set (github): ${GITHUB_OWNER}/${GITHUB_REPO}${channel ? ` (channel=${channel})` : ''}`)
  } catch (err) {
    const message = (err as Error)?.message || String(err)
    log(`feed url set failed: ${message}`)
    send({ state: 'error', message })
  }
}

// Called from the check/download IPC with the renderer's current UI language.
export function setUpdateLanguage(_lang: string | undefined): void {
  // Retained for IPC compatibility; feed routing no longer uses mirror language flags.
}

// Replace the extra feed query (see feedQuery). Invalid keys and non-string
// values are dropped; an empty or invalid input clears it.
export function setUpdateFeedQuery(params: unknown): void {
  const next: Record<string, string> = {}
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (Object.keys(next).length >= FEED_QUERY_MAX_ENTRIES) break
      if (!FEED_QUERY_KEY.test(k) || typeof v !== 'string') continue
      const value = v.trim()
      if (value && value.length <= FEED_QUERY_MAX_VALUE) next[k] = value
    }
  }
  if (JSON.stringify(next) === JSON.stringify(feedQuery)) return
  feedQuery = next
  if (app.isPackaged && CONFIGURED_FEED) applyFeedUrl()
}

// Persist update logs to a file so a user hitting a silent "spinner never
// resolves" can just send us userData/logs/updater.log. We can't rely on a
// logging dep, so this is a tiny append-only writer, plus console for the
// in-app log view / terminal.
let logFile: string | null = null

export function getUpdaterLogPath(): string | null {
  return logFile
}

function initLogFile() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'updater.log')
  } catch {
    logFile = null
  }
}

function log(...parts: unknown[]) {
  const line = `[${new Date().toISOString()}] [updater] ${parts
    .map((p) => (typeof p === 'string' ? p : safeStringify(p)))
    .join(' ')}`
  // Console: shows up in the terminal (dev) and the packaged app's stdout.
  console.log(line)
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\n')
    } catch {
      // ignore disk errors — logging must never break the updater
    }
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

let lastStatus: UpdateStatus | null = null

export function getLastUpdateStatus(): UpdateStatus | null {
  return lastStatus
}

function send(status: UpdateStatus) {
  lastStatus = status
  getWindow()?.webContents.send('update-status', status)
}

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  initLogFile()

  log(`init: appVersion=${app.getVersion()} packaged=${app.isPackaged} logFile=${logFile ?? '<none>'}`)

  // In dev (not packaged) there's no update feed; skip wiring entirely so
  // electron-updater doesn't throw on the missing app-update.yml.
  if (!app.isPackaged) {
    log('not packaged — updater wiring skipped')
    return
  }

  // User-driven flow: we surface "available" and let the user opt in to the
  // download, rather than pulling bytes silently in the background.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  // The desktop channel ships pre-release-tagged builds (e.g. 0.0.8-test), so a
  // current version like 0.0.7-test must be allowed to compare against, and be
  // offered, other pre-release versions. Without this electron-updater's semver
  // compare can silently skip pre-releases and neither "available" nor
  // "not-available" fires — the UI just spins forever.
  autoUpdater.allowPrerelease = true
  autoUpdater.allowDowngrade = false
  // Point at the configured Navora update feed (or GitHub Releases by default).
  applyFeedUrl()
  // Route electron-updater's own internal logging to our file too, so we
  // capture the feed URL, parsed versions and any stack traces it logs.
  autoUpdater.logger = {
    info: (m: unknown) => log('eu-info:', m),
    warn: (m: unknown) => log('eu-warn:', m),
    error: (m: unknown) => log('eu-error:', m),
    debug: (m: unknown) => log('eu-debug:', m),
  } as unknown as typeof autoUpdater.logger

  autoUpdater.on('checking-for-update', () => {
    log(`checking-for-update: current=${app.getVersion()}`)
    send({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    const manual = userInitiatedCheck
    userInitiatedCheck = false
    log(`update-available: current=${app.getVersion()} remote=${info.version} userInitiated=${manual} -> update needed`)
    send({
      state: 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      userInitiated: manual,
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    userInitiatedCheck = false
    log(`update-not-available: current=${app.getVersion()} remote=${info?.version ?? '<unknown>'} -> up to date`)
    send({ state: 'not-available' })
  })
  autoUpdater.on('download-progress', (p) => {
    log(`download-progress: ${Math.round(p.percent)}% (${p.transferred}/${p.total} bytes, ${Math.round(p.bytesPerSecond / 1024)} KB/s)`)
    send({ state: 'downloading', percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    log(`update-downloaded: version=${info.version} -> ready to install`)
    send({ state: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    const manual = userInitiatedCheck
    userInitiatedCheck = false
    const message = err == null ? 'unknown' : err.message || String(err)
    log(`error: ${message}`, err instanceof Error && err.stack ? err.stack : '')
    send({ state: 'error', message, userInitiated: manual })
  })
}

// Tracks whether the in-flight check was triggered by an explicit user click.
// Stamped onto the resulting 'available' event so the renderer knows whether to
// auto-open the panel (manual) or stay silent with just the dot (automatic).
let userInitiatedCheck = false

// Silent check shortly after launch. When not packaged there's no update feed,
// but a manual click should still get visible feedback instead of looking dead:
// reply "not-available" so the menu can show "up to date".
//   userInitiated: pass true for an explicit "check for update" click so the
//   panel re-opens even if the version was previously dismissed. The startup +
//   interval polls pass false, so a dismissed version only lights the dot.
export function checkForUpdates(userInitiated = false): void {
  userInitiatedCheck = userInitiated
  if (!app.isPackaged) {
    // Dev-only UI harness: set COW_MOCK_UPDATE=1 to simulate an available
    // update so the update panel/menu interactions can be exercised in
    // `npm run dev` (where there's no real feed). Never runs in a packaged app.
    if (process.env.COW_MOCK_UPDATE) {
      const version = process.env.COW_MOCK_UPDATE_VERSION || '9.9.9'
      log(`checkForUpdates: not packaged, MOCK available version=${version}`)
      send({ state: 'available', version, userInitiated: userInitiatedCheck })
      return
    }
    log('checkForUpdates: not packaged, replying not-available')
    send({ state: 'not-available' })
    return
  }
  if (checkInFlight) {
    log('checkForUpdates: a check is already running, its result will be reported')
    return
  }
  log(`checkForUpdates: requesting feed, current=${app.getVersion()}`)
  runCheck()
}

let checkInFlight = false

function runCheck(): void {
  checkInFlight = true
  autoUpdater
    .checkForUpdates()
    .then(() => {
      checkInFlight = false
    })
    .catch((err) => {
      const manual = userInitiatedCheck
      userInitiatedCheck = false
      const message = err?.message || String(err)
      log(`checkForUpdates: request failed: ${message}`, err instanceof Error && err.stack ? err.stack : '')
      checkInFlight = false
      send({ state: 'error', message, userInitiated: manual })
    })
}

export function startDownload(): void {
  if (!app.isPackaged) return
  log('startDownload: user requested download')
  autoUpdater.downloadUpdate().catch((err) => {
    const message = err?.message || String(err)
    log(`startDownload: failed: ${message}`, err instanceof Error && err.stack ? err.stack : '')
    send({ state: 'error', message })
  })
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return
  log('quitAndInstall: relaunching to install update')
  // Drop window-all-closed handlers first: a lingering handler can keep the
  // process alive and stop the installer from replacing files / relaunching
  // (a documented electron-updater gotcha, esp. on Windows NSIS).
  app.removeAllListeners('window-all-closed')
  // isSilent=TRUE on Windows. Our installer is now ASSISTED (nsis.oneClick=false
  // + allowToChangeInstallationDirectory) so the FIRST install shows the
  // directory/mode wizard. But an UPDATE must NOT re-show that wizard — isSilent
  // skips it and updates in place. isForceRunAfter=true relaunches after the
  // silent update. (The old assisted+silent force-run bug, #2179, was fixed
  // upstream in PR #2278; we're on electron-updater 6.8.9, well past it.)
  // setImmediate + removeAllListeners are the documented prerequisites for the
  // relaunch to fire reliably. macOS ignores isSilent entirely.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}
