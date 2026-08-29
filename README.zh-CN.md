# opencode-skills-tui

[English](README.md) | 简体中文

一个 [OpenCode](https://opencode.ai) TUI 插件：在右侧边栏增加 `Skills` 区块，按会话列出 OpenCode 可见的全部技能，已加载的高亮并排在最前，还可隐藏个别技能。

## 功能

- 会话侧边栏 `Skills` 区块，技能发现来自 OpenCode 本体（`client.app.skills()`），去重后按名称排序
- 按会话跟踪加载状态，三路检测：`skill` 工具 part（`input.name`）、opencode 注入的 `<skill_content name="...">` 标签 text part、TUI 斜杠命令展开（技能正文以纯文本用户消息注入，按已知技能正文匹配）
- 已加载技能绿色圆点高亮并置顶，侧栏与 `/skills-status` 一致
- 面板头可折叠，实时摘要 `(X loaded Y available)`（有隐藏技能时追加 `+Z`）
- `/hide-skills` 对话框可隐藏个别技能；`Show all hidden` 一步恢复全部，侧栏 `N hidden (show all)` 页脚点击同效
- 折叠状态与隐藏列表跨重启持久化（插件 kv）
- 按会话增量扫描（消息水位线），长会话不重复全量重扫

## 环境要求

- 支持 TUI 插件（`slots.sidebar_content`）的 OpenCode
- 从源码构建需要 [Bun](https://bun.sh)

## 安装

这是 **TUI 插件**，必须配置在 `~/.config/opencode/tui.json`，不是 `opencode.json`。

### 方式一：npm 安装（推荐）

在 `~/.config/opencode/tui.json` 中写入包名：

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-skills-tui"
  ]
}
```

无需手动安装——OpenCode 启动时会用 Bun 自动安装 npm 插件（缓存在 `~/.cache/opencode/node_modules/`）。

### 方式二：源码构建

```bash
git clone https://github.com/aihaipeng/opencode-skills-tui.git
cd opencode-skills-tui
bun install
bun run build
```

产出 `dist/tui.js`。在 `~/.config/opencode/tui.json` 中注册其绝对路径：

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "C:\\path\\to\\opencode-skills-tui\\dist\\tui.js"
  ]
}
```

`plugin` 数组可同时装多个插件，保留已有条目即可。

### 重启 OpenCode

TUI 插件随启动加载，无热重载。安装或更新后请重启 `opencode`。

## 使用

| 操作 | 效果 |
| --- | --- |
| 点击 `Skills` 标题 | 折叠 / 展开面板 |
| 点击技能行 | 无操作（设计如此） |
| 点击 `N hidden (show all)` | 恢复全部隐藏技能 |
| `/skills-status` | 对话框列出全部未隐藏技能与 `Loaded` / `Unloaded` 状态，已加载在前 |
| `/hide-skills` | 对话框隐藏 / 恢复个别技能，支持搜索 |

说明：

- `/skills-status` 反映当前打开的会话，需先打开会话。
- 折叠摘要中 `X` 为未隐藏的已加载数，`Y` 为发现的全部技能数，`Z` 为隐藏数。
- 斜杠命令（`/某技能`）加载的技能，正文注入会话后即计为已加载。

## 工作原理

- 通过 OpenCode TUI 插件 API（`@opencode-ai/plugin/tui`）注册 `sidebar_content` 插槽，`order: 250`（位于内置 `MCP` 200 与 `LSP` 300 之间）
- 技能发现来自 `client.app.skills()`；已加载集合按会话维护
- 加载检测按消息水位线增量扫描；技能列表刷新时重扫（正文匹配依赖列表）
- 刷新来源：`message.part.updated`、`message.updated`、`session.updated`（增量），`session.created`、`project.updated`、`workspace.ready`、`worktree.ready`（重取技能列表），外加启动 250ms 重试与打开会话后 500ms 兜底重扫
- 仅在散文里引用字面 `<skill_content>` 标签（如 assistant 消息）不计为加载：标签命中必须对应已知技能名

## 故障排查

- **没有 `Skills` 区块**：检查 `tui.json` 路径为绝对路径且正确，然后重启。`opencode --pure` 会跳过所有外部插件。
- **加载了技能但显示未加载**：斜杠命令加载按注入正文匹配，需技能列表先就绪；会自动回填。折叠再展开面板或切换会话可立即触发重扫。
- **更新插件后无变化**：TUI 插件随启动加载，重启 `opencode`。

## 开发

```bash
bun run build      # 打包到 dist/tui.js + 声明
bun run typecheck  # tsc --noEmit
```

源码结构：

- `src/tui.tsx` — 插件入口：插槽注册、事件接线、按会话加载跟踪、kv 持久化
- `src/skill-data.ts` — 技能发现、加载检测（工具 part / 标签 / 正文匹配）、增量扫描、加载优先排序
- `src/components/skills-panel.tsx` — 侧边栏面板渲染
- `src/components/skills-status-dialog.tsx` — `/skills-status` 对话框
- `src/components/skills-filter-dialog.tsx` — `/hide-skills` 对话框

## 许可证

[MIT](LICENSE)。
