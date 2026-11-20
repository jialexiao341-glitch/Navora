import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const DESKTOP_DIR = path.resolve(import.meta.dirname, '..')
const DIST_MAIN = path.join(DESKTOP_DIR, 'dist', 'main')
const DIST_RENDERER = path.join(DESKTOP_DIR, 'dist', 'renderer')

test('main process build emits expected entrypoints and pet modules', () => {
  for (const rel of [
    'index.js',
    'preload.js',
    'python-manager.js',
    'pet-window.js',
    'pet-prefs.js',
    'updater.js',
    'tray.js',
    'menu.js',
  ]) {
    const file = path.join(DIST_MAIN, rel)
    assert.ok(fs.existsSync(file), `Missing compiled main file: ${rel}`)
    assert.ok(fs.statSync(file).size > 0, `Empty compiled main file: ${rel}`)
  }
})

test('renderer build emits index.html with resolvable bundle and lightweight boot assets only', () => {
  const indexHtmlPath = path.join(DIST_RENDERER, 'index.html')
  assert.ok(fs.existsSync(indexHtmlPath), 'Missing dist/renderer/index.html')
  const html = fs.readFileSync(indexHtmlPath, 'utf8')

  const assetRefs = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1])
  assert.ok(assetRefs.length > 0, 'Expected Vite JS/CSS asset references in dist/renderer/index.html')
  for (const rel of assetRefs) {
    const full = path.join(DIST_RENDERER, rel)
    assert.ok(fs.existsSync(full), `Referenced renderer asset missing: ${rel}`)
  }

  for (const bootAsset of ['logo.jpg', 'vendor/fonts/inter', 'vendor/fontawesome']) {
    assert.ok(fs.existsSync(path.join(DIST_RENDERER, bootAsset)), `Missing copied boot asset: ${bootAsset}`)
  }

  for (const heavyPath of ['vendor/dsh-pet', 'vendor/doro', 'js/views', 'js/core']) {
    assert.ok(!fs.existsSync(path.join(DIST_RENDERER, heavyPath)), `Unexpected web asset in desktop boot bundle: ${heavyPath}`)
  }
})
