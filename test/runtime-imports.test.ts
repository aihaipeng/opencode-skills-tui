// Guards the 1.2.1 fix: @opencode/* runtime imports load @opencode/schema
// against the host binary's embedded effect and crash on renames, but only
// in real hosts — repo tests resolve them from node_modules and stay green.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { expect, test } from "bun:test"

const sourceFiles = ["index.ts", ...readdirSync("src", { recursive: true })
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .map((file) => `src/${file}`)]

// `import type` is erased at build time and stays allowed.
const stripTypeOnly = (source: string) =>
  source.replace(/import\s+type\s+\{[^}]*\}\s+from\s+"@opencode\/[^"]+"/g, "")

test("source keeps @opencode imports type-only", () => {
  for (const file of sourceFiles) {
    const offending = stripTypeOnly(readFileSync(file, "utf8")).match(/from\s+"@opencode\//g)
    expect(offending, `${file} must not import @opencode at runtime`).toBeNull()
  }
})

test("dist/tui.js has no @opencode imports when built", () => {
  if (!existsSync("dist/tui.js")) return // covered by test:package after build
  const dist = readFileSync("dist/tui.js", "utf8")
  expect(dist.match(/from\s+"@opencode\//g), "dist/tui.js must not import @opencode").toBeNull()
})
