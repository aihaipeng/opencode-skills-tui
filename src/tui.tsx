/** @jsxImportSource @opentui/solid */

import type { TuiDialogStack, TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { SkillsPanel } from "./components/skills-panel"
import { SkillsStatusDialog } from "./components/skills-status-dialog"
import { SkillsFilterDialog } from "./components/skills-filter-dialog"
import {
  extractLoadedSkillName,
  loadAvailableSkills,
  loadHiddenSkills,
  saveHiddenSkills,
  scanLoadedSkillNames,
  toggleHiddenSkill,
  type SkillSummary,
} from "./skill-data"

const SIDEBAR_ORDER = 250
const COLLAPSED_KEY = "opencode-skills-tui.collapsed"

const tui: TuiPlugin = async (api) => {
  const [skills, setSkills] = createSignal<SkillSummary[]>([])
  const [loadVersion, setLoadVersion] = createSignal(0)
  const [collapsed, setCollapsed] = createSignal(Boolean(api.kv.get(COLLAPSED_KEY, false)))
  const hiddenSkills = loadHiddenSkills(api)
  const [hiddenVersion, setHiddenVersion] = createSignal(0)
  const hiddenAccessor = () => {
    hiddenVersion()
    return hiddenSkills
  }
  const loadedBySession = new Map<string, Set<string>>()
  const scannedBySession = new Map<string, Set<string>>()
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const loadedRefreshTimers = new Set<ReturnType<typeof setTimeout>>()
  let visibleSessionID: string | undefined

  const renderFilterDialog = () => (
    <SkillsFilterDialog
      api={api}
      skills={skills}
      hiddenNames={hiddenAccessor}
      onToggleHidden={toggleHidden}
      onClearHidden={clearHidden}
    />
  )

  const openFilterDialog = (dialog: TuiDialogStack) => {
    dialog.setSize("medium")
    dialog.replace(renderFilterDialog)
  }

  const getActiveSessionID = () => {
    const currentRoute = api.route.current
    const candidate = "params" in currentRoute ? currentRoute.params?.sessionID : undefined

    if (currentRoute.name === "session" && typeof candidate === "string") {
      return candidate
    }

    return visibleSessionID
  }

  const toggleCollapsed = () => {
    const next = !collapsed()
    setCollapsed(next)
    api.kv.set(COLLAPSED_KEY, next)
  }

  const toggleHidden = (name: string) => {
    toggleHiddenSkill(hiddenSkills, name)
    saveHiddenSkills(api, hiddenSkills)
    setHiddenVersion((value) => value + 1)
    api.ui.toast({
      variant: "info",
      title: "Skills",
      message: hiddenSkills.has(name) ? `Hid "${name}"` : `Restored "${name}"`,
      duration: 2000,
    })
  }

  const clearHidden = () => {
    if (hiddenSkills.size === 0) return
    const count = hiddenSkills.size
    hiddenSkills.clear()
    saveHiddenSkills(api, hiddenSkills)
    setHiddenVersion((value) => value + 1)
    api.ui.toast({
      variant: "info",
      title: "Skills",
      message: `Restored ${count} hidden skill${count === 1 ? "" : "s"}`,
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
        name: "skills-status",
        namespace: "palette",
        title: "Skills Status",
        desc: "Show all skills and loaded state",
        category: "Skills",
        slashName: "skills-status",
        run() {
          const sessionID = getActiveSessionID()

          if (!sessionID) {
            api.ui.toast({
              variant: "warning",
              title: "Skills",
              message: "Open a session before using /skills-status.",
              duration: 4000,
            })
            return
          }

          scheduleSessionOpenRefresh(sessionID)
          api.ui.dialog.setSize("medium")
          api.ui.dialog.replace(() => (
            <SkillsStatusDialog
              skills={skills}
              loadedNames={() => getLoadedSkills(sessionID)}
              hiddenNames={hiddenAccessor}
              theme={() => api.theme.current}
              version={loadVersion}
            />
          ))
        },
      },
      {
        name: "hide-skills",
        namespace: "palette",
        title: "Hide Skills",
        desc: "Hide or restore skills in the sidebar",
        category: "Skills",
        slashName: "hide-skills",
        run() {
          api.ui.dialog.setSize("medium")
          api.ui.dialog.replace(renderFilterDialog)
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
            hiddenNames={hiddenAccessor}
            theme={() => api.theme.current}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            onClearHidden={clearHidden}
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
