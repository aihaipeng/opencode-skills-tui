/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import type { Plugin } from "@opencode/plugin/tui"

const { default: plugin } = await import(process.env.PLUGIN_TEST_ENTRY ?? "../src/tui")

test("sidebar clicks update the installed plugin", async () => {
  let render!: (input: { sessionID: string }) => any
  let unregistered = false
  let dialogShown = 0
  const events = new Map<string, (event: any) => void>()
  const white = RGBA.fromHex("#ffffff")
  const context = {
    location: { directory: process.cwd() },
    storage: { store: (_key: string, options: { initial: object }) => {
      const [state, setState] = createStore(options.initial)
      return [state, async (mutation: (draft: object) => void) => setState(produce(mutation))]
    } },
    theme: { text: { base: white, muted: white, feedback: { success: { base: white } } } },
    client: { session: { log: async function* () {} } },
    data: {
      location: { skill: {
        sync: async () => {},
        list: () => [{ name: "alpha", content: "# Alpha" }, { name: "beta", content: "# Beta" }],
      } },
      on: (name: string, callback: (event: any) => void) => {
        events.set(name, callback)
        return () => { events.delete(name) }
      },
    },
    ui: {
      slot: (options: { render: typeof render }) => {
        render = options.render
        return () => { unregistered = true }
      },
      dialog: { show: () => { dialogShown++ }, set: () => {} },
      toast: { show: () => {} },
    },
  } as unknown as Plugin.Context
  const cleanup = plugin.setup!(context) as () => void
  const view = await testRender(() => (
    <box width="100%" height={12}>
      <scrollbox>{render({ sessionID: "session-1" })}</scrollbox>
    </box>
  ), { width: 40, height: 16 })
  try {
    await view.waitForFrame((frame) => frame.includes("alpha") && frame.includes("beta"))
    events.get("session.skill.activated")!({ data: { sessionID: "session-1", name: "beta" } })
    await view.waitForFrame((frame) => frame.indexOf("beta") < frame.indexOf("alpha"))
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▶ Skills"))
    expect(view.captureCharFrame()).toContain("1 loaded 2 available")
    expect(view.captureCharFrame()).not.toContain("alpha")
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("alpha"))
    await view.mockMouse.click(4, 1)
    expect(dialogShown).toBe(1)
  } finally {
    cleanup()
    view.renderer.destroy()
  }
  expect(unregistered).toBe(true)
  expect(events.size).toBe(0)
})
