/** @jsxImportSource @opentui/solid */

import { For, Show, createMemo, createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { SkillSummary } from "../skill-data"
import { sortSkillsByLoaded } from "../skill-data"

const ELLIPSIS = "..."
const ROW_FIXED_WIDTH = 3

function truncateLabel(value: string, maxWidth: number) {
  if (maxWidth <= 0 || value.length <= maxWidth) {
    return maxWidth <= 0 ? "" : value
  }

  if (maxWidth <= ELLIPSIS.length) {
    return ELLIPSIS.slice(0, maxWidth)
  }

  return `${value.slice(0, maxWidth - ELLIPSIS.length)}${ELLIPSIS}`
}

export interface SkillsPanelProps {
  skills: Accessor<SkillSummary[]>
  loadedNames: Accessor<Set<string>>
  hiddenNames: Accessor<Set<string>>
  theme: Accessor<TuiThemeCurrent>
  collapsed: Accessor<boolean>
  onToggle: () => void
  onClearHidden: () => void
}

export function SkillsPanel(props: SkillsPanelProps) {
  const [panelWidth, setPanelWidth] = createSignal(0)
  let panelBox: { width: number } | undefined
  const visibleSkills = createMemo(() => {
    const hidden = props.hiddenNames()
    const candidates = props.skills().filter((skill) => !hidden.has(skill.name))
    return sortSkillsByLoaded(candidates, props.loadedNames())
  })
  const hiddenCount = createMemo(() => props.hiddenNames().size)

  const textColor = createMemo(() => props.theme().text)
  const mutedColor = createMemo(() => props.theme().textMuted)
  const loadedColor = createMemo(() => props.theme().success)
  const title = createMemo(() => (props.collapsed() ? "▶ Skills" : "▼ Skills"))
  const headerSummary = createMemo(() => {
    const loaded = props.loadedNames()
    const loadedCount = visibleSkills().filter((skill) => loaded.has(skill.name)).length
    const total = props.skills().length
    const hidden = props.hiddenNames().size
    if (hidden === 0) {
      return `(${loadedCount} loaded ${total} available)`
    }
    return `(${loadedCount} loaded ${total} available +${hidden})`
  })

  return (
    <box
      flexDirection="column"
      ref={(element) => {
        panelBox = element
        setPanelWidth(element.width)
      }}
      onSizeChange={() => setPanelWidth(panelBox?.width ?? 0)}
    >
      <box flexDirection="row" columnGap={1} onMouseDown={props.onToggle}>
        <text style={{ fg: textColor() }}>
          <strong>{title()}</strong>
        </text>
        <Show when={props.collapsed()}>
          <text style={{ fg: mutedColor() }}>{headerSummary()}</text>
        </Show>
      </box>

      <Show when={!props.collapsed()}>
        <Show
          when={visibleSkills().length > 0}
          fallback={<text style={{ fg: mutedColor() }}>No skills available</text>}
        >
          <For each={visibleSkills()}>
            {(skill) => {
              const loaded = () => props.loadedNames().has(skill.name)
              const visibleName = () => {
                if (panelWidth() <= 0) {
                  return skill.name
                }

                return truncateLabel(skill.name, panelWidth() - ROW_FIXED_WIDTH)
              }

              return (
                <box flexDirection="row" columnGap={1}>
                  <text style={{ fg: loaded() ? loadedColor() : mutedColor() }}>
                    {"•"}
                  </text>
                  <text style={{ fg: textColor() }}>{visibleName()}</text>
                </box>
              )
            }}
          </For>
        </Show>

        <Show when={hiddenCount() > 0}>
          <box flexDirection="row" columnGap={1} onMouseDown={props.onClearHidden}>
            <text style={{ fg: mutedColor() }}>
              {`${hiddenCount()} hidden (show all)`}
            </text>
          </box>
        </Show>
      </Show>
    </box>
  )
}
