# 🧩 opencode-skills-tui

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/v/opencode-skills-tui" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/dm/opencode-skills-tui" alt="npm downloads per month"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

给 [**OpenCode**](https://opencode.ai) 的侧边栏加一份技能列表。看看有哪些技能、当前会话加载了哪些，再点开 SKILL.md，在终端里就能搞定。

![技能面板演示](assets/demo.gif)

## ✨ 功能

- 查看当前项目可用的技能。
- 已加载技能标绿置顶，各会话独立记录。
- 点击技能即可预览 SKILL.md，支持滚动阅读。
- 列表自动更新，面板可折叠并记住你的偏好。

## 📦 安装

请根据已安装的 OpenCode 版本选择下方指导。OpenCode V1 使用固定的旧版插件，V2 使用当前版本。

### 让 Agent 帮你装（推荐）

把下面这段话发给 OpenCode 或你常用的编程 Agent：

```text
请按照这份 README 的手动安装部分安装 opencode-skills-tui。先检查我已安装的 OpenCode 版本，再选择对应指导，保留已有配置：
https://raw.githubusercontent.com/aihaipeng/opencode-skills-tui/main/README.zh-CN.md
```

### 手动安装

先检查你正在使用的 OpenCode 版本：

```bash
opencode --version
```

| OpenCode 版本 | 插件包 | 配置文件与字段 |
| --- | --- | --- |
| `1.x`（V1） | `opencode-skills-tui@0.4.4` | `~/.config/opencode/tui.json` → `plugin` |
| `2.x`（V2） | `opencode-skills-tui` | `~/.config/opencode/cli.json` → `plugins` |

如果无法确定版本，请先确认再修改配置。将对应条目合并到已有文件，保留其他插件和设置；若已配置本插件，更新原条目即可，避免重复添加。

#### OpenCode V2

在 `~/.config/opencode/cli.json` 中添加以下条目：

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "opencode-skills-tui"
    }
  ]
}
```

OpenCode 会自动从 npm 下载插件，并重载受监控的配置变更。

#### OpenCode V1

在 `~/.config/opencode/tui.json` 中添加固定版本：

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-skills-tui@0.4.4"
  ]
}
```

重启 OpenCode 后会自动下载并加载插件。使用 V1 时，即使出现更新提示也请保留 `@0.4.4`，不带版本号会安装面向 V2 的版本。

下方使用说明面向 V2。V1 需要右键点击技能来预览，其他功能请参考 [V1 使用说明](https://github.com/aihaipeng/opencode-skills-tui/blob/v0.4.4/README.zh-CN.md)。

## 🖱️ 怎么用

| 操作 | 效果 |
| --- | --- |
| 点击技能 | 预览它的 SKILL.md |
| 在预览中滚动 | 继续阅读 |
| 按 `esc` 或点击预览窗口外 | 关闭预览 |
| 点击 `Skills` | 折叠 / 展开面板 |

## 🟢 已加载状态

绿色表示 OpenCode 已在当前会话中加载该技能。点开预览不会加载技能。每个会话独立记录，重启后再次打开会话，也会恢复已有标记。

## 🔧 小提示

- **没有 Skills 面板？** 检查 OpenCode 版本及上方对应配置，再重启确认。运行 `opencode --print-logs` 可查看插件加载日志。
- **列表是空的？** 确认 OpenCode 能发现当前项目或全局配置中的技能。
- **已加载的技能没变绿？** 切换到对应会话，稍等片刻，让加载状态恢复。
- **改动没生效？** V2 会重载受监控的插件和配置文件；未受监控的本地依赖可能仍需重启。

## 🛠️ 开发

想改插件代码？克隆仓库，再装好开发工具需要的 [Bun](https://bun.sh)：

```bash
git clone https://github.com/aihaipeng/opencode-skills-tui.git
cd opencode-skills-tui
bun install
bun run typecheck
bun run test
bun run test:package
```

作为本地插件加载仓库前，请先运行 `bun run build`。npm 发布包包含预编译的 Solid 代码，确保点击后面板能更新。`bun run test:package` 会从 `node_modules` 路径测试实际 npm 压缩包。

[插件安装](https://opencode.ai/v2/docs/cli/plugins) · [V2 插件 API](https://opencode.ai/v2/docs/build/plugins/cli) · [MIT 许可证](LICENSE)
