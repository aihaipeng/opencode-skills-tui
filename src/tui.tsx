/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui"
import { CodeRenderable, SyntaxStyle, isRenderable } from "@opentui/core"
import type { Renderable } from "@opentui/core"
import { createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { SkillsPanel } from "./components/skills-panel"
import {
  backfillLoadedSkills,
  loadAvailableSkills,
  type SkillSummary,
} from "./skill-data"

const EMPTY_LOADED_SKILLS = new Set<string>()

function createMarkdownSyntax(theme: ResolvedTheme) {
  const markdown = theme.markdown
  return SyntaxStyle.fromStyles({
    default: { fg: markdown.text },
    "markup.heading": { fg: markdown.heading, bold: true },
    "markup.strong": { fg: markdown.strong, bold: true },
    "markup.italic": { fg: markdown.emphasis, italic: true },
    "markup.list": { fg: markdown.listItem },
    "markup.quote": { fg: markdown.blockQuote, italic: true },
    "markup.raw": { fg: markdown.code },
    "markup.link": { fg: markdown.link, underline: true },
    "markup.link.url": { fg: markdown.link, underline: true },
    "markup.link.label": { fg: markdown.linkText, underline: true },
    "markup.strikethrough": { fg: theme.text.muted, dim: true },
  })
}

function enableMarkdownWrapping(renderable: Renderable) {
  if (renderable instanceof CodeRenderable) renderable.wrapMode = "char"
  for (const child of renderable.getChildren()) {
    if (isRenderable(child)) enableMarkdownWrapping(child)
  }
}

function SkillPreviewDialog(props: {
  skill: SkillSummary
  theme: Accessor<ResolvedTheme>
}) {
  const dims = useTerminalDimensions()
  const syntaxStyle = createMarkdownSyntax(props.theme())
  onCleanup(() => syntaxStyle.destroy())

  return (
    <box
      flexDirection="column"
      rowGap={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      width="100%"
      height={Math.max(1, dims().height - 4)}
      backgroundColor={props.theme().surface("dialog").background.base}
    >
      <box>
        <text style={{ fg: props.theme().text.base }}>
          <strong>{props.skill.name}</strong>
        </text>
      </box>
      <scrollbox width="100%" flexGrow={1} minHeight={0} paddingRight={1} scrollX={false}>
        <markdown
          ref={enableMarkdownWrapping}
          width="100%"
          content={props.skill.content}
          syntaxStyle={syntaxStyle}
          tableOptions={{ wrapMode: "char" }}
        />
      </scrollbox>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-skills-tui",
  setup(ctx) {
    const [skills, setSkills] = createSignal<SkillSummary[]>([])
    const [prefs, mutatePrefs] = ctx.storage.store<{ collapsed: boolean }>("prefs", {
      initial: { collapsed: false },
    })

    const [loadedBySession, setLoadedBySession] = createSignal(new Map<string, Set<string>>())
    const backfilled = new Set<string>()
    const backfilling = new Set<string>()

    const markLoaded = (sessionID: string, skillName: string) => {
      setLoadedBySession((current) => {
        const loaded = current.get(sessionID)
        if (loaded?.has(skillName)) return current

        const next = new Map(current)
        next.set(sessionID, new Set(loaded).add(skillName))
        return next
      })
    }

    const ensureBackfill = (sessionID: string) => {
      if (backfilled.has(sessionID) || backfilling.has(sessionID)) return

      backfilling.add(sessionID)
      void backfillLoadedSkills(ctx, sessionID, (skillName) => markLoaded(sessionID, skillName))
        .then(() => backfilled.add(sessionID))
        .catch(() => {
          // Log unreachable: live events still mark loads going forward.
        })
        .finally(() => backfilling.delete(sessionID))
    }

    const toggleCollapsed = () => {
      void mutatePrefs((draft) => {
        draft.collapsed = !draft.collapsed
      })
    }

    const openSkillPreview = (skill: SkillSummary) => {
      // dialog.set() targets the active dialog, so show it first.
      ctx.ui.dialog.show(() => (
        <SkillPreviewDialog skill={skill} theme={() => ctx.theme} />
      ))
      ctx.ui.dialog.set({ size: "xlarge", centered: true })
    }

    const refreshSkills = async () => {
      try {
        setSkills(await loadAvailableSkills(ctx))
      } catch (error) {
        ctx.ui.toast.show({
          variant: "error",
          title: "Skills",
          message: `Failed to load skills: ${error instanceof Error ? error.message : String(error)}`,
          duration: 5000,
        })
      }
    }

    void refreshSkills()

    // OpenCode may initialize TUI plugins before location data is ready.
    // One delayed retry keeps skill discovery from getting stuck empty.
    const initialRefreshTimer = setTimeout(() => void refreshSkills(), 250)

    const unregisterSkillUpdated = ctx.data.on("skill.updated", () => {
      void refreshSkills()
    })

    const unregisterProjectUpdated = ctx.data.on("project.updated", () => {
      void refreshSkills()
    })

    const unregisterSkillActivated = ctx.data.on("session.skill.activated", (event) => {
      markLoaded(event.data.sessionID, event.data.name)
    })

    const unregisterSessionDeleted = ctx.data.on("session.deleted", (event) => {
      const sessionID = event.data.sessionID
      setLoadedBySession((current) => {
        if (!current.has(sessionID)) return current
        const next = new Map(current)
        next.delete(sessionID)
        return next
      })
      backfilled.delete(sessionID)
    })

    const unregisterSlot = ctx.ui.slot({
      append: "sidebar.content",
      render: (input) => {
        ensureBackfill(input.sessionID)

        return (
          <SkillsPanel
            skills={skills}
            loadedNames={() => loadedBySession().get(input.sessionID) ?? EMPTY_LOADED_SKILLS}
            theme={() => ctx.theme}
            collapsed={() => prefs.collapsed}
            onToggle={toggleCollapsed}
            onSkillPreview={openSkillPreview}
          />
        )
      },
    })

    return () => {
      clearTimeout(initialRefreshTimer)

      unregisterSlot()
      unregisterSkillUpdated()
      unregisterProjectUpdated()
      unregisterSkillActivated()
      unregisterSessionDeleted()
    }
  },
})
