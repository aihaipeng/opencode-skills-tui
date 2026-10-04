# 🧩 opencode-skills-tui

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/v/opencode-skills-tui" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/dm/opencode-skills-tui" alt="npm downloads per month"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

给 [**OpenCode**](https://opencode.ai) 的侧边栏加一份技能列表。查看可用/加载的skill，并在不离开终端的情况下阅读 SKILL.md。

![技能面板演示](assets/demo.gif)

## ✨ 功能

- 查看当前项目可用技能，已加载技能标绿置顶，各会话独立记录。
- 点击技能即可预览 SKILL.md，支持滚动阅读。

## 📦 安装

要求 OpenCode ≥ 2.0：

```bash
# install
opencode plugin add opencode-skills-tui
# uninstall
opencode plugin remove opencode-skills-tui
# update
opencode plugin update opencode-skills-tui
```

V1 用户请参考 [V1 说明](https://github.com/aihaipeng/opencode-skills-tui/blob/v0.4.4/README.zh-CN.md)。

## 🔧 小提示

- **绿色标记的来源**：由会话消息推断（技能工具调用、@ 引用），重新打开旧会话会自动回填，稍等片刻即可；点开预览不会加载技能。
- **更新插件**：`opencode plugin update opencode-skills-tui` 后重启。npm 安装副本缓存在 `~/.cache/opencode/npm/opencode-skills-tui@latest/`，更新不生效时删除该目录再重启。

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

以本地插件加载前先运行 `bun run build`，再把仓库的 `file://` 路径加入 `cli.json` 的 `plugins` 数组并重启。npm 发布包已预编译 Solid，安装无需构建。

[插件安装](https://opencode.ai/v2/docs/cli/plugins) · [V2 插件 API](https://opencode.ai/v2/docs/build/plugins/cli) · [MIT 许可证](LICENSE)
