# 🧩 opencode-skills-tui

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/v/opencode-skills-tui" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/dm/opencode-skills-tui" alt="npm downloads per month"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

在 [OpenCode](https://opencode.ai) 终端侧栏查看技能及加载状态、预览 SKILL.md，并插入技能附件。

![技能面板演示](assets/demo.gif)

## 📦 安装／更新／卸载

要求 **OpenCode ≥ 2.0**，仅适用于终端界面（TUI）。

```bash
#安装/更新/卸载
opencode plugin add/update/remove opencode-skills-tui
```

执行时将 `add/update/remove` 替换为所需子命令。

V1 用户请参考 [V1 说明](https://github.com/aihaipeng/opencode-skills-tui/blob/v0.4.4/README.zh-CN.md)。

## ⚙️ 参数说明

运行 `/skills-sidebar` 打开设置面板。

| 设置 | 简要说明 | 可选参数 |
| --- | --- | --- |
| Show sidebar | 显示／隐藏面板 | `on` / `off` |
| Display scope | 选择技能显示范围（见下方说明） | `model-visible` / `registered` / `loaded-only` |
| Token estimation | 显示静态 token 估值 | `list entry` / `load cost` / `total cost` / `off` |
| Header counts | 显示标题中的技能数量 | `on` / `off` |
| Skill overview | 选择打开只读预览的鼠标键 | `left-click` / `middle-click` / `right-click` / `off` |
| Insert @mention | 选择向输入框插入原生技能附件的鼠标键 | `left-click` / `middle-click` / `right-click` / `off` |

- **Display scope**：
  - `model-visible`：模型可发现并自动调用的技能。
  - `loaded-only`：仅显示当前阶段成功加载的技能，包括隐藏技能。
  - `registered`：宿主当前目录的全部已注册技能，包括隐藏技能。

  **隐藏技能**：因元数据或权限规则未进入模型可用清单，**不供模型自动发现／调用**，但可通过 `@skill-id` 显式加载；隐藏不等于禁止加载。

  各范围均保留当前阶段已加载的 ID，已加载技能（包括隐藏技能）置顶。自动调用仍遵循宿主权限规则；显示范围不修改权限，隐藏面板不会禁用技能。
- **侧栏配色**：

  | 项目 | 颜色 |
  | --- | --- |
  | Skills 标题与展开／折叠箭头 | dark 白色，light 黑色 |
  | 未加载、模型可见的技能名称与圆点 | dark 白色，light 黑色 |
  | 已加载技能的名称与圆点，包括隐藏技能 | 主题选中高亮色 |
  | 未加载的隐藏技能、标题计数与 token 估值 | 主题灰色（muted） |

  切换模式或主题时颜色同步更新。未加载且模型可见的技能不使用主题正文色，避免在 `tokyonight light` 等主题中与已加载高亮过于接近。
- **Token estimation**：
  - `list entry`：模型可见清单条目（ID、名称、描述）的预计 token，不含技能正文；隐藏项为 `0`。
  - `load cost`：一次普通加载预计新增的 token，包含正文及宿主附加信息。
  - `total cost`：单技能的 `list entry + load cost`，与当前是否已加载无关。

  均为静态估值，不是实时上下文占用、累计消耗或计费量；未知值显示 `-`。

设置跨会话和重启保留，并在本地 TUI 实例间同步；折叠状态仅属于当前终端。

## 💡 注意事项

- **压缩后显示未加载**：OpenCode 的上下文压缩（`/compact`，Compaction）是[有损压缩](https://opencode.ai/v2/docs/compaction/)，不保证模型在压缩后持续遵循技能。因此插件在压缩成功后重置加载标记，重新成功加载才再次高亮。`loaded` 统计会话开始或最近一次成功压缩后加载成功的不同技能数，不是调用次数；未加载不代表上下文中已没有技能文本。
- **预览**：优先读取本地可读的 SKILL.md，否则展示宿主注册正文；内容可能不同于模型输入。配色随当前主题更新，包括预览打开期间的主题切换；保留 Markdown 样式、文字选择和复制。Ctrl+点击已渲染的 HTTP(S) 链接可在浏览器中打开。

## 📁 源码结构

```text
opencode-skills-tui/
├── src/
│   ├── tui.tsx                 # 插件注册、预览及原生技能附件
│   ├── skill-data.ts           # 技能可见性、加载状态及 token 估值
│   ├── open-link.ts            # Ctrl+点击打开链接
│   └── components/
│       ├── skills-panel.tsx    # 侧栏面板
│       └── skills-dialog.tsx   # 侧栏设置弹窗
├── scripts/                    # 构建及打包校验
├── test/                       # 回归测试
├── assets/                     # 演示素材
├── dist/                       # 生成的 TUI 构建产物
├── index.ts                    # 宿主要求的空操作 server 入口
└── tui.tsx                     # 转出预编译 TUI 的包入口
```

## 🛠️ 本地开发

在本地仓库中使用 [Bun](https://bun.sh)：

```bash
bun install
bun run build
bun run test
```

在 `opencode.json(c)` 现有的 `plugins` 数组中，用仓库的绝对 `file://` URL 替代 npm 条目。修改代码后重新构建并重启 TUI。

[OpenCode 插件文档](https://opencode.ai/v2/docs/plugins) · [MIT 许可证](LICENSE)
