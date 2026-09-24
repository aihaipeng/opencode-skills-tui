import type { Context } from "@opencode/plugin/tui/context"

export interface SkillSummary {
  name: string
  description?: string
  /** SKILL.md location on disk; the server strips frontmatter from content. */
  path?: string
  content: string
}

export async function loadAvailableSkills(ctx: Context): Promise<SkillSummary[]> {
  const location = ctx.location ?? ctx.data.location.default()
  await ctx.data.location.skill.sync(location)
  return toSummaries(ctx.data.location.skill.list(location) ?? [])
}

/** Dedupe the server's skill list by display name and sort it. */
export function toSummaries(
  skills: readonly { name: string; description?: string; path?: string; content?: string }[],
): SkillSummary[] {
  const deduped = new Map<string, SkillSummary>()

  for (const entry of skills) {
    if (!deduped.has(entry.name)) {
      deduped.set(entry.name, {
        name: entry.name,
        description: entry.description,
        path: entry.path,
        content: entry.content ?? "",
      })
    }
  }

  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function sortSkillsByLoaded(skills: SkillSummary[], loaded: Set<string>): SkillSummary[] {
  return [...skills].sort(
    (left, right) =>
      Number(loaded.has(right.name)) - Number(loaded.has(left.name)) ||
      left.name.localeCompare(right.name),
  )
}

const SKILL_CONTENT_TAG = /<skill_content name="([^"]+)">/

/**
 * Skill display names that a session message proves were loaded. OpenCode
 * 2.0.16 does not emit `session.skill.activated` for skill-tool loads
 * (verified: session event logs stay empty), so message data is the source:
 * - assistant content tool entries: { type: "tool", name: "skill", state }
 * - dedicated skill messages from direct invocations
 * - user messages with skill attachments (@-mention / slash expansion)
 */
export function extractMessageSkillLoads(message: unknown): string[] {
  const m = message as {
    type?: unknown
    name?: unknown
    content?: unknown
    skills?: unknown
  }
  if (m.type === "assistant" && Array.isArray(m.content)) {
    const names: string[] = []
    for (const entry of m.content) {
      // Only completed tool entries count: running/streaming states have no
      // output yet, and failed loads must not mark skills as loaded.
      const s = entry as {
        type?: unknown
        name?: unknown
        state?: { status?: unknown; content?: unknown }
      }
      if (s.type !== "tool" || s.name !== "skill" || s.state?.status !== "completed") continue
      const text = (Array.isArray(s.state.content) ? s.state.content : [])
        .map((part) => (part as { text?: unknown })?.text)
        .find((text): text is string => typeof text === "string")
      const tagged = text?.match(SKILL_CONTENT_TAG)
      if (tagged) names.push(tagged[1])
    }
    return names
  }
  // Direct invocations (session.skill endpoint, TUI direct invocation) leave
  // a dedicated skill message: `name` is the display name.
  if (m.type === "skill" && typeof m.name === "string" && m.name.length > 0) {
    return [m.name]
  }
  if (m.type === "user" && Array.isArray(m.skills)) {
    return m.skills
      .map((attachment) => (attachment as { name?: unknown })?.name)
      .filter((name): name is string => typeof name === "string")
  }
  return []
}

/**
 * Replay the session's message history for skill loads, following
 * pagination. The message history is the source of truth for restart
 * backfill because durable activation events are not written for tool loads.
 */
export async function backfillLoadedSkills(
  ctx: Context,
  sessionID: string,
  onLoad: (skillName: string) => void,
): Promise<void> {
  let cursor: string | undefined | null
  do {
    const page = await ctx.client.message.list({
      sessionID,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })

    for (const message of page.data) {
      for (const name of extractMessageSkillLoads(message)) {
        onLoad(name)
      }
    }

    cursor = page.cursor?.next
  } while (cursor)
}
