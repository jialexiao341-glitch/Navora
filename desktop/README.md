# Navora Desktop

Cross-platform desktop client for Navora, built with Electron + TypeScript + Vite.

## Development

### Prerequisites

- Node.js 20+
- npm
- Python 3.11+ (for the backend)

### Setup

```bash
cd desktop
npm ci
```

### Run in Development

Start the lightweight boot shell build and Electron together:

```bash
npm run dev
```

Or run them separately:

```bash
# Terminal 1: Start Vite dev server for the boot/error shell
npm run dev:renderer

# Terminal 2: Start Electron (launches the Python backend and loads the Web Console)
npm run dev:main
```

### Build Installer

On Windows x64 (bundles the PyInstaller Python backend and packages the NSIS installer):

```powershell
powershell -ExecutionPolicy Bypass -File desktop/build/build-win.ps1
```

Build outputs are placed in `desktop/release/`.

## Architecture

```text
desktop/
├── build/                 # PyInstaller spec, NSIS hooks, and local Windows build script
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Window management, IPC, backend & audio bridge
│   │   ├── pet-prefs.ts   # Persisted display & global shortcut helpers for desktop pet
│   │   ├── pet-window.ts  # Transparent always-on-top desktop pet overlay & custom hotkey
│   │   ├── python-manager.ts  # Python backend lifecycle
│   │   ├── preload.ts     # Context bridge for Web Console & pet overlay
│   │   ├── tray.ts        # System tray controls
│   │   └── updater.ts     # GitHub Releases auto-updater
│   └── renderer/          # Lightweight boot/error shell (BootShell + StatusScreen)
└── vite.config.ts         # Vite config (copies minimal boot assets only)
```

### How it Works

1. Electron main process starts and renders the lightweight `StatusScreen` boot shell
2. It spawns the Python backend (`app.py` in dev, `cowagent-backend` in packaged builds)
3. Once ready, the main window navigates directly to the backend's local Web Console (`http://127.0.0.1:<port>/`)
4. When the floating desktop pet mode is enabled, a transparent always-on-top window loads `/pet` and stays active even when the main window is minimized to tray
