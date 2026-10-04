# 🧩 opencode-skills-tui

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/v/opencode-skills-tui" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/dm/opencode-skills-tui" alt="npm downloads per month"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

A skill list for your [**OpenCode**](https://opencode.ai) sidebar. See what's available, check what the current session has loaded, and read SKILL.md without leaving the terminal.

![Skills panel demo](assets/demo.gif)

## ✨ What you get

- Browse the skills available to your project, with loaded skills pinned in green and tracked per session.
- Click a skill to read its SKILL.md in a scrollable preview.

## 📦 Install

Requires OpenCode ≥ 2.0:

```bash
# install
opencode plugin add opencode-skills-tui
# uninstall
opencode plugin remove opencode-skills-tui
# update
opencode plugin update opencode-skills-tui
```

On V1, see the [V1 guide](https://github.com/aihaipeng/opencode-skills-tui/blob/v0.4.4/README.md).

## 🔧 A few tips

- **Where the green marks come from**: derived from session messages (skill tool calls and @-mentions). Reopening an old session restores them after a moment; opening a preview never loads a skill.
- **Updating**: run `opencode plugin update opencode-skills-tui`, then restart. npm copies are cached under `~/.cache/opencode/npm/opencode-skills-tui@latest/`; delete that directory if an update refuses to land.

## 🛠️ Development

Working on the plugin? Clone the repo and install [Bun](https://bun.sh) for the development tools:

```bash
git clone https://github.com/aihaipeng/opencode-skills-tui.git
cd opencode-skills-tui
bun install
bun run typecheck
bun run test
bun run test:package
```

Run `bun run build` before loading this repository as a local plugin, then add its `file://` path to the `plugins` array in `cli.json` and restart. Published npm packages ship precompiled Solid code and need no build step.

[Plugin installation](https://opencode.ai/v2/docs/cli/plugins) · [V2 plugin API](https://opencode.ai/v2/docs/build/plugins/cli) · [MIT license](LICENSE)
