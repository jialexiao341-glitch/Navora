<p align="center"><img src="../../channel/web/static/logo.jpg" alt="Navora" width="120" /></p>

<h1 align="center">霊舟 · Navora</h1>

<p align="center">
  <a href="https://github.com/jialexiao341-glitch/Navora/releases"><img src="https://img.shields.io/github/v/release/jialexiao341-glitch/Navora?include_prereleases&cacheSeconds=3600" alt="Latest release" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT" /></a>
  <a href="https://github.com/jialexiao341-glitch/Navora"><img src="https://img.shields.io/github/stars/jialexiao341-glitch/Navora?style=flat-square&cacheSeconds=3600" alt="Stars" /></a>
</p>

<p align="center">
  [<a href="../../README.md">English</a>] | [<a href="../zh/README.md">简体中文</a>] | [<a href="../zh/README-Hant.md">繁體中文</a>] | [日本語]
</p>

**霊舟 · Navora** は、オープンソースのパーソナル AI Agent ワークベンチ兼拡張可能な Agent Harness です。[CowAgent](https://github.com/zhayujie/CowAgent) アーキテクチャを基盤に、自律タスク計画、マルチエージェントチーム、3 層長期記憶、構造化ナレッジベース、ツール & MCP、マルチチャネル IM 連携、Web コンソール（コンパニオン＆アンビエント機能付き）、および統一体験の Electron デスクトップクライアントを備えています。

<p align="center">
  <a href="https://github.com/jialexiao341-glitch/Navora/releases">💻 リリース & デスクトップ版</a> &nbsp;·&nbsp;
  <a href="../../desktop/README.md">🖥️ デスクトップビルドガイド</a>
</p>

## 🌟 主な特長

| 機能 | 説明 |
| :--- | :--- |
| **タスク計画とツール** | 複雑なタスクを分解し、ファイル I/O、ターミナル、ブラウザ操作、スケジューラ、Web 検索、MCP サーバーを自律的に呼び出して実行 |
| **マルチエージェントチーム** | 役割・モデル・スキル・ナレッジを持つ複数の Agent でチームを編成し、同一会話内で協調動作 |
| **長期記憶とナレッジベース** | 3 層メモリ（コンテキスト → デイリー → `MEMORY.md`）と Deep Dream 蒸留により、Markdown Wiki とナレッジグラフを自動構築 |
| **Web コンソール & コンパニオン** | テーマ切替、Web／システム最前面フローティングペット（Shenshen & Doro、`Alt+P` クイック質問、タスク状態連携）、音楽プレーヤー、集中タイマーを搭載 |
| **デスクトップクライアント** | PyInstaller 製 Python バックエンドを同梱した Electron シェル（`desktop/`）により、Web コンソールと同一の UI、フレームレス操作、トレイ、自動起動、GitHub Releases 自動更新を提供 |
| **マルチチャネル & モデル** | Web、WeChat、Feishu/Lark、DingTalk、WeCom、QQ、Telegram、Slack、Discord および主要 LLM（DeepSeek、Claude、GPT、Gemini、Qwen、GLM、Kimi、MiniMax、Doubao、Custom）に対応 |

## 🚀 クイックスタート

### 方法 1：Windows デスクトップインストーラー

[GitHub Releases](https://github.com/jialexiao341-glitch/Navora/releases) から `Navora-Setup-*-x64.exe` をダウンロードするか、Windows 環境でローカルビルドします：

```powershell
cd desktop
npm ci
cd ..
powershell -ExecutionPolicy Bypass -File desktop/build/build-win.ps1
```

インストーラーには Python バックエンドが同梱されており、ユーザー側で Python や Node.js をインストールする必要はありません。

### 方法 2：ソースコードから起動

```bash
git clone https://github.com/jialexiao341-glitch/Navora.git
cd Navora
python -m venv .venv
# .venv を有効化してから：
pip install -r requirements.txt
python app.py
```

起動後、ブラウザで `http://localhost:9899` を開くと Web コンソールにアクセスできます。

> 公開サーバーで運用する場合は、`config.json` に `web_host` と `web_password` を設定してください。

## 🛠️ 開発とテスト

```bash
# デスクトップリリース分離単体テスト
python -m unittest tests/test_desktop_release_config.py

# Web コンソール・コンパニオン単体テスト
node --test tests/web_*.test.cjs
```

コミット規約やコントリビュートガイドは [CONTRIBUTING.md](../../CONTRIBUTING.md) および [AGENTS.md](../../AGENTS.md) を参照してください。

## 🙏 アップストリームとライセンス

- [MIT License](../../LICENSE) に基づき公開されています。
- [CowAgent](https://github.com/zhayujie/CowAgent)（MIT License）をベースに開発されており、アップストリームの著作権表示および MIT ライセンス条項を保持しています。
- `config.json`、`.env`、API キー、個人の会話データはリポジトリにコミットしないでください。
