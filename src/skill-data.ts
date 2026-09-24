import type { Context } from "@opencode/plugin/tui/context"

export interface SkillSummary {
  name: string
  content: string
}

export async function loadAvailableSkills(ctx: Context): Promise<SkillSummary[]> {
  const location = ctx.location ?? ctx.data.location.default()
  await ctx.data.location.skill.sync(location)
  return toSummaries(ctx.data.location.skill.list(location) ?? [])
}

/** Dedupe the server's skill list by display name and sort it. */
export function toSummaries(skills: readonly { name: string; content?: string }[]): SkillSummary[] {
  const deduped = new Map<string, SkillSummary>()

  for (const entry of skills) {
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
  return [...skills].sort(
    (left, right) =>
      Number(loaded.has(right.name)) - Number(loaded.has(left.name)) ||
      left.name.localeCompare(right.name),
  )
}

/**
 * Replay durable skill activation events so loaded state survives restarts.
 */
export async function backfillLoadedSkills(
  ctx: Context,
  sessionID: string,
  onActivation: (skillName: string) => void,
): Promise<void> {
  const log = ctx.client.session.log({ sessionID })
  for await (const item of log) {
    if (item.type === "session.skill.activated") {
      onActivation(item.data.name)
    }
  }
}
