/** @jsxImportSource @opentui/solid */

import { For, Show, createMemo, createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import type { MouseEvent, ThemeMode } from "@opentui/core"
import type { ResolvedTheme } from "@opencode/theme/tui"
import type { SkillDisplayMode, SkillSummary, SkillTokenMode } from "../skill-data"
import { estimateSkillTokens, estimateSkillListingTotal, formatTokenCount, sortSkillsByLoaded } from "../skill-data"

export interface SkillsPanelProps {
  skills: Accessor<SkillSummary[]>
  /** Catalog counts exclude extra rows retained only by successful loading. */
  modelVisibleCount: Accessor<number>
  registeredCount: Accessor<number>
  scope: Accessor<SkillDisplayMode>
  showState: Accessor<boolean>
  tokenMode: Accessor<SkillTokenMode>
  /** All IDs loaded in the current stage, including skills hidden from the model listing. */
  loadedIDs: Accessor<Set<string>>
  emptyMessage: Accessor<string>
  theme: Accessor<ResolvedTheme>
  themeMode: Accessor<ThemeMode>
  collapsed: Accessor<boolean>
  onToggle: () => void
  onSkillClick: (skill: SkillSummary, button: 0 | 1 | 2) => void
}

export function SkillsPanel(props: SkillsPanelProps) {
  // Match the Themes picker selection, including dialog-specific overrides.
  const loadedColor = () => props.theme().surface("dialog").background.action.primary.focused
  const normalColor = () => props.themeMode() === "light" ? "#000000" : "#ffffff"
  const displayedSkills = createMemo(() => {
    const loaded = props.loadedIDs()
    return sortSkillsByLoaded(props.skills(), loaded)
  })
  const loadedCount = createMemo(() => displayedSkills().filter((skill) => props.loadedIDs().has(skill.id)).length)
  const [stateWidth, setStateWidth] = createSignal(0)
  const totalCount = () => props.scope() === "registered" ? props.registeredCount() : props.modelVisibleCount()
  const fullState = () => props.scope() === "loaded" ? `(${loadedCount()} loaded)`
    : `(${loadedCount()} loaded · ${totalCount()} ${props.scope() === "registered" ? "registered" : "visible"})`
  const state = () => fullState().length <= stateWidth() ? fullState()
    : props.scope() === "loaded" ? `(${loadedCount()})` : `(${loadedCount()}/${totalCount()})`
  const estimates = createMemo(() => {
    const mode = props.tokenMode()
    return new Map(mode === "off" ? [] : displayedSkills().map((skill) => [skill.id, estimateSkillTokens(skill, mode)]))
  })
  const tokenLabel = (tokens: number | undefined) => tokens === undefined ? "-" : `~${formatTokenCount(tokens)} tok`
  // The total prices only what the model can auto-load; hidden skills keep row estimates.
  const totalTokens = createMemo(() => {
    const visible = displayedSkills().filter((skill) => skill.modelVisible)
    const mode = props.tokenMode()
    // No public API exposes the active skill tool definition; this total excludes that shared schema.
    if (mode === "listing") return tokenLabel(estimateSkillListingTotal(visible))
    const counts = visible.map((skill) => mode === "loaded-total" ? estimateSkillTokens(skill, "load-delta") : estimates().get(skill.id))
    if (counts.some((count) => count === undefined)) return tokenLabel(undefined)
    const load = counts.reduce<number>((sum, count) => sum + count!, 0)
    const listing = mode === "loaded-total" ? estimateSkillListingTotal(visible) : 0
    return tokenLabel(listing === undefined ? undefined : listing + load)
  })
  const tokenWidth = createMemo(() => Math.max(totalTokens().length, ...[...estimates().values()].map((count) => tokenLabel(count).length)))

  return (
    <box flexDirection="column" paddingRight={1}>
      <box id="skills-panel.header" width="100%" flexDirection="row" gap={1} onMouseUp={(event: MouseEvent) => {
        if (event.button !== 0 && event.button !== 2) return
        event.preventDefault()
        event.stopPropagation()
        props.onToggle()
      }}>
        {/* Compact the counts before truncating; keep the title and token column visible. */}
        <text flexShrink={0} fg={normalColor()}>
          {props.collapsed() ? "▶" : "▼"}
        </text>
        <text flexShrink={0} fg={normalColor()}><b>Skills</b></text>
        <Show when={props.showState()} fallback={<box flexGrow={1} />}>
          {/* TextBufferRenderable skips onSizeChange; measure its allocated box. */}
          <box onSizeChange={function () { setStateWidth(this.width) }} flexGrow={1} minWidth={0} height={1} flexShrink={1}>
            {/* content updates before painting; JSX text nodes wait another frame. */}
            <text content={state()} width="100%" height={1} wrapMode="none" truncate fg={props.theme().text.muted} />
          </box>
        </Show>
        <Show when={props.tokenMode() !== "off"}>
          <text id="skills-panel.total-tokens" width={tokenWidth()} height={1} flexShrink={0} textAlign="right" fg={props.theme().text.muted}>{totalTokens()}</text>
        </Show>
      </box>

      <Show when={!props.collapsed()}>
        <Show
          when={displayedSkills().length > 0}
          fallback={<text width="100%" flexShrink={0} wrapMode="char" fg={props.theme().text.muted}>{props.emptyMessage()}</text>}
        >
          <For each={displayedSkills()}>
            {(skill) => {
              const loaded = () => props.loadedIDs().has(skill.id)
              const color = () => loaded() ? loadedColor()
                : skill.modelVisible === false ? props.theme().text.muted
                : normalColor()
              // Open on mouseUp, not mouseDown: the host dialog's full-screen
              // backdrop closes the dialog on any mouseup it receives, so a
              // dialog opened during mousedown is dismissed by the release.
              const onRowMouseUp = (event: MouseEvent) => {
                if (event.button !== 0 && event.button !== 1 && event.button !== 2) return
                event.preventDefault()
                event.stopPropagation()
                props.onSkillClick(skill, event.button)
              }

              return (
                <box id={`skills-panel.${skill.id}`} width="100%" flexDirection="row" columnGap={1} onMouseUp={onRowMouseUp}>
                  <text
                    flexShrink={0}
                    fg={color()}
                  >
                    {"•"}
                  </text>
                  {/* Numeric height resets flexShrink; restore it afterwards. */}
                  <text
                    flexGrow={1}
                    minWidth={0}
                    height={1}
                    flexShrink={1}
                    wrapMode="none"
                    truncate
                    fg={color()}
                  >
                    {skill.name ?? skill.id}
                  </text>
                  <Show when={props.tokenMode() !== "off"}>
                    <text id={`skills-panel.${skill.id}.tokens`} width={tokenWidth()} height={1} flexShrink={0} textAlign="right" fg={props.theme().text.muted}>
                      {tokenLabel(estimates().get(skill.id))}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </Show>
    </box>
  )
}
