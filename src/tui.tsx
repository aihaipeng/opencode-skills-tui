/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { SyntaxStyle } from "@opentui/core"
import type { MouseEvent } from "@opentui/core"
import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
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
function SkillPreviewDialog(props: {
  skill: SkillSummary
  theme: Accessor<TuiThemeCurrent>
  onClose: () => void
}) {
  const dims = useTerminalDimensions()
  const rows = () => Math.max(6, dims().height - 4)
  const inContent = (x: number, y: number) => {
    const left = Math.floor((dims().width - PREVIEW_WIDTH) / 2)
    return x >= left && x < left + PREVIEW_WIDTH && y >= 2 && y < 2 + rows()
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
      left={-Math.floor((dims().width - PREVIEW_WIDTH) / 2)}
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
        width={PREVIEW_WIDTH}
        height={rows()}
        backgroundColor={props.theme().backgroundPanel}
      >
        <box flexDirection="row" justifyContent="space-between" columnGap={2}>
          <text style={{ fg: props.theme().text }}>
            <strong>{props.skill.name}</strong>
          </text>
          <text style={{ fg: props.theme().textMuted }}>esc to close</text>
        </box>
        <scrollbox flexGrow={1} minHeight={0}>
          <markdown content={props.skill.content} syntaxStyle={SyntaxStyle.create()} />
        </scrollbox>
      </box>
    </box>
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
    scanLoadedSkillNames(api, sessionID, nextLoaded, nextScanned, skills())
    // TUI state can be empty right after a restart (lazy loading). Fall back
    // to the server once per session so history-loaded skills still show.
    if (messages.length === 0 && !fallbackAttempted.has(sessionID)) {
      fallbackAttempted.add(sessionID)
      void fetchLoadedSkillNames(api, sessionID, nextLoaded, nextScanned, skills())
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
      if (scanLoadedSkillNames(api, sessionID, loaded, scanned, skills())) {
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

  const scheduleSessionOpenRefresh = (sessionID: string) => {
    // Session history can hydrate just after navigation. Immediate scans
    // happen through the side bar render and message/session events; this is
    // a single slower retry to backfill anything hydrated afterwards.
    scheduleRefreshLoadedSkills(sessionID, 500)
  }

  const markLoaded = (sessionID: string, skillName: string) => {
    const loaded = getLoadedSkills(sessionID)
    const sizeBefore = loaded.size

    loaded.add(skillName)

    if (loaded.size !== sizeBefore) {
      setLoadVersion((value) => value + 1)
    }
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
    const skillName = extractLoadedSkillName(event.properties.part, skills())
    if (skillName) {
      markLoaded(event.properties.sessionID, skillName)
    }
  })

  const unregisterMessageUpdated = api.event.on("message.updated", (event) => {
    refreshLoadedSkills(event.properties.sessionID)
  })

  const unregisterSessionDeleted = api.event.on("session.deleted", (event) => {
    const removed = loadedBySession.delete(event.properties.sessionID)
    if (removed || scannedBySession.delete(event.properties.sessionID)) {
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
          scheduleSessionOpenRefresh(props.session_id)
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
