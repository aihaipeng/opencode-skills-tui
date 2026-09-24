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

- Browse the skills available to your current project.
- Spot loaded skills in green at the top, with separate state for each session.
- Click a skill to read its SKILL.md in a scrollable preview.
- Automatic list updates and a collapsible panel that remembers your preference.

## 📦 Install

Choose the instructions below for your installed OpenCode version. OpenCode V1 uses a pinned legacy release; V2 uses the current release.

### Let your Agent do it (recommended)

Paste this into OpenCode or your favorite coding Agent:

```text
Install opencode-skills-tui using the manual installation section in this README. Check my installed OpenCode version and follow the matching instructions. Preserve my existing configuration:
https://raw.githubusercontent.com/aihaipeng/opencode-skills-tui/main/README.md
```

### Manual installation

First check the OpenCode version you use:

```bash
opencode --version
```

| OpenCode version | Plugin package | Configuration file and field |
| --- | --- | --- |
| `1.x` (V1) | `opencode-skills-tui@0.4.4` | `~/.config/opencode/tui.json` → `plugin` |
| `2.x` (V2) | `opencode-skills-tui` | `~/.config/opencode/cli.json` → `plugins` |

If the version cannot be determined, confirm it before editing the configuration. Merge the matching entry into your existing file, preserving other plugins and settings. If this plugin is already listed, update that entry instead of adding a duplicate.

#### OpenCode V2

Add the following entry to `~/.config/opencode/cli.json`:

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

#### OpenCode V1

Add the pinned version to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-skills-tui@0.4.4"
  ]
}
```

Restart OpenCode to download and load the plugin. Keep `@0.4.4` pinned while using V1, even if an update notice appears; an unversioned package selects the V2 release.

The usage below describes V2. In V1, right-click a skill to preview it; see the [V1 usage guide](https://github.com/aihaipeng/opencode-skills-tui/blob/v0.4.4/README.md) for its features.

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

- **No Skills panel?** Check your OpenCode version and its matching configuration above, then restart. Run `opencode --print-logs` to inspect plugin loading.
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
bun run test:package
```

Build before loading this repository as a local plugin: `bun run build`. Published packages include precompiled Solid code so OpenCode can update the panel after a click. `bun run test:package` checks the actual npm tarball from a `node_modules` path.

[Plugin installation](https://opencode.ai/v2/docs/cli/plugins) · [V2 plugin API](https://opencode.ai/v2/docs/build/plugins/cli) · [MIT license](LICENSE)
