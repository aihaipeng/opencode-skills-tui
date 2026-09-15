/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { SyntaxStyle } from "@opentui/core"
import type { MouseEvent } from "@opentui/core"
import { For, Show, createSignal } from "solid-js"
import type { Accessor, JSX } from "solid-js"
import type { Part } from "@opencode-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { SkillsPanel } from "./components/skills-panel"
import {
  extractLoadedSkillName,
  fetchLoadedSkillNames,
  loadAvailableSkills,
  scanLoadedSkillNames,
  type SkillSummary,
} from "./skill-data"

const SIDEBAR_ORDER = 250
const COLLAPSED_KEY = "opencode-skills-tui.collapsed"
const LOADED_ONLY_KEY = "opencode-skills-tui.loaded-only"
const USAGE_KEY = "opencode-skills-tui.usage"
const NPM_PACKAGE = "opencode-skills-tui"
// Must match the "xlarge" dialog width in opencode's ui/dialog.tsx.
const PREVIEW_WIDTH = 116

// opencode's Dialog panel is auto-height, so a flexGrow-only layout collapses
// to content height and the scrollbox ends up with nothing to scroll. Give the
// content an explicit height. The full-screen shield owns all mouse input:
// events inside the content box are swallowed, and a full click (down + up)
// outside it closes the dialog — mirroring opencode's own backdrop dismiss,
// but on our terms so the mouseup of the opening right-click (whose mousedown
// happened before the dialog existed) never closes it.
function DialogShield(props: {
  width: number
  theme: Accessor<TuiThemeCurrent>
  onClose: () => void
  children: JSX.Element
}) {
  const dims = useTerminalDimensions()
  const rows = () => Math.max(6, dims().height - 4)
  const inContent = (x: number, y: number) => {
    const left = Math.floor((dims().width - props.width) / 2)
    return x >= left && x < left + props.width && y >= 2 && y < 2 + rows()
  }
  let downOutside = false
  const onDown = (event: MouseEvent) => {
    event.stopPropagation()
    downOutside = !inContent(event.x, event.y)
  }
  const onUp = (event: MouseEvent) => {
    event.stopPropagation()
    if (downOutside && !inContent(event.x, event.y)) {
      props.onClose()
    }
  }
  const swallow = (event: MouseEvent) => event.stopPropagation()
  // Absolute coordinates are relative to the parent's padding box — which is
  // opencode's dialog panel, itself offset to the screen center. Negative
  // offsets undo the panel origin so the shield covers the whole screen.
  return (
    <box
      position="absolute"
      left={-Math.floor((dims().width - props.width) / 2)}
      top={-Math.floor(dims().height / 4)}
      width={dims().width}
      height={dims().height}
      flexDirection="column"
      alignItems="center"
      paddingTop={2}
      onMouseDown={onDown}
      onMouseUp={onUp}
      onMouseScroll={swallow}
    >
      <box
        flexDirection="column"
        rowGap={1}
        paddingBottom={1}
        paddingLeft={8}
        paddingRight={8}
        width={props.width}
        height={rows()}
        backgroundColor={props.theme().backgroundPanel}
      >
        {props.children}
      </box>
    </box>
  )
}

function SkillPreviewDialog(props: {
  skill: SkillSummary
  theme: Accessor<TuiThemeCurrent>
  onClose: () => void
}) {
  return (
    <DialogShield width={PREVIEW_WIDTH} theme={props.theme} onClose={props.onClose}>
      <box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <text style={{ fg: props.theme().text }}>
          <strong>{props.skill.name}</strong>
        </text>
        <text style={{ fg: props.theme().textMuted }}>esc to close</text>
      </box>
      <scrollbox flexGrow={1} minHeight={0}>
        <markdown content={props.skill.content} syntaxStyle={SyntaxStyle.create()} />
      </scrollbox>
    </DialogShield>
  )
}

// All-time usage counts per skill, sorted by count. Deleted skills whose
// counts are still persisted show up as "(deleted)".
function SkillStatsDialog(props: {
  skills: SkillSummary[]
  counts: Accessor<Map<string, number>>
  theme: Accessor<TuiThemeCurrent>
  onClose: () => void
}) {
  const exists = (name: string) => props.skills.some((skill) => skill.name === name)
  const entries = () => {
    const merged = new Map(props.counts())
    for (const skill of props.skills) {
      if (!merged.has(skill.name)) {
        merged.set(skill.name, 0)
      }
    }
    return [...merged.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
  }
  return (
    <DialogShield width={PREVIEW_WIDTH} theme={props.theme} onClose={props.onClose}>
      <box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <text style={{ fg: props.theme().text }}>
          <strong>Skill usage</strong>
        </text>
        <text style={{ fg: props.theme().textMuted }}>esc to close</text>
      </box>
      <scrollbox flexGrow={1} minHeight={0}>
        <Show
          when={entries().length > 0}
          fallback={<text style={{ fg: props.theme().textMuted }}>No skill usage recorded yet</text>}
        >
          <For each={entries()}>
            {([name, count]) => (
              <box flexDirection="row" justifyContent="space-between" columnGap={2}>
                <text style={{ fg: exists(name) ? props.theme().text : props.theme().textMuted }}>
                  {exists(name) ? name : `${name} (deleted)`}
                </text>
                <text style={{ fg: props.theme().textMuted }}>{String(count)}</text>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>
    </DialogShield>
  )
}

declare const __PLUGIN_VERSION__: string

// opencode caches npm plugins per spec and never re-resolves @latest, so a
// published update stays invisible until the user deletes the cache. Check
// the registry once at startup and point them at the cache dir.
const checkForUpdates = async (api: Awaited<Parameters<TuiPlugin>[0]>) => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`, {
      signal: AbortSignal.timeout(5000),
    })
    const manifest = (await res.json()) as { version?: string }
    if (manifest.version && manifest.version !== __PLUGIN_VERSION__) {
      api.ui.toast({
        variant: "info",
        title: NPM_PACKAGE,
        message: `Version ${manifest.version} is available. Delete ~/.cache/opencode/packages/${NPM_PACKAGE}@latest and restart opencode to update.`,
        duration: 10000,
      })
    }
  } catch {
    // Offline or registry unreachable: silently skip.
  }
}

const tui: TuiPlugin = async (api) => {
  const [skills, setSkills] = createSignal<SkillSummary[]>([])
  const [loadVersion, setLoadVersion] = createSignal(0)
  const [collapsed, setCollapsed] = createSignal(Boolean(api.kv.get(COLLAPSED_KEY, false)))
  const [loadedOnly, setLoadedOnly] = createSignal(Boolean(api.kv.get(LOADED_ONLY_KEY, false)))
  // All-time usage counters, persisted via api.kv so they survive restarts.
  const counts = new Map<string, number>()
  // Part IDs already counted, per session. Guards against double-counting:
  // message.part.updated fires repeatedly per part while streaming, and the
  // post-restart server backfill re-yields parts that live scans already saw.
  const countedParts = new Map<string, Set<string>>()
  const usage = api.kv.get<{ counts?: Record<string, number>; counted?: Record<string, string[]> }>(
    USAGE_KEY,
    {},
  )
  for (const [name, count] of Object.entries(usage.counts ?? {})) {
    if (typeof count === "number" && Number.isFinite(count)) {
      counts.set(name, count)
    }
  }
  for (const [sessionID, ids] of Object.entries(usage.counted ?? {})) {
    countedParts.set(sessionID, new Set(ids.filter((id) => typeof id === "string")))
  }
  const loadedBySession = new Map<string, Set<string>>()
  const scannedBySession = new Map<string, Set<string>>()
  const fallbackAttempted = new Set<string>()
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const loadedRefreshTimers = new Set<ReturnType<typeof setTimeout>>()
  let visibleSessionID: string | undefined

  const toggleCollapsed = () => {
    const next = !collapsed()
    setCollapsed(next)
    api.kv.set(COLLAPSED_KEY, next)
  }

  const toggleLoadedOnly = () => {
    const next = !loadedOnly()
    setLoadedOnly(next)
    api.kv.set(LOADED_ONLY_KEY, next)
    api.ui.toast({
      variant: "info",
      title: "Skills",
      message: next ? "Sidebar shows loaded skills only" : "Sidebar shows all skills",
      duration: 2000,
    })
  }

  const openSkillPreview = (skill: SkillSummary) => {
    // replace() resets the stored size to "medium", so setSize must come after
    // it or the preview renders 60 columns wide instead of xlarge.
    api.ui.dialog.replace(
      () => <SkillPreviewDialog skill={skill} theme={() => api.theme.current} onClose={() => api.ui.dialog.clear()} />,
    )
    api.ui.dialog.setSize("xlarge")
  }

  const getLoadedSkills = (sessionID: string) => {
    const loaded = loadedBySession.get(sessionID)
    const scanned = scannedBySession.get(sessionID)

    if (loaded && scanned) {
      return loaded
    }

    const nextLoaded = loaded ?? new Set<string>()
    const nextScanned = scanned ?? new Set<string>()
    loadedBySession.set(sessionID, nextLoaded)
    scannedBySession.set(sessionID, nextScanned)
    const messages = api.state.session.messages(sessionID)
    scanLoadedSkillNames(api, sessionID, nextLoaded, nextScanned, skills(), countParts(sessionID))
    // TUI state can be empty right after a restart (lazy loading). Fall back
    // to the server once per session so history-loaded skills still show.
    if (messages.length === 0 && !fallbackAttempted.has(sessionID)) {
      fallbackAttempted.add(sessionID)
      void fetchLoadedSkillNames(
        api,
        sessionID,
        nextLoaded,
        nextScanned,
        skills(),
        countParts(sessionID),
      )
        .then((changed) => {
          if (changed) setLoadVersion((value) => value + 1)
        })
        .catch(() => {})
    }

    return nextLoaded
  }

  const refreshLoadedSkills = (sessionID: string) => {
    const loaded = loadedBySession.get(sessionID)
    const scanned = scannedBySession.get(sessionID)

    if (loaded && scanned) {
      if (scanLoadedSkillNames(api, sessionID, loaded, scanned, skills(), countParts(sessionID))) {
        setLoadVersion((value) => value + 1)
      }
      return
    }

    getLoadedSkills(sessionID)
    setLoadVersion((value) => value + 1)
  }

  const scheduleRefreshLoadedSkills = (sessionID: string, delay = 0) => {
    const timer = setTimeout(() => {
      loadedRefreshTimers.delete(timer)
      refreshLoadedSkills(sessionID)
    }, delay)

    loadedRefreshTimers.add(timer)
  }

  const markLoaded = (sessionID: string, skillName: string) => {
    const loaded = getLoadedSkills(sessionID)
    const sizeBefore = loaded.size

    loaded.add(skillName)

    if (loaded.size !== sizeBefore) {
      setLoadVersion((value) => value + 1)
    }
  }

  // ponytail: api.kv persists as a whole-file snapshot with last-write-wins,
  // so concurrent opencode instances can lose individual increments — counts
  // are exact within one instance, approximate across instances. Shard the
  // keys per boot ID if exactness ever matters.
  const persistUsage = () => {
    api.kv.set(USAGE_KEY, {
      counts: Object.fromEntries(counts),
      counted: Object.fromEntries([...countedParts].map(([sessionID, ids]) => [sessionID, [...ids]])),
    })
  }

  const recordSkillLoad = (sessionID: string, part: Part): string | undefined => {
    const skillName = extractLoadedSkillName(part, skills())
    // Only count skills that still exist: calls to deleted or hallucinated
    // skill names must not inflate the stats.
    if (!skillName || !part.id || !skills().some((skill) => skill.name === skillName)) {
      return undefined
    }

    let counted = countedParts.get(sessionID)
    if (!counted) {
      counted = new Set()
      countedParts.set(sessionID, counted)
    }
    if (!counted.has(part.id)) {
      counted.add(part.id)
      counts.set(skillName, (counts.get(skillName) ?? 0) + 1)
      persistUsage()
    }
    return skillName
  }

  const countParts = (sessionID: string) => (part: Part) => recordSkillLoad(sessionID, part)

  const openSkillStats = () => {
    // replace() resets the stored size to "medium", so setSize must come after
    // it or the preview renders 60 columns wide instead of xlarge.
    api.ui.dialog.replace(
      () => (
        <SkillStatsDialog
          skills={skills()}
          counts={() => counts}
          theme={() => api.theme.current}
          onClose={() => api.ui.dialog.clear()}
        />
      ),
    )
    api.ui.dialog.setSize("xlarge")
  }

  const refreshSkills = async () => {
    try {
      setSkills(await loadAvailableSkills(api))
      // Content-based matching needs the skills list; rescan messages that
      // were scanned before the list (or a newer list) was available.
      scannedBySession.clear()
      for (const sessionID of loadedBySession.keys()) {
        refreshLoadedSkills(sessionID)
      }
      setLoadVersion((value) => value + 1)
    } catch (error) {
      api.ui.toast({
        variant: "error",
        title: "Skills",
        message: `Failed to load skills: ${error instanceof Error ? error.message : String(error)}`,
        duration: 5000,
      })
    }
  }

  const scheduleRefreshSkills = (delay = 0) => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      void refreshSkills()
    }, delay)
  }

  void refreshSkills()
  void checkForUpdates(api)

  // OpenCode may initialize TUI plugins before workspace/worktree state is fully ready.
  // Refresh after readiness events so skill discovery does not get stuck empty.
  scheduleRefreshSkills(250)

  const unregisterMessagePartUpdated = api.event.on("message.part.updated", (event) => {
    const skillName = recordSkillLoad(event.properties.sessionID, event.properties.part)
    if (skillName) {
      markLoaded(event.properties.sessionID, skillName)
    }
  })

  const unregisterMessageUpdated = api.event.on("message.updated", (event) => {
    refreshLoadedSkills(event.properties.sessionID)
  })

  const unregisterSessionDeleted = api.event.on("session.deleted", (event) => {
    const removed =
      loadedBySession.delete(event.properties.sessionID) ||
      scannedBySession.delete(event.properties.sessionID)
    // countedParts is deliberately kept: counts are global and session
    // deletion never touches them. ponytail: bookkeeping for dead sessions
    // just accumulates in kv.json (~50 bytes/session) — upgrade: if the file
    // ever grows noticeably (> ~1MB or > 10k counted entries), prune counted
    // entries whose session no longer exists via api.client.session.list().
    if (removed) {
      setLoadVersion((value) => value + 1)
    }
  })

  const unregisterSessionCreated = api.event.on("session.created", () => {
    scheduleRefreshSkills()
  })

  const unregisterSessionUpdated = api.event.on("session.updated", (event) => {
    refreshLoadedSkills(event.properties.sessionID)
  })

  const unregisterProjectUpdated = api.event.on("project.updated", () => {
    scheduleRefreshSkills()
  })

  const unregisterWorkspaceReady = api.event.on("workspace.ready", () => {
    scheduleRefreshSkills()
  })

  const unregisterWorktreeReady = api.event.on("worktree.ready", () => {
    scheduleRefreshSkills()
  })

  const unregisterKeymap = api.keymap.registerLayer({
    commands: [
      {
        name: "skills-toggle",
        namespace: "palette",
        title: "Skills Toggle",
        desc: "Toggle showing only loaded skills in the sidebar",
        category: "Skills",
        slashName: "skills-toggle",
        run() {
          toggleLoadedOnly()
        },
      },
      {
        name: "skills-stats",
        namespace: "palette",
        title: "Skills Stats",
        desc: "Show all-time usage counts per skill",
        category: "Skills",
        slashName: "skills-stats",
        run() {
          openSkillStats()
        },
      },
    ],
  })

  api.lifecycle.onDispose(() => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
    }

    for (const timer of loadedRefreshTimers) {
      clearTimeout(timer)
    }

    loadedRefreshTimers.clear()

    unregisterMessagePartUpdated()
    unregisterMessageUpdated()
    unregisterSessionDeleted()
    unregisterSessionCreated()
    unregisterSessionUpdated()
    unregisterProjectUpdated()
    unregisterWorkspaceReady()
    unregisterWorktreeReady()
    unregisterKeymap()
  })

  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content: (_ctx, props) => {
        if (visibleSessionID !== props.session_id) {
          visibleSessionID = props.session_id
          // Session history can hydrate just after navigation. Immediate scans
          // happen through the side bar render and message/session events; this
          // is a single slower retry to backfill anything hydrated afterwards.
          scheduleRefreshLoadedSkills(props.session_id, 500)
        }

        loadVersion()

        return (
          <SkillsPanel
            skills={skills}
            // Reading loadVersion() here seeds the panel's memos with a
            // reactive dependency — getLoadedSkills() itself is plain data.
            loadedNames={() => {
              loadVersion()
              return getLoadedSkills(props.session_id)
            }}
            loadedOnly={loadedOnly}
            theme={() => api.theme.current}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            onSkillPreview={openSkillPreview}
          />
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-skills-tui",
  tui,
}

export default plugin
