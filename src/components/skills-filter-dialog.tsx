/** @jsxImportSource @opentui/solid */

import { Show, createMemo } from "solid-js"
import type { Accessor } from "solid-js"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { SkillSummary } from "../skill-data"

const BULK_RESTORE = "__restore_all__"

export interface SkillsFilterDialogProps {
  api: TuiPluginApi
  skills: Accessor<SkillSummary[]>
  hiddenNames: Accessor<Set<string>>
  onToggleHidden: (name: string) => void
  onClearHidden: () => void
}

export function SkillsFilterDialog(props: SkillsFilterDialogProps) {
  const options = createMemo(() => {
    const hidden = props.hiddenNames()
    const list: {
      title: string
      value: string
      description?: string
      footer?: string
      category?: string
    }[] = []

    if (hidden.size > 0) {
      list.push({
        title: "Show all hidden",
        value: BULK_RESTORE,
        description: `Restore ${hidden.size} hidden skill${hidden.size === 1 ? "" : "s"}`,
        footer: "action",
        category: "Filter",
      })
    }

    for (const skill of props.skills()) {
      const isHidden = hidden.has(skill.name)
      list.push({
        title: skill.name,
        value: skill.name,
        description: skill.description || undefined,
        footer: isHidden ? "hidden" : "shown",
        category: isHidden ? "Hidden" : "Visible",
      })
    }

    return list
  })

  return (
    <Show
      when={options().length > 0}
      fallback={
        <box flexDirection="column" paddingX={2} paddingY={1} paddingTop={0}>
          <text>No skills available</text>
        </box>
      }
    >
      <props.api.ui.DialogSelect
        title="Hide Skills"
        placeholder="Search skills…"
        options={options()}
        onSelect={(option) => {
          if (option.value === BULK_RESTORE) {
            props.onClearHidden()
            return
          }
          props.onToggleHidden(option.value)
        }}
      />
    </Show>
  )
}
