/** @jsxImportSource @opentui/solid */

import { readFileSync } from "node:fs"
import type { Plugin } from "@opencode/plugin/tui"
import { CliRenderEvents, CodeRenderable, InputRenderable, SyntaxStyle, TextAttributes, isRenderable } from "@opentui/core"
import type { MouseEvent, Renderable } from "@opentui/core"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { LocationRef } from "@opencode/client"
import { useTerminalDimensions } from "@opentui/solid"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { SkillsPanel } from "./components/skills-panel"
import { SkillsDialog } from "./components/skills-dialog"
import type { SkillsSiderSettings } from "./components/skills-dialog"
import { openUrl, resolveLinkToOpen } from "./open-link"
import {
  backfillLoadedSkills,
  extractSkillLoadState,
  estimateSkillTokens,
  formatTokenCount,
  loadAvailableSkills,
  loadSkillFileSamples,
  toSummaries,
  type SkillDisplayMode,
  type SkillSummary,
} from "./skill-data"

const EMPTY_LOADED_SKILLS = new Set<string>()

// shortcut: runtime imports of @opencode/plugin/tui or @opencode/client/solid load
// @opencode/schema against the host binary's embedded effect, which broke on the
// effect 4.0.1 isStartsWith → isStartingWith rename (host 2.0.27); keep both local.
const definePlugin = (plugin: Plugin.Definition): Plugin.Definition => plugin

// Same composite key as @opencode/client/solid locationKey.
const locationKey = (location: LocationRef) => JSON.stringify([location.directory, location.workspaceID])

function createMarkdownSyntax(theme: ResolvedTheme) {
  const markdown = theme.markdown
  // Native selection inverts glyph colors; transparent backgrounds fall back to black.
  const bg = theme.surface("dialog").background.base
  return SyntaxStyle.fromStyles({
    default: { fg: markdown.text, bg },
    "markup.heading": { fg: markdown.heading, bg, bold: true },
    "markup.strong": { fg: markdown.strong, bg, bold: true },
    "markup.italic": { fg: markdown.emphasis, bg, italic: true },
    "markup.list": { fg: markdown.listItem, bg },
    "markup.quote": { fg: markdown.blockQuote, bg, italic: true },
    "markup.raw": { fg: markdown.code, bg },
    "markup.link": { fg: markdown.link, bg, underline: true },
    "markup.link.url": { fg: markdown.link, bg, underline: true },
    "markup.link.label": { fg: markdown.linkText, bg, underline: true },
    "markup.strikethrough": { fg: theme.text.muted, bg, dim: true },
  })
}

function updateMarkdownCode(renderable: Renderable, syntaxStyle: SyntaxStyle) {
  if (renderable instanceof CodeRenderable) {
    renderable.wrapMode = "char"
    renderable.syntaxStyle = syntaxStyle
  }
  for (const child of renderable.getChildren()) {
    if (isRenderable(child)) updateMarkdownCode(child, syntaxStyle)
  }
}

/** Splits a leading `---` frontmatter fence off the body; the fences themselves never render. */
function splitFrontmatter(raw: string): { frontmatter?: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(raw)
  if (!match) return { body: raw }
  return { frontmatter: match[1], body: raw.slice(match[0].length) }
}

function SkillPreviewDialog(props: {
  skill: SkillSummary
  raw?: string
  theme: Accessor<ResolvedTheme>
  renderer: {
    getLinkAt: (x: number, y: number) => string | null
    getSelection: () => unknown
  }
}) {
  const dims = useTerminalDimensions()
  const [separatorWidth, setSeparatorWidth] = createSignal(0)
  const separator = () => {
    const label = " provided by plugin "
    const dashes = Math.max(0, separatorWidth() - label.length)
    const right = Math.min(7, Math.floor(dashes / 2))
    return `${"-".repeat(dashes - right)}${label}${"-".repeat(right)}`
  }
  let markdown: Renderable | undefined
  const syntaxStyle = createMemo(() => createMarkdownSyntax(props.theme()))
  createEffect((previous: SyntaxStyle | undefined) => {
    const style = syntaxStyle()
    // Markdown updates children next frame; detach async highlighters before freeing the old style.
    if (markdown) updateMarkdownCode(markdown, style)
    previous?.destroy()
    return style
  })
  onCleanup(() => syntaxStyle().destroy())
  const background = () => props.theme().surface("dialog").background.base

  // ctrl+click opens links in the browser directly: OSC 8 emission is gated
  // by terminal capability detection and highlight success inside opentui's
  // native renderer, so terminal-native ctrl+click is not reliable. The
  // renderer's screen-coordinate hit test works regardless.
  const onPreviewMouseUp = (event: MouseEvent) => {
    const url = resolveLinkToOpen(
      event,
      () => props.renderer.getSelection() !== null,
      props.renderer.getLinkAt,
    )
    if (url === null) return
    event.stopPropagation()
    openUrl(url)
  }

  let content: string
  if (props.raw) {
    // Verbatim SKILL.md: frontmatter fields stay visible; only the `---`
    // fence lines are dropped so they don't render as an unwanted rule.
    const { frontmatter, body } = splitFrontmatter(props.raw)
    content = frontmatter ? `${frontmatter}\n\n${body.trim()}\n` : props.raw
  } else if (props.skill.description) {
    // Fallback when the file is unreadable: the server strips frontmatter
    // from content, so show the parsed description as a quote.
    content = `> ${props.skill.description}\n\n${props.skill.content}`
  } else {
    content = props.skill.content
  }
  const path = props.skill.path
  // The API's own value, including virtual builtin paths like /builtin/opencode.md.
  const source = path || "-"
  // Count the actual preview Markdown, not the path or model's skill listing.
  const chars = [...content].length.toLocaleString("en-US")
  const tok = (mode: "listing" | "load-delta" | "loaded-total") => {
    const tokens = estimateSkillTokens(props.skill, mode)
    return tokens === undefined ? "-" : `~${formatTokenCount(tokens)} tok`
  }

  return (
    <box
      flexDirection="column"
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      width="100%"
      height={Math.max(1, dims().height - 4)}
      backgroundColor={background()}
    >
      <scrollbox
        ref={(scrollbox) => {
          // Default-visible bars otherwise draw once before their first layout.
          scrollbox.verticalScrollBar.resetVisibilityControl()
          scrollbox.horizontalScrollBar.resetVisibilityControl()
        }}
        width="100%" flexGrow={1} minHeight={0} paddingRight={1} scrollX={false}
      >
        <text width="100%" flexShrink={0} wrapMode="char" fg={props.theme().text.muted} bg={background()} attributes={TextAttributes.ITALIC}>
          {`id: ${props.skill.id}`}
        </text>
        <text width="100%" flexShrink={0} wrapMode="char" fg={props.theme().text.muted} bg={background()} attributes={TextAttributes.ITALIC}>
          {`stats: chars ${chars} · list entry ${tok("listing")} · load cost ${tok("load-delta")} · total cost ${tok("loaded-total")}`}
        </text>
        <text width="100%" flexShrink={0} wrapMode="char" fg={props.theme().text.muted} bg={background()} attributes={TextAttributes.ITALIC}>
          {`path: ${source}`}
        </text>
        <box id="skills-preview.separator" width="100%" flexShrink={0} marginBottom={1}
          onSizeChange={function () { setSeparatorWidth(this.width) }}>
          <text content={separator()} width="100%" flexShrink={0} wrapMode="char" fg={props.theme().text.muted} bg={background()} attributes={TextAttributes.ITALIC} />
        </box>
        <markdown
          ref={(renderable) => { markdown = renderable; updateMarkdownCode(renderable, syntaxStyle()) }}
          width="100%"
          content={content}
          syntaxStyle={syntaxStyle()}
          fg={props.theme().markdown.text}
          bg={background()}
          tableOptions={{ wrapMode: "char" }}
          onMouseUp={onPreviewMouseUp}
        />
      </scrollbox>
    </box>
  )
}

export default definePlugin({
  id: "opencode-skills-tui",
  setup(ctx) {
    // Keep collapse per-terminal. Old in-memory settings seed the durable store on reload.
    const [ui, mutateUI] = ctx.storage.memory<Omit<SkillsSiderSettings, "token"> & { token: SkillsSiderSettings["token"] | "metadata" | "instructions"; collapsed: boolean; displayMode?: SkillDisplayMode }>("prefs", {
      initial: { collapsed: false, switch: "on", scope: "model", preview: "left-click", mention: "right-click", token: "off", state: "on" },
    })
    const normalizeSettings = (value: Omit<typeof ui, "collapsed">): SkillsSiderSettings => ({
      switch: value.switch ?? "on",
      scope: value.scope ?? value.displayMode ?? "model",
      preview: value.preview ?? "left-click",
      mention: value.mention ?? "right-click",
      token: value.token === "metadata" ? "listing" : value.token === "instructions" ? "load-delta" : value.token ?? "off",
      state: value.state ?? "on",
    })
    const [prefs, mutatePrefs] = ctx.storage.store<Omit<typeof ui, "collapsed">>("settings", {
      initial: normalizeSettings(ui),
    })
    const settings = () => normalizeSettings(prefs)
    const changeSettings = (update: Partial<SkillsSiderSettings>) => {
      void mutatePrefs((draft) => {
        // Mutate the latest disk values, not a possibly stale TUI snapshot.
        const next = { ...normalizeSettings(draft), ...update }
        if (next.preview !== "off" && next.preview === next.mention) throw new Error("Mouse button conflict")
        Object.assign(draft, next)
      }).catch((error) => {
        if (disposed) return
        ctx.ui.toast.show({
          variant: "error",
          title: "Skills Sidebar",
          message: `Failed to save skills sidebar settings: ${error instanceof Error ? error.message : String(error)}`,
          duration: 5000,
        })
      })
    }

    const [loadedBySession, setLoadedBySession] = createSignal(new Map<string, Set<string>>())
    const [fileSamples, setFileSamples] = createSignal(new Map<string, readonly string[] | undefined>())
    const sampling = new Map<string, AbortController>()
    const backfilled = new Set<string>()
    const backfilling = new Map<string, AbortController>()
    const [refreshByLocation, setRefreshByLocation] = createSignal(
      new Map<string, { id: number; failure?: { skills: unknown; agents: unknown } }>(),
    )
    const compactionBySession = new Map<string, string>()
    const deletedSessions = new Set<string>()
    let disposed = false
    let refreshID = 0
    let initialRefreshTimer: ReturnType<typeof setTimeout> | undefined
    let stopNativeSelection: (() => void) | undefined

    const sampleKey = (skill: SkillSummary, location: LocationRef) => `${locationKey(location)}\0${skill.path}`
    const clearFileSamples = (location: LocationRef) => {
      const prefix = `${locationKey(location)}\0`
      for (const [key, controller] of sampling) {
        if (!key.startsWith(prefix)) continue
        controller.abort()
        sampling.delete(key)
      }
      setFileSamples((current) => {
        const next = new Map([...current].filter(([key]) => !key.startsWith(prefix)))
        return next.size === current.size ? current : next
      })
    }
    const ensureFileSamples = (skill: SkillSummary, location: LocationRef, refresh = false) => {
      if (disposed || skill.name === undefined || !skill.path || !/(?:^|[\\/])SKILL\.md$/.test(skill.path)) return
      const key = sampleKey(skill, location)
      if (sampling.has(key) || (!refresh && fileSamples().has(key))) return
      const controller = new AbortController()
      sampling.set(key, controller)
      // ponytail: samples refresh with the catalog or preview; no directory watcher. Reads stop after 5s.
      void loadSkillFileSamples(ctx, skill, location, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
        .catch(() => undefined) // Unavailable paths remain unknown, not an invented empty sample.
        .then((files) => {
          if (disposed || controller.signal.aborted || sampling.get(key) !== controller) return
          setFileSamples((current) => new Map(current).set(key, files))
        })
        .finally(() => { if (sampling.get(key) === controller) sampling.delete(key) })
    }

    const markLoaded = (sessionID: string, skillID: string) => {
      if (disposed || deletedSessions.has(sessionID)) return
      setLoadedBySession((current) => {
        const loaded = current.get(sessionID)
        if (loaded?.has(skillID)) return current

        const next = new Map(current)
        next.set(sessionID, new Set(loaded).add(skillID))
        return next
      })
    }

    const resetLoaded = (sessionID: string) => {
      backfilling.get(sessionID)?.abort()
      backfilling.delete(sessionID)
      backfilled.delete(sessionID)
      setLoadedBySession((current) => {
        if (!current.has(sessionID)) return current
        const next = new Map(current)
        next.delete(sessionID)
        return next
      })
    }

    const applyLoads = (sessionID: string, state: ReturnType<typeof extractSkillLoadState>) => {
      if (disposed || deletedSessions.has(sessionID)) return
      if (state.compactionID && state.compactionID !== compactionBySession.get(sessionID)) {
        compactionBySession.set(sessionID, state.compactionID)
        resetLoaded(sessionID)
      }
      for (const id of state.loaded) markLoaded(sessionID, id)
    }

    const ensureBackfill = (sessionID: string) => {
      if (
        disposed || deletedSessions.has(sessionID) ||
        backfilled.has(sessionID) || backfilling.has(sessionID)
      ) return

      const controller = new AbortController()
      backfilling.set(sessionID, controller)
      void backfillLoadedSkills(ctx, sessionID, controller.signal)
        .then((state) => {
          if (disposed || controller.signal.aborted || !state) return
          // Detach this read before a newly discovered boundary invalidates older reads.
          backfilling.delete(sessionID)
          applyLoads(sessionID, state)
          applyLoads(sessionID, extractSkillLoadState(ctx.data.session.message.list(sessionID)))
          backfilled.add(sessionID)
        })
        .catch(() => {
          // History unreachable: live message scans still mark loads.
        })
        .finally(() => {
          if (backfilling.get(sessionID) === controller) backfilling.delete(sessionID)
        })
    }

    const toggleCollapsed = () => {
      mutateUI((draft) => {
        draft.collapsed = !draft.collapsed
      })
    }

    const renderSkillPreview = (skill: SkillSummary, location: LocationRef) => {
      // Read the SKILL.md from disk and render it verbatim; normalize CRLF so
      // Windows line endings can't leak into the rendered lines. Unreadable
      // files fall back to the stripped server content.
      let raw: string | undefined
      if (skill.path) {
        try {
          raw = readFileSync(skill.path, "utf8").replace(/\r\n/g, "\n")
        } catch {
          // Unreadable (missing, permissions, remote skill): fall back below.
        }
      }
      const previewSkill = createMemo(() => ({ ...skill, fileSamples: fileSamples().get(sampleKey(skill, location)) }))
      return <SkillPreviewDialog skill={previewSkill()} raw={raw} theme={() => ctx.theme} renderer={ctx.renderer} />
    }

    const openSkillPreview = (skill: SkillSummary, location: LocationRef) => {
      ensureFileSamples(skill, location, true)
      // The host backdrop swallows the first dismiss click while a selection
      // exists (mousedown sets dismiss=!!getSelection()), so a zero-width
      // selection left over from the opening click would force users to
      // click outside twice. Clear it before the dialog mounts.
      ctx.renderer.clearSelection()
      // dialog.set() targets the active dialog, so show it first.
      ctx.ui.dialog.show(() => renderSkillPreview(skill, location))
      ctx.ui.dialog.set({ size: "xlarge", centered: true })
    }

    const refreshSkills = async (location: LocationRef): Promise<boolean> => {
      if (disposed) return true
      const requestID = ++refreshID
      const key = locationKey(location)
      setRefreshByLocation((current) => new Map(current).set(key, { id: requestID }))
      try {
        const available = await loadAvailableSkills(ctx, location)
        if (disposed || refreshByLocation().get(key)?.id !== requestID) return true
        return available.length > 0
      } catch (error) {
        if (disposed || refreshByLocation().get(key)?.id !== requestID) return true
        // A host-owned cache refresh can recover without another plugin refresh.
        setRefreshByLocation((current) => new Map(current).set(key, {
          id: requestID,
          failure: {
            skills: ctx.data.location.skill.list(location),
            agents: ctx.data.location.agent.list(location),
          },
        }))
        if (requestID !== refreshID) return true
        ctx.ui.toast.show({
          variant: "error",
          title: "Skills",
          message: `Failed to load skills: ${error instanceof Error ? error.message : String(error)}`,
          duration: 5000,
        })
        return false
      }
    }

    // Retry only an empty/failed initial discovery. Do not race a slow first
    // request or repeat a successful refresh triggered by a host event.
    const initialLocation = ctx.location ?? ctx.data.location.default()
    void refreshSkills(initialLocation).then((ready) => {
      if (ready || disposed || refreshID !== 1) return
      initialRefreshTimer = setTimeout(() => {
        if (refreshID !== 1) return
        ctx.data.location.skill.invalidate(initialLocation)
        void refreshSkills(initialLocation)
      }, 250)
    })

    const unregisterSkillUpdated = ctx.data.on("skill.updated", (event) => {
      const location = event.location ?? initialLocation
      clearFileSamples(location)
      void refreshSkills(location)
    })

    const unregisterProjectUpdated = ctx.data.on("project.updated", () => {
      const location = ctx.location ?? ctx.data.location.default()
      clearFileSamples(location)
      void refreshSkills(location)
    })

    // v2.0.24 does not project direct skill activations into the live client cache.
    // Refresh messages, not load flags: a later compaction must still win.
    const unregisterSkillActivated = ctx.data.on("session.skill.activated", (event) => {
      const sessionID = event.data.sessionID
      if (disposed || deletedSessions.has(sessionID)) return
      ctx.data.session.message.invalidate(sessionID)
      void ctx.data.session.message.sync(sessionID).catch(() => {
        // Keep existing marks; later message syncs/backfills can recover.
      })
    })

    // OpenCode 2.0.16 does not emit durable skill activations for skill-tool
    // loads (session event logs stay empty), so loads are detected from
    // message data.
    const unregisterSessionDeleted = ctx.data.on("session.deleted", (event) => {
      const sessionID = event.data.sessionID
      deletedSessions.add(sessionID)
      resetLoaded(sessionID)
      compactionBySession.delete(sessionID)
    })

    const unregisterCompactionEnded = ctx.data.on("session.compaction.ended", (event) => {
      const sessionID = event.data.sessionID
      if (disposed || deletedSessions.has(sessionID)) return
      // The host projects ended events into completed messages, even for inactive sessions.
      const state = extractSkillLoadState(ctx.data.session.message.list(sessionID))
      if (state.compactionID) applyLoads(sessionID, state)
      else resetLoaded(sessionID)
      ensureBackfill(sessionID)
    })

    const skillsView = (sessionID: string | undefined, mode: SkillDisplayMode, loaded: ReadonlySet<string>) => {
      const current = sessionID ? ctx.data.session.get(sessionID) : undefined
      const empty = { skills: [], modelVisibleCount: 0, registeredCount: 0, emptyMessage: "Loading skills…" }
      if (disposed || (sessionID && !current)) return empty
      const location = current?.location ?? ctx.location ?? ctx.data.location.default()
      const registered = ctx.data.location.skill.list(location)
      const agents = ctx.data.location.agent.list(location)
      const failure = refreshByLocation().get(locationKey(location))?.failure
      const failed = failure && (
        registered === undefined || agents === undefined ||
        (registered === failure.skills && agents === failure.agents)
      )
      const emptyMessage = failed ? "Failed to load skills" : "Loading skills…"
      if (registered === undefined || (mode === "model" && agents === undefined)) return { ...empty, emptyMessage }
      // V2 returns the effective default agent first when Session.agent is unset.
      const agent = current?.agent === undefined ? agents?.[0] : agents?.find((item) => item.id === current.agent)
      if (!agent && mode === "model") return {
        ...empty,
        emptyMessage: failed ? emptyMessage : `Agent unavailable${current?.agent === undefined ? "" : `: ${current.agent}`}`,
      }
      const permissions = [...(agent?.permissions ?? []), ...(current?.permissions ?? [])]
      return {
        skills: toSummaries(registered, permissions, loaded, mode).map((skill) => {
          const files = fileSamples().get(sampleKey(skill, location))
          return files === undefined ? skill : { ...skill, fileSamples: files }
        }),
        modelVisibleCount: agent ? toSummaries(registered, permissions).length : 0,
        registeredCount: toSummaries(registered, [], undefined, "registered").length,
        emptyMessage: failed ? emptyMessage : mode === "loaded" ? "No skills loaded" : mode === "registered" || registered.length === 0
          ? "No skills registered" : "No model-visible skills",
      }
    }

    const insertSkill = (skill: SkillSummary, location: LocationRef) => {
      if (disposed) return
      const registered = ctx.data.location.skill.list(location)
      const index = registered?.findIndex((entry) => entry.id === skill.id) ?? -1
      const warn = (message: string) => ctx.ui.toast.show({ title: "Skills", variant: "warning", message })
      if (!registered || index < 0) return warn("Skill is no longer registered")
      const ids = registered.map((entry) => entry.id)
      const route = JSON.stringify(ctx.ui.router.current())
      stopNativeSelection?.()
      let prompt: typeof ctx.renderer.currentFocusedEditor | undefined
      let active = true
      // The native filter focuses on a timer, after a frame may already be drawn.
      // Hold only that rendering transaction; keep the native attachment callback.
      let releaseFrame!: () => void
      const gate = new Promise<void>((resolve) => { releaseFrame = resolve })
      const beforeFrame = () => gate

      // Reuse /skills itself: it owns typed attachments, extmarks and duplicate handling.
      // ponytail: O(n) navigation and <=5s frame wait; replace with a host prompt attachment API.
      const ready = () => {
        if (!active || disposed) return
        const currentRoute = ctx.ui.router.current()
        const currentLocation = currentRoute.type === "session" ? ctx.data.session.get(currentRoute.sessionID)?.location
          : ctx.location ?? ctx.data.location.default()
        if (JSON.stringify(currentRoute) !== route || !currentLocation || locationKey(currentLocation) !== locationKey(location)) {
          stopNativeSelection?.()
          return warn("Session changed; try again")
        }
        const editor = ctx.renderer.currentFocusedEditor
        if (!prompt) {
          // These host traits distinguish the composer from unrelated editors.
          const traits = editor?.traits as { owner?: string; role?: string; status?: string } | undefined
          if (traits?.owner !== "opencode" || traits.role !== "prompt") return
          if (traits.status === "SHELL") {
            stopNativeSelection?.()
            return warn("Prompt busy; try again")
          }
          if (!ctx.keymap.commands().some((command) => command.id === "prompt.skills")) return
          prompt = editor
          ctx.renderer.setFrameCallback(beforeFrame)
          ctx.keymap.dispatch("prompt.skills")
          return
        }
        if (editor === prompt) { stopNativeSelection?.(); return } // Native picker cancelled.
        if (!(editor instanceof InputRenderable) || editor.traits.status !== "FILTER") return
        stopNativeSelection?.()
        const current = ctx.data.location.skill.list(location)
        if (disposed || prompt.isDestroyed ||
          !current || current.length !== ids.length || current.some((entry, i) => entry.id !== ids[i])) {
          if (!disposed) warn("Skills changed; pick the skill again")
          return
        }
        ctx.keymap.dispatch("dialog.select.home")
        for (let i = 0; i < index; i++) ctx.keymap.dispatch("dialog.select.next")
        ctx.keymap.dispatch("dialog.select.submit")
      }
      const timer = setTimeout(() => {
        stopNativeSelection?.()
        if (!disposed) warn("Skill picker unavailable; close and try again")
      }, 5000)
      stopNativeSelection = () => {
        active = false
        clearTimeout(timer)
        ctx.renderer.off(CliRenderEvents.FOCUSED_EDITOR, ready)
        ctx.renderer.removeFrameCallback(beforeFrame)
        releaseFrame()
        stopNativeSelection = undefined
      }
      ctx.renderer.on(CliRenderEvents.FOCUSED_EDITOR, ready)
      ctx.ui.dialog.clear()
      queueMicrotask(ready)
    }

    const openSettings = () => {
      if (disposed) return
      stopNativeSelection?.()
      ctx.renderer.clearSelection()
      ctx.ui.dialog.show(() => <SkillsDialog ctx={ctx} settings={settings} onChange={changeSettings} />)
      ctx.ui.dialog.set({ size: "medium", centered: true })
    }

    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "opencode-skills-tui.sider",
        title: "Skills Sidebar",
        description: "Configure the skills sidebar",
        group: "Skills",
        palette: true,
        slash: { name: "skills-sidebar" },
        run: openSettings,
      }],
    }))

    const unregisterSlot = ctx.ui.slot({
      append: "sidebar.content",
      render: (input) => {
        const session = createMemo(() => ctx.data.session.get(input.sessionID))
        createEffect(() => {
          const location: LocationRef | undefined = session()?.location
          if (!location || disposed) return
          // Read directory/workspace fields so moving the same Session also syncs.
          void refreshSkills({ directory: location.directory, workspaceID: location.workspaceID })
        })
        const panel = createMemo(() => skillsView(input.sessionID, settings().scope, loadedBySession().get(input.sessionID) ?? EMPTY_LOADED_SKILLS))
        createEffect(() => {
          const location = session()?.location
          const token = settings().token
          if (!location || disposed || settings().switch !== "on" || (token !== "load-delta" && token !== "loaded-total")) return
          for (const skill of panel().skills) ensureFileSamples(skill, location)
        })

        // Slot renders run once, untracked. Effects follow its reactive Session
        // input and the message window instead of relying on claim re-renders.
        createEffect(() => {
          applyLoads(input.sessionID, extractSkillLoadState(ctx.data.session.message.list(input.sessionID)))
          ensureBackfill(input.sessionID)
        })

        return (
          <Show when={settings().switch === "on"}><SkillsPanel
            skills={() => panel().skills}
            modelVisibleCount={() => panel().modelVisibleCount}
            registeredCount={() => panel().registeredCount}
            scope={() => settings().scope}
            showState={() => settings().state === "on"}
            tokenMode={() => settings().token}
            emptyMessage={() => panel().emptyMessage}
            loadedIDs={() => loadedBySession().get(input.sessionID) ?? EMPTY_LOADED_SKILLS}
            theme={() => ctx.theme}
            themeMode={() => ctx.themeMode}
            collapsed={() => ui.collapsed}
            onToggle={toggleCollapsed}
            onSkillClick={(skill, button) => {
              const click = (["left-click", "middle-click", "right-click"] as const)[button]
              if (settings().mention === click) {
                const location = session()?.location
                if (location) insertSkill(skill, location)
              } else if (settings().preview === click) {
                openSkillPreview(skill, session()?.location ?? ctx.location ?? ctx.data.location.default())
              }
            }}
          /></Show>
        )
      },
    })

    return () => {
      disposed = true
      stopNativeSelection?.()
      if (initialRefreshTimer !== undefined) clearTimeout(initialRefreshTimer)
      for (const controller of backfilling.values()) controller.abort()
      backfilling.clear()
      for (const controller of sampling.values()) controller.abort()
      sampling.clear()

      unregisterSlot()
      unregisterSkillUpdated()
      unregisterProjectUpdated()
      unregisterSkillActivated()
      unregisterSessionDeleted()
      unregisterCompactionEnded()
    }
  },
})
