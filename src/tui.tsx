/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { SkillsPanel } from "./components/skills-panel"
import {
  extractLoadedSkillName,
  loadAvailableSkills,
  scanLoadedSkillNames,
  type SkillSummary,
} from "./skill-data"

const SIDEBAR_ORDER = 250
const COLLAPSED_KEY = "opencode-skills-tui.collapsed"
const LOADED_ONLY_KEY = "opencode-skills-tui.loaded-only"

const tui: TuiPlugin = async (api) => {
  const [skills, setSkills] = createSignal<SkillSummary[]>([])
  const [loadVersion, setLoadVersion] = createSignal(0)
  const [collapsed, setCollapsed] = createSignal(Boolean(api.kv.get(COLLAPSED_KEY, false)))
  const [loadedOnly, setLoadedOnly] = createSignal(Boolean(api.kv.get(LOADED_ONLY_KEY, false)))
  const loadedBySession = new Map<string, Set<string>>()
  const scannedBySession = new Map<string, Set<string>>()
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
    scanLoadedSkillNames(api, sessionID, nextLoaded, nextScanned, skills())

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
        name: "skills-loaded-only",
        namespace: "palette",
        title: "Skills Loaded Only",
        desc: "Toggle showing only loaded skills in the sidebar",
        category: "Skills",
        slashName: "skills-loaded-only",
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
            loadedNames={() => getLoadedSkills(props.session_id)}
            loadedOnly={loadedOnly}
            theme={() => api.theme.current}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
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
