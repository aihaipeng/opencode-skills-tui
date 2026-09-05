# opencode-skills-tui

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/v/opencode-skills-tui" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/dm/opencode-skills-tui" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

一个 [OpenCode](https://opencode.ai) TUI 插件：在右侧边栏增加 `Skills` 区块，列出 OpenCode 可见的全部技能。当前会话已加载的技能标绿置顶，右键任意技能即可阅读其完整 SKILL.md，还能一键切换为只看已加载技能。

![demo](assets/demo.gif)

## ✨ 功能

- 📋 会话侧边栏 `Skills` 区块，列出 OpenCode 认识的全部技能，按名称排序
- 🟢 已加载技能标绿并置顶，各会话独立跟踪
- 👁️ 右键任意技能，在窗口中阅读完整 SKILL.md——滚轮翻阅，`esc` 或点击窗口外关闭
- 🎚️ `/skills-toggle` 一键切换为只显示已加载技能
- 📁 面板头可折叠，实时摘要 `(X loaded Y available)`
- 🔄 列表随会话与消息变化自动更新
- 🔔 有新版本发布时提醒你，并给出需要删除的缓存目录——OpenCode 自己不会接住新版本
- 💾 面板偏好跨重启保留

## 📦 安装

这是 **TUI 插件**，必须配置在 `~/.config/opencode/tui.json`，不是 `opencode.json`。

### 方式一：让 AI agent 代装（推荐）

把下面这段话粘贴给 OpenCode 或任意 LLM agent：

```text
按照 https://raw.githubusercontent.com/aihaipeng/opencode-skills-tui/main/README.md 的说明，安装 opencode-skills-tui 插件。
```

### 方式二：npm 安装

在 `~/.config/opencode/tui.json` 中写入包名：

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-skills-tui"
  ]
}
```

OpenCode 启动时会自动安装 npm 插件，**依赖 [Bun](https://bun.sh)**——`PATH` 中必须有 Bun。缺少时安装会静默失败，TUI 可能一直卡在加载页（见下方故障排查）。用 `bun --version` 检查；没有先安装：`curl -fsSL https://bun.sh/install | bash`（macOS/Linux）。

### 方式三：源码构建

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

- **npm 安装**：重启 `opencode` 即可——启动时会重新解析插件版本。若仍加载旧版，删除 `~/.cache/opencode/packages/opencode-skills-tui@latest/` 后再重启。
- **本地安装**：`git pull` → `bun install && bun run build` → 重启 `opencode`。

### 🔄 重启 OpenCode

TUI 插件随启动加载，无热重载。安装或更新后请重启 `opencode`。

### 🤖 给 LLM Agent 的说明

<details>
<summary>AI agent 代装时按以下步骤执行</summary>

1. 检查 Bun：`bun --version`。若未安装，先从 <https://bun.sh> 安装——缺少 Bun 时 npm 自动安装会静默失败，TUI 会卡在加载页。
2. 读取 `~/.config/opencode/tui.json`（不存在则创建）。这是 **TUI 插件**：必须写入 `tui.json`，绝不写入 `opencode.json`。
3. 将 `"opencode-skills-tui"` 加入 `plugin` 数组，保留已有条目：

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["opencode-skills-tui"]
   }
   ```

4. 不要手动执行 `npm install` / `bun add`——OpenCode 启动时会自行拉取 npm 插件。
5. 提醒用户重启 `opencode`（无热重载）。右侧边栏出现 `Skills` 区块即安装成功。

</details>

## 🚀 使用

| 操作 | 效果 |
| --- | --- |
| 点击 `Skills` 标题 | 折叠 / 展开面板 |
| 右键技能行 | 在窗口中预览该技能的 SKILL.md 内容，滚轮翻阅，`esc` 或点击窗口外关闭 |
| `/skills-toggle` | 在「全部技能」与「只看已加载」之间切换侧栏 |

## 🧠 「已加载」如何判定

会话消息中出现以下任一情形，即视为该技能已加载：

1. `skill` 工具以该技能名称被调用
2. 出现该技能的 `<skill_content name="...">` 注入标签
3. 斜杠命令（`/某技能`）将其正文粘贴进会话

重启后绿色标记会自动恢复——首次打开某个会话时，插件会重新读取该会话的历史。

## 🛠️ 故障排查

- **添加 npm 插件后 TUI 卡在加载页**：自动安装依赖 `PATH` 中的 Bun，缺失时会静默失败。用 `bun --version` 检查；安装 Bun，或改用方式三（源码构建），然后重启 `opencode`。
- **没有 `Skills` 区块**：检查 `tui.json` 路径为绝对路径且正确，然后重启。`opencode --pure` 会跳过所有外部插件，可用来确认问题是否出在插件上。
- **重启后已加载技能不变绿**：插件会对每个会话自动拉取一次历史；切换到该会话稍等片刻。
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
├── tui.tsx                       # 插件入口：侧边栏面板、技能预览、命令注册、版本检查
├── skill-data.ts                 # 技能发现与加载状态检测
└── components/
    └── skills-panel.tsx          # 侧边栏面板渲染
```

如果这个插件对你有帮助，欢迎点个 ⭐——能让更多人发现它。

## 📄 许可证

[MIT](LICENSE)
