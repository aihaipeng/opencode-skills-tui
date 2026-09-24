# 🧩 opencode-skills-tui

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/v/opencode-skills-tui" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/dm/opencode-skills-tui" alt="npm downloads per month"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

A skill list for your [**OpenCode V2**](https://opencode.ai/v2/docs/) sidebar. See what's available, check what the current session has loaded, and read SKILL.md without leaving the terminal.

![Skills panel demo](assets/demo.gif)

## ✨ What you get

- Browse the skills available to your current project.
- Spot loaded skills in green at the top, with separate state for each session.
- Click a skill to read its SKILL.md in a scrollable preview.
- Automatic list updates and a collapsible panel that remembers your preference.

## 📦 Install

### Let your Agent do it (recommended)

Paste this into OpenCode or your favorite coding Agent:

```text
Install opencode-skills-tui for OpenCode V2 using the manual installation section in this README. Preserve my existing configuration:
https://raw.githubusercontent.com/aihaipeng/opencode-skills-tui/main/README.md
```

### Manual installation

Add this plugin to `~/.config/opencode/cli.json`, keeping your existing settings:

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

OpenCode handles the npm download and reloads watched configuration changes.

## 🖱️ Click around

| Action | What happens |
| --- | --- |
| Click a skill | Open its SKILL.md preview |
| Scroll inside the preview | Read more |
| Press `esc` or click outside the preview | Close it |
| Click `Skills` | Fold / unfold the panel |

## 🟢 Loaded state

Green means OpenCode has loaded that skill in the current session. Opening its preview does not load it. Each session keeps its own marks, which are restored when you revisit it after a restart.

## 🔧 A few tips

- **No Skills panel?** Check your OpenCode version and the `plugins` entry, then restart. Run `opencode --print-logs` to inspect plugin loading.
- **No skills listed?** Confirm that OpenCode can discover skills for the current project or global configuration.
- **Loaded skill not green?** Switch to the relevant session and give it a moment to restore the loaded state.
- **Changes not showing up?** V2 reloads watched plugin/config files. Unwatched local dependencies may still need a restart.

## 🛠️ Development

Working on the plugin? Clone the repo and install [Bun](https://bun.sh) for the development tools:

```bash
git clone https://github.com/aihaipeng/opencode-skills-tui.git
cd opencode-skills-tui
bun install
bun run typecheck
bun run test
```

OpenCode compiles the TSX entrypoints directly and reloads watched files. If an edit is not picked up, restart OpenCode to verify. Tests cover skill normalization and loaded-first ordering.

[Plugin installation](https://opencode.ai/v2/docs/cli/plugins) · [V2 plugin API](https://opencode.ai/v2/docs/build/plugins/cli) · [MIT license](LICENSE)
