// Server-side entrypoint. This plugin is TUI-only: the CLI plugin loader
// (<plugin-dir>/server|index + <plugin-dir>/tui) requires a server
// entrypoint to exist, so provide a no-op definition with the same id.
// Plain object, not Plugin.define: importing @opencode/plugin here would load
// @opencode/schema against the host binary's embedded effect (see AGENTS.md).
export default {
  id: "opencode-skills-tui",
  setup() {},
}
