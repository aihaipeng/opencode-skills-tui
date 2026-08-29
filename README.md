# opencode-skill-tracker

English | [简体中文](README.zh-CN.md)

An [OpenCode](https://opencode.ai) TUI plugin that adds a `Skills` section to the right sidebar: every skill visible to OpenCode is listed per session, loaded ones are highlighted and sorted first, and individual skills can be hidden from the sidebar.

Formerly `opencode-skills-sidebar`; saved state (collapsed / hidden skills) migrates automatically.

## Features

- `Skills` section in the session sidebar, discovery via OpenCode itself (`client.app.skills()`), deduplicated and sorted by name
- Loaded state per session, detected from three sources: `skill` tool parts (`input.name`), text parts carrying the `<skill_content name="...">` tag injected by opencode, and TUI slash-command expansion (skill body pasted as a plain user text part, matched against known skill content)
- Loaded skills are highlighted (green bullet) and sorted first, both in the sidebar and in `/skills-status`
- Collapsible panel header with a live summary — `(X loaded Y available)` (`+Z` when skills are hidden)
- Hide individual skills via the `/hide-skills` dialog; `Show all hidden` restores everything in one step, and an `N hidden (show all)` footer in the sidebar does the same
- Collapsed state and hidden set persist across restarts (plugin kv), with automatic migration from the legacy `opencode-skills-sidebar` keys
- Incremental per-session scanning (message watermark), so long sessions do not trigger repeated full rescans

## Requirements

- OpenCode with TUI plugin support (`slots.sidebar_content`)
- [Bun](https://bun.sh) to build from source

## Installation

This is a **TUI plugin**, so it must be configured in `~/.config/opencode/tui.json`, not in `opencode.json`.

### Option A: from npm (recommended)

Add the package name to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "opencode-skill-tracker-tui"
  ]
}
```

No manual install is needed — OpenCode installs npm plugins automatically with Bun at startup (cached in `~/.cache/opencode/node_modules/`).

### Option B: build from source

```bash
git clone https://github.com/aihaipeng/opencode-skill-tracker.git
cd opencode-skill-tracker
bun install
bun run build
```

That produces `dist/tui.js`. Register its absolute path in `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "C:\\path\\to\\opencode-skill-tracker\\dist\\tui.js"
  ]
}
```

Keep any existing entries in the `plugin` array — it can hold multiple plugins.

### Restart OpenCode

TUI plugins are loaded at startup; there is no hot reload. Restart `opencode` after installing or updating.

## Usage

| Action | Result |
| --- | --- |
| Click the `Skills` header | Collapse / expand the panel |
| Click a skill row | Nothing (by design) |
| Click `N hidden (show all)` | Restore all hidden skills |
| `/skills-status` | Dialog with every non-hidden skill, `Loaded` / `Unloaded` state, loaded first |
| `/hide-skills` | Dialog to hide / restore individual skills, with search |

Notes:

- `/skills-status` reflects the currently open session and needs one to be open.
- In the collapsed header, `X` counts loaded skills that are not hidden, `Y` counts all discovered skills, `Z` counts hidden ones.
- A skill loaded via a slash command (`/some-skill`) counts as loaded once the skill body has been pasted into the session.

## How it works

- Registers a `sidebar_content` slot via the OpenCode TUI plugin API (`@opencode-ai/plugin/tui`), slot `order: 250` (between the built-in `MCP` at 200 and `LSP` at 300)
- Skill discovery comes from `client.app.skills()`; the loaded set is tracked per session
- Loaded detection scans message parts incrementally (per-message watermark), and re-scans when the skill list refreshes (content matching needs the list)
- Refresh sources: `message.part.updated`, `message.updated`, `session.updated` (incremental), `session.created`, `project.updated`, `workspace.ready`, `worktree.ready` (skill list refetch), plus a 250ms startup retry and a 500ms backfill after opening a session
- Prose that merely quotes the literal `<skill_content>` tag (e.g. in assistant messages) is ignored: tag matches must name a known skill

## Troubleshooting

- **No `Skills` section**: check the path in `tui.json` is absolute and correct, then restart. `opencode --pure` skips all external plugins.
- **A skill was loaded but shows as unloaded**: slash-command loading is detected by matching the pasted skill body, which requires the skill list to be loaded first. It backfills automatically; collapsing and re-expanding the panel, or switching sessions, forces an immediate rescan.
- **Updated the plugin but nothing changed**: TUI plugins load at startup — restart `opencode`.

## Development

```bash
bun run build      # bundle to dist/tui.js + declarations
bun run typecheck  # tsc --noEmit
```

Source layout:

- `src/tui.tsx` — plugin entry: slot registration, event wiring, per-session loaded tracking, kv persistence
- `src/skill-data.ts` — skill discovery, loaded-state extraction (tool part / tag / content matching), incremental scanning, loaded-first sorting
- `src/components/skills-panel.tsx` — sidebar panel rendering
- `src/components/skills-status-dialog.tsx` — `/skills-status` dialog
- `src/components/skills-filter-dialog.tsx` — `/hide-skills` dialog

## License

[MIT](LICENSE) — the npm package is published as [`opencode-skill-tracker-tui`](https://www.npmjs.com/package/opencode-skill-tracker-tui).
