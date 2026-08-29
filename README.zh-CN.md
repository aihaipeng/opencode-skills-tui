# opencode-skills-tui

[English](README.md) | 简体中文

一个 [OpenCode](https://opencode.ai) TUI 插件：在右侧边栏增加 `Skills` 区块，按会话列出 OpenCode 可见的全部技能，已加载的高亮并排在最前，并可一键切换为只显示已加载技能。

## ✨ 功能

- 📋 会话侧边栏 `Skills` 区块，列出 OpenCode 发现的全部技能，按名称排序
- 🟢 已加载技能绿色圆点高亮并置顶（按会话跟踪）
- 🎚️ `/skills-loaded-only` 在「全部技能」与「只看已加载」之间切换侧栏
- 📁 面板头可折叠，实时摘要 `(X loaded Y available)`
- 💾 折叠状态与切换偏好跨重启保留

## 📦 安装

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

无需手动安装——OpenCode 启动时会用 Bun 自动安装 npm 插件。

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

### ⬆️ 更新

- **npm 安装**：重启 `opencode` 即可——启动时会重新解析插件版本。若仍加载旧版，删除 `~/.cache/opencode/node_modules/` 后再重启。
- **本地安装**：`git pull` → `bun install && bun run build` → 重启 `opencode`。

### 🔄 重启 OpenCode

TUI 插件随启动加载，无热重载。安装或更新后请重启 `opencode`。

## 🚀 使用

| 操作 | 效果 |
| --- | --- |
| 点击 `Skills` 标题 | 折叠 / 展开面板 |
| `/skills-loaded-only` | 在「全部技能」与「只看已加载」之间切换侧栏 |

> 💡 斜杠命令（`/某技能`）加载的技能，正文注入会话后即计为已加载。

## 🛠️ 故障排查

- **没有 `Skills` 区块**：检查 `tui.json` 路径为绝对路径且正确，然后重启。`opencode --pure` 会跳过所有外部插件，可用来确认问题是否出在插件上。
- **更新插件后无变化**：重启 `opencode`。

## 🧑‍💻 开发

```bash
bun install
bun run build      # 打包到 dist/tui.js + 声明
bun run typecheck  # tsc --noEmit
```

### 📂 源码结构

```text
src/
├── tui.tsx                       # 插件入口：侧边栏插槽、命令、持久化
├── skill-data.ts                 # 技能发现与加载状态检测
└── components/
    └── skills-panel.tsx          # 侧边栏面板渲染
```

## 📄 许可证

[MIT](LICENSE)
