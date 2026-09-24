/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
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
  // Reactive stand-in for the host's message store: the plugin rescans it
  // whenever the slot claim re-renders.
  const [sessionID, setSessionID] = createSignal("session-1")
  const messages: any[] = [
    {
      id: "msg_tool",
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "call_1",
          name: "skill",
          executed: false,
          state: {
            status: "completed",
            input: { id: "beta" },
            content: [{ type: "text", text: '<skill_content name="beta">\n# Skill: beta\n' }],
          },
          time: { created: 1, completed: 2 },
        },
      ],
    },
  ]
  const white = RGBA.fromHex("#ffffff")
  const context = {
    location: { directory: process.cwd() },
    storage: { store: (_key: string, options: { initial: object }) => {
      const [state, setState] = createStore(options.initial)
      return [state, async (mutation: (draft: object) => void) => setState(produce(mutation))]
    } },
    theme: { text: { base: white, muted: white, feedback: { success: { base: white } } } },
    client: { message: { list: async () => ({ data: [], cursor: {} }) } },
    data: {
      session: { message: { list: () => messages } },
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
      <scrollbox>{render({ sessionID: sessionID() })}</scrollbox>
    </box>
  ), { width: 40, height: 16 })
  try {
    // Message-store scan marks the skill-tool load from history.
    await view.waitForFrame((frame) => frame.includes("alpha") && frame.includes("beta"))
    await view.waitForFrame((frame) => frame.indexOf("beta") < frame.indexOf("alpha"))
    // A later message (user attachment for alpha) is picked up when the claim
    // re-renders, without any durable activation event.
    messages.push({
      id: "msg_user",
      type: "user",
      text: "@alpha",
      files: [],
      agents: [],
      skills: [{ id: "alpha", name: "alpha" }],
    })
    setSessionID("session-2")
    setSessionID("session-1")
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▶ Skills"))
    expect(view.captureCharFrame()).toContain("2 loaded 2 available")
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▼ Skills"))
    await view.mockMouse.click(4, 1)
    expect(dialogShown).toBe(1)
  } finally {
    cleanup()
    view.renderer.destroy()
  }
  expect(unregistered).toBe(true)
  expect(events.size).toBe(0)
})
