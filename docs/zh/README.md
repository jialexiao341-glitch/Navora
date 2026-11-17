<p align="center"><img src="../../channel/web/static/logo.jpg" alt="Navora" width="120" /></p>

<h1 align="center">灵舟 · Navora</h1>

<p align="center">
  <a href="https://github.com/jialexiao341-glitch/Navora/releases"><img src="https://img.shields.io/github/v/release/jialexiao341-glitch/Navora?include_prereleases&cacheSeconds=3600" alt="Latest release" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT" /></a>
  <a href="https://github.com/jialexiao341-glitch/Navora"><img src="https://img.shields.io/github/stars/jialexiao341-glitch/Navora?style=flat-square&cacheSeconds=3600" alt="Stars" /></a>
</p>

<p align="center">
  [<a href="../../README.md">English</a>] | [简体中文] | [<a href="README-Hant.md">繁體中文</a>] | [<a href="../ja/README.md">日本語</a>]
</p>

**灵舟 · Navora** 是开源的个人 AI Agent 工作台与可扩展 Agent Harness。基于开源项目 [CowAgent](https://github.com/zhayujie/CowAgent) 架构构建，集成了主动任务规划、多智能体团队、三层长期记忆、结构化知识库、工具与 MCP、多通道 IM 接入、带互动桌宠与休闲氛围组件的 Web 控制台，以及统一体验的 Electron 桌面客户端。

<p align="center">
  <a href="https://github.com/jialexiao341-glitch/Navora/releases">💻 客户端下载（Releases）</a> &nbsp;·&nbsp;
  <a href="../../desktop/README.md">🖥️ 桌面端开发与打包说明</a>
</p>

## 🌟 核心特性

| 能力 | 说明 |
| :--- | :--- |
| **任务规划与工具** | 自动拆解复杂目标并循环调用文件读写、终端、浏览器自动化、定时任务、联网搜索与 MCP 工具 |
| **多智能体团队** | 支持组建多 Agent 团队，各自拥有独立角色、模型、技能与知识库，在同一会话中分工协作 |
| **长期记忆与知识库** | 三层记忆架构（上下文 → 天级 → `MEMORY.md`）+ 梦境蒸馏，自动沉淀 Markdown Wiki 与知识图谱 |
| **Web 控制台与陪伴体验** | 完整控制台（`channel/web`），支持主题换肤、网页桌宠漫游（深深 / Doro、`Alt+P` 快问、任务状态气泡）、悬浮音乐播放器与专注计时 |
| **桌面客户端** | Electron 桌面壳（`desktop/`）内嵌 PyInstaller 打包的 Python 后端，直接呈现与网页版完全一致的控制台界面，支持无边框窗口控制、托盘、开机自启与 GitHub Releases 自动更新 |
| **多通道与多模型** | 支持 Web、微信、飞书、钉钉、企微、QQ、Telegram、Slack、Discord 等通道，支持 DeepSeek、Claude、GPT、Gemini、Qwen、GLM、Kimi、MiniMax、Doubao 及自定义 OpenAI 协议模型 |

## 🚀 快速开始

### 方式一：Windows 桌面安装包

前往 [GitHub Releases](https://github.com/jialexiao341-glitch/Navora/releases) 下载 `Navora-Setup-*-x64.exe`，或在本地 Windows 环境构建：

```powershell
cd desktop
npm ci
cd ..
powershell -ExecutionPolicy Bypass -File desktop/build/build-win.ps1
```

安装包已内置 Python 后端，目标机器无需预装 Python 或 Node.js。

### 方式二：源码运行

```bash
git clone https://github.com/jialexiao341-glitch/Navora.git
cd Navora
python -m venv .venv
# 激活 .venv 后执行：
pip install -r requirements.txt
python app.py
```

启动后在浏览器访问 `http://localhost:9899` 即可打开 Web 控制台。

> 如需部署到服务器供外网访问，请在 `config.json` 中配置 `web_host` 与 `web_password`。

## 🛠️ 测试与开发

```bash
# 桌面发布源隔离单测
python -m unittest tests/test_desktop_release_config.py

# Web 控制台、桌宠与桌面桥接测试
node --test tests/web_*.test.cjs
```

协作与 Git 提交规范请参见 [CONTRIBUTING.md](../../CONTRIBUTING.md) 与 [AGENTS.md](../../AGENTS.md)。

## 🙏 上游致谢与许可证

- 本项目遵循 [MIT License](../../LICENSE)。
- 基于 [CowAgent](https://github.com/zhayujie/CowAgent)（MIT License）持续演进，完整保留上游版权声明与开源协议。
- 请勿将 `config.json`、`.env`、API Key 或个人会话数据提交到代码仓库。
