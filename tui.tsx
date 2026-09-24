// The CLI probes this file beside index.ts, including in installed npm packages.
// Local directory installs must run `bun run build` first.
export { default } from "./dist/tui.js"
