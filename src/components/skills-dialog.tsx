/** @jsxImportSource @opentui/solid */

import { CliRenderEvents } from "@opentui/core"
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { SkillDisplayMode, SkillTokenMode } from "../skill-data"

export type SkillClickAction = "left-click" | "middle-click" | "right-click" | "off"
export type SkillsSiderSettings = {
  switch: "off" | "on"
  scope: SkillDisplayMode
  preview: SkillClickAction
  mention: SkillClickAction
  token: SkillTokenMode
  state: "on" | "off"
}

const OPTIONS: { key: keyof SkillsSiderSettings; label?: string; category: string; values: string[]; labels?: string[] }[] = [
  { key: "switch", label: "Show sidebar", category: "Sidebar Display", values: ["off", "on"] },
  { key: "scope", label: "Display scope", category: "Sidebar Display", values: ["model", "registered", "loaded"], labels: ["model-visible", "registered", "loaded-only"] },
  { key: "token", label: "Token estimation", category: "Sidebar Display", values: ["listing", "load-delta", "loaded-total", "off"], labels: ["list entry", "load cost", "total cost", "off"] },
  { key: "state", label: "Header counts", category: "Sidebar Display", values: ["on", "off"] },
  { key: "preview", label: "Skill overview", category: "Mouse actions", values: ["left-click", "middle-click", "right-click", "off"] },
  { key: "mention", label: "Insert @mention", category: "Mouse actions", values: ["left-click", "middle-click", "right-click", "off"] },
]

export function SkillsDialog(props: {
  ctx: Plugin.Context
  settings: Accessor<SkillsSiderSettings>
  onChange: (update: Partial<SkillsSiderSettings>) => void
}) {
  const dims = useTerminalDimensions()
  const theme = () => props.ctx.theme.surface("dialog")
  const [selected, setSelected] = createSignal(0)
  // Invalid candidates are dialog-local; dismissal never changes a valid binding.
  const [pending, setPending] = createSignal<Partial<SkillsSiderSettings>>({})
  const value = (key: keyof SkillsSiderSettings) => pending()[key] ?? props.settings()[key]
  const conflict = () => value("preview") !== "off" && value("preview") === value("mention")
  let scroll: ScrollBoxRenderable | undefined

  const move = (delta: number) => setSelected((index) => (index + delta + OPTIONS.length) % OPTIONS.length)
  const change = (delta: number, option = OPTIONS[selected()]) => {
    const index = option.values.indexOf(value(option.key))
    const next = option.values[(index + delta + option.values.length) % option.values.length]
    if (option.key === "preview" || option.key === "mention") {
      const other = option.key === "preview" ? "mention" : "preview"
      if (next !== "off" && next === props.settings()[other]) {
        setPending({ [option.key]: next })
        return
      }
      setPending({})
    }
    props.onChange({ [option.key]: next })
  }

  const close = () => {
    props.ctx.renderer.clearSelection()
    props.ctx.ui.dialog.clear()
  }

  props.ctx.keymap.layer(() => ({
    mode: "modal",
    priority: 10,
    commands: [
      { bind: "escape", run: close },
      { bind: "up,ctrl+p", run: () => move(-1) },
      { bind: "down,ctrl+n", run: () => move(1) },
      { bind: "home", run: () => setSelected(0) },
      { bind: "end", run: () => setSelected(OPTIONS.length - 1) },
      { bind: "left", run: () => change(-1) },
      { bind: "right,return", run: () => change(1) },
    ],
  }))

  createEffect(() => {
    const index = selected()
    const option = OPTIONS[index]
    dims().height
    const reveal = () => {
      if (!scroll || scroll.isDestroyed) return
      if (index === 0) scroll.scrollTo(0)
      else scroll.scrollChildIntoView(`skills-sider.${option.key}`)
    }
    props.ctx.renderer.once(CliRenderEvents.FRAME, reveal)
    props.ctx.renderer.requestRender()
    onCleanup(() => props.ctx.renderer.off(CliRenderEvents.FRAME, reveal))
  })

  const click = (event: MouseEvent, action: () => void) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  return (
    <box width="100%" height={Math.max(1, Math.min(17, dims().height - 4))} paddingBottom={1} gap={dims().height < 12 ? 0 : 1} backgroundColor={theme().background.base}>
      <box flexDirection="row" paddingX={4} flexShrink={0}>
        <text fg={theme().text.base}><b>Skills Sidebar</b></text>
        <text flexGrow={1} textAlign="right" fg={theme().text.muted} onMouseUp={(event) => click(event, close)}>esc</text>
      </box>
      <scrollbox id="skills-sider.options" ref={(value) => {
        scroll = value
        value.verticalScrollBar.resetVisibilityControl()
        value.horizontalScrollBar.resetVisibilityControl()
      }} flexGrow={1} minHeight={0} width="100%" paddingX={1} scrollX={false}>
        <For each={OPTIONS}>{(option, index) => {
          const active = () => selected() === index()
          const invalid = () => conflict() && (option.key === "preview" || option.key === "mention")
          return (
            <>
              <Show when={index() === 0 || OPTIONS[index() - 1].category !== option.category}>
                <box paddingTop={index() > 0 ? 1 : 0} paddingLeft={3} flexShrink={0}>
                  <text fg={theme().hue.accent[200]}><b>{option.category}</b></text>
                </box>
              </Show>
              <box id={`skills-sider.${option.key}`} width="100%" flexDirection="row" columnGap={1} paddingLeft={3} paddingRight={2} height={1} flexShrink={0}
                backgroundColor={active() ? theme().background.action.primary.focused : undefined}
                onMouseMove={() => setSelected(index())}
                onMouseDown={(event) => click(event, () => setSelected(index()))}
                onMouseUp={(event) => click(event, () => { setSelected(index()); change(1, option) })}>
                <text flexShrink={0} fg={active() ? theme().text.action.primary.focused : theme().text.base}>{option.label ?? option.key}</text>
                <text flexGrow={1} minWidth={0} height={1} flexShrink={1} wrapMode="none" truncate textAlign="right"
                  fg={invalid() ? theme().text.feedback.error.base : active() ? theme().text.action.primary.focused : theme().text.muted}>
                  {(option.labels ?? option.values)[option.values.indexOf(value(option.key))]}
                </text>
              </box>
            </>
          )
        }}</For>
      </scrollbox>
      <box paddingX={4} flexShrink={0}>
        <text width="100%" height={1} wrapMode="none" truncate fg={conflict() ? theme().text.feedback.error.base : theme().text.muted}>
          {conflict() ? "Button conflict · change not saved" : "↑/↓ select · ←/→ / enter change"}
        </text>
      </box>
    </box>
  )
}
