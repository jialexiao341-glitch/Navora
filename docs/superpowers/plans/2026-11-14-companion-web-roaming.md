# 网页小伙伴漫游 Implementation Plan

**Goal:** 在 Navora 各视图提供连贯且可中断的视口内漫游。

**Architecture:** 纯函数选择避开交互区域的目标及计算时长；前端调度器控制转向、移动和停留，并在交互或任务开始时冻结当前位置。沿用现有精灵图和状态事件。

**Tech Stack:** JavaScript、CSS、Node.js 测试。

**Spec:** `docs/superpowers/specs/2026-11-14-companion-web-roaming-design.md`

## 实施与验证

- [x] 在 `tests/web_companion.test.cjs` 先测试视口边界、障碍避让和与距离相关的时长，确认失败。
- [x] 修改 `channel/web/static/js/core/companion.js`（现已统一演进为 `indesktop-pet.js`）实现目标选择、连续调度及安全中断，支持所有视图、输入和弹窗暂停。
- [x] 修改 `channel/web/static/css/ambient-player.css`（及 `indesktop-pet.css`）配合动态时长与减少动态效果。
- [x] 运行小伙伴及相关网页测试，检查变更与未相关的工作区修改。
