# opencode-skills-tui

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/v/opencode-skills-tui" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/opencode-skills-tui"><img src="https://img.shields.io/npm/dm/opencode-skills-tui" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

An [OpenCode](https://opencode.ai) TUI plugin that adds a `Skills` section to the right sidebar listing every skill OpenCode can see. Loaded skills are marked green and pinned to the top; right-click any skill to read its full SKILL.md; `/skills-toggle` narrows the list to loaded skills, `/skills-stats` shows all-time usage counts per skill.

![demo](assets/demo.gif)

## ✨ Features

- 🟢 Loaded skills marked green and pinned to the top, tracked per session
- 👁️ Right-click a skill to read its full SKILL.md — scroll with the wheel, close with `esc` or a click outside
- 🎚️ `/skills-toggle` narrows the sidebar to loaded skills only
- 📊 `/skills-stats` shows all-time usage counts per skill, persisted across restarts
- 📁 Collapsible header with a live `(X loaded Y available)` summary; panel preferences persist
- 🔄 Keeps itself up to date as sessions and messages change
- 🔔 Update notifications with the exact cache directory to delete

## 📦 Installation

This is a **TUI plugin**: it goes into `~/.config/opencode/tui.json`, not `opencode.json`.

### Option 1: let your agent do it (recommended)

Paste this into OpenCode, or any LLM agent:

```text
Install the opencode-skills-tui plugin by following the instructions here:
https://raw.githubusercontent.com/aihaipeng/opencode-skills-tui/main/README.md
```

### Option 2: from npm

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-skills-tui"
  ]
}
```

No manual steps — OpenCode fetches npm plugins itself at startup (embedded Bun runtime, nothing to install). Keep any existing entries; `plugin` holds multiple plugins. Loading screen hangs? See Troubleshooting.

### Option 3: build from source

```bash
git clone https://github.com/aihaipeng/opencode-skills-tui.git
cd opencode-skills-tui
bun install
bun run build
```

Then register the absolute path of `dist/tui.js` in `plugin` the same way as Option 2 (e.g. `"C:\\path\\to\\opencode-skills-tui\\dist\\tui.js"`).

### ⬆️ Updating

- **npm install**: restart `opencode`; plugins re-resolve at startup. If the old version is still loaded, delete `~/.cache/opencode/packages/opencode-skills-tui@latest/` and restart again.
- **Local install**: `git pull`, then `bun install && bun run build`, then restart.

No hot reload — restart `opencode` after installing, updating, or changing config.

### 🤖 For LLM Agents

<details>
<summary>Step-by-step instructions when an AI agent is doing the install</summary>

1. Don't ask the user to install Bun — OpenCode installs npm plugins with its own embedded runtime. Startup hang: run `opencode --print-logs`; if package resolution is stuck, delete `~/.cache/opencode/` and retry.
2. Edit `~/.config/opencode/tui.json` (create if missing) — TUI plugins go here, never `opencode.json`.
3. Add `"opencode-skills-tui"` to the `plugin` array, keeping existing entries:

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["opencode-skills-tui"]
   }
   ```

4. No manual `npm install` / `bun add` — OpenCode fetches npm plugins itself at startup.
5. Restart `opencode` (no hot reload). A `Skills` section in the right sidebar means it worked.

</details>

## 🚀 Usage

| Action | Result |
| --- | --- |
| Click the `Skills` header | Collapse / expand the panel |
| Right-click a skill | Preview its SKILL.md — scroll with the wheel, close with `esc` or a click outside |
| `/skills-toggle` | Toggle the sidebar between all skills and loaded-only |
| `/skills-stats` | Show all-time usage counts per skill (deleted skills show as "(deleted)") |

## 🧠 How "loaded" is determined

A skill counts as loaded for a session when any of these appears in its messages:

1. The `skill` tool is invoked with that skill's name
2. A `<skill_content name="...">` injection tag for it
3. A slash command (`/some-skill`) pastes its body into the session

After a restart the green marks come back on their own: the plugin re-reads each session's history the first time you open it.

## 🔢 Usage stats

Counts are written immediately to `~/.local/state/opencode/opencode-skills-tui-usage.json` and read from disk, so totals survive restarts, are shared across OpenCode windows, and never change when a session is deleted.

## 🛠️ Troubleshooting

- **TUI stuck on the loading screen**: the embedded runtime is likely hanging while resolving the package (common behind proxies / slow networks). Run `opencode --print-logs` to watch it; if stuck, delete `~/.cache/opencode/` and retry, or build from source.
- **No `Skills` section**: check the path in `tui.json` is absolute and correct, then restart. `opencode --pure` skips all external plugins — handy to isolate the cause.
- **Loaded skills not green after a restart**: the plugin re-fetches session history once per session; switch to the session and give it a moment.

## 🧑‍💻 Development

```bash
bun install
bun run build      # bundle to dist/tui.js + declarations
bun run typecheck  # tsc --noEmit
```

### 📂 Project structure

```text
src/
├── tui.tsx                       # Plugin entry: sidebar panel, skill preview, commands, update check
├── skill-data.ts                 # Skill discovery and loaded-state detection
└── components/
    └── skills-panel.tsx          # Sidebar panel rendering
```

If you find this useful, consider giving it a ⭐.

## 📄 License

[MIT](LICENSE)
