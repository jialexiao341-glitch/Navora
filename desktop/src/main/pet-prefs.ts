import fs from 'fs'
import path from 'path'

export const DEFAULT_PET_SHORTCUT = 'Alt+P'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayLike {
  id: number
  label?: string
  bounds: Rect
  workArea: Rect
}

export interface PetDisplayInfo {
  id: string
  index: number
  label: string
  width: number
  height: number
  isPrimary: boolean
  bounds: Rect
  workArea: Rect
}

export interface PetPrefs {
  desktopWindow: boolean
  enabled: boolean
  displayId: string
  shortcut: string
}

const MODIFIER_ORDER = ['Ctrl', 'Cmd', 'CmdOrCtrl', 'Alt', 'Shift'] as const

const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  cmd: 'Cmd',
  command: 'Cmd',
  meta: 'Cmd',
  super: 'Cmd',
  win: 'Cmd',
  commandorcontrol: 'CmdOrCtrl',
  cmdorctrl: 'CmdOrCtrl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'Alt',
  shift: 'Shift',
}

const SPECIAL_KEY_ALIASES: Record<string, string> = {
  space: 'Space',
  spacebar: 'Space',
  ' ': 'Space',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  arrowup: 'Up',
  down: 'Down',
  arrowdown: 'Down',
  left: 'Left',
  arrowleft: 'Left',
  right: 'Right',
  arrowright: 'Right',
  plus: 'Plus',
  '=': '=',
  '-': '-',
  ',': ',',
  '.': '.',
  '/': '/',
  ';': ';',
  "'": "'",
  '[': '[',
  ']': ']',
  '\\': '\\',
  '`': '`',
}

const FUNCTION_KEY_RE = /^F([1-9]|1[0-2])$/i
const ALPHA_NUM_RE = /^[A-Z0-9]$/i

/**
 * Normalize and validate an Electron globalShortcut accelerator string.
 * Returns '' when explicitly disabled, canonical accelerator on success,
 * or null when invalid/unsupported.
 */
export function normalizePetShortcut(raw: unknown): string | null {
  if (raw === '') return ''
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const parts = trimmed.split('+').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return null

  const mods = new Set<string>()
  let mainKey: string | null = null

  for (const part of parts) {
    const lower = part.toLowerCase()
    const mod = MODIFIER_ALIASES[lower]
    if (mod) {
      mods.add(mod)
      continue
    }
    if (mainKey !== null) return null

    if (ALPHA_NUM_RE.test(part)) {
      mainKey = part.toUpperCase()
    } else if (FUNCTION_KEY_RE.test(part)) {
      mainKey = part.toUpperCase()
    } else if (SPECIAL_KEY_ALIASES[lower]) {
      mainKey = SPECIAL_KEY_ALIASES[lower]
    } else {
      return null
    }
  }

  if (!mainKey) return null

  const isFnKey = FUNCTION_KEY_RE.test(mainKey)
  if (!isFnKey && mods.size === 0) return null
  // Avoid bare Shift+Letter/Digit/Space hijacking normal typing.
  if (!isFnKey && mods.size === 1 && mods.has('Shift') && (ALPHA_NUM_RE.test(mainKey) || mainKey === 'Space')) {
    return null
  }

  const orderedMods = MODIFIER_ORDER.filter((m) => mods.has(m))
  return [...orderedMods, mainKey].join('+')
}

export function resolvePetDisplay<T extends DisplayLike>(
  displays: T[],
  primaryId: number | null | undefined,
  requestedDisplayId: string,
): { display: T | null; effectiveDisplayId: string; fellBack: boolean } {
  if (!Array.isArray(displays) || displays.length === 0) {
    return { display: null, effectiveDisplayId: 'primary', fellBack: false }
  }
  const req = typeof requestedDisplayId === 'string' && requestedDisplayId.trim() ? requestedDisplayId.trim() : 'primary'
  if (req !== 'primary') {
    const matched = displays.find((d) => String(d.id) === req)
    if (matched) {
      return { display: matched, effectiveDisplayId: String(matched.id), fellBack: false }
    }
  }
  const primary = (primaryId !== null && primaryId !== undefined ? displays.find((d) => d.id === primaryId) : undefined) || displays[0]
  return {
    display: primary,
    effectiveDisplayId: 'primary',
    fellBack: req !== 'primary',
  }
}

export function formatPetDisplayList(displays: DisplayLike[], primaryId: number | null | undefined): PetDisplayInfo[] {
  if (!Array.isArray(displays)) return []
  return displays.map((d, idx) => ({
    id: String(d.id),
    index: idx + 1,
    label: typeof d.label === 'string' ? d.label.trim() : '',
    width: Math.round(d.bounds?.width || d.workArea?.width || 0),
    height: Math.round(d.bounds?.height || d.workArea?.height || 0),
    isPrimary: d.id === primaryId,
    bounds: { ...d.bounds },
    workArea: { ...d.workArea },
  }))
}

export function defaultPetPrefs(): PetPrefs {
  return {
    desktopWindow: true,
    enabled: true,
    displayId: 'primary',
    shortcut: DEFAULT_PET_SHORTCUT,
  }
}

export function loadPetPrefs(filePath: string): PetPrefs {
  const defaults = defaultPetPrefs()
  try {
    if (!fs.existsSync(filePath)) return defaults
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<PetPrefs> | null
    if (!raw || typeof raw !== 'object') return defaults
    const normalizedShortcut = normalizePetShortcut(raw.shortcut)
    return {
      desktopWindow: typeof raw.desktopWindow === 'boolean' ? raw.desktopWindow : defaults.desktopWindow,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
      displayId: typeof raw.displayId === 'string' && raw.displayId.trim() ? raw.displayId.trim() : defaults.displayId,
      shortcut: normalizedShortcut !== null ? normalizedShortcut : defaults.shortcut,
    }
  } catch {
    return defaults
  }
}

export function savePetPrefs(filePath: string, prefs: PetPrefs): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(prefs, null, 2), 'utf8')
  } catch {
    // best-effort persistence
  }
}
