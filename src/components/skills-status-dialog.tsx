/** @jsxImportSource @opentui/solid */

import { For, Show, createMemo } from "solid-js"
import type { Accessor } from "solid-js"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { SkillSummary } from "../skill-data"
import { sortSkillsByLoaded } from "../skill-data"

export interface SkillsStatusDialogProps {
  skills: Accessor<SkillSummary[]>
  loadedNames: Accessor<Set<string>>
  hiddenNames: Accessor<Set<string>>
  theme: Accessor<TuiThemeCurrent>
  version: Accessor<number>
}

export function SkillsStatusDialog(props: SkillsStatusDialogProps) {
  const currentLoadedNames = createMemo(() => {
    props.version()
    return props.loadedNames()
  })

  const visibleSkills = createMemo(() => {
    const hidden = props.hiddenNames()
    return props.skills().filter((skill) => !hidden.has(skill.name))
  })

  const orderedSkills = createMemo(() =>
    sortSkillsByLoaded(visibleSkills(), currentLoadedNames()),
  )

  const hiddenCount = createMemo(() => props.hiddenNames().size)

  const textColor = createMemo(() => props.theme().text)
  const mutedColor = createMemo(() => props.theme().textMuted)
  const loadedColor = createMemo(() => props.theme().success)

  return (
    <box flexDirection="column" rowGap={1} paddingX={2} paddingY={1} paddingTop={0}>
      <box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <text style={{ fg: textColor() }}>
          <strong>Skills Status</strong>
        </text>
        <text style={{ fg: mutedColor() }}>esc</text>
      </box>

      <Show
        when={orderedSkills().length > 0}
        fallback={<text style={{ fg: mutedColor() }}>No skills available</text>}
      >
        <box flexDirection="column">
          <For each={orderedSkills()}>
            {(skill) => {
              const loaded = () => currentLoadedNames().has(skill.name)

              return (
                <box flexDirection="row" columnGap={1}>
                  <text style={{ fg: loaded() ? loadedColor() : mutedColor() }}>{"•"}</text>
                  <text style={{ fg: textColor() }}>{skill.name}</text>
                  <text style={{ fg: mutedColor() }}>{loaded() ? "Loaded" : "Unloaded"}</text>
                </box>
              )
            }}
          </For>
        </box>
      </Show>

      <Show when={hiddenCount() > 0}>
        <text style={{ fg: mutedColor() }}>{`(${hiddenCount()} hidden — use /hide-skills to manage)`}</text>
      </Show>
    </box>
  )
}
