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
  loadedOnly: Accessor<boolean>
  theme: Accessor<TuiThemeCurrent>
  collapsed: Accessor<boolean>
  onToggle: () => void
}

export function SkillsPanel(props: SkillsPanelProps) {
  const [panelWidth, setPanelWidth] = createSignal(0)
  let panelBox: { width: number } | undefined
  const visibleSkills = createMemo(() => {
    const loaded = props.loadedNames()
    const candidates = props.loadedOnly()
      ? props.skills().filter((skill) => loaded.has(skill.name))
      : props.skills()
    return sortSkillsByLoaded(candidates, loaded)
  })

  const textColor = createMemo(() => props.theme().text)
  const mutedColor = createMemo(() => props.theme().textMuted)
  const loadedColor = createMemo(() => props.theme().success)
  const title = createMemo(() => (props.collapsed() ? "▶ Skills" : "▼ Skills"))
  const headerSummary = createMemo(() => {
    const loaded = props.loadedNames()
    const loadedCount = visibleSkills().filter((skill) => loaded.has(skill.name)).length
    const total = props.skills().length
    return `(${loadedCount} loaded ${total} available)`
  })
  const emptyMessage = createMemo(() =>
    props.loadedOnly() ? "No skills loaded yet" : "No skills available",
  )

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
          fallback={<text style={{ fg: mutedColor() }}>{emptyMessage()}</text>}
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
      </Show>
    </box>
  )
}
