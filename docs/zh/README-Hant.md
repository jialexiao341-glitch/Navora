<p align="center"><img src="../../channel/web/static/logo.jpg" alt="Navora" width="120" /></p>

<h1 align="center">靈舟 · Navora</h1>

<p align="center">
  <a href="https://github.com/jialexiao341-glitch/Navora/releases"><img src="https://img.shields.io/github/v/release/jialexiao341-glitch/Navora?include_prereleases&cacheSeconds=3600" alt="Latest release" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT" /></a>
  <a href="https://github.com/jialexiao341-glitch/Navora"><img src="https://img.shields.io/github/stars/jialexiao341-glitch/Navora?style=flat-square&cacheSeconds=3600" alt="Stars" /></a>
</p>

<p align="center">
  [<a href="../../README.md">English</a>] | [<a href="README.md">簡體中文</a>] | [繁體中文] | [<a href="../ja/README.md">日本語</a>]
</p>

**靈舟 · Navora** 是開源的個人 AI Agent 工作台與可擴展 Agent Harness。基於開源專案 [CowAgent](https://github.com/zhayujie/CowAgent) 架構構建，集成了主動任務規劃、多智能體團隊、三層長期記憶、結構化知識庫、工具與 MCP、多通道 IM 接入、帶互動桌寵與休閒氛圍元件的 Web 控制台，以及統一體驗的 Electron 桌面用戶端。

<p align="center">
  <a href="https://github.com/jialexiao341-glitch/Navora/releases">💻 用戶端下載（Releases）</a> &nbsp;·&nbsp;
  <a href="../../desktop/README.md">🖥️ 桌面端開發與打包說明</a>
</p>

## 🌟 核心特性

| 能力 | 說明 |
| :--- | :--- |
| **任務規劃與工具** | 自動拆解複雜目標並循環呼叫檔案讀寫、終端機、瀏覽器自動化、排程任務、聯網搜尋與 MCP 工具 |
| **多智能體團隊** | 支援組建多 Agent 團隊，各自擁有獨立角色、模型、技能與知識庫，在同一對話中分工協作 |
| **長期記憶與知識庫** | 三層記憶架構（上下文 → 天級 → `MEMORY.md`）+ 夢境蒸餾，自動沉澱 Markdown Wiki 與知識圖譜 |
| **Web 控制台與陪伴體驗** | 完整控制台（`channel/web`），支援主題換膚、網頁與獨立桌面透明懸浮桌寵（深深 / Doro、`Alt+P` 快問、任務狀態氣泡）、懸浮音樂播放器與專注計時 |
| **桌面用戶端** | Electron 桌面殼（`desktop/`）內嵌 PyInstaller 打包的 Python 後端，直接呈現與網頁版一致的控制台介面，支援無邊框視窗控制、系統匣、開機自啟與 GitHub Releases 自動更新 |
| **多通道與多模型** | 支援 Web、微信、飛書、釘釘、企微、QQ、Telegram、Slack、Discord 等通道，支援 DeepSeek、Claude、GPT、Gemini、Qwen、GLM、Kimi、MiniMax、Doubao 及自訂 OpenAI 協定模型 |

## 🚀 快速開始

### 方式一：Windows 桌面安裝包

前往 [GitHub Releases](https://github.com/jialexiao341-glitch/Navora/releases) 下載 `Navora-Setup-*-x64.exe`，或在本地 Windows 環境建置：

```powershell
cd desktop
npm ci
cd ..
powershell -ExecutionPolicy Bypass -File desktop/build/build-win.ps1
```

安裝包已內建 Python 後端，目標電腦無需預先安裝 Python 或 Node.js。

### 方式二：原始碼執行

```bash
git clone https://github.com/jialexiao341-glitch/Navora.git
cd Navora
python -m venv .venv
# 啟用 .venv 後執行：
pip install -r requirements.txt
python app.py
```

啟動後在瀏覽器開啟 `http://localhost:9899` 即可進入 Web 控制台。

> 如需部署至伺服器供外部網路存取，請在 `config.json` 中設定 `web_host` 與 `web_password`。

## 🛠️ 測試與開發

```bash
# 桌面發布源隔離單測
python -m unittest tests/test_desktop_release_config.py

# Web 控制台、桌寵與桌面橋接測試
node --test tests/web_*.test.cjs
```

協作與 Git 提交規範請參見 [CONTRIBUTING.md](../../CONTRIBUTING.md) 與 [AGENTS.md](../../AGENTS.md)。

## 🙏 上游致謝與授權條款

- 本專案遵循 [MIT License](../../LICENSE)。
- 基於 [CowAgent](https://github.com/zhayujie/CowAgent)（MIT License）持續演進，完整保留上游版權聲明與開源協議。
- 請勿將 `config.json`、`.env`、API Key 或個人對話資料提交至程式碼倉庫。
