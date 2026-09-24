// Server-side entrypoint. This plugin is TUI-only: the CLI plugin loader
// (<plugin-dir>/server|index + <plugin-dir>/tui) requires a server
// entrypoint to exist, so provide a no-op definition with the same id.
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "opencode-skills-tui",
  setup() {},
})
