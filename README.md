<p align="center"><img src="channel/web/static/logo.jpg" alt="Navora" width="120" /></p>

<h1 align="center">灵舟 · Navora</h1>

<p align="center">
  <a href="https://github.com/jialexiao341-glitch/Navora/releases"><img src="https://img.shields.io/github/v/release/jialexiao341-glitch/Navora?include_prereleases&cacheSeconds=3600" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT"></a>
  <a href="https://github.com/jialexiao341-glitch/Navora"><img src="https://img.shields.io/github/stars/jialexiao341-glitch/Navora?style=flat-square&cacheSeconds=3600" alt="Stars"></a>
</p>

<p align="center">
  [English] | [<a href="docs/zh/README.md">中文</a>]
</p>

**Navora（灵舟）** is an open-source personal AI Agent workbench and extensible Agent Harness. Built on top of the open-source [CowAgent](https://github.com/zhayujie/CowAgent) architecture, it combines proactive task planning, multi-agent teams, three-tier long-term memory, a structured knowledge base, tools & MCP, multi-channel IM access, an interactive Web Console with companion & ambient features, and a unified Electron desktop client.

<p align="center">
  <a href="docs/zh/README.md">📖 中文说明</a> &nbsp;·&nbsp;
  <a href="https://github.com/jialexiao341-glitch/Navora/releases">💻 Releases & Desktop</a> &nbsp;·&nbsp;
  <a href="desktop/README.md">🖥️ Desktop Build Guide</a>
</p>

## 🌟 Highlights

| Capability | Description |
| :--- | :--- |
| **Planning & Tools** | Decomposes complex tasks and loops over built-in file I/O, terminal, browser automation, scheduler, web search, and MCP servers |
| **Multi-Agent Teams** | Build a team of Agents with independent roles, models, skills, and knowledge collaborating in shared conversations |
| **Memory & Knowledge** | Three-tier memory (context → daily → `MEMORY.md`) with Deep Dream distillation and a Markdown Wiki knowledge graph |
| **Web Console & Companion** | Unified console (`channel/web`) with theme skins, interactive desktop/web pet companions (Doro & Shenshen, `Alt+P` quick ask, task status sync), floating audio player, and focus timer |
| **Desktop Client** | Electron shell (`desktop/`) bundling the PyInstaller Python backend and serving the exact Web Console UI with frameless window controls, tray, launch-at-login, and GitHub Releases auto-update |
| **Multi-Channel & Models** | Supports Web, WeChat, Feishu/Lark, DingTalk, WeCom, QQ, Telegram, Slack, Discord, and mainstream LLM providers (DeepSeek, Claude, GPT, Gemini, Qwen, GLM, Kimi, MiniMax, Doubao, Custom) |

## 🚀 Quick Start

### Option 1: Desktop Installer (Windows)

Download the latest `Navora-Setup-*-x64.exe` from [GitHub Releases](https://github.com/jialexiao341-glitch/Navora/releases), or build locally on Windows:

```powershell
cd desktop
npm ci
cd ..
powershell -ExecutionPolicy Bypass -File desktop/build/build-win.ps1
```

The installer bundles the Python backend and requires no system Python or Node.js on end-user machines.

### Option 2: Run from Source

```bash
git clone https://github.com/jialexiao341-glitch/Navora.git
cd Navora
python -m venv .venv
# Activate .venv, then:
pip install -r requirements.txt
python app.py
```

Once started, open `http://localhost:9899` to access the Web Console.

> Running on a public server? Configure `web_host` and `web_password` in `config.json`.

### Docker

```bash
docker compose up -d
```

## 🛠️ Development & Testing

```bash
# Python tests (e.g., desktop release & update isolation)
python -m unittest tests/test_desktop_release_config.py

# Web console & companion unit tests
node --test tests/web_*.test.cjs
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for commit and collaboration conventions.

## 🙏 Upstream & License

- Licensed under the [MIT License](LICENSE).
- Built upon [CowAgent](https://github.com/zhayujie/CowAgent) (MIT License), retaining upstream copyright notices and MIT license terms.
- Please do not commit `config.json`, `.env`, API keys, or personal conversation data to the repository.
