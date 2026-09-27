/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { CodeRenderable, RGBA } from "@opentui/core"
import type { Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import type { Plugin } from "@opencode/plugin/tui"

const { default: plugin } = await import(process.env.PLUGIN_TEST_ENTRY ?? "../src/tui")

const white = RGBA.fromHex("#ffffff")

/** Plugin context stand-in; tests override only what they assert on. */
const makeContext = (overrides: {
  storage?: Record<string, unknown>
  messages?: () => unknown[]
  skills?: (location?: any) => unknown[]
  skillSync?: (location: any) => Promise<void>
  messageList?: (input: any) => Promise<any>
  toastShow?: (options: any) => void
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
  client: { message: { list: overrides.messageList ?? (async () => ({ data: [], cursor: {} })) } },
  data: {
    session: { message: { list: () => overrides.messages?.() ?? [] } },
    location: { skill: {
      sync: overrides.skillSync ?? (async () => {}),
      list: (location: any) => overrides.skills?.(location) ?? [],
    } },
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
    toast: { show: overrides.toastShow ?? (() => {}) },
  },
} as unknown as Plugin.Context)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function waitForMarkdown(view: Awaited<ReturnType<typeof testRender>>) {
  // Worker-backed highlighting can outlive render-idle. Wait for the public
  // completion promises instead of adding sleeps/retries to a frame assertion.
  await view.renderOnce()
  const pending: Promise<void>[] = []
  const visit = (node: Renderable) => {
    if (node instanceof CodeRenderable) pending.push(node.highlightingDone)
    for (const child of node.getChildren()) visit(child)
  }
  visit(view.renderer.root)
  await Promise.all(pending)
}

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
    await view.mockMouse.click(4, 0, 2)
    await view.flush()
    expect(view.captureCharFrame()).toContain("▼ Skills")
    await view.mockMouse.click(4, 1, 2)
    expect(dialogShown).toBe(0)
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
      await waitForMarkdown(dialogView)
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
      await waitForMarkdown(dialogView)
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


test("a stale discovery cannot replace the latest location's skills", async () => {
  const first = deferred<void>()
  const second = deferred<void>()
  const events = new Map<string, (event: any) => void>()
  let render!: (input: { sessionID: string }) => any
  let calls = 0
  const context = makeContext({
    skillSync: () => (++calls === 1 ? first.promise : second.promise),
    skills: (location) => [{ name: location.directory === "new" ? "beta" : "alpha", content: "" }],
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
    slot: (claim) => { render = claim.render; return () => {} },
  })
  const cleanup = plugin.setup!(context) as () => void
  const view = await testRender(() => <box>{render({ sessionID: "session-1" })}</box>, { width: 60, height: 12 })
  try {
    Object.assign(context, { location: { directory: "new" } })
    events.get("project.updated")!({ data: {} })
    second.resolve()
    await Bun.sleep(0)
    await view.waitForFrame((frame) => frame.includes("beta"))
    first.resolve()
    await Bun.sleep(0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("beta")
    expect(view.captureCharFrame()).not.toContain("alpha")
    expect(calls).toBe(2)
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test("stale discovery errors do not notify after a newer refresh succeeds", async () => {
  const pending = deferred<void>()
  const toasts: unknown[] = []
  let refresh!: () => void
  let calls = 0
  const cleanup = plugin.setup!(makeContext({
    skillSync: () => ++calls === 1 ? pending.promise : Promise.resolve(),
    skills: () => [{ name: "alpha", content: "" }],
    toastShow: (options) => toasts.push(options),
    on: (name, callback) => {
      if (name === "skill.updated") refresh = () => callback({ data: {} })
      return () => {}
    },
  })) as () => void
  try {
    refresh()
    await Bun.sleep(0)
    pending.reject(new Error("stale failure"))
    await Bun.sleep(0)
    expect(toasts).toEqual([])
  } finally { cleanup() }
})

test("successful initial discovery does not schedule another refresh", async () => {
  let calls = 0
  const cleanup = plugin.setup!(makeContext({
    skillSync: async () => { calls++ },
    skills: () => [{ name: "alpha", content: "" }],
  })) as () => void
  try {
    await Bun.sleep(300)
    expect(calls).toBe(1)
  } finally { cleanup() }
})

test("empty initial discovery gets one delayed retry", async () => {
  let calls = 0
  const cleanup = plugin.setup!(makeContext({
    skillSync: async () => { calls++ },
    skills: () => calls === 1 ? [] : [{ name: "alpha", content: "" }],
  })) as () => void
  try {
    await Bun.sleep(300)
    expect(calls).toBe(2)
    await Bun.sleep(300)
    expect(calls).toBe(2)
  } finally { cleanup() }
})

test("deleting a session invalidates its pending history and live scans", async () => {
  const pending = deferred<any>()
  const events = new Map<string, (event: any) => void>()
  const [revision, setRevision] = createSignal(0)
  let render!: (input: { sessionID: string }) => any
  let historyCalls = 0
  const cleanup = plugin.setup!(makeContext({
    skills: () => [{ name: "alpha", content: "" }],
    messages: () => { revision(); return [{ type: "skill", name: "alpha" }] },
    messageList: () => { historyCalls++; return pending.promise },
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
    slot: (claim) => { render = claim.render; return () => {} },
  })) as () => void
  const view = await testRender(() => <box>{render({ sessionID: "session-1" })}</box>, { width: 60, height: 12 })
  try {
    await view.waitForFrame((frame) => frame.includes("alpha"))
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("1 loaded 1 available"))
    events.get("session.deleted")!({ data: { sessionID: "session-1" } })
    pending.resolve({ data: [{ type: "skill", name: "alpha" }], cursor: { next: "older" } })
    await Bun.sleep(0)
    setRevision(1)
    await view.waitForFrame((frame) => frame.includes("0 loaded 1 available"))
    expect(historyCalls).toBe(1)
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test("cleanup discards pending discovery and history without toasts or more pages", async () => {
  const discovery = deferred<void>()
  const history = deferred<any>()
  const toasts: unknown[] = []
  let render!: (input: { sessionID: string }) => any
  let historyCalls = 0
  const cleanup = plugin.setup!(makeContext({
    skillSync: () => discovery.promise,
    messageList: () => { historyCalls++; return history.promise },
    toastShow: (options) => toasts.push(options),
    slot: (claim) => { render = claim.render; return () => {} },
  })) as () => void
  const view = await testRender(() => <box>{render({ sessionID: "session-1" })}</box>, { width: 60, height: 12 })
  try {
    cleanup()
    discovery.reject(new Error("offline"))
    history.resolve({ data: [{ type: "skill", name: "alpha" }], cursor: { next: "older" } })
    await Bun.sleep(0)
    expect(toasts).toEqual([])
    expect(historyCalls).toBe(1)
  } finally { view.renderer.destroy() }
})


test("a slow initial discovery is not raced by the startup retry timer", async () => {
  const pending = deferred<void>()
  let calls = 0
  const cleanup = plugin.setup!(makeContext({
    skillSync: () => { calls++; return pending.promise },
    skills: () => [{ name: "alpha", content: "" }],
  })) as () => void
  try {
    await Bun.sleep(300)
    expect(calls).toBe(1)
    pending.resolve()
    await Bun.sleep(300)
    expect(calls).toBe(1)
  } finally { cleanup() }
})

test("a host refresh supersedes the pending empty-startup retry", async () => {
  let calls = 0
  let refresh!: () => void
  const cleanup = plugin.setup!(makeContext({
    skillSync: async () => { calls++ },
    skills: () => calls === 1 ? [] : [{ name: "alpha", content: "" }],
    on: (name, callback) => {
      if (name === "skill.updated") refresh = () => callback({ data: {} })
      return () => {}
    },
  })) as () => void
  try {
    await Bun.sleep(0)
    refresh()
    await Bun.sleep(300)
    expect(calls).toBe(2)
  } finally { cleanup() }
})

test("historical loads restore once per session and stay isolated on revisit", async () => {
  const [sessionID, setSessionID] = createSignal("session-1")
  const calls: string[] = []
  let render!: (input: { sessionID: string }) => any
  const cleanup = plugin.setup!(makeContext({
    skills: () => [{ name: "alpha", content: "" }, { name: "beta", content: "" }],
    messageList: async (input) => {
      calls.push(input.sessionID)
      return {
        data: [{ type: "skill", name: input.sessionID === "session-1" ? "beta" : "alpha" }],
        cursor: {},
      }
    },
    slot: (claim) => { render = claim.render; return () => {} },
  })) as () => void
  const view = await testRender(() => <box>{render({ sessionID: sessionID() })}</box>, { width: 60, height: 12 })
  try {
    await view.waitForFrame((frame) => frame.includes("alpha") && frame.indexOf("beta") < frame.indexOf("alpha"))
    setSessionID("session-2")
    await Bun.sleep(0)
    await view.waitForFrame((frame) => frame.includes("beta") && frame.indexOf("alpha") < frame.indexOf("beta"))
    setSessionID("session-1")
    await view.waitForFrame((frame) => frame.includes("alpha") && frame.indexOf("beta") < frame.indexOf("alpha"))
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("1 loaded 2 available"))
    expect(calls).toEqual(["session-1", "session-2"])
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test("late successful discovery cannot update an unloaded plugin", async () => {
  const pending = deferred<void>()
  let render!: (input: { sessionID: string }) => any
  const cleanup = plugin.setup!(makeContext({
    skillSync: () => pending.promise,
    skills: () => [{ name: "alpha", content: "" }],
    slot: (claim) => { render = claim.render; return () => {} },
  })) as () => void
  const view = await testRender(() => <box>{render({ sessionID: "session-1" })}</box>, { width: 60, height: 12 })
  try {
    await view.waitForFrame((frame) => frame.includes("No skills available"))
    cleanup()
    pending.resolve()
    await Bun.sleep(0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("No skills available")
    expect(view.captureCharFrame()).not.toContain("alpha")
  } finally { view.renderer.destroy() }
})
