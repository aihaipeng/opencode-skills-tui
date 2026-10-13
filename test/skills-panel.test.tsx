/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Show, createComponent, createRoot, createSignal, getOwner, onCleanup } from "solid-js"
import { createData } from "@opencode/client/solid"
import { CliRenderEvents, CodeRenderable, RGBA, Selection, TextAttributes, TextBufferRenderable, TextTableRenderable } from "@opentui/core"
import { TestRecorder } from "@opentui/core/testing"
import type { KeyEvent, Renderable, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import type { Plugin } from "@opencode/plugin/tui"
import { PluginContextProvider } from "@opencode/plugin/tui"
import type { KeymapLayer } from "@opencode/plugin/tui/context"
import { estimateSkillTokens, estimateSkillListingTotal, formatTokenCount } from "../src/skill-data"

const { default: plugin } = await import(process.env.PLUGIN_TEST_ENTRY ?? "../src/tui")

/** Mock server's empty directory sample plus the registered, not preview, payloads. */
const previewStatsLabel = (chars: number, skill: Parameters<typeof estimateSkillTokens>[0]) =>
  `stats: chars ${chars.toLocaleString("en-US")} · list entry ${tokenLabel(estimateSkillTokens(skill, "listing"))} · load cost ${tokenLabel(estimateSkillTokens({ ...skill, fileSamples: [] }, "load-delta"))} · total cost ${tokenLabel(estimateSkillTokens({ ...skill, fileSamples: [] }, "loaded-total"))}`
const tokenLabel = (tokens: number | undefined) => tokens === undefined ? "-" : `~${formatTokenCount(tokens)} tok`

const white = RGBA.fromHex("#ffffff")

/** Plugin context stand-in; tests override only what they assert on. */
const makeContext = (overrides: {
  storage?: Record<string, unknown>
  prefs?: Record<string, unknown>
  messages?: (sessionID: string) => unknown[]
  skills?: (location?: any) => unknown[]
  skillSync?: (location: any) => Promise<void>
  agentSync?: (location: any) => Promise<void>
  session?: (sessionID: string) => any
  agents?: (location: any) => any[] | undefined
  messageList?: (input: any) => Promise<any>
  fileList?: (input: any, options?: any) => Promise<any>
  toastShow?: (options: any) => void
  clearSelection?: () => void
  on?: (name: string, callback: (event: any) => void) => () => void
  slot?: (options: { render: (input: { sessionID: string }) => any }) => () => void
  dialogShow?: () => void
  onDialogShow?: (render: () => any) => void
  keymap?: Partial<Plugin.Context["keymap"]>
} = {}) => {
  // The host keeps reactive catalogs per location, not a single UI-wide list.
  const [revision, setRevision] = createSignal(0)
  const catalogs = new Map<string, unknown[]>()
  const defaultAgents = [{ id: "build", permissions: [] }]
  const ready = new Set<string>()
  const pending = new Map<string, Promise<void>>()
  const key = (location: any) => JSON.stringify([location.directory, location.workspaceID])
  const skill = {
    sync(location: any): Promise<void> {
      const id = key(location)
      if (pending.has(id)) return pending.get(id)!
      if (ready.has(id)) return Promise.resolve()
      const request = Promise.resolve(overrides.skillSync?.(location)).then(() => {
        catalogs.set(id, overrides.skills?.(location) ?? [])
        ready.add(id)
        setRevision((value) => value + 1)
      }).finally(() => pending.delete(id))
      pending.set(id, request)
      return request
    },
    list(location: any) { revision(); return catalogs.get(key(location)) },
    invalidate(location: any) { ready.delete(key(location)) },
  }
  const context = {
    location: { directory: process.cwd() },
    themeMode: "dark",
    renderer: { clearSelection: overrides.clearSelection ?? (() => {}) },
    storage: {
      store: (_key: string, options: { initial: object }) => {
        const [state, setState] = createStore(options.initial)
        return [state, async (mutation: (draft: object) => void) => { setState(produce(mutation)) }]
      },
      memory: (_key: string, options: { initial: object }) => {
        const [state, setState] = createStore({ ...options.initial, ...overrides.prefs })
        return [state, (mutation: (draft: object) => void) => setState(produce(mutation))]
      },
      ...overrides.storage,
    },
    theme: {
      hue: { accent: { 200: white }, interactive: { 200: white } },
      categorical: [{ 200: white }],
      background: { base: white, action: { primary: { focused: white } } },
      text: { base: white, muted: white, feedback: { success: { base: white }, error: { base: RGBA.fromHex("#ff5555") } } },
      markdown: {
        text: white, heading: white, strong: white, emphasis: white,
        listItem: white, blockQuote: white, code: white, link: white, linkText: white,
      },
      surface: () => context.theme,
    },
    client: {
      message: { list: overrides.messageList ?? (async () => ({ data: [], cursor: {} })) },
      file: { list: overrides.fileList ?? (async () => ({ location: context.location, data: [] })) },
    },
    keymap: { layer: () => {}, commands: () => [], dispatch: () => {}, ...overrides.keymap },
    data: {
      session: {
        get: (sessionID: string) => overrides.session ? overrides.session(sessionID) : { agent: "build", location: context.location },
        message: { list: (sessionID: string) => overrides.messages?.(sessionID) ?? [] },
      },
      location: {
        default: () => ({ directory: process.cwd() }),
        skill,
        agent: {
          sync: async (location: any) => { await overrides.agentSync?.(location) },
          list: (location: any) => overrides.agents ? overrides.agents(location) : defaultAgents,
        },
      },
      on: (name: string, callback: (event: any) => void) => overrides.on?.(name, (event) => {
        if (name === "skill.updated") skill.invalidate(event.location ?? context.location)
        callback(event)
      }) ?? (() => {}),
    },
    ui: {
      slot: overrides.slot ?? (() => () => {}),
      dialog: {
        show: (render: () => any) => {
          overrides.onDialogShow?.(render)
          overrides.dialogShow?.()
        },
        set: () => {},
        clear: () => {},
      },
      router: { current: () => ({ type: "session", sessionID: "session-1" }) },
      toast: { show: overrides.toastShow ?? (() => {}) },
    },
  }
  return context as unknown as Plugin.Context
}

/** Fixed-session panels share a lifecycle; layout and session-switch tests stay explicit. */
async function withPanel(
  context: Plugin.Context,
  check: (view: Awaited<ReturnType<typeof testRender>>) => Promise<void>,
  { width = 60, height = 12, sessionID = "session-1" } = {},
) {
  let render!: (input: { sessionID: string }) => any
  Object.assign(context.ui, { slot: (claim: { render: typeof render }) => { render = claim.render; return () => {} } })
  const cleanup = plugin.setup!(context) as () => void
  let view: Awaited<ReturnType<typeof testRender>> | undefined
  try {
    view = await testRender(() => createComponent(render, { sessionID }), { width, height })
    await check(view)
  } finally {
    cleanup()
    view?.renderer.destroy()
  }
}

function cell(view: Awaited<ReturnType<typeof testRender>>, id: string) {
  const node = view.renderer.root.findDescendantById(id)!
  return view.captureCharFrame().split("\n")[node.y].slice(node.x, node.x + node.width).trim()
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

/** Minimal host: modal keymap lifetime, composer refocus, and the native /skills callback. */
async function withSider(
  context: Plugin.Context,
  check: (view: Awaited<ReturnType<typeof testRender>>, host: {
    open: () => void
    escape: () => Promise<void>
    prompt: TextareaRenderable
    draft: { text: string; files: unknown[]; skills: any[] }
    dispatches: string[]
    submits: () => number
    cleanup: () => void
    change: (setting: string, direction?: "left" | "right" | "enter") => Promise<void>
  }) => Promise<void>,
  { width = 80, height = 26, kittyKeyboard = false, nativeReady = true as boolean | (() => boolean), onNativeOpen = () => {}, text = "keep @file ", shell = false, sessionID = () => "session-1" } = {},
) {
  const [dialog, setDialog] = createSignal<() => any>()
  const layers = new Set<() => KeymapLayer>()
  const dispatches: string[] = []
  const draft = { text, files: [{ uri: "file:///keep.txt" }], skills: [] as any[] }
  let prompt!: TextareaRenderable
  let sidebar!: (input: { sessionID: string }) => any
  let submits = 0
  const commands = () => [...layers].map((layer) => layer())
    .filter((layer) => (layer.mode === "global" || (layer.mode ?? "base") === (dialog() ? "modal" : "base")))
    .filter((layer) => typeof layer.enabled === "function" ? layer.enabled() : layer.enabled !== false)
    .toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .flatMap((layer) => layer.commands ?? [])
    .concat(dialog() ? [{ bind: "escape", run: () => setDialog(undefined) }] : [])

  function NativeSkills() {
    // Same input order and onSelect semantics as the v2.0.24 native DialogSkill.
    const registered = context.data.location.skill.list(context.location) ?? []
    let index = 0
    context.keymap.layer(() => ({ mode: "modal", commands: [
      { id: "dialog.select.home", run: () => { index = 0 } },
      { id: "dialog.select.next", run: () => { index = (index + 1) % registered.length } },
      { id: "dialog.select.submit", run: () => {
        const id = registered[index]?.id
        if (id && !draft.skills.some((skill) => skill.id === id)) {
          const mentionText = `@${id}`
          const start = prompt.cursorOffset
          prompt.insertText(mentionText + " ")
          draft.text = prompt.plainText
          draft.skills.push({ id, mention: { start, end: start + mentionText.length, text: mentionText } })
        }
        context.ui.dialog.clear()
      } },
    ] }))
    return <Show when={typeof nativeReady === "function" ? nativeReady() : nativeReady} fallback={<text>Loading native skills…</text>}>
      <input ref={(value) => {
        value.traits = { status: "FILTER" }
        queueMicrotask(() => { if (!value.isDestroyed) value.focus() })
      }} placeholder="Native skills" />
    </Show>
  }

  Object.assign(context, { keymap: {
    layer: (factory: () => KeymapLayer) => {
      layers.add(factory)
      if (getOwner()) onCleanup(() => layers.delete(factory))
    },
    commands: () => [...commands(), ...(!dialog() ? [{ id: "prompt.skills", run: () => { setDialog(() => NativeSkills); onNativeOpen() } }] : [])],
    dispatch: (id: string) => {
      dispatches.push(id)
      context.keymap.commands().find((command) => command.id === id)?.run()
    },
  } })
  Object.assign(context.ui, {
    slot: (claim: { render: typeof sidebar }) => { sidebar = claim.render; return () => {} },
    dialog: {
      show: (render: () => any) => setDialog(() => () => <PluginContextProvider value={context}>{render()}</PluginContextProvider>),
      clear: () => setDialog(undefined),
      set: () => {},
    },
  })
  Object.assign(context.theme, {
    hue: { ...context.theme.hue, accent: { 200: RGBA.fromHex("#c792ea") } },
    background: { base: RGBA.fromHex("#161b22"), formfield: { focused: RGBA.fromHex("#21262d") }, action: { primary: { focused: RGBA.fromHex("#fab283") } } },
    text: { ...context.theme.text, action: { primary: { focused: RGBA.fromHex("#161b22") } }, formfield: { focused: white } },
  })
  const pluginCleanup = plugin.setup!(context) as () => void
  let stopped = false
  const cleanup = () => { if (!stopped) { stopped = true; pluginCleanup() } }
  const view = await testRender(() => {
    Object.assign(context, { renderer: useRenderer() })
    return <box width="100%" height="100%">
      {createComponent(sidebar, { get sessionID() { return sessionID() } })}
      <textarea ref={(value) => { prompt = value; Object.assign(value, { traits: { owner: "opencode", role: "prompt", capture: shell ? undefined : ["tab"], status: shell ? "SHELL" : undefined } }) }}
        initialValue={text} height={2} focused={!dialog()} onSubmit={() => { submits++ }} />
      <Show when={dialog()} keyed>{(render) => <box position="absolute" top={0} width="100%" height="100%" zIndex={100} backgroundColor="#161b22">{render}</box>}</Show>
    </box>
  }, { width, height, kittyKeyboard })
  const onKey = (event: KeyEvent) => {
    const key = [event.ctrl ? "ctrl" : "", event.shift ? "shift" : "", event.name].filter(Boolean).join("+")
    const command = commands().find((command) => typeof command.bind === "string" && command.bind.split(",").includes(key))
    if (!command) return
    event.preventDefault()
    event.stopPropagation()
    command.run(undefined, event)
  }
  view.renderer.keyInput.on("keypress", onKey)
  const open = () => context.keymap.dispatch("opencode-skills-tui.sider")
  // A bare ESC is an ambiguous sequence prefix; let its parser deadline expire.
  const escape = () => view.mockInput.pressKeys(["ESCAPE"], 100)
  const change = async (setting: string, direction: "left" | "right" | "enter" = "right") => {
    open()
    await view.waitForFrame((frame) => frame.includes("Skills Sidebar"))
    view.mockInput.pressKey("HOME")
    const index = ["switch", "scope", "token", "state", "preview", "mention"].indexOf(setting)
    expect(index).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < index; i++) view.mockInput.pressArrow("down")
    if (direction === "enter") view.mockInput.pressEnter()
    else view.mockInput.pressArrow(direction)
    await view.flush()
    await escape()
    await view.flush()
  }
  try {
    await view.flush()
    await check(view, { open, escape, prompt, draft, dispatches, submits: () => submits, cleanup, change })
  } finally {
    cleanup()
    view.renderer.keyInput.off("keypress", onKey)
    view.renderer.destroy()
    layers.clear()
  }
}

test("left and right sidebar headers toggle on release without opening settings", async () => {
  let render!: (input: { sessionID: string }) => any
  let unregistered = false
  let dialogShown = 0
  let clearSelectionCalls = 0
  const events = new Map<string, (event: any) => void>()
  // Reactive stand-in for the host's message store: the plugin rescans it
  // whenever the slot claim re-renders.
  const [sessionID] = createSignal("session-1")
  const [messageRevision, setMessageRevision] = createSignal(0)
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
    prefs: { mention: "off" },
    messages: () => { messageRevision(); return messages },
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", content: "# Alpha" }, { id: "beta", name: "beta", description: "Beta", content: "# Beta" }],
    on: (name, callback) => {
      events.set(name, callback)
      return () => { events.delete(name) }
    },
    slot: (options) => {
      render = options.render
      return () => { unregistered = true }
    },
    dialogShow: () => { dialogShown++ },
    clearSelection: () => { clearSelectionCalls++ },
  })
  const cleanup = plugin.setup!(context) as () => void
  const view = await testRender(() => (
    <box width="100%" height={12}>
      <scrollbox>{createComponent(render, { get sessionID() { return sessionID() } })}</scrollbox>
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
    setMessageRevision(1)
    for (const button of [0, 2] as const) {
      // Both buttons on the arrow or label toggle once per release, never on press.
      for (const x of [0, 4]) {
        await view.mockMouse.pressDown(x, 0, button)
        expect(view.captureCharFrame()).toContain("▼ Skills")
        expect(dialogShown).toBe(0)
        await view.mockMouse.release(x, 0, button)
        await view.flush()
        expect(view.captureCharFrame()).toContain("▶ Skills")
        await view.waitForFrame((frame) => frame.includes("▶ Skills"))
        expect(view.captureCharFrame()).toContain("2 loaded · 2 visible")
        expect(view.captureCharFrame()).not.toContain("alpha")
        await view.mockMouse.click(x, 0, 1)
        await view.flush()
        expect(view.captureCharFrame()).toContain("▶ Skills")
        expect(dialogShown).toBe(0)
        await view.mockMouse.click(x, 0, button)
        await view.waitForFrame((frame) => frame.includes("▼ Skills") && frame.includes("alpha"))
        expect(dialogShown).toBe(0)
      }
    }
    expect(clearSelectionCalls).toBe(0)
    for (const button of [0, 2] as const) {
      const before = dialogShown
      await view.mockMouse.pressDown(4, 1, button)
      expect(dialogShown).toBe(before)
      await view.mockMouse.release(4, 1, button)
      await view.flush()
      expect(dialogShown).toBe(before + (button === 0 ? 1 : 0))
      // Clear leftover selections so the host backdrop can dismiss on one click.
      expect(clearSelectionCalls).toBe(dialogShown)
      expect(view.captureCharFrame()).toContain("▼ Skills (2 loaded · 2 visible)")
    }
    // Middle clicks keep their previous no-op behavior.
    await view.mockMouse.click(4, 0, 1)
    await view.mockMouse.click(4, 1, 1)
    await view.flush()
    expect(view.captureCharFrame()).toContain("▼ Skills")
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
  let durableWrites = 0
  const memories: { collapsed: boolean }[] = []
  const renders: ((input: { sessionID: string }) => any)[] = []
  const makeTerminalContext = () => {
    const [memoryState, setMemoryState] = createStore({ collapsed: false })
    memories.push(memoryState)
    return makeContext({
      storage: {
        store: () => {
          storeCalls++
          return [sharedDurable, async (mutation: (draft: object) => void) => {
            durableWrites++
            setSharedDurable(produce(mutation))
          }]
        },
        memory: () => [memoryState, (mutation: (draft: object) => void) => setMemoryState(produce(mutation))],
      },
      skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", content: "# Alpha" }],
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
    expect(storeCalls).toBe(2)
    expect(durableWrites).toBe(0)
    expect(sharedDurable.collapsed).toBe(false)
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
  const skill = {
    id: "find-skills",
    name: "find-skills",
    description: `Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", or express interest in extending capabilities.`,
    content: "# Find Skills\n\nBody paragraph.\n",
  }
  const context = makeContext({
    skills: () => [skill],
    onDialogShow: (render) => { dialogRender = render },
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("find-skills"))
    await view.mockMouse.click(4, 1)
    const dialogView = await testRender(() => (
      <box width="100%" height={20}>{dialogRender()}</box>
    ), { width: 110, height: 24 })
    try {
      await waitForMarkdown(dialogView)
      await dialogView.waitForFrame((frame) => frame.includes("Find Skills"))
      const frame = dialogView.captureCharFrame()
      expect(frame.split("\n")[0].trim()).toBe("id: find-skills")
      expect(frame.split("\n")[1].trim()).toBe(previewStatsLabel(195, skill))
      expect(frame.split("\n")[2].trim()).toBe("path: -")
      expect(frame).toContain("Helps users discover and install agent skills")
      expect(frame).toContain("Find Skills")
      expect(frame).toContain("Body paragraph.")
      expect(frame).not.toContain("# find-skills") // no injected title
    } finally {
      dialogView.renderer.destroy()
    }
  }, { width: 110, height: 24 })
})

for (const initialMode of ["light", "dark"] as const) {
  test(`sidebar and preview colors follow ${initialMode} mode, including native text selections and live theme changes`, async () => {
    let dialogRender!: () => any
    const [mode, setMode] = createSignal<"light" | "dark">(initialMode)
    const palettes = {
      light: { text: "#24292f", background: "#f6f8fa", muted: "#57606a", link: "#0969da", code: "#8250df" },
      dark: { text: "#c9d1d9", background: "#161b22", muted: "#8b949e", link: "#58a6ff", code: "#d2a8ff" },
    }
    const palette = () => palettes[mode()]
    const skill = {
      id: "alpha", name: "alpha", description: "",
      content: "Paragraph with `inline` and [link](https://example.com).\n\n# Heading\n\n> Quote\n\n- Item\n\n```text\nCode block\n```\n\n| Name | Value |\n| ---- | ----- |\n| Cell | `CellCode` |\n",
    }
    const context = makeContext({ skills: () => [skill], onDialogShow: (render) => { dialogRender = render } })
    Object.defineProperty(context, "themeMode", { get: mode })
    const theme = context.theme
    Object.defineProperty(context, "theme", { get: () => ({
      ...theme,
      text: { ...theme.text, base: RGBA.fromHex(palette().text), muted: RGBA.fromHex(palette().muted) },
      markdown: {
        ...theme.markdown,
        text: RGBA.fromHex(palette().text), heading: RGBA.fromHex(palette().text),
        strong: RGBA.fromHex(palette().text), emphasis: RGBA.fromHex(palette().text),
        listItem: RGBA.fromHex(palette().text), blockQuote: RGBA.fromHex(palette().text),
        code: RGBA.fromHex(palette().code), link: RGBA.fromHex(palette().link), linkText: RGBA.fromHex(palette().link),
      },
      // The dialog surface differs from the base background on purpose.
      surface: () => ({ ...theme, background: { ...theme.background, base: RGBA.fromHex(palette().background) } }),
    }) })
    await withPanel(context, async (view) => {
      await view.waitForFrame((frame) => frame.includes("alpha"))
      const sidebarSpans = view.captureSpans().lines.flatMap((line) => line.spans)
      for (const text of ["Skills", "▼", "alpha", "•"]) {
        expect(sidebarSpans.find((span) => span.text.includes(text))!.fg.equals(RGBA.fromHex(initialMode === "light" ? "#000000" : "#ffffff"))).toBe(true)
      }
      await view.mockMouse.click(4, 1)
      const dialogView = await testRender(() => dialogRender(), { width: 110, height: 40 })
      const nodes: (TextBufferRenderable | TextTableRenderable)[] = []
      const visit = (node: Renderable) => {
        if (node instanceof TextBufferRenderable || node instanceof TextTableRenderable) nodes.push(node)
        for (const child of node.getChildren()) visit(child)
      }
      try {
        for (const nextMode of [initialMode, initialMode === "light" ? "dark" : "light", initialMode] as const) {
          setMode(nextMode)
          // Markdown propagates styles on the next frame; existing highlighters must stay valid meanwhile.
          for (const node of nodes) {
            if (node instanceof CodeRenderable) expect(() => node.syntaxStyle.getStyle("default")).not.toThrow()
          }
          await waitForMarkdown(dialogView)
          await dialogView.flush()
          const samples = ["id: alpha", "stats:", "path:", "provided by plugin", "Paragraph", "inline", "link", "Heading", "Quote", "Item", "Code block", "Cell", "CellCode"]
          const foreground = (text: string) => /id:|stats:|path:|provided by plugin/.test(text) ? palette().muted
            : text === "inline" || text === "CellCode" ? palette().code : text === "link" ? palette().link : palette().text
          const spans = () => dialogView.captureSpans().lines.flatMap((line) => line.spans)
          for (const text of samples) {
            const span = spans().find((span) => span.text.includes(text))!
            expect({ text, mode: nextMode, fg: span.fg.toInts(), bg: span.bg.toInts() }).toEqual({
              text, mode: nextMode, fg: RGBA.fromHex(foreground(text)).toInts(), bg: RGBA.fromHex(palette().background).toInts(),
            })
          }
          nodes.length = 0
          visit(dialogView.renderer.root)
          const first = nodes[0]
          const last = nodes.at(-1)!
          // Exercise native selection painting directly; mouse selection is disabled in testRender.
          const selection = new Selection(first, { x: first.x, y: first.y }, { x: last.x + last.width - 1, y: last.y + last.height - 1 })
          const frame = dialogView.captureCharFrame()
          for (const node of nodes) node.onSelectionChanged(selection)
          await dialogView.flush()
          expect(dialogView.captureCharFrame()).toBe(frame)
          for (const text of samples) {
            const span = spans().find((span) => span.text.includes(text))!
            expect({ text, mode: nextMode, fg: span.fg.toInts(), bg: span.bg.toInts() }).toEqual({
              text, mode: nextMode, fg: RGBA.fromHex(palette().background).toInts(), bg: RGBA.fromHex(foreground(text)).toInts(),
            })
          }
          const copied = nodes.map((node) => node.getSelectedText()).join("\n")
          for (const text of samples) expect(copied).toContain(text)
          for (const node of nodes) node.onSelectionChanged(null)
        }
      } finally {
        dialogView.renderer.destroy()
      }
    }, { width: 110, height: 40 })
  })
}

test("overview plugin data is italic and separated from the raw SKILL.md without title or frontmatter rules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-tui-test-"))
  const skillPath = join(dir, "SKILL.md")
  writeFileSync(
    skillPath,
    `---\nname: find-skills\ndescription: Helps users discover and install agent skills.\n---\n\n# Find Skills\n\nBody paragraph.\n`,
  )
  let dialogRender!: () => any
  const skill = {
    id: "find-skills",
    name: "find-skills",
    description: "Helps users discover and install agent skills.",
    path: skillPath,
    content: "# Find Skills\n\nBody paragraph.\n",
  }
  const context = makeContext({
    skills: () => [skill],
    onDialogShow: (render) => { dialogRender = render },
  })
  const purple = RGBA.fromHex("#bc8cff")
  const cyan = RGBA.fromHex("#39c5cf")
  const [color, setColor] = createSignal(purple)
  const [mutedColor, setMutedColor] = createSignal(RGBA.fromHex("#8b949e"))
  const theme = context.theme
  Object.defineProperty(context, "theme", { get: () => ({
    ...theme,
    categorical: [{ 200: color() }],
    text: { ...theme.text, base: RGBA.fromHex("#c9d1d9"), muted: mutedColor() },
  }) })
  try {
    await withPanel(context, async (view) => {
      await view.waitForFrame((frame) => frame.includes("find-skills"))
      await view.mockMouse.click(4, 1)
      const dialogView = await testRender(() => (
        <box width="100%" height={20}>{dialogRender()}</box>
      ), { width: 110, height: 24 })
      const recorder = new TestRecorder(dialogView.renderer)
      recorder.rec()
      try {
        await waitForMarkdown(dialogView)
        await dialogView.waitForFrame((frame) => frame.includes("Find Skills"))
        const frame = dialogView.captureCharFrame()
        const rows = frame.split("\n").map((line) => line.trim())
        expect(rows[0]).toBe("id: find-skills")
        expect(rows[1]).toBe(previewStatsLabel(110, skill))
        expect(rows[2]).toBe(`path: ${skillPath}`)
        expect(rows[3]).toMatch(/^-+ provided by plugin -{7}$/)
        expect(rows[4]).toBe("")
        expect(rows[5]).toBe("name: find-skills")
        const headerSpans = () => dialogView.captureSpans().lines.slice(0, 4).flatMap((line) => line.spans)
          .filter((span) => /id:|stats:|path:|provided by plugin/.test(span.text))
        const headerColors = () => headerSpans().map((span) => span.fg.equals(mutedColor()))
        expect(headerColors()).toEqual([true, true, true, true])
        expect(headerSpans().map((span) => (span.attributes & TextAttributes.ITALIC) !== 0)).toEqual([true, true, true, true])
        const bodySpans = dialogView.captureSpans().lines.slice(5).flatMap((line) => line.spans)
          .filter((span) => /name: find-skills|Body paragraph\./.test(span.text))
        expect(bodySpans.map((span) => (span.attributes & TextAttributes.ITALIC) !== 0)).toEqual([false, false])
        setColor(cyan)
        await dialogView.flush()
        expect(headerColors()).toEqual([true, true, true, true])
        setMutedColor(RGBA.fromHex("#6f767e"))
        await dialogView.flush()
        expect(headerColors()).toEqual([true, true, true, true])
        // The raw file renders verbatim: frontmatter labels visible, no
        // injected title, and the `---` fences never become a rule line.
        expect(frame).toContain("name: find-skills")
        expect(frame).toContain("description: Helps users discover and install agent skills.")
        expect(frame).toContain("Find Skills")
        expect(frame).toContain("Body paragraph.")
        expect(frame).not.toContain("─")
        expect(rows.filter((line) => /^-+$/.test(line))).toEqual([])
        await dialogView.flush()
        expect(recorder.recordedFrames.length).toBeGreaterThan(0)
        expect(recorder.recordedFrames.some(({ frame }) => /[█▀▄]/.test(frame))).toBe(false)
        const scrollbox = dialogView.renderer.root.getChildren()[0].getChildren()[0].getChildren()[0] as ScrollBoxRenderable
        expect(scrollbox.verticalScrollBar.visible).toBe(false)
        // A smaller terminal needs scrolling; initializing visibility must not disable it.
        dialogView.resize(110, 10)
        await dialogView.flush()
        expect(scrollbox.verticalScrollBar.visible).toBe(true)
        await dialogView.mockMouse.scroll(4, 2, "down")
        expect(scrollbox.scrollTop).toBeGreaterThan(0)
        dialogView.resize(110, 24)
        await dialogView.flush()
        expect(scrollbox.verticalScrollBar.visible).toBe(false)
      } finally {
        recorder.stop()
        dialogView.renderer.destroy()
      }
    }, { width: 110, height: 24 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test.each([
  "/builtin/opencode.md",
  "/builtin/report.md",
  "",
  String.raw`C:\Users\Example\.cache\opencode\npm\@dietrichgebert\ponytail@latest\1700000000000\node_modules\@dietrichgebert\ponytail\skills\ponytail\SKILL.md`,
  "/srv/.claude/skills/opencode/SKILL.md",
])("preview shows the API's registered path verbatim or wraps it: %s", async (path) => {
  let dialogRender!: () => any
  const skill = { id: "opencode", name: "opencode", description: "", path, content: "name: opencode\n\nBody paragraph." }
  const context = makeContext({
    // The API's path is shown verbatim, including virtual /builtin/* paths.
    skills: () => [skill],
    onDialogShow: (render) => { dialogRender = render },
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("opencode"))
    await view.mockMouse.click(4, 1)
    const dialogView = await testRender(() => dialogRender(), { width: 80, height: 24 })
    try {
      await waitForMarkdown(dialogView)
      await dialogView.waitForFrame((frame) => frame.includes("Body paragraph."))
      const rows = dialogView.captureCharFrame().split("\n").map((line) => line.trim())
      const nameRow = rows.indexOf("name: opencode")
      const pathRow = rows.findIndex((line) => line.startsWith("path:"))
      const separatorRow = rows.findIndex((line) => line.includes("provided by plugin"))
      expect(rows[0]).toBe("id: opencode")
      expect(rows.slice(1, pathRow).join("").replace(/\s/g, "")).toBe(previewStatsLabel(31, skill).replace(/\s/g, ""))
      expect(rows.slice(pathRow, separatorRow).join("")).toBe(`path: ${path || "-"}`)
      expect(separatorRow).toBe(nameRow - 2)
      expect(rows[nameRow - 1]).toBe("")
      expect(nameRow).toBeGreaterThanOrEqual(5)
      expect(rows).toContain("Body paragraph.")
    } finally { dialogView.renderer.destroy() }
  }, { width: 50, height: 24 })
})


test("a stale discovery cannot replace the latest location's skills", async () => {
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  const events = new Map<string, (event: any) => void>()
  let calls = 0
  const [location, setLocation] = createSignal({ directory: process.cwd() })
  const context = makeContext({
    session: () => ({ agent: "build", location: location() }),
    skillSync: () => (++calls === 1 ? first.promise : second.promise),
    skills: (location) => {
      const id = location.directory === "new" ? "beta" : "alpha"
      return [{ id, name: id, description: "Skill", content: "" }]
    },
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  await withPanel(context, async (view) => {
    Object.assign(context, { location: { directory: "new" } })
    setLocation({ directory: "new" })
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
  })
})

test("inactive-location discovery errors do not notify after a newer location succeeds", async () => {
  const pending = Promise.withResolvers<void>()
  const toasts: unknown[] = []
  let refresh!: () => void
  let calls = 0
  const cleanup = plugin.setup!(makeContext({
    skillSync: () => ++calls === 1 ? pending.promise : Promise.resolve(),
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", content: "" }],
    toastShow: (options) => toasts.push(options),
    on: (name, callback) => {
      if (name === "skill.updated") refresh = () => callback({ location: { directory: "new" }, data: {} })
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
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", content: "" }],
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
    skills: () => calls === 1 ? [] : [{ id: "alpha", name: "alpha", description: "Alpha", content: "" }],
  })) as () => void
  try {
    await Bun.sleep(300)
    expect(calls).toBe(2)
    await Bun.sleep(300)
    expect(calls).toBe(2)
  } finally { cleanup() }
})

test("deleting a session invalidates its pending history and live scans", async () => {
  const pending = Promise.withResolvers<any>()
  const events = new Map<string, (event: any) => void>()
  const [revision, setRevision] = createSignal(0)
  let historyCalls = 0
  const context = makeContext({
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", content: "" }],
    messages: () => { revision(); return [{ type: "skill", skill: "alpha", name: "alpha" }] },
    messageList: () => { historyCalls++; return pending.promise },
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("alpha"))
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("1 loaded · 1 visible"))
    events.get("session.deleted")!({ data: { sessionID: "session-1" } })
    pending.resolve({ data: [{ type: "skill", skill: "alpha", name: "alpha" }], cursor: { next: "older" } })
    await Bun.sleep(0)
    setRevision(1)
    await view.waitForFrame((frame) => frame.includes("0 loaded · 1 visible"))
    expect(historyCalls).toBe(1)
  })
})

test("cleanup discards pending discovery and history without toasts or more pages", async () => {
  const discovery = Promise.withResolvers<void>()
  const history = Promise.withResolvers<any>()
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
    history.resolve({ data: [{ type: "skill", skill: "alpha", name: "alpha" }], cursor: { next: "older" } })
    await Bun.sleep(0)
    expect(toasts).toEqual([])
    expect(historyCalls).toBe(1)
  } finally { view.renderer.destroy() }
})


test("a slow initial discovery is not raced by the startup retry timer", async () => {
  const pending = Promise.withResolvers<void>()
  let calls = 0
  const cleanup = plugin.setup!(makeContext({
    skillSync: () => { calls++; return pending.promise },
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", content: "" }],
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
    skills: () => calls === 1 ? [] : [{ id: "alpha", name: "alpha", description: "Alpha", content: "" }],
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

test.each(["session", "skills", "agents"])("empty panel waits for the %s cache instead of claiming no registered skills", async (dependency) => {
  const pending = Promise.withResolvers<void>()
  const [ready, setReady] = createSignal(false)
  const context = makeContext({
    skills: () => [],
    skillSync: () => dependency === "skills" ? pending.promise : Promise.resolve(),
    agentSync: () => dependency === "agents" ? pending.promise : Promise.resolve(),
    agents: () => dependency === "agents" && !ready() ? undefined : [{ id: "build", permissions: [] }],
    session: () => dependency === "session" && !ready() ? undefined : { agent: "build", location: context.location },
  })
  await withPanel(context, async (view) => {
    try {
      await view.flush()
      expect(view.captureCharFrame()).toContain("Loading skills…")
      expect(view.captureCharFrame()).not.toContain("No skills registered")
      setReady(true)
      pending.resolve()
      await view.waitForFrame((frame) => frame.includes("No skills registered"))
      expect(view.captureCharFrame()).toContain("Skills (0 loaded · 0 visible)")
      expect(view.captureCharFrame()).not.toContain(" tok")
    } finally { pending.resolve() }
  })
})

test("a registered catalog hidden entirely by metadata is not reported as unregistered", async () => {
  const context = makeContext({
    skills: () => [
      { id: "missing-description", name: "Missing description" },
      { id: "manual", name: "Manual", description: "Manual only", autoinvoke: false },
    ],
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("No model-visible skills"))
    expect(view.captureCharFrame()).not.toContain("No skills registered")
    expect(view.captureCharFrame()).toContain("Skills (0 loaded · 0 visible)")
  })
})

test.each(["skill", "agent"])("failed %s reads stay explicit after the toast disappears and clear on recovery", async (catalog) => {
  const pending = Promise.withResolvers<void>()
  const agents = [{ id: "build", permissions: [] }]
  const toasts: any[] = []
  const events = new Map<string, (event: any) => void>()
  let recovering = false
  const context = makeContext({
    skillSync: () => catalog === "skill" && !recovering ? pending.promise : Promise.resolve(),
    agentSync: () => catalog === "agent" && !recovering ? pending.promise : Promise.resolve(),
    agents: () => catalog === "agent" && !recovering ? undefined : agents,
    toastShow: (toast) => toasts.push(toast),
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  await withPanel(context, async (view) => {
    try {
      pending.reject(new Error("offline"))
      await view.waitForFrame((frame) => frame.includes("Failed to load skills"))
      expect(toasts).toEqual([{ variant: "error", title: "Skills", message: "Failed to load skills: offline", duration: 5000 }])
      // A toast's lifetime does not own the persistent empty-panel status.
      toasts.length = 0
      await view.flush()
      expect(view.captureCharFrame()).toContain("Failed to load skills")
      recovering = true
      events.get("skill.updated")!({ location: context.location, data: {} })
      await view.waitForFrame((frame) => frame.includes("No skills registered"))
      expect(view.captureCharFrame()).not.toContain("Failed to load skills")
    } finally { pending.resolve() }
  })
})

test("failed initial discovery gets only one delayed retry", async () => {
  let calls = 0
  const toasts: unknown[] = []
  const cleanup = plugin.setup!(makeContext({
    skillSync: async () => { if (++calls === 1) throw new Error("offline") },
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha" }],
    toastShow: (toast) => toasts.push(toast),
  })) as () => void
  try {
    await Bun.sleep(300)
    expect(calls).toBe(2)
    expect(toasts.length).toBe(1)
    await Bun.sleep(300)
    expect(calls).toBe(2)
  } finally { cleanup() }
})

test("discovery status stays isolated across workspace IDs and late inactive failures", async () => {
  const pending = Promise.withResolvers<void>()
  const toasts: unknown[] = []
  const [workspaceID, setWorkspaceID] = createSignal("workspace-a")
  const context = makeContext({
    session: () => ({ agent: "build", location: { directory: process.cwd(), workspaceID: workspaceID() } }),
    skillSync: (location) => location.workspaceID === "workspace-a" ? pending.promise : Promise.resolve(),
    toastShow: (toast) => toasts.push(toast),
  })
  Object.assign(context, { location: { directory: process.cwd(), workspaceID: "workspace-a" } })
  await withPanel(context, async (view) => {
    try {
      await view.flush()
      expect(view.captureCharFrame()).toContain("Loading skills…")
      setWorkspaceID("workspace-b")
      await view.waitForFrame((frame) => frame.includes("No skills registered"))
      pending.reject(new Error("workspace A offline"))
      await Bun.sleep(0)
      await view.flush()
      expect(view.captureCharFrame()).toContain("No skills registered")
      expect(toasts).toEqual([])
      setWorkspaceID("workspace-a")
      await view.waitForFrame((frame) => frame.includes("Failed to load skills"))
      setWorkspaceID("workspace-b")
      await view.waitForFrame((frame) => frame.includes("No skills registered"))
      expect(view.captureCharFrame()).not.toContain("Failed to load skills")
    } finally { pending.resolve() }
  })
})

test("host cache failures keep visible rows, reject stale errors and recover to an empty catalog", async () => {
  const requests = Array.from({ length: 4 }, () => Promise.withResolvers<any>())
  const toasts: unknown[] = []
  const events = new Map<string, (event: any) => void>()
  let calls = 0
  let disposeData!: () => void
  const context = makeContext({
    toastShow: (toast) => toasts.push(toast),
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  const data = createRoot((dispose) => {
    disposeData = dispose
    return createData({
      api: () => ({
        skill: { list: () => requests[calls++].promise },
        agent: { list: async () => ({ location: context.location, data: [{ id: "build", permissions: [] }] }) },
      }) as any,
      directory: process.cwd(),
      event: { on: () => () => {}, listen: () => () => {} },
    })
  })
  Object.assign(context.data.location, { skill: data.location.skill, agent: data.location.agent })
  const refresh = () => {
    data.location.skill.invalidate(context.location)
    events.get("skill.updated")!({ location: context.location, data: {} })
  }
  try {
    await withPanel(context, async (view) => {
      try {
        await view.flush()
        expect(view.captureCharFrame()).toContain("Loading skills…")
        refresh()
        // The host serializes an invalidated read behind its previous request.
        requests[0].reject(new Error("stale failure"))
        await Bun.sleep(0)
        await view.flush()
        expect(toasts).toEqual([])
        expect(view.captureCharFrame()).toContain("Loading skills…")
        requests[1].resolve({ location: context.location, data: [{ id: "alpha", name: "alpha", description: "Alpha" }] })
        await view.waitForFrame((frame) => frame.includes("alpha"))
        refresh()
        await view.flush()
        expect(view.captureCharFrame()).toContain("alpha")
        requests[2].reject(new Error("refresh failed"))
        await Bun.sleep(0)
        await view.flush()
        expect(toasts.length).toBe(1)
        expect(view.captureCharFrame()).toContain("alpha")
        expect(view.captureCharFrame()).not.toContain("Failed to load skills")
        // Host-owned cache recovery need not emit another plugin refresh.
        data.location.skill.invalidate(context.location)
        const recovery = data.location.skill.sync(context.location)
        requests[3].resolve({ location: context.location, data: [] })
        await recovery
        await view.waitForFrame((frame) => frame.includes("No skills registered"))
        expect(view.captureCharFrame()).not.toContain("Failed to load skills")
        expect(calls).toBe(4)
      } finally {
        for (const request of requests) request.resolve({ location: context.location, data: [] })
      }
    })
  } finally { disposeData() }
})

test("historical loads restore once per session and stay isolated on revisit", async () => {
  const [sessionID, setSessionID] = createSignal("session-1")
  const calls: string[] = []
  let render!: (input: { sessionID: string }) => any
  const cleanup = plugin.setup!(makeContext({
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", content: "" }, { id: "beta", name: "beta", description: "Beta", content: "" }],
    messageList: async (input) => {
      calls.push(input.sessionID)
      return {
        data: [{ type: "skill", skill: input.sessionID === "session-1" ? "beta" : "alpha", name: input.sessionID === "session-1" ? "beta" : "alpha" }],
        cursor: {},
      }
    },
    slot: (claim) => { render = claim.render; return () => {} },
  })) as () => void
  const view = await testRender(() => (
    <box>{createComponent(render, { get sessionID() { return sessionID() } })}</box>
  ), { width: 60, height: 12 })
  try {
    await view.waitForFrame((frame) => frame.includes("alpha") && frame.indexOf("beta") < frame.indexOf("alpha"))
    setSessionID("session-2")
    await Bun.sleep(0)
    await view.waitForFrame((frame) => frame.includes("beta") && frame.indexOf("alpha") < frame.indexOf("beta"))
    setSessionID("session-1")
    await view.waitForFrame((frame) => frame.includes("alpha") && frame.indexOf("beta") < frame.indexOf("alpha"))
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("1 loaded · 2 visible"))
    expect(calls).toEqual(["session-1", "session-2"])
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test.each(["manual", "auto"])("successful %s compaction removes loaded-only hidden rows until a new load", async (reason) => {
  const events = new Map<string, (event: any) => void>()
  const old = [
    { id: "msg_alpha", type: "user", skills: [{ id: "alpha", name: "alpha" }] },
    { id: "msg_beta", type: "skill", skill: "beta", name: "beta" },
  ]
  const [messages, setMessages] = createSignal<any[]>(old)
  const skills = [{ id: "alpha", name: "alpha", description: "Alpha" }, { id: "beta", name: "beta", description: "Beta", autoinvoke: false }]
  const context = makeContext({
    skills: () => skills,
    messages,
    messageList: async () => ({ data: [...messages()].reverse(), cursor: {} }),
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  const purple = RGBA.fromHex("#bc8cff")
  Object.assign(context.theme.background.action.primary, { focused: purple })
  context.theme.text.muted = RGBA.fromHex("#8b949e")
  await withPanel(context, async (view) => {
    const foreground = (name: string) => view.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes(name))!.fg
    await view.waitForFrame((frame) => frame.includes("Skills (2 loaded · 1 visible)"))
    expect(foreground("alpha").equals(purple)).toBe(true)
    expect(foreground("beta").equals(purple)).toBe(true)
    const compaction = { id: "msg_compact", type: "compaction", reason, summary: "alpha and beta were loaded", recent: '<skill_content name="beta">' }
    for (const status of ["running", "failed"]) {
      setMessages([...old, { ...compaction, status }])
      await view.flush()
      expect(view.captureCharFrame()).toContain("Skills (2 loaded · 1 visible)")
      expect(foreground("beta").equals(purple)).toBe(true)
    }
    setMessages([...old, { ...compaction, status: "completed" }])
    events.get("session.compaction.ended")!({ data: { sessionID: "session-1", reason } })
    await view.waitForFrame((frame) => frame.includes("Skills (0 loaded · 1 visible)"))
    expect(foreground("alpha").equals(white)).toBe(true)
    expect(view.captureCharFrame()).not.toContain("• beta")
    // A cache rescan and a preview must not revive the old loads.
    setMessages([...messages(), { id: "msg_plain", type: "user", text: "continue" }])
    await view.flush()
    await view.mockMouse.click(4, 1)
    expect(view.captureCharFrame()).toContain("Skills (0 loaded · 1 visible)")
    expect(view.captureCharFrame()).not.toContain("• beta")
    await view.mockMouse.click(4, 0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("▶ Skills (0 loaded · 1 visible)")
    setMessages([...messages(), {
      id: "msg_reload", type: "assistant", content: [{
        type: "tool", name: "skill", state: {
          status: "completed", input: { id: "beta" },
          content: [{ type: "text", text: '<skill_content name="beta">\n# Beta' }],
        },
      }],
    }])
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 1 visible)"))
    await view.mockMouse.click(4, 0)
    await view.flush()
    expect(foreground("alpha").equals(white)).toBe(true)
    expect(foreground("beta").equals(purple)).toBe(true)
    expect(view.captureCharFrame().indexOf("beta")).toBeLessThan(view.captureCharFrame().indexOf("alpha"))
  })
  expect(events.size).toBe(0)
})

test("host event projection changes the same compaction message in place and clears only successful loads", async () => {
  let project!: (event: any) => void
  let disposeData!: () => void
  let history = () => [{ id: "msg_alpha", type: "skill", skill: "alpha", name: "alpha", text: "# Alpha", time: { created: 1 } }]
  const events = new Map<string, (event: any) => void>()
  const context = makeContext({
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha" }],
    messageList: async () => ({ data: [...history()].reverse(), cursor: {} }),
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  const data = createRoot((dispose) => {
    disposeData = dispose
    return createData({
      api: () => context.client,
      directory: process.cwd(),
      event: {
        on: () => () => {},
        listen: (callback) => { project = (event) => callback({ name: event.type, details: event }); return () => {} },
      },
    })
  })
  await data.session.message.sync("session-1")
  history = () => data.session.message.list("session-1") as any
  Object.assign(context.data.session, { message: data.session.message })
  const emit = (type: string, id: string, extra: object = {}) => {
    const event = { type, id, created: 2, data: { sessionID: "session-1", reason: "auto", ...extra } }
    project(event)
    events.get(type)?.(event)
  }
  try {
    await withPanel(context, async (view) => {
      await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 1 visible)"))
      emit("session.compaction.started", "evt_failed", { recent: "" })
      await view.flush()
      expect(view.captureCharFrame()).toContain("Skills (1 loaded · 1 visible)")
      emit("session.compaction.failed", "evt_failure", { error: { type: "compaction.interrupted", message: "Cancelled" } })
      await view.flush()
      expect(view.captureCharFrame()).toContain("Skills (1 loaded · 1 visible)")
      emit("session.compaction.started", "evt_success", { recent: "" })
      await view.flush()
      const running = data.session.message.get("session-1", "msg_success")
      expect(running?.type).toBe("compaction")
      emit("session.compaction.ended", "evt_end", { text: "alpha was loaded", recent: '<skill_content name="alpha">' })
      await view.waitForFrame((frame) => frame.includes("Skills (0 loaded · 1 visible)"))
      expect(data.session.message.get("session-1", "msg_success")).toBe(running)
      expect((running as any).status).toBe("completed")
      expect(data.session.message.list("session-1").length).toBe(3)
    })
  } finally { disposeData() }
})

test("direct activation refreshes the real host message cache without bypassing successful-compaction boundaries", async () => {
  let project!: (event: any) => void
  let disposeData!: () => void
  let history: any[] = []
  const events = new Map<string, (event: any) => void>()
  const context = makeContext({
    prefs: { scope: "loaded" },
    skills: () => [{ id: "manual", name: "Manual", description: "Manual", autoinvoke: false }],
    messageList: async () => ({ data: [...history].reverse(), cursor: {} }),
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  const data = createRoot((dispose) => {
    disposeData = dispose
    return createData({
      api: () => context.client,
      directory: process.cwd(),
      event: {
        on: () => () => {},
        listen: (callback) => { project = (event) => callback({ name: event.type, details: event }); return () => {} },
      },
    })
  })
  await data.session.message.sync("session-1")
  Object.assign(context.data.session, { message: data.session.message })
  const activation = { type: "session.skill.activated", id: "evt_manual", created: 2, data: { sessionID: "session-1", id: "manual", name: "Manual", text: "Manual body" } }
  try {
    await withPanel(context, async (view) => {
      await view.waitForFrame((frame) => frame.includes("No skills loaded"))
      history = [{ id: "msg_manual", type: "skill", skill: "manual", name: "Manual", text: "Manual body", time: { created: 2 } }]
      project(activation)
      // The host omits this event; the plugin must refresh the authoritative messages.
      expect(data.session.message.list("session-1")).toEqual([])
      events.get(activation.type)!(activation)
      await view.waitForFrame((frame) => frame.includes("Skills (1 loaded)") && frame.includes("• Manual"))
      history.push({ id: "msg_compacted", type: "compaction", status: "completed", text: "Manual mentioned in summary", recent: "", time: { created: 3, completed: 4 } })
      // Even a late direct-activation notification cannot resurrect a pre-compaction load.
      events.get(activation.type)!(activation)
      await view.waitForFrame((frame) => frame.includes("Skills (0 loaded)") && frame.includes("No skills loaded"))
      history.push({ id: "msg_reloaded", type: "skill", skill: "manual", name: "Manual", text: "Manual body", time: { created: 5 } })
      events.get(activation.type)!({ ...activation, id: "evt_reloaded", created: 5 })
      await view.waitForFrame((frame) => frame.includes("Skills (1 loaded)") && frame.includes("• Manual"))
    })
    expect(events.size).toBe(0)
  } finally { disposeData() }
})

test("restart backfill restores only current-stage hidden rows and keeps sessions isolated", async () => {
  // A new plugin setup on each run models a restart, not retained plugin state.
  for (let restart = 0; restart < 2; restart++) {
    let render!: (input: { sessionID: string }) => any
    const [sessionID, setSessionID] = createSignal("session-a")
    const calls: string[] = []
    const histories: Record<string, any[]> = {
      "session-a": [
        { type: "skill", skill: "beta" },
        { id: "msg_latest", type: "compaction", status: "completed", summary: "alpha was loaded" },
        { type: "skill", skill: "alpha" },
        { id: "msg_old", type: "compaction", status: "completed" },
      ],
      "session-b": [{ type: "user", skills: [{ id: "alpha", name: "alpha" }] }],
    }
    const cleanup = plugin.setup!(makeContext({
      skills: () => [{ id: "alpha", name: "alpha", description: "Alpha" }, { id: "beta", name: "beta", description: "Beta", autoinvoke: false }],
      messageList: async (input) => { calls.push(input.sessionID); return { data: histories[input.sessionID], cursor: {} } },
      slot: (claim) => { render = claim.render; return () => {} },
    })) as () => void
    const view = await testRender(() => createComponent(render, {
      get sessionID() { return sessionID() },
    }), { width: 60, height: 12 })
    try {
      await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 1 visible)") && frame.includes("• beta"))
      expect(view.captureCharFrame().indexOf("beta")).toBeLessThan(view.captureCharFrame().indexOf("alpha"))
      setSessionID("session-b")
      await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 1 visible)") && frame.includes("• alpha") && !frame.includes("• beta"))
      expect(view.captureCharFrame()).not.toContain("• beta")
      setSessionID("session-a")
      await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 1 visible)") && frame.includes("• beta"))
      expect(calls).toEqual(["session-a", "session-b"])
    } finally {
      cleanup()
      view.renderer.destroy()
    }
  }
})

test("compaction invalidates a slow old-stage backfill but keeps a new load arriving during its replacement", async () => {
  const oldRead = Promise.withResolvers<any>()
  const newRead = Promise.withResolvers<any>()
  const events = new Map<string, (event: any) => void>()
  const [messages, setMessages] = createSignal<any[]>([{ id: "msg_old", type: "skill", skill: "alpha" }])
  let calls = 0
  const context = makeContext({
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", autoinvoke: false }, { id: "beta", name: "beta", description: "Beta", autoinvoke: false }],
    messages,
    messageList: () => (++calls === 1 ? oldRead.promise : newRead.promise),
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 0 visible)"))
    const compaction = { id: "msg_compact", type: "compaction", status: "completed" }
    setMessages([...messages(), compaction])
    events.get("session.compaction.ended")!({ data: { sessionID: "session-1" } })
    await view.waitForFrame((frame) => frame.includes("Skills (0 loaded · 0 visible)"))
    expect(view.captureCharFrame()).not.toContain("• alpha")
    oldRead.resolve({ data: [{ type: "skill", skill: "alpha" }], cursor: { next: "stale-page" } })
    await Bun.sleep(0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Skills (0 loaded · 0 visible)")
    expect(view.captureCharFrame()).not.toContain("• alpha")
    setMessages([...messages(), { id: "msg_new", type: "user", skills: [{ id: "beta" }] }])
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 0 visible)"))
    // The replacement read began before this new attachment: its commit must not lose it.
    newRead.resolve({ data: [compaction], cursor: {} })
    await Bun.sleep(0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Skills (1 loaded · 0 visible)")
    expect(view.captureCharFrame()).toContain("• beta")
    expect(view.captureCharFrame()).not.toContain("• alpha")
    expect(calls).toBe(2)
  })
})

test("a successful compaction in an inactive session removes only that session's hidden rows on revisit", async () => {
  let render!: (input: { sessionID: string }) => any
  const [sessionID, setSessionID] = createSignal("session-a")
  const events = new Map<string, (event: any) => void>()
  const [compacted, setCompacted] = createSignal(false)
  const histories = (id: string) => id === "session-b" && compacted()
    ? [{ id: "msg_compact", type: "compaction", status: "completed" }]
    : [{ type: "skill", skill: "alpha" }]
  const cleanup = plugin.setup!(makeContext({
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", autoinvoke: false }],
    messages: histories,
    messageList: async (input) => ({ data: histories(input.sessionID), cursor: {} }),
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
    slot: (claim) => { render = claim.render; return () => {} },
  })) as () => void
  const view = await testRender(() => createComponent(render, {
    get sessionID() { return sessionID() },
  }), { width: 60, height: 12 })
  try {
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 0 visible)"))
    setSessionID("session-b")
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 0 visible)"))
    await Bun.sleep(0)
    setSessionID("session-a")
    setCompacted(true)
    events.get("session.compaction.ended")!({ data: { sessionID: "session-b" } })
    await view.flush()
    expect(view.captureCharFrame()).toContain("Skills (1 loaded · 0 visible)")
    expect(view.captureCharFrame()).toContain("• alpha")
    setSessionID("session-b")
    await view.waitForFrame((frame) => frame.includes("Skills (0 loaded · 0 visible)"))
    expect(view.captureCharFrame()).not.toContain("• alpha")
    setSessionID("session-a")
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 0 visible)"))
    expect(view.captureCharFrame()).toContain("• alpha")
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test("late successful discovery cannot update an unloaded plugin", async () => {
  const pending = Promise.withResolvers<void>()
  let render!: (input: { sessionID: string }) => any
  const cleanup = plugin.setup!(makeContext({
    skillSync: () => pending.promise,
    skills: () => [{ id: "alpha", name: "alpha", description: "Alpha", content: "" }],
    slot: (claim) => { render = claim.render; return () => {} },
  })) as () => void
  const view = await testRender(() => <box>{render({ sessionID: "session-1" })}</box>, { width: 60, height: 12 })
  try {
    await view.waitForFrame((frame) => frame.includes("Loading skills…"))
    cleanup()
    pending.resolve()
    await Bun.sleep(0)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Loading skills…")
    expect(view.captureCharFrame()).not.toContain("alpha")
  } finally { view.renderer.destroy() }
})

test("sidebar shows only skill IDs and always-on counts without token labels", async () => {
  const renders: ((input: { sessionID: string }) => any)[] = []
  const alpha = { id: "alpha", name: "alpha", description: "Alpha does things.", content: "" }
  const beta = { id: "beta", name: "beta", description: undefined, content: "" }
  const gamma = { id: "gamma", name: "gamma", description: "Gamma.", autoinvoke: false, content: "" }
  const context = makeContext({
    skills: () => [alpha, beta, gamma],
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
  ), { width: 40, height: 16 })
  try {
    await view.waitForFrame((frame) => frame.includes("alpha"))
    const frame = view.captureCharFrame()
    expect(frame).toContain("▼ Skills (0 loaded · 1 visible)")
    expect(frame).not.toContain(" tok")
    expect(frame).not.toContain("~")
    // The trailing █ belongs to the test wrapper's scrollbar, not panel content.
    const alphaRow = frame.split("\n").find((line) => line.includes("alpha"))!
    expect(alphaRow.replace(/█+$/, "").trimEnd()).toBe("• alpha")
    // Host-excluded skills do not appear in the panel or its visible count.
    expect(frame).not.toContain("beta")
    expect(frame).not.toContain("gamma")
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▶ Skills"))
    const collapsed = view.captureCharFrame()
    expect(collapsed).toContain("▶ Skills (0 loaded · 1 visible)")
    expect(collapsed).not.toContain(" tok")
    expect(collapsed).not.toContain("~")
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test("expanded and collapsed headers show full loaded and visible counts at the host sidebar width", async () => {
  let render!: (input: { sessionID: string }) => any
  const skills = Array.from({ length: 11 }, (_, index) => ({
    id: `skill-${index}`, name: `Skill ${index}`, description: "x".repeat(350), content: "",
  }))
  const cleanup = plugin.setup!(makeContext({
    skills: () => skills,
    messages: () => [0, 1, 2].map((index) => ({ type: "skill", skill: skills[index].id, name: skills[index].name })),
    slot: (claim) => { render = claim.render; return () => {} },
  })) as () => void
  // The host's 42 columns leave 37 for the panel after its padding and slot gutter.
  const view = await testRender(() => (
    <box width="100%" height={12} paddingLeft={2} paddingRight={2}>
      <scrollbox verticalScrollbarOptions={{ position: "absolute", right: 0, width: 1 }}>
        <box flexShrink={0} paddingRight={1}>{render({ sessionID: "session-1" })}</box>
      </scrollbox>
    </box>
  ), { width: 42, height: 16 })
  try {
    await view.waitForFrame((frame) => frame.includes("Skill 0"))
    // Exclude the host's right padding and absolute scrollbar cell.
    const expanded = view.captureCharFrame().split("\n")[0].slice(2, 39).trimEnd()
    expect(expanded).toBe("▼ Skills (3 loaded · 11 visible)")
    await view.mockMouse.click(4, 0)
    await view.flush()
    const header = view.captureCharFrame().split("\n")[0].slice(2, 39).trimEnd()
    expect(header).toBe("▶ Skills (3 loaded · 11 visible)")
    for (const width of [30, 26, 70, 42]) {
      view.resize(width, 16)
      await view.flush()
      const narrow = view.captureCharFrame().split("\n")[0].slice(2, width - 3).trimEnd()
      expect(narrow).toMatch(/^▶ Skills /)
      expect(narrow).not.toContain(" tok")
      if (width < 42) expect(narrow).toBe("▶ Skills (3/11)")
      else expect(narrow).toContain("(3 loaded · 11 visible)")
    }
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test.each(["model", "registered", "loaded"] as const)("%s counts compact within their allocated width, preserving tokens and restoring full text", async (scope) => {
  const skills = Array.from({ length: 12 }, (_, index) => ({
    id: `skill-${index}`, name: `Skill ${index}`, description: "Test", autoinvoke: index !== 11, path: "/builtin/test.md", content: "x".repeat(index === 0 ? 72400 : 800),
  }))
  const [messages, setMessages] = createSignal([0, 1, 2].map((index) => ({ type: "skill", skill: skills[index].id })))
  const [prefs, setPrefs] = createStore({ token: "load-delta", state: "on", collapsed: false, scope })
  const context = makeContext({
    skills: () => skills, messages,
    storage: { store: () => [prefs, async (mutation: (draft: typeof prefs) => void) => { setPrefs(produce(mutation)) }] },
  })
  Object.assign(context.theme.text, { muted: RGBA.fromHex("#8aa68f") })
  const count = scope === "registered" ? 12 : 11
  const full = () => scope === "loaded" ? "(3 loaded)" : `(3 loaded · ${count} ${scope === "registered" ? "registered" : "visible"})`
  const compact = () => scope === "loaded" ? "(3)" : `(3/${count})`
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes(`Skills ${compact()}`) && frame.includes(" tok"))
    expect(view.captureCharFrame().split("\n")[0]).not.toMatch(/\.\.\.|…/)
    const span = view.captureSpans().lines[0].spans.find((span) => span.text.includes(compact()))!
    expect(span.fg.equals(context.theme.text.muted)).toBe(true)
    const total = view.renderer.root.findDescendantById("skills-panel.total-tokens")!
    const tokenRight = total.x + total.width
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes(`▶ Skills ${compact()}`))
    expect(total.x + total.width).toBe(tokenRight)
    view.resize(60, 12)
    await view.waitForFrame((frame) => frame.includes(`▶ Skills ${full()}`))
    const counts = view.renderer.root.findDescendantById("skills-panel.header")!.getChildren()[2] as Renderable
    const exactWidth = 60 - (counts.width - full().length)
    view.resize(exactWidth, 12)
    await view.waitForFrame((frame) => frame.includes(`▶ Skills ${full()}`))
    view.resize(exactWidth - 1, 12)
    await view.waitForFrame((frame) => frame.includes(`▶ Skills ${compact()}`))
    setPrefs("token", "off")
    await view.waitForFrame((frame) => frame.includes(`▶ Skills ${full()}`))
    setPrefs("token", "load-delta")
    await view.waitForFrame((frame) => frame.includes(`▶ Skills ${compact()}`))
    view.resize(30, 12)
    await view.waitForFrame((frame) => frame.includes(`▶ Skills ${compact()}`))
    setPrefs("state", "off")
    await view.flush()
    expect(view.captureCharFrame().split("\n")[0]).not.toContain("(")
    expect(view.captureCharFrame()).toContain(" tok")
    setPrefs("state", "on")
    await view.waitForFrame((frame) => frame.includes(`▶ Skills ${compact()}`))
    setMessages(skills.slice(0, 10).map((skill) => ({ type: "skill", skill: skill.id })))
    await view.waitForFrame((frame) => frame.includes(scope === "loaded" ? "Skills (10)" : `Skills (10/${count})`))
    view.resize(42, 12)
    setPrefs("token", "off")
    await view.waitForFrame((frame) => frame.includes(scope === "loaded" ? "(10 loaded)" : `(10 loaded · ${count} ${scope === "registered" ? "registered" : "visible"})`))
  }, { width: 30 })
})

test("skill rows and counts stay clear of an absolute scrollbar without shifting when it appears", async () => {
  let render!: (input: { sessionID: string }) => any
  let scrollbox!: ScrollBoxRenderable
  const [overflow, setOverflow] = createSignal(false)
  const skills = Array.from({ length: 11 }, (_, index) => ({
    id: `long-skill-name-${index}-${"x".repeat(17)}`, name: `Skill ${index}`, description: "x".repeat(450), content: "",
  }))
  const cleanup = plugin.setup!(makeContext({
    skills: () => skills,
    slot: (claim) => { render = claim.render; return () => {} },
  })) as () => void
  const view = await testRender(() => (
    <box width={42} height={16} paddingLeft={2} paddingRight={2}>
      <scrollbox
        ref={(value) => { scrollbox = value }}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ position: "absolute", right: 0, top: 0, width: 1, height: "100%" }}
      >
        {/* The panel must protect its last column even without a host gutter. */}
        <box flexShrink={0}>
          {render({ sessionID: "session-1" })}
          <box height={overflow() ? 25 : 0} />
        </box>
      </scrollbox>
    </box>
  ), { width: 42, height: 16 })
  try {
    await view.waitForFrame((frame) => frame.includes("Skill 0"))
    const before = view.captureCharFrame().split("\n")[0].slice(2, 39)
    expect(before).toContain("Skills (0 loaded · 11 visible)")
    const rowBefore = view.captureCharFrame().split("\n")[1].slice(2, 39)
    expect(scrollbox.verticalScrollBar.visible).toBe(false)
    setOverflow(true)
    await view.flush()
    const after = view.captureCharFrame().split("\n")[0].slice(2, 39)
    expect(scrollbox.verticalScrollBar.visible).toBe(true)
    expect(after).toContain("Skills (0 loaded · 11 visible)")
    expect(after.trimEnd()).toBe(before.trimEnd())
    const row = view.captureCharFrame().split("\n")[1].slice(2, 39)
    expect(row.trimEnd()).toBe(rowBefore.trimEnd())
    expect(row.trimEnd()).toBe(`• ${skills[0].name}`)
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test.each([
  [`sample-skill${"1".repeat(80)}`, "x".repeat(400)],
  [`超长技能${"名称".repeat(40)}`, "x".repeat(4800)],
])("long skill labels use the row width, truncate without wrapping and still open previews: %s", async (id, description) => {
  let render!: (input: { sessionID: string }) => any
  let dialogShown = 0
  const skill = { id, name: id, description, content: "# Sample" }
  const cleanup = plugin.setup!(makeContext({
    skills: () => [skill],
    slot: (claim) => { render = claim.render; return () => {} },
    dialogShow: () => { dialogShown++ },
  })) as () => void
  const view = await testRender(() => (
    <box width="100%" height={12} paddingLeft={2} paddingRight={2}>
      <scrollbox>{createComponent(render, { sessionID: "session-1" })}</scrollbox>
    </box>
  ), { width: 42, height: 16 })
  try {
    await view.waitForFrame((frame) => frame.includes(id.slice(0, 3)))
    for (const width of [42, 26, 70, 42]) {
      view.resize(width, 16)
      await view.flush()
      const row = view.captureCharFrame().split("\n")[1].replace(/█+$/, "").trimEnd()
      expect(row).not.toContain(id)
      expect(row).toMatch(/\.\.\.|…/)
      expect(row.trimStart()).toMatch(/^• /)
      expect(row).not.toContain(" tok")
      expect(view.captureCharFrame().split("\n").slice(2).join("\n").trim()).toBe("")
    }
    await view.mockMouse.click(4, 1)
    expect(dialogShown).toBe(1)
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test("a stable slot switches cached skills immediately by session, not by the UI location", async () => {
  let render!: (input: { sessionID: string }) => any
  const [sessionID, setSessionID] = createSignal("session-a")
  const context = makeContext({
    session: (id) => ({ agent: "build", location: { directory: id === "session-a" ? "project-a" : "project-b" } }),
    skills: (location) => [{ id: `${location.directory}-skill`, name: `${location.directory}-skill`, description: "Project skill", content: "" }],
    slot: (claim) => { render = claim.render; return () => {} },
  })
  await Promise.all(["project-a", "project-b"].map((directory) => context.data.location.skill.sync({ directory })))
  const cleanup = plugin.setup!(context) as () => void
  const view = await testRender(() => createComponent(render, {
    get sessionID() { return sessionID() },
  }), { width: 50, height: 12 })
  try {
    await view.waitForFrame((frame) => frame.includes("project-a-skill"))
    setSessionID("session-b")
    await view.flush()
    expect(view.captureCharFrame()).toContain("project-b-skill")
    expect(view.captureCharFrame()).not.toContain("project-a-skill")
    setSessionID("session-a")
    await view.flush()
    expect(view.captureCharFrame()).toContain("project-a-skill")
    expect(view.captureCharFrame()).not.toContain("project-b-skill")
  } finally {
    cleanup()
    view.renderer.destroy()
  }
})

test("host catalog updates add and remove skills in a stable slot without another plugin refresh", async () => {
  let available = [{ id: "alpha", name: "alpha", description: "Alpha", content: "" }]
  const location = { directory: "session-project" }
  const events = new Map<string, (event: any) => void>()
  const context = makeContext({
    session: () => ({ agent: "build", location }),
    skills: (ref) => ref.directory === location.directory ? available : [{ id: "unrelated", name: "unrelated", description: "Other project" }],
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("alpha"))
    available = [{ id: "downloaded", name: "downloaded", description: "Installed during this session", content: "" }]
    context.data.location.skill.invalidate(location)
    await context.data.location.skill.sync(location)
    await view.flush()
    expect(view.captureCharFrame()).toContain("downloaded")
    expect(view.captureCharFrame()).not.toContain("alpha")
    available = []
    events.get("skill.updated")!({ location, data: {} })
    await view.waitForFrame((frame) => frame.includes("No skills registered"))
    expect(view.captureCharFrame()).toContain("▼ Skills (0 loaded · 0 visible)")
    expect(view.captureCharFrame()).not.toContain(" tok")
    expect(view.captureCharFrame()).not.toContain("unrelated")
  }, { width: 50 })
})

test("an uncached session starts discovery on switch without events or leaking the previous list", async () => {
  let render!: (input: { sessionID: string }) => any
  const [sessionID, setSessionID] = createSignal("project-a")
  const pending = Promise.withResolvers<void>()
  const calls: string[] = []
  const context = makeContext({
    session: (id) => ({ agent: "build", location: { directory: id } }),
    skillSync: (location) => {
      calls.push(location.directory)
      return location.directory === "project-b" ? pending.promise : Promise.resolve()
    },
    skills: (location) => [{ id: `${location.directory}-skill`, name: `${location.directory}-skill`, description: "Project skill" }],
    slot: (claim) => { render = claim.render; return () => {} },
  })
  const cleanup = plugin.setup!(context) as () => void
  const view = await testRender(() => createComponent(render, {
    get sessionID() { return sessionID() },
  }), { width: 50, height: 12 })
  try {
    await view.waitForFrame((frame) => frame.includes("project-a-skill"))
    setSessionID("project-b")
    await view.flush()
    expect(calls).toContain("project-b")
    expect(view.captureCharFrame()).not.toContain("project-a-skill")
    pending.resolve()
    await view.waitForFrame((frame) => frame.includes("project-b-skill"))
  } finally {
    pending.resolve()
    cleanup()
    view.renderer.destroy()
  }
})

test("agent changes and session permission overrides immediately filter the model-visible list", async () => {
  const [agentID, setAgentID] = createSignal<string | undefined>(undefined)
  const [permissions, setPermissions] = createSignal<any[]>([])
  const context = makeContext({
    session: () => ({ agent: agentID(), permissions: permissions(), location: { directory: process.cwd() } }),
    agents: () => [
      // The effective default may not be build; the host orders it first.
      { id: "custom-default", permissions: [{ action: "skill", resource: "private", effect: "deny" }] },
      { id: "build", permissions: [] },
    ],
    skills: () => [
      { id: "public", name: "public", description: "Public" },
      { id: "private", name: "private", description: "Private" },
      { id: "hidden", name: "hidden", description: "Hidden", autoinvoke: false },
      { id: "no-description", name: "no-description" },
    ],
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("public"))
    expect(view.captureCharFrame()).not.toContain("private")
    expect(view.captureCharFrame()).not.toContain("hidden")
    expect(view.captureCharFrame()).not.toContain("no-description")
    setAgentID("build")
    await view.flush()
    expect(view.captureCharFrame()).toContain("private")
    setPermissions([{ action: "skill", resource: "*", effect: "deny" }])
    await view.flush()
    expect(view.captureCharFrame()).toContain("No model-visible skills")
    setPermissions([{ action: "skill", resource: "*", effect: "ask" }])
    await view.flush()
    expect(view.captureCharFrame()).toContain("private")
    expect(view.captureCharFrame()).toContain("public")
    setAgentID("missing-agent")
    await view.flush()
    expect(view.captureCharFrame()).toContain("Agent unavailable: missing-agent")
  }, { width: 50 })
})

test("unloaded visible skills stay black or white when theme text matches the loaded highlight", async () => {
  const [mode, setMode] = createSignal<"light" | "dark">("light")
  const highlight = RGBA.fromHex("#3b7dd8")
  const muted = RGBA.fromHex("#8b949e")
  const context = makeContext({
    prefs: { scope: "registered", token: "listing" },
    skills: () => [
      { id: "alpha", name: "Alpha", description: "Visible" },
      { id: "beta", name: "Beta", description: "Loaded" },
      { id: "gamma", name: "Gamma", description: "Hidden", autoinvoke: false },
      { id: "delta", name: "Delta", description: "Hidden loaded", autoinvoke: false },
    ],
    messages: () => ["beta", "delta"].map((skill) => ({ type: "skill", skill, name: skill })),
  })
  Object.defineProperty(context, "themeMode", { get: mode })
  Object.assign(context.theme.text, { base: highlight, muted })
  Object.assign(context.theme.background.action.primary, { focused: highlight })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("Gamma"))
    for (const nextMode of ["light", "dark", "light"] as const) {
      setMode(nextMode)
      await view.flush()
      const normal = RGBA.fromHex(nextMode === "light" ? "#000000" : "#ffffff")
      for (const [id, name, color] of [["alpha", "Alpha", normal], ["beta", "Beta", highlight], ["gamma", "Gamma", muted], ["delta", "Delta", highlight]] as const) {
        const row = view.renderer.root.findDescendantById(`skills-panel.${id}`)!
        const spans = view.captureSpans().lines[row.y].spans
        expect(spans.find((span) => span.text.includes(name))!.fg.equals(color)).toBe(true)
        expect(spans.find((span) => span.text.includes("•"))!.fg.equals(color)).toBe(true)
        expect(spans.find((span) => span.text.includes("tok"))!.fg.equals(muted)).toBe(true)
      }
      const header = view.captureSpans().lines[0].spans
      expect(header.find((span) => span.text.includes("Skills"))!.fg.equals(normal)).toBe(true)
      expect(header.find((span) => span.text.includes("▼"))!.fg.equals(normal)).toBe(true)
      expect(header.find((span) => span.text.includes("registered"))!.fg.equals(muted)).toBe(true)
    }
  }, { width: 70 })
})

test("loaded rows match the theme picker selection, not accent or agent colors; header counts stay muted", async () => {
  const orange = RGBA.fromHex("#fab283") // opencode dark primary highlight
  const blue = RGBA.fromHex("#3b7dd8") // opencode light primary highlight
  const [color, setColor] = createSignal(orange)
  const [agentColor, setAgentColor] = createSignal(RGBA.fromHex("#5c9cf5"))
  const context = makeContext({
    skills: () => [
      { id: "alpha", name: "alpha", description: "Alpha" },
      { id: "beta", name: "beta", description: "Beta" },
    ],
    messages: () => [{ type: "skill", skill: "beta", name: "beta" }],
  })
  Object.defineProperty(context, "themeMode", { get: () => color() === orange ? "dark" : "light" })
  const theme = context.theme
  Object.defineProperty(context, "theme", { get: () => ({
    ...theme,
    hue: { ...theme.hue, accent: { 200: RGBA.fromHex("#9d7cd8") } },
    categorical: [{ 200: agentColor() }, { 200: RGBA.fromHex("#d68c27") }],
    // Dialog-specific selection overrides must win over base hues/tokens.
    surface: () => ({
      ...theme,
      background: { ...theme.background, action: { primary: { focused: color() } } },
    }),
    text: {
      ...theme.text,
      base: RGBA.fromHex(color() === orange ? "#c9d1d9" : "#24292f"),
      muted: RGBA.fromHex(color() === orange ? "#8aa68f" : "#aa8833"),
    },
  }) })
  await withPanel(context, async (view) => {
    const foreground = (text: string) => view.captureSpans().lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes(text))!.fg
    await view.waitForFrame((frame) => frame.includes("alpha") && frame.includes("beta"))
    expect(foreground("Skills").equals(white)).toBe(true)
    expect(foreground("▼").equals(white)).toBe(true)
    expect(view.captureCharFrame()).toContain("Skills (1 loaded · 2 visible)")
    expect(foreground("(").equals(context.theme.text.muted)).toBe(true)
    expect(foreground("1 loaded · 2 visible").equals(context.theme.text.muted)).toBe(true)
    expect(foreground("beta").equals(orange)).toBe(true)
    const bulletColor = () => view.captureSpans().lines[1].spans.find((span) => span.text.includes("•"))!.fg
    expect(bulletColor().equals(orange)).toBe(true)
    expect(foreground("alpha").equals(white)).toBe(true)
    setColor(blue)
    await view.flush()
    expect(foreground("Skills").equals(RGBA.fromHex("#000000"))).toBe(true)
    expect(foreground("▼").equals(RGBA.fromHex("#000000"))).toBe(true)
    expect(foreground("(").equals(context.theme.text.muted)).toBe(true)
    expect(foreground("1 loaded · 2 visible").equals(context.theme.text.muted)).toBe(true)
    expect(foreground("beta").equals(blue)).toBe(true)
    expect(bulletColor().equals(blue)).toBe(true)
    expect(foreground("alpha").equals(RGBA.fromHex("#000000"))).toBe(true)
    setAgentColor(RGBA.fromHex("#70b48f"))
    await view.flush()
    expect(foreground("beta").equals(blue)).toBe(true)
    expect(bulletColor().equals(blue)).toBe(true)
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▶ Skills (1 loaded · 2 visible)"))
    expect(foreground("Skills").equals(RGBA.fromHex("#000000"))).toBe(true)
    expect(foreground("▶").equals(RGBA.fromHex("#000000"))).toBe(true)
    const header = view.captureSpans().lines[0].spans
    expect(foreground("(").equals(context.theme.text.muted)).toBe(true)
    expect(header.some((span) => span.text.includes("(1 loaded · 2 visible)") && span.fg.equals(context.theme.text.muted))).toBe(true)
    setColor(orange)
    await view.flush()
    expect(foreground("Skills").equals(white)).toBe(true)
    expect(foreground("▶").equals(white)).toBe(true)
    expect(foreground("(").equals(context.theme.text.muted)).toBe(true)
    expect(foreground("1 loaded · 2 visible").equals(context.theme.text.muted)).toBe(true)
  }, { width: 50 })
})

test("same-name skills share one label; only the loaded ID is colored and the preview tells them apart", async () => {
  const purple = RGBA.fromHex("#bc8cff")
  let dialogRender!: () => any
  const context = makeContext({
    skills: () => [
      { id: "one", name: "Review", description: "First" },
      { id: "two", name: "Review", description: "Second" },
    ],
    messages: () => [{ type: "skill", skill: "two", name: "Review" }],
    onDialogShow: (render) => { dialogRender = render },
  })
  Object.assign(context.theme.background.action.primary, { focused: purple })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => (frame.match(/Review/g) ?? []).length === 2)
    const rows = view.captureSpans().lines.flatMap((line) => line.spans).filter((span) => span.text.includes("Review"))
    expect(rows.map((row) => row.fg.equals(purple))).toEqual([true, false])
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▶ Skills (1 loaded · 2 visible)"))
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▼ Skills (1 loaded · 2 visible)"))
    await view.mockMouse.click(4, 1)
    const dialogView = await testRender(() => dialogRender(), { width: 60, height: 16 })
    try {
      await waitForMarkdown(dialogView)
      await dialogView.waitForFrame((frame) => frame.includes("id: two"))
      expect(dialogView.captureCharFrame()).toContain("Second")
    } finally { dialogView.renderer.destroy() }
  }, { width: 50 })
})

test("successful hidden loads retain one highlighted row per loaded ID, even after definitions disappear", async () => {
  const visible = { id: "visible", name: "visible", description: "Visible", content: "" }
  const loaded = { id: "loaded", name: "loaded", description: "Loaded", content: "" }
  let available = [
    visible, loaded,
    { id: "manual", name: "manual-name", description: "Hidden even though its name matches another ID", autoinvoke: false, content: "" },
    { id: "disabled", name: "disabled", description: "disable-model-invocation normalizes to autoinvoke:false", autoinvoke: false, content: "" },
    { id: "missing", name: "no-description", content: "" },
    { id: "denied", name: "denied", description: "Permission denied", content: "" },
  ]
  const [messages, setMessages] = createSignal<any[]>([
    { type: "skill", skill: "manual", name: "visible" },
    { type: "user", skills: [{ id: "denied" }, { id: "disabled" }] },
    { type: "skill", skill: "another-project-id", name: "visible" },
    { type: "skill", name: "visible" }, // No ID: do not guess by display name.
    { type: "skill", skill: "loaded", name: "loaded" },
    { type: "assistant", content: [{ type: "tool", name: "skill", state: { status: "error", input: { id: "failed" } } }] },
  ])
  const history = [
    { type: "assistant", content: [{ type: "tool", name: "skill", state: {
      status: "completed", input: { id: "missing" },
      content: [{ type: "text", text: '<skill_content name="no-description">\n# Missing' }],
    } }] },
    { type: "user", skills: [{ id: "manual", name: "visible" }, { name: "visible" }] },
  ]
  const purple = RGBA.fromHex("#bc8cff")
  const context = makeContext({
    skills: () => available,
    agents: () => [{ id: "build", permissions: [{ action: "skill", resource: "denied", effect: "deny" }] }],
    messages,
    messageList: async () => ({ data: [...history, ...messages()].reverse(), cursor: {} }),
  })
  Object.assign(context.theme.background.action.primary, { focused: purple })
  context.theme.text.muted = RGBA.fromHex("#8b949e")
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("• visible") && frame.includes("• loaded"))
    await Bun.sleep(0) // Allow the history backfill to settle too.
    await view.flush()
    const frame = view.captureCharFrame()
    const highlightedRows = () => view.captureSpans().lines.slice(1)
      .filter((line) => line.spans.some((span) => span.text.includes("•") && span.fg.equals(purple)))
    const mutedRows = () => view.captureSpans().lines.slice(1)
      .filter((line) => line.spans.some((span) => span.text.includes("•") && span.fg.equals(context.theme.text.muted)))
    expect(frame.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("•"))).toEqual([
      "• loaded", "• another-project-id", "• denied", "• disabled", "• manual-name", "• no-description", "• visible",
    ])
    expect((frame.split("\n").slice(1).join("\n").match(/visible/g) ?? []).length).toBe(1)
    const rows = view.captureSpans().lines.slice(1).flatMap((line) => line.spans)
    expect(rows.find((span) => span.text.includes("visible"))!.fg.equals(white)).toBe(true)
    expect(rows.find((span) => span.text.includes("loaded"))!.fg.equals(purple)).toBe(true)
    expect(highlightedRows().length).toBe(6)
    expect(mutedRows().length).toBe(0)
    expect(frame).not.toContain("failed")
    expect(frame).toContain("▼ Skills (6 loaded · 2 visible)")
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▶ Skills (6 loaded · 2 visible)"))
    // Hiding a loaded skill changes visibility, never its load record.
    available = [visible, { ...loaded, autoinvoke: false }]
    context.data.location.skill.invalidate(context.location)
    await context.data.location.skill.sync(context.location)
    await view.flush()
    expect(view.captureCharFrame()).toContain("Skills (6 loaded · 1 visible)")
    available = [{ ...visible, autoinvoke: false }]
    context.data.location.skill.invalidate(context.location)
    await context.data.location.skill.sync(context.location)
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("• manual"))
    expect(view.captureCharFrame()).toContain("▼ Skills (6 loaded · 0 visible)")
    expect(highlightedRows().length).toBe(6)
    expect(mutedRows().length).toBe(0)
    expect(view.captureCharFrame()).not.toContain("• visible")
    expect(view.captureCharFrame()).not.toContain("No model-visible skills")
    expect(view.captureCharFrame()).not.toContain(" tok")
    setMessages([...messages(), { id: "msg_compact", type: "compaction", status: "completed" }])
    await view.waitForFrame((frame) => frame.includes("Skills (0 loaded · 0 visible)"))
    expect(view.captureCharFrame()).toContain("No model-visible skills")
    expect(highlightedRows().length).toBe(0)
    expect(mutedRows().length).toBe(0)
    setMessages([...messages(), { type: "user", skills: [{ id: "manual" }, { id: "manual" }] }])
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 0 visible)"))
    expect(view.captureCharFrame()).toContain("• manual")
    expect(highlightedRows().length).toBe(1)
    expect(mutedRows().length).toBe(0)
    expect(view.captureCharFrame()).not.toContain(" tok")
  })
})

test.each(["tool", "attachment", "direct"])("hidden skills appear only after a successful %s load and still support read-only previews", async (source) => {
  const skill = { id: "hidden", name: "Hidden", description: "Manual only", autoinvoke: false, path: "/missing/SKILL.md", content: "Hidden body." }
  const tool = (status: string) => ({ type: "assistant", content: [{ type: "tool", name: "skill", state: {
    status, input: { id: skill.id }, content: [{ type: "text", text: '<skill_content name="Hidden">Hidden body.' }],
  } }] })
  const [messages, setMessages] = createSignal<any[]>([tool("running"), tool("error")])
  let dialogRender!: () => any
  const purple = RGBA.fromHex("#bc8cff")
  const context = makeContext({
    skills: () => [skill], messages,
    onDialogShow: (render) => { dialogRender = render },
  })
  Object.assign(context.theme.background.action.primary, { focused: purple })
  context.theme.text.muted = RGBA.fromHex("#8b949e")
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("Skills (0 loaded · 0 visible)"))
    expect(view.captureCharFrame()).not.toContain("• Hidden")
    const success = source === "tool" ? tool("completed") : source === "attachment"
      ? { type: "user", skills: [{ id: skill.id }] } : { type: "skill", skill: skill.id }
    setMessages([...messages(), success, success])
    await view.waitForFrame((frame) => frame.includes("• Hidden"))
    expect(view.captureCharFrame()).toContain("Skills (1 loaded · 0 visible)")
    const row = view.captureSpans().lines[1].spans
    expect(row.find((span) => span.text.includes("•"))!.fg.equals(purple)).toBe(true)
    expect(row.find((span) => span.text.includes(skill.name))!.fg.equals(purple)).toBe(true)
    const before = JSON.stringify({ skill, messages: messages() })
    await view.mockMouse.click(4, 1)
    const dialogView = await testRender(() => dialogRender(), { width: 60, height: 16 })
    try {
      await waitForMarkdown(dialogView)
      await dialogView.waitForFrame((frame) => frame.includes("Hidden body."))
      expect(dialogView.captureCharFrame()).toContain(`path: ${skill.path}`)
    } finally { dialogView.renderer.destroy() }
    expect(JSON.stringify({ skill, messages: messages() })).toBe(before)
    expect(view.captureCharFrame()).toContain("Skills (1 loaded · 0 visible)")
  })
})

test("loaded counts only displayed rows while the registry is pending or the agent is unavailable", async () => {
  const pending = Promise.withResolvers<void>()
  const [agentID, setAgentID] = createSignal("build")
  const context = makeContext({
    skills: () => [{ id: "manual", name: "Manual", description: "Manual only", autoinvoke: false }],
    skillSync: () => pending.promise,
    session: () => ({ agent: agentID(), location: context.location }),
    messages: () => [{ type: "user", skills: [{ id: "manual" }] }],
  })
  await withPanel(context, async (view) => {
    try {
      await view.flush()
      expect(view.captureCharFrame()).toContain("Skills (0 loaded · 0 visible)")
      expect(view.captureCharFrame()).toContain("Loading skills…")
      expect(view.captureCharFrame()).not.toContain("• Manual")
      pending.resolve()
      await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 0 visible)"))
      expect(view.captureCharFrame()).toContain("• Manual")
      setAgentID("missing-agent")
      await view.flush()
      expect(view.captureCharFrame()).toContain("Skills (0 loaded · 0 visible)")
      expect(view.captureCharFrame()).toContain("Agent unavailable: missing-agent")
      expect(view.captureCharFrame()).not.toContain("• Manual")
      setAgentID("build")
      await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 0 visible)"))
      expect(view.captureCharFrame()).toContain("• Manual")
    } finally { pending.resolve() }
  })
})

test("moving the same session between workspace IDs syncs separate catalogs", async () => {
  const [workspaceID, setWorkspaceID] = createSignal("workspace-a")
  const calls: string[] = []
  const context = makeContext({
    session: () => ({ agent: "build", location: { directory: "shared-directory", workspaceID: workspaceID() } }),
    skillSync: async (location) => { calls.push(location.workspaceID) },
    skills: (location) => [{ id: location.workspaceID ?? "initial", name: location.workspaceID ?? "initial", description: "Workspace skill", content: "" }],
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("workspace-a"))
    setWorkspaceID("workspace-b")
    await view.waitForFrame((frame) => frame.includes("workspace-b"))
    expect(view.captureCharFrame()).not.toContain("workspace-a")
    setWorkspaceID("workspace-a")
    await view.flush()
    expect(view.captureCharFrame()).toContain("workspace-a")
    expect(view.captureCharFrame()).not.toContain("workspace-b")
    expect(calls.filter(Boolean)).toEqual(["workspace-a", "workspace-b"])
  }, { width: 50, sessionID: "same-session" })
})

test("host agent catalog permission changes update a stable slot without switching agents", async () => {
  const [permissions, setPermissions] = createSignal<any[]>([])
  const context = makeContext({
    agents: () => [{ id: "build", permissions: permissions() }],
    skills: () => [{ id: "review", name: "Review", description: "Review code" }],
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("Review"))
    setPermissions([{ action: "skill", resource: "review", effect: "deny" }])
    await view.flush()
    expect(view.captureCharFrame()).toContain("Skills (0 loaded · 0 visible)")
    expect(view.captureCharFrame()).not.toContain(" tok")
    expect(view.captureCharFrame()).not.toContain("Review")
    setPermissions([{ action: "skill", resource: "review", effect: "ask" }])
    await view.flush()
    expect(view.captureCharFrame()).toContain("Review")
    expect(view.captureCharFrame()).toContain("Skills (0 loaded · 1 visible)")
  }, { width: 50 })
})

test.each([
  { content: "" },
  { content: "abcd" },
  { content: "中文😀" },
  { content: "x".repeat(12_345) },
])("overview stats field uses code points for chars and UTF-8 host-payload estimates for tokens: $content", async ({ content }) => {
  let dialogRender!: () => any
  const skill = { id: "stats", name: "Stats", description: "", content }
  const idRow = "id: stats"
  const label = previewStatsLabel([...content].length, skill)
  const context = makeContext({
    skills: () => [skill],
    onDialogShow: (render) => { dialogRender = render },
  })
  context.theme.text.muted = RGBA.fromHex("#8b949e")
  context.theme.text.base = RGBA.fromHex("#c9d1d9")
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("• Stats"))
    await view.mockMouse.click(4, 1)
    const dialogView = await testRender(() => dialogRender(), { width: 100, height: 24 })
    try {
      await waitForMarkdown(dialogView)
      await dialogView.waitForFrame((frame) => frame.includes(label))
      const rows = dialogView.captureCharFrame().split("\n")
      expect(rows[0].trim()).toContain(idRow)
      expect(rows[1]).toContain(label)
      expect(rows[1].trimStart()).toStartWith("stats: chars ")
      expect(rows[1]).not.toMatch(/chars:|list entry:|load cost:|total cost:/)
      expect(rows[2]).toContain("path: -")
      expect(rows[3].trim()).toMatch(/^-+ provided by plugin -{7}$/)
      expect(rows[4].trim()).toBe("")
      const statistics = dialogView.captureSpans().lines[1].spans.find((span) => span.text.includes("stats:"))!
      expect(statistics.text.trim()).toBe(label)
      expect(statistics.fg.equals(context.theme.text.muted)).toBe(true)
      expect(statistics.attributes & TextAttributes.ITALIC).toBe(TextAttributes.ITALIC)
      for (const width of [19, 26, 70, 100]) {
        dialogView.resize(width, 24)
        await dialogView.flush()
        const lines = dialogView.captureSpans().lines
        const pathRow = lines.findIndex((line) => line.spans.some((span) => span.text.includes("path:")))
        expect(pathRow).toBeGreaterThan(0)
        const wrapped = lines.slice(0, pathRow).flatMap((line) => line.spans)
          .filter((span) => span.fg.equals(context.theme.text.muted)).map((span) => span.text).join("")
        expect(wrapped.replace(/\s/g, "")).toBe((idRow + label).replace(/\s/g, ""))
        const separator = dialogView.renderer.root.findDescendantById("skills-preview.separator")!
        const separatorSpans = lines.slice(separator.y, separator.y + separator.height).flatMap((line) => line.spans)
          .filter((span) => span.text.trim())
        expect(separatorSpans.map((span) => span.text).join("").replace(/\s/g, "")).toMatch(/^-*providedbyplugin-*$/)
        expect(separatorSpans.every((span) => span.fg.equals(context.theme.text.muted) && (span.attributes & TextAttributes.ITALIC) !== 0)).toBe(true)
        expect(separatorSpans.reduce((width, span) => width + span.width, 0)).toBeLessThanOrEqual(separator.width * separator.height)
      }
      expect(view.captureCharFrame()).toContain("Skills (0 loaded · 1 visible)")
      expect(view.captureCharFrame()).not.toContain("toks")
    } finally { dialogView.renderer.destroy() }
  }, { width: 70, height: 24 })
})

test.each([0, 1, 2] as const)("preview normalizes CRLF and stays read-only even when disk and registered content differ (button %i)", async (button) => {
  const dir = mkdtempSync(join(tmpdir(), "skills-tui-readonly-"))
  const path = join(dir, "SKILL.md")
  const raw = "---\r\nname: Review\r\ndescription: Disk description\r\n---\r\n\r\n# Disk body\r\n"
  writeFileSync(path, raw)
  const skill = { id: "review", name: "Review", description: "Registered description", path, content: "# Registered body" }
  const session = { agent: "build", permissions: [], location: { directory: process.cwd() } }
  const before = JSON.stringify({ skill, session })
  const clientAccesses: PropertyKey[] = []
  let dialogRender!: () => any
  const context = makeContext({
    skills: () => [skill],
    session: () => session,
    prefs: { preview: (["left-click", "middle-click", "right-click"] as const)[button], mention: "off" },
    onDialogShow: (render) => { dialogRender = render },
  })
  Object.assign(context, { client: new Proxy(context.client, {
    get(target, key, receiver) {
      clientAccesses.push(key)
      if (key !== "message" && key !== "file") throw new Error(`Preview must not access client.${String(key)}`)
      return Reflect.get(target, key, receiver)
    },
  }) })
  try {
    await withPanel(context, async (view) => {
      await view.waitForFrame((frame) => frame.includes("Review"))
      await view.mockMouse.click(4, 1, button)
      const dialogView = await testRender(() => dialogRender(), { width: 70, height: 16 })
      try {
        await waitForMarkdown(dialogView)
        await dialogView.waitForFrame((frame) => frame.includes("Disk body"))
        const frame = dialogView.captureCharFrame()
        expect(frame.split("\n")[0].trim()).toBe("id: review")
        const rows = frame.split("\n").map((line) => line.trim())
        const pathRow = rows.findIndex((line) => line.startsWith("path:"))
        expect(rows.slice(1, pathRow).join(" ").replace(/\s/g, "")).toBe(previewStatsLabel(56, skill).replace(/\s/g, ""))
        expect(frame).toContain("description: Disk description")
        expect(frame).not.toContain("Registered body")
        expect(frame).not.toContain("\r")
        expect(readFileSync(path, "utf8")).toBe(raw)
        expect(JSON.stringify({ skill, session })).toBe(before)
        expect(view.captureCharFrame()).toContain("Skills (0 loaded · 1 visible)")
        expect(clientAccesses.every((key) => key === "message" || key === "file")).toBe(true)
      } finally { dialogView.renderer.destroy() }
    }, { width: 70, height: 16 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("preview Markdown exposes HTTP links through native renderer hit testing", async () => {
  let dialogRender!: () => any
  const url = "https://example.com/skills-verification"
  const context = makeContext({
    skills: () => [{ id: "links", name: "Links", description: "", content: `[Documentation](${url})` }],
    onDialogShow: (render) => { dialogRender = render },
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("Links"))
    await view.mockMouse.click(4, 1)
    const dialogView = await testRender(() => dialogRender(), { width: 70, height: 16 })
    try {
      await waitForMarkdown(dialogView)
      await dialogView.waitForFrame((frame) => frame.includes("Documentation"))
      const targets = new Set<string | null>()
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 70; x++) targets.add(dialogView.renderer.getLinkAt(x, y))
      }
      expect(targets.has(url)).toBe(true)
    } finally { dialogView.renderer.destroy() }
  }, { width: 70, height: 16 })
})

test.each([false, true])("Skills Sidebar groups clear setting labels without search, preserving keys and arrow/Enter cycling (Kitty: %s)", async (kittyKeyboard) => {
  const context = makeContext({ skills: () => [{ id: "one", name: "One", description: "One" }] })
  await withSider(context, async (view, host) => {
    const command = context.keymap.commands().find((command) => command.id === "opencode-skills-tui.sider")!
    expect(command.slash).toEqual({ name: "skills-sidebar" })
    expect(command.palette).toBe(true)
    expect(command.description).toBe("Configure the skills sidebar")
    expect(command.title).toBe("Skills Sidebar")
    host.open()
    await view.waitForFrame((frame) => frame.includes("Skills Sidebar") && frame.includes("model-visible"))
    const frame = view.captureCharFrame()
    expect(frame).not.toContain("Search")
    expect(view.renderer.root.findDescendantById("skills-sider.search")).toBeUndefined()
    expect(frame).toContain("Sidebar Display")
    expect(frame).toContain("Mouse actions")
    const rows = frame.split("\n").map((line) => line.trim())
    expect(rows.filter((line) => ["Settings", "Sidebar Display", "Mouse actions"].includes(line))).toEqual(["Sidebar Display", "Mouse actions"])
    expect(rows.slice(rows.indexOf("Sidebar Display") + 1, rows.indexOf("Sidebar Display") + 5).map((line) => line.split(/\s{2,}/)[0]))
      .toEqual(["Show sidebar", "Display scope", "Token estimation", "Header counts"])
    expect(frame).not.toMatch(/Skills Sider|Cursor Actions|Loaded total|\b(switch|state)\b/)
    expect(frame.split("\n").find((line) => line.includes("↑/↓"))!.indexOf("↑"))
      .toBe(frame.split("\n").find((line) => line.trim() === "Sidebar Display")!.indexOf("Sidebar Display"))
    for (const title of ["Sidebar Display", "Mouse actions"]) {
      const span = view.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.trim() === title)!
      expect(span.fg.equals(context.theme.hue.accent[200])).toBe(true)
    }
    expect(frame).not.toContain("ctrl+o")
    expect(frame).not.toContain("• One")
    for (const [key, value] of [["Show sidebar", "on"], ["Display scope", "model-visible"], ["Token estimation", "off"], ["Header counts", "on"], ["Skill overview", "left-click"], ["Insert @mention", "right-click"]]) {
      const row = frame.split("\n").find((line) => line.trim().startsWith(key))!
      expect(row.trimEnd().endsWith(value)).toBe(true)
    }
    const switchRow = view.renderer.root.findDescendantById("skills-sider.switch")!
    const [label, value] = switchRow.getChildren()
    expect(value.x).toBeGreaterThanOrEqual(label.x + label.width + 1)
    expect(switchRow.height).toBe(1)
    view.mockInput.pressArrow("right")
    await view.waitForFrame((frame) => /Show sidebar\s+off/.test(frame))
    view.mockInput.pressEnter()
    await view.waitForFrame((frame) => /Show sidebar\s+on/.test(frame))
    view.mockInput.pressArrow("down")
    view.mockInput.pressArrow("left")
    await view.waitForFrame((frame) => /Display scope\s+loaded-only/.test(frame))
    view.mockInput.pressEnter()
    await view.waitForFrame((frame) => /Display scope\s+model-visible/.test(frame))
    view.mockInput.pressKey("END")
    view.mockInput.pressArrow("right")
    await view.waitForFrame((frame) => /Insert @mention\s+off/.test(frame))
    await view.mockInput.typeText("MEN")
    expect(view.captureCharFrame()).toContain("Display scope")
    expect(host.draft.skills).toEqual([])
    await host.escape()
    host.open()
    await view.waitForFrame((frame) => /Skill overview\s+left-click/.test(frame) && /Insert @mention\s+off/.test(frame))
    await host.escape()
    await host.change("preview", "enter")
    host.open()
    await view.waitForFrame((frame) => /Skill overview\s+middle-click/.test(frame) && /Insert @mention\s+off/.test(frame))
    view.mockInput.pressKey("HOME")
    for (let i = 0; i < 4; i++) view.mockInput.pressArrow("down")
    for (const label of ["right-click", "off", "left-click", "middle-click"]) {
      view.mockInput.pressEnter()
      await view.waitForFrame((frame) => new RegExp(`Skill overview\\s+${label}`).test(frame))
    }
    view.mockInput.pressArrow("left")
    await view.waitForFrame((frame) => /Skill overview\s+left-click/.test(frame))
    await host.escape()
    await host.change("token")
    host.open()
    await view.waitForFrame((frame) => /Token estimation\s+list entry/.test(frame))
    // Preserve the requested four-mode order with both keyboard directions and Enter.
    view.mockInput.pressKey("HOME")
    view.mockInput.pressArrow("down")
    view.mockInput.pressArrow("down")
    for (const label of ["load cost", "total cost", "off", "list entry"]) {
      view.mockInput.pressEnter()
      await view.waitForFrame((frame) => frame.includes("Token estimation") && new RegExp(`Token estimation\\s+${label}`).test(frame))
    }
    view.mockInput.pressArrow("left")
    await view.waitForFrame((frame) => /Token estimation\s+off/.test(frame))
    view.mockInput.pressArrow("left")
    await view.waitForFrame((frame) => /Token estimation\s+total cost/.test(frame))
    view.mockInput.pressArrow("right")
    view.mockInput.pressArrow("right")
    await view.waitForFrame((frame) => /Token estimation\s+list entry/.test(frame))
    expect(view.captureCharFrame()).not.toContain("not implemented")
    await host.escape()
    expect(view.captureCharFrame()).toContain(" tok")
    expect(host.prompt.plainText).toBe("keep @file ")
    expect(host.submits()).toBe(0)
    expect(host.dispatches.every((id) => id === "opencode-skills-tui.sider")).toBe(true)
  }, { kittyKeyboard })
})

test("setting conflicts stay red and uncommitted, without changing previously valid mouse buttons", async () => {
  const [prefs, setPrefs] = createStore({ switch: "on", scope: "model", token: "off", state: "on", preview: "left-click", mention: "right-click", collapsed: false })
  const context = makeContext({ storage: { store: () => [prefs, async (change: (draft: typeof prefs) => void) => { setPrefs(produce(change)) }] } })
  await withSider(context, async (view, host) => {
    host.open()
    await view.waitForFrame((frame) => frame.includes("Mouse actions"))
    const previewRow = view.renderer.root.findDescendantById("skills-sider.preview")!
    await view.mockMouse.click(previewRow.x + 4, previewRow.y)
    await view.waitForFrame((frame) => /Skill overview\s+middle-click/.test(frame))
    expect(prefs.preview).toBe("middle-click")
    expect(prefs.mention).toBe("right-click")
    expect(view.captureCharFrame()).not.toContain("Button conflict")
    await view.mockMouse.click(previewRow.x + 4, previewRow.y)
    await view.waitForFrame((frame) => frame.includes("Button conflict"))
    for (const key of ["preview", "mention"]) {
      const row = view.renderer.root.findDescendantById(`skills-sider.${key}`)!
      const span = view.captureSpans().lines[row.y].spans.find((span) => span.text.includes("right-click"))!
      expect(span.fg.equals(context.theme.text.feedback.error.base)).toBe(true)
    }
    expect(prefs.preview).toBe("middle-click")
    expect(prefs.mention).toBe("right-click")
    // Unrelated settings still apply while a mouse-binding candidate is invalid.
    view.mockInput.pressKey("HOME")
    view.mockInput.pressArrow("down")
    view.mockInput.pressEnter()
    expect(prefs.scope).toBe("registered")
    await host.escape()
    host.open()
    await view.waitForFrame((frame) => /Skill overview\s+middle-click/.test(frame) && /Insert @mention\s+right-click/.test(frame))
    expect(view.captureCharFrame()).not.toContain("Button conflict")
    await host.escape()
    // Same edge case as the user's decision: default right-click is already occupied.
    await host.change("mention") // right-click -> off
    await host.change("preview") // middle-click -> right-click
    host.open()
    await view.flush()
    view.mockInput.pressKey("END")
    view.mockInput.pressArrow("left") // off -> right-click, conflicts
    await view.waitForFrame((frame) => frame.includes("Button conflict"))
    context.ui.dialog.clear() // Backdrop/replacement dismissal also discards the candidate.
    await view.flush()
    expect(prefs.preview).toBe("right-click")
    expect(prefs.mention).toBe("off")
    host.open()
    await view.flush()
    view.mockInput.pressKey("END")
    view.mockInput.pressEnter() // off -> left-click is valid
    await view.waitForFrame((frame) => /Insert @mention\s+left-click/.test(frame))
    expect(prefs.preview).toBe("right-click")
    expect(prefs.mention).toBe("left-click")
    expect(host.submits()).toBe(0)
  })
})

test.each(["preview", "mention"] as const)("middle-click conflicts for %s stay uncommitted and dismissal retains both valid bindings", async (key) => {
  const initial = key === "preview" ? { preview: "left-click", mention: "middle-click" } : { preview: "middle-click", mention: "right-click" }
  const [prefs, setPrefs] = createStore({ ...initial, switch: "on", scope: "model", token: "off", state: "on", collapsed: false })
  const context = makeContext({ storage: { store: () => [prefs, async (change: (draft: typeof prefs) => void) => { setPrefs(produce(change)) }] } })
  await withSider(context, async (view, host) => {
    host.open()
    await view.waitForFrame((frame) => frame.includes("Mouse actions"))
    view.mockInput.pressKey("END")
    if (key === "preview") view.mockInput.pressArrow("up")
    view.mockInput.pressArrow(key === "preview" ? "right" : "left")
    await view.waitForFrame((frame) => frame.includes("Button conflict"))
    for (const action of ["preview", "mention"]) {
      const row = view.renderer.root.findDescendantById(`skills-sider.${action}`)!
      const span = view.captureSpans().lines[row.y].spans.find((span) => span.text.includes("middle-click"))!
      expect(span.fg.equals(context.theme.text.feedback.error.base)).toBe(true)
    }
    expect(prefs).toMatchObject(initial)
    await host.escape()
    host.open()
    await view.waitForFrame((frame) => frame.includes("Mouse actions"))
    expect(view.captureCharFrame()).not.toContain("Button conflict")
    expect(prefs).toMatchObject(initial)
    expect(host.draft.skills).toEqual([])
    expect(host.submits()).toBe(0)
  })
})

test("settings hover uses the native selection highlight; press selects and release cycles", async () => {
  const context = makeContext()
  await withSider(context, async (view, host) => {
    host.open()
    await view.waitForFrame((frame) => frame.includes("Skills Sidebar"))
    const scope = view.renderer.root.findDescendantById("skills-sider.scope")!
    const x = scope.x + scope.width - 4
    await view.mockMouse.moveTo(x, scope.y)
    await view.flush()
    expect(scope.backgroundColor.equals(context.theme.background.action.primary.focused)).toBe(true)
    const selected = view.captureSpans().lines[scope.y].spans.find((span) => span.text.includes("Display scope"))!
    expect(selected.fg.equals(context.theme.text.action.primary.focused)).toBe(true)
    await view.mockMouse.pressDown(x, scope.y)
    expect(view.captureCharFrame()).toContain("model-visible")
    await view.mockMouse.release(x, scope.y)
    await view.waitForFrame((frame) => /Display scope\s+registered/.test(frame))
    const state = view.renderer.root.findDescendantById("skills-sider.state")!
    await view.mockMouse.moveTo(state.x + 4, state.y)
    await view.flush()
    expect(state.backgroundColor.equals(context.theme.background.action.primary.focused)).toBe(true)
    expect(scope.backgroundColor.equals(context.theme.background.action.primary.focused)).toBe(false)
    view.mockInput.pressEnter()
    await view.waitForFrame((frame) => /Header counts\s+off/.test(frame))
    await host.escape()
    expect(view.captureCharFrame()).toContain("Skills")
    expect(view.captureCharFrame()).not.toContain("loaded")
    expect(host.prompt.plainText).toBe("keep @file ")
    expect(host.submits()).toBe(0)
  })
})

test("Header counts hides only header counts, preserving highlights and optional token totals", async () => {
  const skill = { id: "one", name: "One", description: "One", path: "/builtin/one.md", content: "x".repeat(512) }
  const estimate = tokenLabel(estimateSkillTokens(skill, "load-delta"))
  const context = makeContext({
    skills: () => [skill],
    messages: () => [{ type: "skill", skill: "one" }],
    prefs: { token: "load-delta" },
  })
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("1 loaded") && frame.includes(estimate))
    await host.change("state")
    expect(view.captureCharFrame()).not.toContain("loaded")
    expect(view.captureCharFrame()).toContain(estimate)
    const row = view.captureSpans().lines.find((line) => line.spans.some((span) => span.text.includes("One")))!
    expect(row.spans.some((span) => span.text.includes("One") && span.fg.equals(context.theme.background.action.primary.focused))).toBe(true)
    await view.mockMouse.click(4, 0)
    await view.waitForFrame((frame) => frame.includes("▶ Skills"))
    expect(view.captureCharFrame()).toContain(estimate)
    expect(view.captureCharFrame()).not.toContain("loaded")
    await host.change("state")
    await view.waitForFrame((frame) => frame.includes("1 loaded"))
  })
})

test("Show sidebar only hides the panel; Display scope retains loaded IDs and current-stage compaction rules", async () => {
  const [messages, setMessages] = createSignal<any[]>([{ type: "user", skills: [{ id: "manual" }] }])
  const context = makeContext({
    skills: () => [
      { id: "visible", name: "Visible", description: "Visible" },
      { id: "manual", name: "Manual", description: "Manual", autoinvoke: false },
      { id: "not-loaded", name: "No desc" },
    ],
    messages,
  })
  context.theme.text.muted = RGBA.fromHex("#8b949e")
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded · 1 visible)"))
    expect(view.captureCharFrame()).not.toContain("not-loaded")
    await host.change("scope", "enter")
    await view.waitForFrame((frame) => frame.includes("• No desc") && frame.includes("• Visible"))
    expect(view.captureCharFrame()).toContain("Skills (1 loaded · 3 registered)")
    await host.change("scope")
    await view.waitForFrame((frame) => frame.includes("• Manual") && !frame.includes("• Visible"))
    expect(view.captureCharFrame()).toContain("Skills (1 loaded)")
    await host.change("switch")
    expect(view.captureCharFrame()).not.toContain("Skills")
    expect(host.prompt.plainText).toBe("keep @file ")
    setMessages([...messages(), { type: "skill", skill: "removed-definition" }])
    await host.change("switch", "left")
    await view.waitForFrame((frame) => frame.includes("Skills (2 loaded)") && frame.includes("• removed-definition"))
    const highlightedRows = () => view.captureSpans().lines.filter((line) => line.spans.some((span) => span.text.includes("•") && span.fg.equals(context.theme.surface("dialog").background.action.primary.focused)))
    expect(highlightedRows().length).toBe(2)
    setMessages([...messages(), { id: "compact", type: "compaction", status: "running" }])
    await view.flush()
    expect(view.captureCharFrame()).toContain("• Manual")
    setMessages([...messages(), { id: "compact-failed", type: "compaction", status: "failed" }])
    await view.flush()
    expect(view.captureCharFrame()).toContain("2 loaded")
    setMessages([...messages(), { id: "compact-done", type: "compaction", status: "completed" }])
    await view.waitForFrame((frame) => frame.includes("Skills (0 loaded)") && frame.includes("No skills loaded"))
    expect(highlightedRows().length).toBe(0)
    setMessages([...messages(), { type: "user", skills: [{ id: "manual" }] }])
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded)") && frame.includes("• Manual"))
    expect(highlightedRows().length).toBe(1)
    await host.change("scope", "left")
    await view.waitForFrame((frame) => frame.includes("• Manual") && frame.includes("• Visible"))
    expect(view.captureCharFrame()).toContain("• No desc")
    await host.change("scope", "left")
    setMessages([...messages(), { id: "compact-again", type: "compaction", status: "completed" }])
    await view.waitForFrame((frame) => frame.includes("• Visible") && !frame.includes("• Manual"))
    expect(host.submits()).toBe(0)
  })
})

test("loaded hidden skills are pinned; unloaded hidden rows and token values stay muted", async () => {
  const [permissions, setPermissions] = createSignal<any[]>([{ action: "skill", resource: "denied", effect: "deny" }])
  const [muted, setMuted] = createSignal(RGBA.fromHex("#8b949e"))
  const [scope, setScope] = createSignal("registered")
  const [token, setToken] = createSignal("listing")
  const skills = [
    { id: "manual", name: "Shared", description: "Manual", autoinvoke: false },
    { id: "loaded", name: "Zulu", description: "Loaded" },
    { id: "denied", name: "A denied", description: "Denied" },
    { id: "missing", name: "B missing" },
    { id: "shared", name: "Shared", description: "Visible shared name" },
    { id: "visible", name: "Alpha", description: "Visible" },
  ]
  const context = makeContext({
    skills: () => skills, agents: () => [{ id: "build", permissions: permissions() }],
    messages: () => [{ type: "user", skills: [{ id: "manual" }, { id: "loaded" }] }],
    storage: { store: (_key: string, options: { initial: object }) => [
      { ...options.initial, get scope() { return scope() }, get token() { return token() } }, async () => {},
    ] },
  })
  Object.assign(context.theme.background.action.primary, { focused: RGBA.fromHex("#fab283") })
  Object.defineProperty(context.theme.text, "muted", { get: muted })
  await withPanel(context, async (view) => {
    const node = (id: string) => view.renderer.root.findDescendantById(`skills-panel.${id}`)
    const order = () => skills.map((skill) => node(skill.id)).filter((row): row is Renderable => !!row)
      .toSorted((left, right) => left.y - right.y).map((row) => row.id.slice("skills-panel.".length))
    const spans = (id: string) => view.captureSpans().lines[node(id)!.y].spans.filter((span) => span.text.trim())
    const expectManualHighlight = () => {
      const row = spans("manual")
      expect(row.filter((span) => !span.text.includes("tok")).every((span) => span.fg.equals(context.theme.surface("dialog").background.action.primary.focused))).toBe(true)
      expect(row.filter((span) => span.text.includes("tok")).every((span) => span.fg.equals(muted()))).toBe(true)
    }
    await view.waitForFrame((frame) => frame.includes("Skills (2 loaded · 6 registered)"))
    expect(order()).toEqual(["loaded", "manual", "visible", "shared", "denied", "missing"])
    for (const id of ["denied", "missing"]) expect(spans(id).every((span) => span.fg.equals(muted()))).toBe(true)
    expectManualHighlight()
    expect(spans("loaded").some((span) => span.text.includes("Zulu") && span.fg.equals(context.theme.surface("dialog").background.action.primary.focused))).toBe(true)
    expect(spans("shared").some((span) => span.text.includes("Shared") && span.fg.equals(white))).toBe(true)
    setMuted(RGBA.fromHex("#6f767e"))
    await view.flush()
    for (const id of ["denied", "missing"]) expect(spans(id).every((span) => span.fg.equals(muted()))).toBe(true)
    expectManualHighlight()
    setPermissions([{ action: "skill", resource: "denied", effect: "ask" }])
    await view.flush()
    expect(order()).toEqual(["loaded", "manual", "denied", "visible", "shared", "missing"])
    expect(spans("denied").some((span) => span.text.includes("A denied") && span.fg.equals(white))).toBe(true)
    expect(view.captureCharFrame()).toContain("2 loaded · 6 registered")
    setScope("loaded")
    await view.flush()
    expect(order()).toEqual(["loaded", "manual"])
    expectManualHighlight()
    expect(view.captureCharFrame()).toContain("Skills (2 loaded)")
    setScope("model")
    await view.flush()
    expect(order()).toEqual(["loaded", "manual", "denied", "visible", "shared"])
    expect(view.captureCharFrame()).toContain("2 loaded · 4 visible")
    setToken("off")
    await view.flush()
    expect(view.captureCharFrame()).not.toContain(" tok")
    expectManualHighlight()
  }, { width: 100 })
})

test("grouped settings keep values aligned and keyboard selection visible in short terminals", async () => {
  await withSider(makeContext(), async (view, host) => {
    host.open()
    await view.waitForFrame((frame) => frame.includes("model-visible"))
    for (const key of ["switch", "scope", "preview", "mention", "token", "state"]) {
      const row = view.renderer.root.findDescendantById(`skills-sider.${key}`)!
      const [label, value] = row.getChildren()
      expect(value.x).toBeGreaterThanOrEqual(label.x + label.width + 1)
      expect(row.height).toBe(1)
      expect(value.x + value.width).toBeLessThanOrEqual(39)
    }
    view.mockInput.pressKey("HOME")
    view.mockInput.pressArrow("down")
    view.mockInput.pressArrow("down")
    for (let i = 0; i < 3; i++) view.mockInput.pressArrow("right")
    await view.waitForFrame((frame) => /Token estimation\s+total cost/.test(frame))
    const tokenRow = view.renderer.root.findDescendantById("skills-sider.token")!
    const [tokenLabel, tokenValue] = tokenRow.getChildren()
    expect(tokenValue.x).toBeGreaterThanOrEqual(tokenLabel.x + tokenLabel.width + 1)
    expect(tokenValue.x + tokenValue.width).toBeLessThanOrEqual(39)
    expect(tokenRow.height).toBe(1)
    await view.mockMouse.click(tokenValue.x + tokenValue.width - 2, tokenRow.y)
    await view.waitForFrame((frame) => /Token estimation\s+off/.test(frame))
    view.mockInput.pressKey("END")
    await view.waitForFrame((frame) => /Insert @mention\s+right-click/.test(frame))
    view.mockInput.pressArrow("down")
    await view.waitForFrame((frame) => frame.includes("Sidebar Display") && /Show sidebar\s+on/.test(frame))
    expect(view.captureCharFrame()).not.toContain("Search")
    expect(host.draft.skills).toEqual([])
    await host.escape()
    await view.waitForFrame((frame) => frame.includes("No skills registered"))
    expect(host.submits()).toBe(0)
  }, { width: 40, height: 14 })
})

test.each(["listing", "load-delta", "loaded-total"] as const)("%s token columns right-align, total visible IDs and avoid the absolute scrollbar", async (token) => {
  const visible = { id: "long-id-" + "x".repeat(50), name: "Shared", description: "A", path: "/builtin/test.md", content: "x".repeat(512) }
  const hidden = { id: "manual", name: "Shared", description: "Manual", autoinvoke: false, content: "y".repeat(5200) }
  const [skills, setSkills] = createSignal([visible])
  let render!: (input: { sessionID: string }) => any
  let scroll!: ScrollBoxRenderable
  const context = makeContext({ skills, prefs: { token }, slot: (claim) => { render = claim.render; return () => {} } })
  const cleanup = plugin.setup!(context) as () => void
  const view = await testRender(() => <box width="100%" height="100%" paddingX={2}>
    <scrollbox ref={(value) => { scroll = value; value.verticalScrollBar.resetVisibilityControl() }}
      horizontalScrollbarOptions={{ visible: false }} verticalScrollbarOptions={{ position: "absolute", right: 0, top: 0, width: 1, height: "100%" }}>
      {createComponent(render, { sessionID: "session-1" })}
      <box height={skills().length > 1 ? 20 : 0} />
    </scrollbox>
  </box>, { width: 42, height: 12 })
  try {
    await view.waitForFrame((frame) => frame.includes(" tok"))
    const before = view.renderer.root.findDescendantById(`skills-panel.${visible.id}.tokens`)!
    const right = before.x + before.width
    expect(scroll.verticalScrollBar.visible).toBe(false)
    setSkills([visible, hidden])
    context.data.location.skill.invalidate(context.location)
    await context.data.location.skill.sync(context.location)
    await view.flush()
    expect(scroll.verticalScrollBar.visible).toBe(true)
    expect(view.renderer.root.findDescendantById(`skills-panel.${visible.id}.tokens`)!.x + before.width).toBe(right)
    expect(view.captureCharFrame()).not.toContain("manual") // Hidden, not loaded: no contribution.
    for (const width of [42, 30, 26]) {
      view.resize(width, 12)
      await view.flush()
      const total = view.renderer.root.findDescendantById("skills-panel.total-tokens")!
      const row = view.renderer.root.findDescendantById(`skills-panel.${visible.id}.tokens`)!
      expect(total.x + total.width).toBe(row.x + row.width)
      expect(row.x + row.width).toBeLessThanOrEqual(scroll.verticalScrollBar.x)
      expect(row.height).toBe(1)
      const line = view.captureCharFrame().split("\n")[row.y]
      expect(line.slice(row.x, row.x + row.width).trim()).toMatch(/^~[\d.]+k? tok$/)
      expect(line.slice(row.x, row.x + row.width).trim()).toBe(tokenLabel(estimateSkillTokens(visible, token)))
      const expectedTotal = token === "listing" ? estimateSkillListingTotal([visible]) : token === "loaded-total"
        ? estimateSkillListingTotal([visible])! + estimateSkillTokens(visible, "load-delta")! : estimateSkillTokens(visible, token)
      expect(view.captureCharFrame().split("\n")[total.y].slice(total.x, total.x + total.width).trim()).toBe(tokenLabel(expectedTotal))
    }
  } finally { cleanup(); view.renderer.destroy() }
})

test("token totals sum only model-visible skills across scopes, loads and registered updates", async () => {
  let catalog = [
    { id: "one", name: "Shared", description: "One", path: "/builtin/one.md", content: "x".repeat(512) },
    { id: "manual", name: "Shared", description: "Manual", autoinvoke: false, path: "/builtin/manual.md", content: "y".repeat(5200) },
  ]
  const label = (skill: typeof catalog[number]) => tokenLabel(estimateSkillTokens(skill, "load-delta"))
  const visibleLabel = label(catalog[0])
  const [messages, setMessages] = createSignal<any[]>([])
  const context = makeContext({ skills: () => catalog, messages, prefs: { token: "load-delta" } })
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes(visibleLabel))
    await host.change("scope") // model -> registered
    await view.waitForFrame((frame) => frame.includes(label(catalog[1]))) // hidden manual keeps a row estimate
    expect(cell(view, "skills-panel.total-tokens")).toBe(visibleLabel) // but never enters the total
    setMessages([{ type: "skill", skill: "manual" }])
    await host.change("scope") // registered -> loaded
    await view.waitForFrame((frame) => frame.includes("Skills (1 loaded)") && frame.includes(label(catalog[1])))
    expect(view.renderer.root.findDescendantById("skills-panel.one")).toBeUndefined()
    expect(cell(view, "skills-panel.total-tokens")).toBe("~0 tok")
    catalog = [{ ...catalog[1], content: "z".repeat(800) }]
    context.data.location.skill.invalidate(context.location)
    await context.data.location.skill.sync(context.location)
    await view.waitForFrame((frame) => frame.includes(label(catalog[0])))
    expect(cell(view, "skills-panel.total-tokens")).toBe("~0 tok")
    catalog = []
    context.data.location.skill.invalidate(context.location)
    await context.data.location.skill.sync(context.location)
    await view.waitForFrame((frame) => frame.includes("• manual")) // definition gone: ID-only row, estimate unknown
    expect(cell(view, "skills-panel.manual.tokens")).toBe("-")
    expect(cell(view, "skills-panel.total-tokens")).toBe("~0 tok")
    setMessages([...messages(), { id: "compact", type: "compaction", status: "completed" }])
    await view.waitForFrame((frame) => frame.includes("No skills loaded") && frame.includes("~0 tok"))
    await host.change("token") // load cost -> total cost
    expect(view.captureCharFrame()).toContain("~0 tok")
    await host.change("token") // total cost -> off
    expect(view.captureCharFrame()).not.toContain(" tok")
  })
})

test("total cost includes visible list-entry guidance once plus each ordinary load without loading skills", async () => {
  const visible = [
    { id: "one", name: "One", description: "First", path: "/builtin/one.md", content: "Body one" },
    { id: "two", name: "Two", description: "Second", path: "/builtin/two.md", content: "Body two" },
  ]
  const hidden = { id: "hidden", name: "Hidden", description: "Manual", autoinvoke: false, path: "/builtin/manual.md", content: "Manual body" }
  const context = makeContext({ skills: () => [...visible, hidden], prefs: { token: "loaded-total", scope: "registered" } })
  const expected = estimateSkillListingTotal(visible)! + visible.reduce((sum, skill) => sum + estimateSkillTokens(skill, "load-delta")!, 0)
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("• Hidden") && frame.includes(tokenLabel(expected)))
    expect(cell(view, "skills-panel.total-tokens")).toBe(tokenLabel(expected))
    for (const skill of visible) expect(cell(view, `skills-panel.${skill.id}.tokens`)).toBe(tokenLabel(estimateSkillTokens(skill, "loaded-total")))
    expect(cell(view, "skills-panel.hidden.tokens")).toBe(tokenLabel(estimateSkillTokens({ ...hidden, modelVisible: false }, "load-delta")))
    expect(view.captureCharFrame()).toContain("0 loaded")
    await host.change("scope") // registered -> loaded-only; no actual loads, so no contribution.
    await view.waitForFrame((frame) => frame.includes("No skills loaded"))
    expect(cell(view, "skills-panel.total-tokens")).toBe("~0 tok")
    expect(host.draft.skills).toEqual([])
    expect(host.submits()).toBe(0)
    expect(host.prompt.plainText).toBe("keep @file ")
  })
})

test.each([["metadata", "list entry"], ["instructions", "load cost"], ["loaded-total", "total cost"]])("existing terminal-memory token mode %s displays as %s without resetting other settings", async (legacy, label) => {
  const context = makeContext({
    prefs: { token: legacy, scope: "registered", state: "off" },
    skills: () => [{ id: "one", name: "One", description: "One", path: "/builtin/one.md", content: "Body" }],
  })
  await withSider(context, async (view, host) => {
    host.open()
    await view.waitForFrame((frame) => frame.includes("Skills Sidebar"))
    expect(view.captureCharFrame()).toMatch(new RegExp(`Token estimation\\s+${label}`))
    expect(view.captureCharFrame()).toMatch(/Display scope\s+registered/)
    expect(view.captureCharFrame()).toMatch(/Header counts\s+off/)
    expect(host.submits()).toBe(0)
  })
})

test.each(["load-delta", "loaded-total"] as const)("%s columns and the overview share asynchronous server path samples without loading or sending", async (mode) => {
  const pending = Promise.withResolvers<any>()
  const calls: any[] = []
  const skill = { id: "sample", name: "Sample", description: "", path: "/server/skills/sample/SKILL.md", content: "Registered body." }
  const location = { directory: "/server/project", workspaceID: "remote" }
  const context = makeContext({
    skills: () => [skill], session: () => ({ agent: "build", location }), prefs: { token: mode },
    fileList: (input) => { calls.push(input); return pending.promise },
  })
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("• Sample"))
    expect(cell(view, "skills-panel.sample.tokens")).toBe("-")
    expect(cell(view, "skills-panel.total-tokens")).toBe("-")
    await view.mockMouse.click(4, 1)
    await waitForMarkdown(view)
    expect(view.captureCharFrame()).toContain("load cost - · total cost -")
    pending.resolve({ location, data: [
      { type: "file", path: "../skills/sample/SKILL.md" },
      { type: "file", path: "../skills/sample/scripts-not-read.ts" },
    ] })
    const sampled = { ...skill, fileSamples: ["/server/skills/sample/scripts-not-read.ts"] }
    const load = tokenLabel(estimateSkillTokens(sampled, "load-delta"))
    const total = tokenLabel(estimateSkillTokens(sampled, "loaded-total"))
    await view.waitForFrame((frame) => frame.includes(`load cost ${load} · total cost ${total}`))
    expect(view.captureCharFrame()).toContain("stats: chars 16")
    expect(view.captureCharFrame()).not.toContain("size:")
    await host.escape()
    const rowLabel = tokenLabel(estimateSkillTokens(sampled, mode))
    const headerLabel = mode === "loaded-total" ? tokenLabel(estimateSkillListingTotal([sampled])! + estimateSkillTokens(sampled, "load-delta")!) : load
    await view.waitForFrame((frame) => frame.includes(rowLabel) && frame.includes(headerLabel))
    expect(cell(view, "skills-panel.sample.tokens")).toBe(rowLabel)
    expect(cell(view, "skills-panel.total-tokens")).toBe(headerLabel)
    expect(calls).toEqual([{ location, path: "/server/skills/sample" }])
    expect(view.captureCharFrame()).toContain("0 loaded")
    expect(host.draft.skills).toEqual([])
    expect(host.submits()).toBe(0)
    expect(host.prompt.plainText).toBe("keep @file ")
  }, { width: 120 })
})

test("path samples are lazy, location-isolated, invalidate on skill updates and discard late reads after cleanup", async () => {
  const requests = Array.from({ length: 4 }, () => Promise.withResolvers<any>())
  const events = new Map<string, (event: any) => void>()
  const calls: any[] = []
  const [workspaceID, setWorkspaceID] = createSignal("a")
  const [token, setToken] = createSignal("off")
  const skill = { id: "sample", name: "Sample", description: "", path: "/server/skills/sample/SKILL.md", content: "Body" }
  const location = () => ({ directory: "/server/project", workspaceID: workspaceID() })
  const context = makeContext({
    skills: () => [skill], session: () => ({ agent: "build", location: location() }),
    storage: { store: (_key, options) => [{ ...options.initial, get token() { return token() } }, async () => {}] },
    fileList: (input) => { calls.push(input); return requests[calls.length - 1].promise },
    on: (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  })
  await withPanel(context, async (view) => {
    await view.waitForFrame((frame) => frame.includes("• Sample"))
    expect(calls).toEqual([])
    setToken("listing")
    await view.waitForFrame((frame) => frame.includes(" tok"))
    expect(calls).toEqual([])
    setToken("load-delta")
    await view.waitFor(() => calls.length === 1)
    setWorkspaceID("b")
    await view.waitFor(() => calls.length === 2)
    const bFile = "/server/skills/sample/b-long-reference-name.md"
    requests[1].resolve({ location: location(), data: [{ type: "file", path: bFile }] })
    const label = tokenLabel(estimateSkillTokens({ ...skill, fileSamples: [bFile] }, "load-delta"))
    await view.waitForFrame((frame) => frame.includes(label))
    requests[0].resolve({ location: { directory: "/server/project", workspaceID: "a" }, data: [] })
    await view.flush()
    expect(view.captureCharFrame()).toContain(label)
    events.get("skill.updated")!({ location: location(), data: {} })
    await view.waitFor(() => calls.length === 3)
    requests[2].reject(new Error("directory unavailable"))
    await view.waitForFrame((frame) => !frame.includes(label))
    expect(view.renderer.root.findDescendantById("skills-panel.sample.tokens")).toBeDefined()
    events.get("skill.updated")!({ location: location(), data: {} })
    await view.waitFor(() => calls.length === 4)
  })
  // Cleanup aborts the still-pending recursive read: no request for the child follows.
  requests[3].resolve({ location: location(), data: [{ type: "directory", path: "/server/skills/sample/not-read" }] })
  await Bun.sleep(0)
  expect(calls.length).toBe(4)
})

test.each(["right-click", "middle-click"] as const)("native %s mention never renders the transient skill picker, even when its filter is delayed", async (mention) => {
  const [ready, setReady] = createSignal(false)
  const context = makeContext({ skills: () => [{ id: "one", name: "One", description: "One" }], prefs: { mention } })
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("• One"))
    const recorder = new TestRecorder(view.renderer)
    recorder.rec()
    try {
      await view.mockMouse.click(4, 1, mention === "middle-click" ? 1 : 2)
      await view.waitFor(() => host.draft.skills.length === 1)
      await view.flush()
      expect(recorder.recordedFrames.length).toBeGreaterThan(0)
      expect(recorder.recordedFrames.some(({ frame }) => frame.includes("Native skills") || frame.includes("Loading native skills"))).toBe(false)
      expect(host.prompt.plainText).toBe("@one keep @file ")
      expect(host.draft.files).toEqual([{ uri: "file:///keep.txt" }])
      expect(view.captureCharFrame()).toContain("0 loaded")
      expect(host.submits()).toBe(0)
    } finally { recorder.stop() }
  }, { nativeReady: ready, onNativeOpen: () => { setTimeout(() => setReady(true), 35) } })
})

test("cancelled native mention releases the frame wait without inserting or sending", async () => {
  const context = makeContext({ skills: () => [{ id: "one", name: "One", description: "One" }] })
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("• One"))
    await view.mockMouse.click(4, 1, 2)
    await view.waitFor(() => context.renderer.currentFocusedEditor === host.prompt)
    await view.flush()
    expect(host.dispatches).toEqual(["prompt.skills"])
    expect(view.renderer.listenerCount(CliRenderEvents.FOCUSED_EDITOR)).toBe(0)
    expect(host.draft.skills).toEqual([])
    expect(host.prompt.plainText).toBe("keep @file ")
    expect(host.submits()).toBe(0)
  }, { nativeReady: false, onNativeOpen: () => { setTimeout(() => context.ui.dialog.clear(), 35) } })
})

test("Skills Sidebar settings persist across sessions and restarts without saving collapse state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "skills-settings-"))
  const [sessionID, setSessionID] = createSignal("session-1")
  const expected = { switch: "off", scope: "registered", token: "listing", state: "off", preview: "middle-click", mention: "off" }
  const terminal = () => makeContext({
    skills: () => [{ id: "one", name: "One", description: "One" }],
    session: (id) => ({ agent: "build", location: { directory: id } }),
    storage: {
      store: (key: string, options: { initial: object }) => {
        const file = join(directory, `${key}.json`)
        const load = () => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : structuredClone(options.initial)
        const [state, setState] = createStore(load())
        return [state, async (update: (draft: object) => void) => {
          await Promise.resolve() // Host storage publishes reactive state after the durable commit.
          const draft = load()
          update(draft)
          writeFileSync(file, JSON.stringify(draft))
          setState(draft)
        }]
      },
    },
  })
  try {
    await withSider(terminal(), async (view, host) => {
      await view.waitForFrame((frame) => frame.includes("• One"))
      await view.mockMouse.click(4, 0)
      await view.waitForFrame((frame) => frame.includes("▶ Skills"))
      await host.change("scope")
      await host.change("token")
      await host.change("state")
      await host.change("preview")
      await host.change("mention")
      await host.change("switch")
      expect(view.captureCharFrame()).not.toContain("Skills")
      setSessionID("session-2")
      await view.flush()
      host.open()
      await view.waitForFrame((frame) => /Show sidebar\s+off/.test(frame) && /Display scope\s+registered/.test(frame))
      expect(view.captureCharFrame()).toMatch(/Skill overview\s+middle-click/)
      expect(host.draft.skills).toEqual([])
      expect(host.submits()).toBe(0)
      expect(JSON.parse(readFileSync(join(directory, "settings.json"), "utf8"))).toEqual(expected)
      // A fresh disk value, not yet reflected in this TUI, must survive an unrelated update.
      writeFileSync(join(directory, "settings.json"), JSON.stringify({ ...expected, scope: "loaded" }))
      await host.escape()
      await host.change("state", "left")
      await host.change("state")
      expected.scope = "loaded"
      expect(JSON.parse(readFileSync(join(directory, "settings.json"), "utf8"))).toEqual(expected)
    }, { sessionID })
    await withSider(terminal(), async (view, host) => {
      host.open()
      await view.waitForFrame((frame) => /Display scope\s+loaded-only/.test(frame))
      for (const pattern of [/Show sidebar\s+off/, /Token estimation\s+list entry/, /Header counts\s+off/, /Skill overview\s+middle-click/, /Insert @mention\s+off/]) {
        expect(view.captureCharFrame()).toMatch(pattern)
      }
      await host.escape()
      await host.change("switch")
      await view.waitForFrame((frame) => frame.includes("▼ Skills"))
      expect(view.captureCharFrame()).not.toContain("▶ Skills")
    }, { sessionID })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test("failed durable settings writes are reported and keep the previous valid settings", async () => {
  const toasts: any[] = []
  const context = makeContext({
    toastShow: (toast) => toasts.push(toast),
    storage: { store: (_key: string, options: { initial: object }) => [
      createStore(options.initial)[0], async () => { throw new Error("disk full") },
    ] },
  })
  await withSider(context, async (view, host) => {
    await host.change("scope")
    await view.waitFor(() => toasts.length === 1)
    expect(toasts[0].message).toContain("disk full")
    host.open()
    await view.waitForFrame((frame) => /Display scope\s+model-visible/.test(frame))
    expect(view.captureCharFrame()).not.toContain("Button conflict")
  })
})

test("durable settings reject mouse conflicts against the latest values from another TUI", async () => {
  let saved: Record<string, unknown> = {}
  const toasts: any[] = []
  const context = makeContext({
    toastShow: (toast) => toasts.push(toast),
    storage: { store: (_key: string, options: { initial: object }) => {
      saved = structuredClone(options.initial) as Record<string, unknown>
      const [state, setState] = createStore({ ...saved })
      return [state, async (update: (draft: object) => void) => {
        const draft = { ...saved }
        update(draft)
        saved = draft
        setState(draft)
      }]
    } },
  })
  await withSider(context, async (view, host) => {
    // Another terminal saves a valid pair before this TUI receives its refresh.
    saved = { ...saved, preview: "off", mention: "middle-click" }
    await host.change("preview") // Cached left-click -> middle-click now conflicts on disk.
    await view.waitFor(() => toasts.length === 1)
    expect(toasts[0].message).toContain("Mouse button conflict")
    expect(saved).toMatchObject({ preview: "off", mention: "middle-click" })
  })
})

test("legacy memory displayMode is retained as scope when the new settings are first changed", async () => {
  const [state, setState] = createStore({ collapsed: false, displayMode: "registered" })
  const context = makeContext({ storage: { memory: () => [state, (update: (draft: typeof state) => void) => setState(produce(update))] } })
  await withSider(context, async (view, host) => {
    host.open()
    await view.waitForFrame((frame) => /Display scope\s+registered/.test(frame) && /Skill overview\s+left-click/.test(frame))
    await host.escape()
    await host.change("token")
    host.open()
    await view.waitForFrame((frame) => /Display scope\s+registered/.test(frame) && /Insert @mention\s+right-click/.test(frame) && /Skill overview\s+left-click/.test(frame))
    expect(host.submits()).toBe(0)
  })
})

test("mention of a loaded ID removed from the registry warns without inventing an attachment", async () => {
  const toasts: any[] = []
  const context = makeContext({
    skills: () => [], messages: () => [{ type: "skill", skill: "removed" }],
    toastShow: (toast) => toasts.push(toast),
  })
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("• removed"))
    await view.mockMouse.click(4, 1, 2)
    expect(toasts[0]?.message).toBe("Skill is no longer registered")
    expect(host.draft.skills).toEqual([])
    expect(host.dispatches).not.toContain("prompt.skills")
    expect(host.submits()).toBe(0)
  })
})

test("sidebar mention does not inject into a shell prompt and unload cancels a pending native picker", async () => {
  const toasts: any[] = []
  const context = makeContext({ skills: () => [{ id: "one", name: "One", description: "One" }], toastShow: (toast) => toasts.push(toast) })
  await withSider(context, async (view, host) => {
    await view.mockMouse.click(4, 1, 2)
    await view.waitFor(() => toasts.length > 0)
    expect(toasts[0].message).toBe("Prompt busy; try again")
    expect(host.draft.skills).toEqual([])
    expect(host.prompt.plainText).toBe("keep @file ")
    expect(host.dispatches).not.toContain("prompt.skills")
  }, { shell: true })
  let cancel = () => {}
  await withSider(makeContext({ skills: () => [{ id: "one", name: "One", description: "One" }] }), async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("• One"))
    cancel = () => {
      expect(view.renderer.listenerCount(CliRenderEvents.FOCUSED_EDITOR)).toBeGreaterThan(0)
      host.cleanup()
    }
    await view.mockMouse.click(4, 1, 2)
    await view.flush()
    expect(view.renderer.listenerCount(CliRenderEvents.FOCUSED_EDITOR)).toBe(0)
    expect(host.draft.skills).toEqual([])
    expect(host.submits()).toBe(0)
  }, { nativeReady: false, onNativeOpen: () => queueMicrotask(cancel) })
})

test("sidebar mention does not select an obsolete native index when the registry changes", async () => {
  const [ready, setReady] = createSignal(false)
  const toasts: any[] = []
  let skills = [{ id: "old", name: "Old", description: "Old" }]
  const context = makeContext({ skills: () => skills, toastShow: (toast) => toasts.push(toast) })
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("• Old"))
    await view.mockMouse.click(4, 1, 2)
    await view.waitFor(() => toasts.length === 1)
    expect(toasts[0].message).toBe("Skills changed; pick the skill again")
    expect(host.dispatches).toEqual(["prompt.skills"])
    expect(host.draft.skills).toEqual([])
    expect(host.prompt.plainText).toBe("keep @file ")
    expect(host.submits()).toBe(0)
  }, { nativeReady: ready, onNativeOpen: () => {
    queueMicrotask(async () => {
      skills = [{ id: "new", name: "New", description: "New" }]
      context.data.location.skill.invalidate(context.location)
      await context.data.location.skill.sync(context.location)
      setReady(true)
    })
  } })
})

test("Skills Sidebar settings remain available on home without skills or an agent", async () => {
  const pending = Promise.withResolvers<void>()
  const context = makeContext({ skills: () => [], agents: () => [], skillSync: () => pending.promise })
  const [location, setLocation] = createSignal(context.location)
  Object.defineProperty(context, "location", { get: location })
  Object.assign(context.ui.router, { current: () => ({ type: "home" }) })
  await withSider(context, async (view, host) => {
    host.open()
    await view.waitForFrame((frame) => frame.includes("Skills Sidebar") && frame.includes("Display scope"))
    expect(view.captureCharFrame()).not.toContain("Agent unavailable")
    expect(view.captureCharFrame()).not.toContain("Loading skills")
    setLocation({ directory: "project-two" })
    view.mockInput.pressArrow("down")
    view.mockInput.pressEnter()
    await view.waitForFrame((frame) => /Display scope\s+registered/.test(frame))
    await host.escape()
    host.open()
    await view.waitForFrame((frame) => /Display scope\s+registered/.test(frame))
    expect(context.renderer.currentFocusedEditor).toBeNull()
    expect(host.submits()).toBe(0)
  })
  pending.resolve()
})

test.each(["left-click", "middle-click", "right-click", "off"] as const)("sidebar preview obeys %s and never mentions, loads or sends", async (preview) => {
  const skill = { id: "review", name: "Review", description: "Review code", content: "Preview Markdown." }
  const before = JSON.stringify(skill)
  const context = makeContext({ skills: () => [skill], prefs: { preview, mention: "off" } })
  await withSider(context, async (view, host) => {
    await view.waitForFrame((frame) => frame.includes("• Review"))
    for (const button of [0, 1, 2] as const) {
      await view.mockMouse.pressDown(4, 1, button)
      expect(view.captureCharFrame()).not.toContain("Preview Markdown.")
      await view.mockMouse.release(4, 1, button)
      await view.flush()
      if ((button === 0 && preview === "left-click") || (button === 1 && preview === "middle-click") || (button === 2 && preview === "right-click")) {
        await waitForMarkdown(view)
        await view.waitForFrame((frame) => frame.includes("Preview Markdown."))
        expect(view.captureCharFrame()).toContain("path: -")
        expect(view.captureCharFrame()).toContain("stats:")
        await host.escape()
      } else expect(view.captureCharFrame()).toContain("Skills (0 loaded · 1 visible)")
    }
    expect(host.draft.skills).toEqual([])
    expect(host.prompt.plainText).toBe("keep @file ")
    expect(host.dispatches).not.toContain("prompt.skills")
    expect(host.submits()).toBe(0)
    expect(JSON.stringify(skill)).toBe(before)
  })
})

test.each(["left-click", "middle-click", "right-click", "off"] as const)("sidebar mention obeys %s and uses native attachments without sending", async (mention) => {
  const skills = [
    { id: "z-manual", name: "Shared name", description: "Manual", autoinvoke: false, content: "Do not preview" },
    { id: "a-visible", name: "Shared name", description: "Visible", content: "Do not preview" },
  ]
  const before = JSON.stringify(skills)
  const context = makeContext({ skills: () => skills, prefs: { preview: "off", mention } })
  await withSider(context, async (view, host) => {
    await host.change("scope")
    await view.waitForFrame((frame) => frame.includes("• Shared name"))
    host.prompt.cursorOffset = 5
    for (const button of [0, 1, 2] as const) {
      const count = host.draft.skills.length
      await view.mockMouse.pressDown(4, 2, button)
      expect(host.draft.skills.length).toBe(count)
      await view.mockMouse.release(4, 2, button)
      await view.flush()
      const expected = (button === 0 && mention === "left-click") || (button === 1 && mention === "middle-click") || (button === 2 && mention === "right-click")
      if (expected) await view.waitFor(() => host.draft.skills.length === 1)
      else expect(host.draft.skills.length).toBe(count)
    }
    if (mention !== "off") {
      expect(host.draft.skills).toEqual([{ id: "z-manual", mention: { start: 5, end: 14, text: "@z-manual" } }])
      expect(host.prompt.plainText).toBe("keep @z-manual @file ")
      const button = mention === "left-click" ? 0 : mention === "middle-click" ? 1 : 2
      await view.mockMouse.click(4, 2, button)
      await view.waitFor(() => host.dispatches.filter((id) => id === "dialog.select.submit").length === 2)
      expect(host.draft.skills.length).toBe(1)
      expect(host.prompt.plainText).toBe("keep @z-manual @file ")
      await view.mockMouse.click(4, 1, button)
      await view.waitFor(() => host.draft.skills.length === 2)
      expect(host.draft.skills[1].id).toBe("a-visible")
      expect(host.dispatches.slice(-4)).toEqual(["prompt.skills", "dialog.select.home", "dialog.select.next", "dialog.select.submit"])
    } else expect(host.prompt.plainText).toBe("keep @file ")
    expect(host.draft.files).toEqual([{ uri: "file:///keep.txt" }])
    expect(view.captureCharFrame()).toContain("Skills (0 loaded · 2 registered)")
    expect(view.captureCharFrame()).not.toContain("Do not preview")
    expect(host.submits()).toBe(0)
    expect(JSON.stringify(skills)).toBe(before)
  })
})
