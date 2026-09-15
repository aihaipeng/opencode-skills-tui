import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Part } from "@opencode-ai/sdk/v2"

export interface SkillSummary {
  name: string
  content: string
}

export async function loadAvailableSkills(api: TuiPluginApi): Promise<SkillSummary[]> {
  const result = await api.client.app.skills({
    directory: api.state.path.directory,
  })

  const entries = result.data ?? []
  const deduped = new Map<string, SkillSummary>()

  for (const entry of entries) {
    if (!deduped.has(entry.name)) {
      deduped.set(entry.name, {
        name: entry.name,
        content: entry.content ?? "",
      })
    }
  }

  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function sortSkillsByLoaded(skills: SkillSummary[], loaded: Set<string>): SkillSummary[] {
  return [...skills].sort((left, right) => {
    const leftLoaded = loaded.has(left.name)
    const rightLoaded = loaded.has(right.name)

    if (leftLoaded !== rightLoaded) {
      return leftLoaded ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })
}

export function extractLoadedSkillName(part: Part, skills: SkillSummary[] = []): string | undefined {
  if (part.type === "tool" && part.tool === "skill") {
    const candidate = part.state.input?.name
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined
  }

  // opencode injects loaded skills as text parts; the opening tag carries the
  // canonical skill name (see SkillTool.toModelOutput in opencode core).
  // Prose quoting the literal tag (e.g. `<skill_content name="...">` in
  // assistant messages) must not count, so require the name to be a known
  // skill.
  if (part.type === "text" && typeof part.text === "string") {
    const tagged = /<skill_content name="([^"]+)">/.exec(part.text)
    if (tagged && skills.some((skill) => skill.name === tagged[1])) {
      return tagged[1]
    }

    // TUI slash-command expansion pastes the skill body as a plain user text
    // part with no tag; match it against known skill content.
    const text = part.text.trim()
    if (text.length > 0) {
      for (const skill of skills) {
        const content = skill.content.trim()
        if (content.length > 0 && text.includes(content)) {
          return skill.name
        }
      }
    }
  }

  return undefined
}

/** Merge a batch of messages into `loaded`, skipping already-scanned ones. */
function mergeSkillMessages(
  messages: Array<{ id?: string; parts?: readonly Part[] }>,
  loaded: Set<string>,
  scannedMessageIDs: Set<string>,
  skills: SkillSummary[],
  onPart?: (part: Part) => void,
): boolean {
  let changed = false

  for (const message of messages) {
    const messageID = message.id
    if (!messageID || scannedMessageIDs.has(messageID)) continue
    scannedMessageIDs.add(messageID)

    for (const part of message.parts ?? []) {
      onPart?.(part)
      const skillName = extractLoadedSkillName(part, skills)
      if (skillName && !loaded.has(skillName)) {
        loaded.add(skillName)
        changed = true
      }
    }
  }

  return changed
}

/**
 * Server-side scan fallback: TUI state only holds lazily loaded messages, so
 * after a restart a session's history may be invisible to
 * api.state.session.messages(). Pulls messages from the server instead.
 */
export async function fetchLoadedSkillNames(
  api: TuiPluginApi,
  sessionID: string,
  loaded: Set<string>,
  scannedMessageIDs: Set<string>,
  skills: SkillSummary[] = [],
  onPart?: (part: Part) => void,
): Promise<boolean> {
  const result = await api.client.session.messages({ sessionID, limit: 200 })
  const items = (result.data ?? []) as Array<{ info?: { id?: string }; parts?: Part[] }>
  return mergeSkillMessages(
    items.map((item) => ({ id: item.info?.id, parts: item.parts })),
    loaded,
    scannedMessageIDs,
    skills,
    onPart,
  )
}

/**
 * Incrementally scans messages of a session via TUI state. Only messages not
 * already in `scannedMessageIDs` are inspected, so repeated calls are cheap.
 */
export function scanLoadedSkillNames(
  api: TuiPluginApi,
  sessionID: string,
  loaded: Set<string>,
  scannedMessageIDs: Set<string>,
  skills: SkillSummary[] = [],
  onPart?: (part: Part) => void,
): boolean {
  return mergeSkillMessages(
    api.state.session.messages(sessionID).map((message) => ({
      id: message.id,
      parts: api.state.part(message.id),
    })),
    loaded,
    scannedMessageIDs,
    skills,
    onPart,
  )
}
