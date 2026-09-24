/** @jsxImportSource @opentui/solid */

import { readFileSync } from "node:fs"
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
  extractMessageSkillLoads,
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
}) {
  const dims = useTerminalDimensions()
  const syntaxStyle = createMarkdownSyntax(props.theme())
  onCleanup(() => syntaxStyle.destroy())

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

  return (
    <box
      flexDirection="column"
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      width="100%"
      height={Math.max(1, dims().height - 4)}
      backgroundColor={props.theme().surface("dialog").background.base}
    >
      <scrollbox width="100%" flexGrow={1} minHeight={0} paddingRight={1} scrollX={false}>
        <markdown
          ref={enableMarkdownWrapping}
          width="100%"
          content={content}
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
    // storage.store live-syncs across running TUI instances: collapsing one
    // terminal would collapse every terminal. Per-terminal UI state belongs
    // in memory storage, which is scoped to this TUI process.
    const [prefs, mutatePrefs] = ctx.storage.memory<{ collapsed: boolean }>("prefs", {
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
          // History unreachable: live message scans still mark loads.
        })
        .finally(() => backfilling.delete(sessionID))
    }

    const toggleCollapsed = () => {
      mutatePrefs((draft) => {
        draft.collapsed = !draft.collapsed
      })
    }

    const openSkillPreview = (skill: SkillSummary) => {
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
      // dialog.set() targets the active dialog, so show it first.
      ctx.ui.dialog.show(() => (
        <SkillPreviewDialog skill={skill} raw={raw} theme={() => ctx.theme} />
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

    // OpenCode 2.0.16 does not emit durable skill activations for skill-tool
    // loads (session event logs stay empty), so loads are detected from
    // message data.
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

        // The message store is reactive: the host re-runs this claim when it
        // changes, so scanning here catches loads live. The store holds a
        // bounded window and markLoaded is idempotent, so rescans are cheap.
        for (const message of ctx.data.session.message.list(input.sessionID)) {
          for (const skillName of extractMessageSkillLoads(message)) {
            markLoaded(input.sessionID, skillName)
          }
        }

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
      unregisterSessionDeleted()
    }
  },
})
