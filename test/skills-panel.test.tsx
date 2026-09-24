/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import type { Plugin } from "@opencode/plugin/tui"

const { default: plugin } = await import(process.env.PLUGIN_TEST_ENTRY ?? "../src/tui")

const white = RGBA.fromHex("#ffffff")

/** Plugin context stand-in; tests override only what they assert on. */
const makeContext = (overrides: {
  storage?: Record<string, unknown>
  messages?: () => unknown[]
  skills?: () => unknown[]
  on?: (name: string, callback: (event: any) => void) => () => void
  slot?: (options: { render: (input: { sessionID: string }) => any }) => () => void
  dialogShow?: () => void
  onDialogShow?: (render: () => any) => void
} = {}) => ({
  location: { directory: process.cwd() },
  storage: {
    memory: (_key: string, options: { initial: object }) => {
      const [state, setState] = createStore(options.initial)
      return [state, (mutation: (draft: object) => void) => setState(produce(mutation))]
    },
    ...overrides.storage,
  },
  theme: {
    text: { base: white, muted: white, feedback: { success: { base: white } } },
    markdown: {
      text: white, heading: white, strong: white, emphasis: white,
      listItem: white, blockQuote: white, code: white, link: white, linkText: white,
    },
    surface: () => ({ background: { base: white } }),
  },
  client: { message: { list: async () => ({ data: [], cursor: {} }) } },
  data: {
    session: { message: { list: () => overrides.messages?.() ?? [] } },
    location: { skill: { sync: async () => {}, list: () => overrides.skills?.() ?? [] } },
    on: overrides.on ?? (() => () => {}),
  },
  ui: {
    slot: overrides.slot ?? (() => () => {}),
    dialog: {
      show: (render: () => any) => {
        overrides.onDialogShow?.(render)
        overrides.dialogShow?.()
      },
      set: () => {},
    },
    toast: { show: () => {} },
  },
} as unknown as Plugin.Context)

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
  const context = makeContext({
    messages: () => messages,
    skills: () => [{ name: "alpha", content: "# Alpha" }, { name: "beta", content: "# Beta" }],
    on: (name, callback) => {
      events.set(name, callback)
      return () => { events.delete(name) }
    },
    slot: (options) => {
      render = options.render
      return () => { unregistered = true }
    },
    dialogShow: () => { dialogShown++ },
  })
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

test("collapsing stays per-terminal instead of syncing across TUI instances", async () => {
  // Host semantics: storage.store is durable AND live-synced across running
  // TUI instances, storage.memory is scoped to one TUI process. Both contexts
  // here share one durable backend, so using storage.store for the collapse
  // toggle would flip the other terminal too (the reported bug).
  const [sharedDurable, setSharedDurable] = createStore({ collapsed: false })
  let storeCalls = 0
  const memories: { collapsed: boolean }[] = []
  const renders: ((input: { sessionID: string }) => any)[] = []
  const makeTerminalContext = () => {
    const [memoryState, setMemoryState] = createStore({ collapsed: false })
    memories.push(memoryState)
    return makeContext({
      storage: {
        store: () => {
          storeCalls++
          return [sharedDurable, async (mutation: (draft: object) => void) => setSharedDurable(produce(mutation))]
        },
        memory: () => [memoryState, (mutation: (draft: object) => void) => setMemoryState(produce(mutation))],
      },
      skills: () => [{ name: "alpha", content: "# Alpha" }],
      slot: (options) => {
        renders.push(options.render)
        return () => {}
      },
    })
  }

  const cleanupA = plugin.setup!(makeTerminalContext()) as () => void
  const cleanupB = plugin.setup!(makeTerminalContext()) as () => void
  const view = await testRender(() => (
    <box width="100%" height={12}>
      <scrollbox>{renders[0]({ sessionID: "session-1" })}</scrollbox>
    </box>
  ), { width: 40, height: 16 })
  try {
    await view.waitForFrame((frame) => frame.includes("alpha") && frame.includes("▼ Skills"))
    // Collapse in the first terminal…
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▶ Skills"))
    // …the second terminal keeps its own state, and no shared durable write happened.
    expect(memories[0].collapsed).toBe(true)
    expect(memories[1].collapsed).toBe(false)
    expect(storeCalls).toBe(0)
  } finally {
    cleanupA()
    cleanupB()
    view.renderer.destroy()
  }
})

test("preview dialog renders wrapped description and body without title or overlap", async () => {
  // Regression: the description used to be a wrapping <text> that lays out as
  // one line but draws every wrapped line, overwriting the dialog contents.
  let dialogRender!: () => any
  const renders: ((input: { sessionID: string }) => any)[] = []
  const context = makeContext({
    skills: () => [{
      name: "find-skills",
      description: `Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", or express interest in extending capabilities.`,
      content: "# Find Skills\n\nBody paragraph.\n",
    }],
    onDialogShow: (render) => { dialogRender = render },
    slot: (options) => {
      renders.push(options.render)
      return () => {}
    },
  })
  const cleanup = plugin.setup!(context) as () => void
  const view = await testRender(() => (
    <box width="100%" height={12}>
      <scrollbox>{renders[0]({ sessionID: "session-1" })}</scrollbox>
    </box>
  ), { width: 110, height: 24 })
  try {
    await view.waitForFrame((frame) => frame.includes("find-skills"))
    await view.mockMouse.click(4, 1)
    const dialogView = await testRender(() => (
      <box width="100%" height={20}>{dialogRender()}</box>
    ), { width: 110, height: 24 })
    try {
      await dialogView.waitForFrame((frame) => frame.includes("Find Skills"))
      const frame = dialogView.captureCharFrame()
      expect(frame).toContain("Helps users discover and install agent skills")
      expect(frame).toContain("Find Skills")
      expect(frame).toContain("Body paragraph.")
      expect(frame).not.toContain("find-skills") // no injected title
    } finally {
      dialogView.renderer.destroy()
    }
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test("preview renders the raw SKILL.md without title or rule lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-tui-test-"))
  const skillPath = join(dir, "SKILL.md")
  writeFileSync(
    skillPath,
    `---\nname: find-skills\ndescription: Helps users discover and install agent skills.\n---\n\n# Find Skills\n\nBody paragraph.\n`,
  )
  let dialogRender!: () => any
  const renders: ((input: { sessionID: string }) => any)[] = []
  const context = makeContext({
    skills: () => [{
      name: "find-skills",
      description: "Helps users discover and install agent skills.",
      path: skillPath,
      content: "# Find Skills\n\nBody paragraph.\n",
    }],
    onDialogShow: (render) => { dialogRender = render },
    slot: (options) => {
      renders.push(options.render)
      return () => {}
    },
  })
  const cleanup = plugin.setup!(context) as () => void
  const view = await testRender(() => (
    <box width="100%" height={12}>
      <scrollbox>{renders[0]({ sessionID: "session-1" })}</scrollbox>
    </box>
  ), { width: 110, height: 24 })
  try {
    await view.waitForFrame((frame) => frame.includes("find-skills"))
    await view.mockMouse.click(4, 1)
    const dialogView = await testRender(() => (
      <box width="100%" height={20}>{dialogRender()}</box>
    ), { width: 110, height: 24 })
    try {
      await dialogView.waitForFrame((frame) => frame.includes("Find Skills"))
      const frame = dialogView.captureCharFrame()
      // The raw file renders verbatim: frontmatter labels visible, no
      // injected title, and the `---` fences never become a rule line.
      expect(frame).toContain("name: find-skills")
      expect(frame).toContain("description: Helps users discover and install agent skills.")
      expect(frame).toContain("Find Skills")
      expect(frame).toContain("Body paragraph.")
      expect(frame).not.toContain("─")
      expect(frame).not.toContain("---")
    } finally {
      dialogView.renderer.destroy()
    }
  } finally {
    cleanup()
    rmSync(dir, { recursive: true, force: true })
    view.renderer.destroy()
  }
})
