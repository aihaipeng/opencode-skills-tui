# opencode-skills-tui

English | [简体中文](README.zh-CN.md)

An [OpenCode](https://opencode.ai) TUI plugin that adds a `Skills` section to the right sidebar: every skill visible to OpenCode is listed per session, loaded ones are highlighted and sorted first, and a toggle can narrow the sidebar down to loaded skills only.

## ✨ Features

- 📋 `Skills` section in the session sidebar — every skill discovered by OpenCode, sorted by name
- 🟢 Loaded skills highlighted (green bullet) and sorted first, tracked per session
- 🎚️ `/skills-loaded-only` toggles the sidebar between all skills and loaded-only
- 📁 Collapsible panel header with a live summary — `(X loaded Y available)`
- 💾 Collapsed state and loaded-only preference persist across restarts

## 📦 Installation

This is a **TUI plugin**, so it must be configured in `~/.config/opencode/tui.json`, not in `opencode.json`.

### Option A: from npm (recommended)

Add the package name to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-skills-tui"
  ]
}
```

No manual install is needed — OpenCode installs npm plugins automatically with Bun at startup.

### Option B: build from source

```bash
git clone https://github.com/aihaipeng/opencode-skills-tui.git
cd opencode-skills-tui
bun install
bun run build
```

That produces `dist/tui.js`. Register its absolute path in `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "C:\\path\\to\\opencode-skills-tui\\dist\\tui.js"
  ]
}
```

Keep any existing entries in the `plugin` array — it can hold multiple plugins.

### ⬆️ Updating

- **npm install**: just restart `opencode` — plugins are re-resolved at startup. If the old version is still loaded, delete `~/.cache/opencode/packages/opencode-skills-tui@latest/` and restart again.
- **Local install**: `git pull`, then `bun install && bun run build`, then restart `opencode`.

### 🔄 Restart OpenCode

TUI plugins are loaded at startup; there is no hot reload. Restart `opencode` after installing or updating.

## 🚀 Usage

| Action | Result |
| --- | --- |
| Click the `Skills` header | Collapse / expand the panel |
| `/skills-loaded-only` | Toggle the sidebar between all skills and loaded-only |

> 💡 A skill loaded via a slash command (`/some-skill`) counts as loaded once the skill body has been pasted into the session.

## 🛠️ Troubleshooting

- **No `Skills` section**: check the path in `tui.json` is absolute and correct, then restart. `opencode --pure` skips all external plugins — handy to confirm the plugin is the cause.
- **Updated the plugin but nothing changed**: restart `opencode`.

## 🧑‍💻 Development

```bash
bun install
bun run build      # bundle to dist/tui.js + declarations
bun run typecheck  # tsc --noEmit
```

### 📂 Project structure

```text
src/
├── tui.tsx                       # Plugin entry: sidebar slot, command, persistence
├── skill-data.ts                 # Skill discovery and loaded-state detection
└── components/
    └── skills-panel.tsx          # Sidebar panel rendering
```

## 📄 License

[MIT](LICENSE)
