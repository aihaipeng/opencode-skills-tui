# opencode-skills-tui

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/v/opencode-skills-tui" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/dm/opencode-skills-tui" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

一个 [OpenCode](https://opencode.ai) TUI 插件：在右侧边栏增加 `Skills` 区块，列出 OpenCode 可见的全部技能。已加载的技能标绿置顶；右键任意技能可读完整 SKILL.md；`/skills-toggle` 只看已加载，`/skills-stats` 查看各技能累计使用次数。

![demo](assets/demo.gif)

## ✨ 功能

- 🟢 已加载技能标绿置顶，各会话独立跟踪
- 👁️ 右键任意技能，阅读完整 SKILL.md——滚轮翻阅，`esc` 或点击窗口外关闭
- 🎚️ `/skills-toggle` 只显示已加载技能
- 📊 `/skills-stats` 查看各技能累计使用次数，跨重启保留
- 📁 面板头可折叠，实时摘要 `(X loaded Y available)`，面板偏好跨重启保留
- 🔄 列表随会话与消息变化自动更新
- 🔔 有新版本时提醒，并给出需要删除的缓存目录

## 📦 安装

这是 **TUI 插件**：必须配置在 `~/.config/opencode/tui.json`，不是 `opencode.json`。

### 方式一：让 AI agent 代装（推荐）

把下面这段话粘贴给 OpenCode 或任意 LLM agent：

```text
按照 https://raw.githubusercontent.com/aihaipeng/opencode-skills-tui/main/README.md 的说明，安装 opencode-skills-tui 插件。
```

### 方式二：npm 安装

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-skills-tui"
  ]
}
```

无需手动操作——OpenCode 启动时用内嵌 Bun 运行时自行拉取 npm 插件。保留 `plugin` 里的已有条目，数组可装多个插件。加载页卡住见故障排查。

### 方式三：源码构建

```bash
git clone https://github.com/aihaipeng/opencode-skills-tui.git
cd opencode-skills-tui
bun install
bun run build
```

然后把 `dist/tui.js` 的绝对路径按方式二的样子写进 `plugin`（如 `"C:\\path\\to\\opencode-skills-tui\\dist\\tui.js"`）。

### ⬆️ 更新

- **npm 安装**：重启 `opencode` 即可，启动时会重新解析版本。若仍加载旧版，删除 `~/.cache/opencode/packages/opencode-skills-tui@latest/` 后再重启。
- **本地安装**：`git pull` → `bun install && bun run build` → 重启。

无热重载——安装、更新、改配置后都需重启 `opencode`。

### 🤖 给 LLM Agent 的说明

<details>
<summary>AI agent 代装时按以下步骤执行</summary>

1. 不要让用户安装 Bun——OpenCode 用内嵌运行时安装 npm 插件。启动卡住时运行 `opencode --print-logs` 查看依赖解析；若卡住，删除 `~/.cache/opencode/` 后重试。
2. 编辑 `~/.config/opencode/tui.json`（不存在则创建）——TUI 插件写这里，绝不写 `opencode.json`。
3. 将 `"opencode-skills-tui"` 加入 `plugin` 数组，保留已有条目：

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["opencode-skills-tui"]
   }
   ```

4. 不要手动执行 `npm install` / `bun add`——OpenCode 启动时自行拉取。
5. 重启 `opencode`（无热重载）。右侧边栏出现 `Skills` 区块即成功。

</details>

## 🚀 使用

| 操作 | 效果 |
| --- | --- |
| 点击 `Skills` 标题 | 折叠 / 展开面板 |
| 右键技能行 | 预览该技能的 SKILL.md，滚轮翻阅，`esc` 或点击窗口外关闭 |
| `/skills-toggle` | 在「全部技能」与「只看已加载」之间切换 |
| `/skills-stats` | 查看累计使用次数（已删除的技能标注 `(deleted)`） |

## 🧠 「已加载」如何判定

会话消息中出现以下任一情形，即视为该技能已加载：

1. `skill` 工具以该技能名称被调用
2. 出现该技能的 `<skill_content name="...">` 注入标签
3. 斜杠命令（`/某技能`）将其正文粘贴进会话

重启后绿色标记自动恢复：首次打开某个会话时，插件会重新读取其历史。

## 🔢 使用次数统计

计数即时写入 `~/.local/state/opencode/opencode-skills-tui-usage.json`，读取直接走磁盘——跨重启、跨多个 OpenCode 窗口保留，删除会话不影响已有计数。

## 🛠️ 故障排查

- **TUI 卡在加载页**：多半是内嵌运行时解析依赖挂起（代理/慢网络常见）。运行 `opencode --print-logs` 观察；若卡住，删除 `~/.cache/opencode/` 后重试，或改用源码构建。
- **没有 `Skills` 区块**：检查 `tui.json` 路径为绝对路径且正确，然后重启。`opencode --pure` 会跳过所有外部插件，可用来定位问题。
- **重启后已加载技能不变绿**：插件会对每个会话自动拉取一次历史；切换到该会话稍等片刻。

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

如果这个插件对你有帮助，欢迎点个 ⭐。

## 📄 许可证

[MIT](LICENSE)
