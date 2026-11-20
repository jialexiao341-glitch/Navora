import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// '@product' resolves to the built-in default (empty). An alternate build
// can set COW_PRODUCT_DIR to point at another module instead.
const productDir =
  process.env.COW_PRODUCT_DIR || path.resolve(__dirname, 'src/renderer/src/product/default')

const nodeModules = path.resolve(__dirname, 'node_modules')
const sharedDepAliases = process.env.COW_PRODUCT_DIR
  ? {
      react: path.join(nodeModules, 'react'),
      'react-dom': path.join(nodeModules, 'react-dom'),
      'react/jsx-runtime': path.join(nodeModules, 'react/jsx-runtime'),
    }
  : {}

const webStaticDir = path.resolve(__dirname, '../channel/web/static')
const bootAssets = [
  { src: 'logo.jpg', dest: 'logo.jpg' },
  { src: 'vendor/fonts/inter', dest: 'vendor/fonts/inter' },
  { src: 'vendor/fontawesome', dest: 'vendor/fontawesome' },
]

function copyEntry(src: string, dest: string): void {
  if (!fs.existsSync(src)) return
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      copyEntry(path.join(src, entry.name), path.join(dest, entry.name))
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
}

/**
 * Copy/serve only the minimal static assets needed by the desktop boot shell
 * (logo + Inter font + FontAwesome) instead of duplicating all 90+ MB of
 * channel/web/static (pet videos, Doro frames, console scripts) into dist/renderer.
 */
function desktopBootAssetsPlugin(): Plugin {
  const outDir = path.resolve(__dirname, 'dist/renderer')
  return {
    name: 'navora-desktop-boot-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const cleanUrl = (req.url || '').split('?')[0].replace(/^\/+/, '')
        const allowed = bootAssets.some((a) => cleanUrl === a.dest || cleanUrl.startsWith(`${a.dest}/`))
        if (!allowed) return next()
        const full = path.resolve(webStaticDir, cleanUrl)
        if (!full.startsWith(webStaticDir + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
          return next()
        }
        const ext = path.extname(full).toLowerCase()
        if (MIME[ext]) res.setHeader('Content-Type', MIME[ext])
        fs.createReadStream(full).pipe(res)
      })
    },
    writeBundle() {
      for (const item of bootAssets) {
        copyEntry(path.join(webStaticDir, item.src), path.join(outDir, item.dest))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), desktopBootAssetsPlugin()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    // Keep in sync with VITE_DEV_PORTS in src/main/index.ts. strictPort makes a
    // clash fail loudly instead of drifting to the next free port, which the
    // main process would not be looking at.
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer/src'),
      '@product': productDir,
      ...sharedDepAliases,
    },
  },
})
