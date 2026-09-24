/** @jsxImportSource @opentui/solid */

import { For, Show, createMemo } from "solid-js"
import type { Accessor } from "solid-js"
import type { MouseEvent } from "@opentui/core"
import type { ResolvedTheme } from "@opencode/theme/tui"
import type { SkillSummary } from "../skill-data"
import { sortSkillsByLoaded } from "../skill-data"

export interface SkillsPanelProps {
  skills: Accessor<SkillSummary[]>
  loadedNames: Accessor<Set<string>>
  theme: Accessor<ResolvedTheme>
  collapsed: Accessor<boolean>
  onToggle: () => void
  onSkillPreview: (skill: SkillSummary) => void
}

export function SkillsPanel(props: SkillsPanelProps) {
  const visibleSkills = createMemo(() => {
    const loaded = props.loadedNames()
    return sortSkillsByLoaded(props.skills(), loaded)
  })

  const headerSummary = createMemo(() => {
    const loaded = props.loadedNames()
    const loadedCount = visibleSkills().filter((skill) => loaded.has(skill.name)).length
    const total = props.skills().length
    return `(${loadedCount} loaded ${total} available)`
  })

  return (
    <box flexDirection="column">
      <box flexDirection="row" columnGap={1} onMouseDown={props.onToggle}>
        <text style={{ fg: props.theme().text.base }}>
          <strong>{props.collapsed() ? "▶ Skills" : "▼ Skills"}</strong>
        </text>
        <Show when={props.collapsed()}>
          <text style={{ fg: props.theme().text.muted }}>{headerSummary()}</text>
        </Show>
      </box>

      <Show when={!props.collapsed()}>
        <Show
          when={visibleSkills().length > 0}
          fallback={<text style={{ fg: props.theme().text.muted }}>No skills available</text>}
        >
          <For each={visibleSkills()}>
            {(skill) => {
              const loaded = () => props.loadedNames().has(skill.name)
              const onRowMouseDown = (event: MouseEvent) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.stopPropagation()
                props.onSkillPreview(skill)
              }

              return (
                <box width="100%" flexDirection="row" columnGap={1} onMouseDown={onRowMouseDown}>
                  <text
                    style={{
                      fg: loaded() ? props.theme().text.feedback.success.base : props.theme().text.muted,
                    }}
                  >
                    {"•"}
                  </text>
                  <text
                    flexGrow={1}
                    minWidth={0}
                    height={1}
                    wrapMode="none"
                    truncate
                    style={{
                      fg: loaded() ? props.theme().text.feedback.success.base : props.theme().text.base,
                    }}
                  >
                    {skill.name}
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </Show>
    </box>
  )
}
