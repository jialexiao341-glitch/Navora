# Navora 桌面打包与自动更新实施计划

> **给后续执行者：** 使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development` 按任务实施；本文件仅记录计划，当前不执行构建、发布或修改用户数据。

**目标：** 为 Navora 制作可独立安装的 Windows 桌面应用，并实现版本检测、下载、安装与重启，同时保留用户数据。

**架构：** 沿用 Electron 主进程、React 桌面界面和 PyInstaller 打包的 Python 后端。复用 `electron-updater` 的更新状态和安装流程，将发布和更新源调整为 Navora 自己可控的服务；更新前停止受管理的后端，重启后验证版本和数据。

**技术栈：** Windows x64、Electron、React、Python、PyInstaller、electron-builder、electron-updater、NSIS、GitHub Actions、GitHub Releases。

**需求来源：** 2026-11-13 关于桌面打包、独立更新与 DeepSeek Harness 更新体验的讨论；本文同时作为本次实施的设计说明。

## 范围与约束

- 第一阶段仅交付 Windows x64 安装版；macOS、Linux 和多更新通道后续评估。
- 安装包必须包含可运行的 Python 后端，目标用户不需要自行安装 Python、Node.js 或 Git。
- 更新地址、版本检测和发布流程必须指向 Navora 控制的资源；未经验证前不得分发连接原项目更新源的安装包。
- 保留原项目 MIT 许可证及版权声明；不得将 API Key、个人会话或配置提交到仓库或安装包。
- 应用文件与用户数据分离；升级、失败恢复和卸载的数据处理策略需要明确并验证。
- 允许用户检查更新、查看版本、选择下载和安装；安装前处理运行中的任务和 Python 子进程。
- 本地源码模式和打包桌面模式的更新路径分别处理，不能把桌面更新误接到 `git pull`。

## 当前基础（代码核对于 2026-11-13）

| 项目 | 当前状态 | 后续处理 |
| --- | --- | --- |
| 桌面架构 | `desktop/` 已有 Electron、React 界面及 Python 后端进程管理 | 先复用，核对桌面 UI 与 Web 的品牌和功能差异 |
| 安装包 | `desktop/package.json` 配置了 Windows NSIS；打包时依赖 `desktop/build/dist/cowagent-backend` | 先构建后端，再构建并实测安装包 |
| 更新器 | `desktop/src/main/updater.ts` 已有检查、下载进度和安装状态；启动后约 5 秒检查一次，之后每 4 小时检查 | 接入 Navora 更新源，完整测试安装和故障恢复 |
| 进程关闭 | `desktop/src/main/index.ts` 安装更新前调用 Python 后端停止逻辑 | 验证后台任务、文件占用及停止失败场景 |
| 发布流程 | `.github/workflows/release.yml` 可构建多个平台；现有发布部分依赖原项目的 Cloudflare / R2 / D1 | 调整为 Navora 自己的 Windows 构建与发布流程 |
| 更新来源 | 更新器和构建配置仍包含 `cowagent.ai` / `cowagent.cn`；源码更新服务的版本检测仍指向原仓库 | 必须明确禁用或替换，不能让两个品牌的更新混用 |
| 用户数据 | 打包后端当前使用 `~/.cow` 作为数据目录，工作空间路径需根据实际配置确认；源码运行的 `config.json` 通常在项目目录 | 设计迁移，不假定两种安装的数据已自动合并 |
| 品牌 | 产品显示名已有 Navora，但 `appId`、后端文件名和部分文案仍沿用原名称 | 确认独立身份并保持既有数据兼容 |

## 文件与职责

- `desktop/package.json`：应用身份、版本、NSIS 目标、发布配置和打包资源。
- `desktop/src/main/updater.ts`：版本源选择、检查、下载、错误处理和安装调度。
- `desktop/src/main/index.ts`、`desktop/src/main/python-manager.ts`：后端生命周期和更新前安全退出。
- `desktop/src/main/themes.ts`、`desktop/resources/app-config.json`：现有可选更新地址配置入口；如继续使用，明确打包和校验方式。
- `desktop/src/renderer/`：桌面品牌、更新交互和与 Web 界面的差异。
- `desktop/build/cowagent-backend.spec`、`desktop/build/requirements-desktop.txt`：后端打包依赖和资源收集。
- `.github/workflows/release.yml`：构建、生成产物与发布；现有 Cloudflare 步骤不得直接指向原项目资源。
- `cli/VERSION`、`cli/update_service.py`、`channel/web/static/js/core/version.js`：后端版本与源码模式更新检查。

## 分阶段任务

### 1. 冻结身份与数据方案

- [x] 确认正式 `appId`（`com.navora.desktop`）、产品名称（`Navora`）、初始版本（`2.2.2`），保持与旧数据目录兼容。
- [x] 列出源码版和打包版的配置、会话、工作空间、记忆、技能与凭证实际存储位置（`~/.cow` 与 `~/cow`）。
- [x] 制定迁移策略：沿用 `~/.cow` 与 `~/cow` 目录并保留原数据，升级与卸载均不删除用户数据。
- [x] 明确卸载默认保留哪些用户数据，并在文档（`docs/**/guide/desktop.mdx`）中说明。
- [ ] 验收：从已有源码配置和全新环境分别推演一次，确认不会读取错误账户或覆盖已有工作空间。

### 2. 打通本地 Windows 构建

- [x] 核对桌面端文案、图标、默认名称和启动后端所需的资源；桌面端切换直接加载 Web 控制台并保留轻量启动壳。
- [x] 在独立构建环境安装项目桌面依赖和 PyInstaller，按现有工作流生成 `desktop/build/dist/cowagent-backend`。
- [x] 同步 `desktop/package.json` 与 `cli/VERSION` 的版本；新增 `desktop/build/build-win.ps1` 并成功构建 Windows NSIS 安装包（`Navora-Setup-2.2.2-x64.exe`）。
- [ ] 在干净的 Windows 环境安装，验证启动、模型配置、对话、工具、日志和退出；确认无需系统 Python / Node.js。
- [ ] 验证后端路径、打包资源和首次启用飞书时的依赖下载行为；清楚记录离线能力边界。
- [ ] 验收：安装包可安装、启动、关闭和卸载；应用重启后个人设置与会话按既定策略保留。

### 3. 实现 Navora 独立更新源

- [x] 确定公开发布渠道为 GitHub Releases（`jialexiao341-glitch/Navora`）。
- [x] 实现使用 `electron-updater` 的 GitHub provider（保留可选 `NAVORA_UPDATE_FEED_URL` / `app-config.json` generic 覆盖能力）。
- [x] 修改 `updater.ts` 的 `setFeedURL` 和构建配置，移除 CowAgent 默认源回退，新增 `tests/test_desktop_release_config.py` 隔离校验。
- [x] 调整源码模式版本检测（`cli/update_service.py`）和版本说明链接（`channel/web/static/js/core/version.js`），指向 Navora 仓库。
- [x] 不在客户端内嵌 GitHub 私有令牌。
- [ ] 验收：测试环境只请求预期域名和预期版本；错误源、空清单和不可访问时旧版本仍可使用。

### 4. 构建与发布自动化

- [x] 调整 GitHub Actions（`.github/workflows/release.yml`）：在 runner 安装固定版本的 Node.js 与 Python，先打包后端，再构建安装器。
- [x] 基于同一版本号生成桌面和后端版本（`stamp-backend-version.sh`）；校验产物版本一致。
- [x] 发布对应安装包、`latest.yml` 和 `.blockmap` 到 GitHub Releases。
- [x] 增加预发布检查：产物存在性、`latest.yml` 版本一致、仓库敏感文件扫描（排除非敏感内置证书）。
- [ ] 评估 Windows 代码签名与证书管理（已预留 `SIGNTOOL_*` 密钥钩子，待正式证书配置）；未经签名的测试包应清楚标明。
- [ ] 验收：在测试发布渠道生成的清单可被已安装的测试客户端识别；只有明确授权后才创建正式公开发行。

### 5. 更新体验与可靠性

- [x] 实现或核对 UI 状态：检查中、发现新版本、更新说明摘要、下载进度、下载失败、准备安装、已是最新版本。
- [x] 更新前检测运行中的对话任务与未发送草稿，给出「立即安装 / 稍后」的明确选择；由 `stopSync()` 清理子进程后再交给安装器。
- [x] 明确下载校验和签名验证策略；处理断网、清单异常、下载损坏、磁盘空间不足和安装器失败。
- [x] 提供可靠的失败恢复方式：保留当前可用版本、显示错误、一键定位 `updater.log` 日志与手动前往 GitHub Releases 下载入口。
- [ ] 验收：执行任务中、无网络、下载中断和安装失败时，都能理解当前状态并恢复使用。

### 6. 跨版本验收

- [ ] 制作测试版 A 和版本号更高的测试版 B，确认安装 A 后能检测并下载 B。
- [ ] 点击更新，验证 Python 子进程停止、安装器完成替换、应用重新打开，前后端版本均为 B。
- [ ] 比较升级前后的配置、会话、工作空间、记忆、技能和凭证；验证现有用户数据没有丢失。
- [ ] 在普通权限账户、包含空格或中文的安装路径、首次安装与重复升级场景下测试。
- [ ] 分别测试拒绝更新、网络失败、错误元数据、安装被中断和恢复启动。
- [ ] 记录测试环境、版本、结果及未解决问题；通过后才准备正式发布。

## 待后续决定

1. Navora 的正式应用 ID 和首次发布版本。
2. 更新源采用 GitHub Releases 还是自有 HTTPS 存储，以及仓库／发行资源是否公开。
3. 是否迁移到 Navora 专属数据目录，以及与现有 CowAgent 数据如何共存。
4. 代码签名证书和正式发布时间。
5. 是否在第一版加入安装目录选择、开机启动、托盘和静默更新等功能。

## 参考资料

- DeepSeek Harness 官方桌面端更新说明：<https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md>
- electron-builder 自动更新文档：<https://www.electron.build/v26/docs/features/auto-update/>
- 本项目桌面端说明：`desktop/README.md`
