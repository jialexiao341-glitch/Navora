import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  DEFAULT_PET_SHORTCUT,
  defaultPetPrefs,
  formatPetDisplayList,
  loadPetPrefs,
  normalizePetShortcut,
  resolvePetDisplay,
  savePetPrefs,
} = require('../dist/main/pet-prefs.js')

const DISPLAYS = [
  {
    id: 101,
    label: 'Built-in Retina Display',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  },
  {
    id: 202,
    label: 'DELL U2720Q',
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
    workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
  },
]

test('resolvePetDisplay handles primary, explicit display, and disconnected fallback', () => {
  const primaryRes = resolvePetDisplay(DISPLAYS, 101, 'primary')
  assert.equal(primaryRes.display.id, 101)
  assert.equal(primaryRes.effectiveDisplayId, 'primary')
  assert.equal(primaryRes.fellBack, false)

  const secondaryRes = resolvePetDisplay(DISPLAYS, 101, '202')
  assert.equal(secondaryRes.display.id, 202)
  assert.equal(secondaryRes.effectiveDisplayId, '202')
  assert.equal(secondaryRes.fellBack, false)

  const missingRes = resolvePetDisplay([DISPLAYS[0]], 101, '202')
  assert.equal(missingRes.display.id, 101)
  assert.equal(missingRes.effectiveDisplayId, 'primary')
  assert.equal(missingRes.fellBack, true)
})

test('formatPetDisplayList exposes index, resolution, label, and primary marker', () => {
  const list = formatPetDisplayList(DISPLAYS, 101)
  assert.equal(list.length, 2)
  assert.deepEqual(
    list.map((d) => ({ id: d.id, index: d.index, width: d.width, height: d.height, isPrimary: d.isPrimary, label: d.label })),
    [
      { id: '101', index: 1, width: 1920, height: 1080, isPrimary: true, label: 'Built-in Retina Display' },
      { id: '202', index: 2, width: 2560, height: 1440, isPrimary: false, label: 'DELL U2720Q' },
    ],
  )
})

test('normalizePetShortcut validates and canonicalizes accelerators', () => {
  assert.equal(normalizePetShortcut('alt+p'), DEFAULT_PET_SHORTCUT)
  assert.equal(normalizePetShortcut('shift+control+space'), 'Ctrl+Shift+Space')
  assert.equal(normalizePetShortcut('CommandOrControl+Alt+k'), 'CmdOrCtrl+Alt+K')
  assert.equal(normalizePetShortcut('f9'), 'F9')
  assert.equal(normalizePetShortcut(''), '')
  assert.equal(normalizePetShortcut('A'), null)
  assert.equal(normalizePetShortcut('Shift+Space'), null)
})

test('loadPetPrefs and savePetPrefs persist displayId and shortcut safely', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navora-pet-prefs-'))
  try {
    const file = path.join(tmpDir, 'pet-prefs.json')
    assert.deepEqual(loadPetPrefs(file), defaultPetPrefs())

    const custom = { desktopWindow: true, enabled: false, displayId: '202', shortcut: 'Ctrl+Shift+Space' }
    savePetPrefs(file, custom)
    assert.deepEqual(loadPetPrefs(file), custom)

    // Invalid shortcut inside corrupted file safely falls back to default
    fs.writeFileSync(file, JSON.stringify({ displayId: '202', shortcut: 'bad-key' }), 'utf8')
    const recovered = loadPetPrefs(file)
    assert.equal(recovered.displayId, '202')
    assert.equal(recovered.shortcut, DEFAULT_PET_SHORTCUT)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
