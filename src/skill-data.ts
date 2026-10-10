import type { Context } from "@opencode/plugin/tui/context"
import type { LocationRef, PermissionRule } from "@opencode/client"
import { posix, win32 } from "node:path"

export interface SkillSummary {
  id: string
  /** Display label and host payload field, never an identity. */
  name?: string
  description?: string
  /** SKILL.md location on disk; the server strips frontmatter from content. */
  path?: string
  content: string
  /** False when the host hides the skill from the model's auto-invocation listing. */
  modelVisible?: boolean
  /** Server-side path sample; undefined means not read or unavailable, not empty. */
  fileSamples?: readonly string[]
}

export type SkillDisplayMode = "model" | "registered" | "loaded"
export type SkillTokenMode = "listing" | "load-delta" | "loaded-total" | "off"

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
// ponytail: UTF-8 bytes/4 is display-only; use a host counter if model-exact counts become necessary.
export const estimateTokens = (text: string) => Math.ceil(Buffer.byteLength(text, "utf8") / 4)
export const formatTokenCount = (tokens: number) => compactNumber.format(tokens).toLowerCase()

// OpenCode v2.0.24 packages/core/src/skill/instructions.ts, including whitespace.
export function renderSkillListing(skill: SkillSummary): string {
  return [
    "  <skill>",
    `    <id>${skill.id}</id>`,
    `    <name>${skill.name}</name>`,
    `    <description>${skill.description}</description>`,
    "  </skill>",
  ].join("\n")
}

/** Shared guidance belongs to the listing total, not every skill row. */
export function estimateSkillListingTotal(skills: readonly SkillSummary[]): number | undefined {
  const visible = skills.filter((skill) => skill.modelVisible !== false && skill.description !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id))
  if (visible.some((skill) => skill.name === undefined)) return undefined
  if (visible.length === 0) return 0 // The host removes this instruction source when empty.
  return estimateTokens([
    "Skills provide specialized instructions and workflows for specific tasks.",
    "Use the skill tool to load a skill when a task matches its description.",
    "The user may also invoke a skill directly. When that happens, its instructions appear in the conversation as a <skill_content> block, the same shape the skill tool returns. A skill that is already present this way does not need to be invoked again.",
    "<available_skills>",
    ...visible.map(renderSkillListing),
    "</available_skills>",
  ].join("\n"))
}

// Choose the server's path syntax, not the TUI machine's operating system.
const pathFor = (path: string) => /^(?:[a-z]:[\\/]|\\\\)/i.test(path) ? win32 : posix

/** Static ordinary-load payload, not an API-direct message or a retained tool result. */
export function renderSkillLoad(skill: SkillSummary): string | undefined {
  if (skill.name === undefined || !skill.path) return undefined
  const path = pathFor(skill.path)
  const files = path.basename(skill.path) === "SKILL.md" ? skill.fileSamples : []
  if (files === undefined) return undefined
  // OpenCode v2.0.24 packages/core/src/skill.ts: Skill.toModelOutput.
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${path.dirname(skill.path)}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    ...files.map((file) => `<file>${file}</file>`),
    "</skill_files>",
    "</skill_content>",
  ].join("\n")
}

export function estimateSkillTokens(skill: SkillSummary, mode: Exclude<SkillTokenMode, "off">): number | undefined {
  if (skill.name === undefined) return undefined // Loaded ID with no registered definition.
  const listing = skill.modelVisible === false || skill.description === undefined ? 0 : estimateTokens(renderSkillListing(skill))
  if (mode === "listing") return listing
  const output = renderSkillLoad(skill)
  if (output === undefined) return undefined
  const load = estimateTokens(output)
  return mode === "loaded-total" ? listing + load : load
}

/** Only names are read, through the connected server; no skill is loaded or sent. */
export async function loadSkillFileSamples(ctx: Context, skill: SkillSummary, location: LocationRef, signal?: AbortSignal): Promise<string[] | undefined> {
  if (!skill.path || skill.name === undefined) return undefined
  const path = pathFor(skill.path)
  if (path.basename(skill.path) !== "SKILL.md") return []
  const files: string[] = []
  // ponytail: file.list omits symlinks; use a read-only host prepare API if one becomes public.
  // Lexical DFS stops at ten instead of walking and sorting the entire regular-file tree.
  const visit = async (directory: string): Promise<void> => {
    if (signal?.aborted) return
    const response = await ctx.client.file.list({ location, path: directory }, { signal })
    if (signal?.aborted) return
    const base = response.location.directory ?? location.directory
    if (!base) throw new Error("File sample location is unavailable")
    const entries = response.data.map((entry) => {
      const absolute = path.resolve(base, entry.path)
      const relative = path.relative(directory, absolute)
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error("File sample escaped its skill directory")
      }
      return { type: entry.type, absolute, key: absolute + (entry.type === "directory" ? path.sep : "") }
    }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    for (const entry of entries) {
      if (signal?.aborted || files.length === 10) return
      if (entry.type === "directory") await visit(entry.absolute)
      else if (path.basename(entry.absolute) !== "SKILL.md") files.push(entry.absolute)
    }
  }
  await visit(path.dirname(skill.path))
  return signal?.aborted ? undefined : files
}

export async function loadAvailableSkills(
  ctx: Context,
  location: LocationRef = ctx.location ?? ctx.data.location.default(),
): Promise<SkillSummary[]> {
  await Promise.all([
    ctx.data.location.skill.sync(location),
    ctx.data.location.agent.sync(location),
  ])
  return toSummaries(ctx.data.location.skill.list(location) ?? [])
}

/** Match the host's Permission wildcard semantics, including Windows case folding. */
function matches(input: string, pattern: string): boolean {
  let escaped = pattern.replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp(`^${escaped}$`, process.platform === "win32" ? "si" : "s")
    .test(input.replaceAll("\\", "/"))
}

/** Host model-visibility: described, auto-invocable, and not denied by the last matching rule. */
function isModelVisible(
  entry: { description?: string; autoinvoke?: boolean },
  id: string,
  rules: readonly PermissionRule[],
): boolean {
  if (entry.description === undefined || entry.autoinvoke === false) return false
  const permission = rules.find((rule) => matches("skill", rule.action) && matches(id, rule.resource))
  return permission?.effect !== "deny"
}

/** Selected display scope plus successful current-stage loads; identities stay ID-only. */
export function toSummaries(
  skills: readonly {
    id: string
    name: string
    description?: string
    autoinvoke?: boolean
    path?: string
    content?: string
  }[],
  permissions: readonly PermissionRule[] = [],
  loadedIDs?: ReadonlySet<string>,
  mode: SkillDisplayMode = "model",
): SkillSummary[] {
  const deduped = new Map<string, SkillSummary>()
  const rules = [...permissions].reverse()
  for (const entry of skills) {
    if (typeof entry.id !== "string" || !entry.id) continue
    const id = entry.id
    const modelVisible = isModelVisible(entry, id, rules)
    if (mode === "loaded" && !loadedIDs?.has(id)) continue
    if (mode === "model" && !modelVisible && !loadedIDs?.has(id)) continue
    deduped.set(id, deduped.get(id) ?? {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      path: entry.path,
      content: entry.content ?? "",
      modelVisible,
    })
  }
  // A successful load outlives catalog removal; keep its ID without inventing a definition.
  for (const id of loadedIDs ?? []) {
    if (typeof id === "string" && id && !deduped.has(id)) deduped.set(id, { id, content: "", modelVisible: false })
  }
  return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** Loaded skills first, then model visibility, display name and ID. */
export function sortSkillsByLoaded(skills: SkillSummary[], loaded: Set<string>): SkillSummary[] {
  return [...skills].sort(
    (left, right) =>
      Number(loaded.has(right.id)) - Number(loaded.has(left.id)) ||
      Number(left.modelVisible === false) - Number(right.modelVisible === false) ||
      (left.name ?? left.id).localeCompare(right.name ?? right.id) ||
      left.id.localeCompare(right.id),
  )
}

/**
 * Exact skill IDs that a session message proves were loaded; display names
 * cannot identify a skill and must never be used as a fallback. OpenCode
 * 2.0.16 does not emit `session.skill.activated` for skill-tool loads
 * (verified: session event logs stay empty), so message data is the source:
 * - assistant content tool entries: { type: "tool", name: "skill", state }
 * - dedicated skill messages from direct invocations
 * - user messages with skill attachments (@-mention / slash expansion)
 */
export function extractMessageSkillLoads(message: unknown): string[] {
  const m = message as {
    type?: unknown
    skill?: unknown
    content?: unknown
    skills?: unknown
  }
  if (m.type === "assistant" && Array.isArray(m.content)) {
    const ids: string[] = []
    for (const entry of m.content) {
      // Only completed tool entries count: running/streaming states have no
      // output yet, and failed loads must not mark skills as loaded.
      const s = entry as {
        type?: unknown
        name?: unknown
        state?: { status?: unknown; content?: unknown; input?: { id?: unknown } }
      }
      if (
        s.type !== "tool" || s.name !== "skill" || s.state?.status !== "completed" ||
        typeof s.state.input?.id !== "string" || s.state.input.id.length === 0
      ) continue
      if ((Array.isArray(s.state.content) ? s.state.content : []).some((part) =>
        typeof part?.text === "string" && part.text.startsWith('<skill_content name="'),
      )) ids.push(s.state.input.id)
    }
    return ids
  }
  // Direct invocations (session.skill endpoint, TUI direct invocation) leave
  // a dedicated skill message: `skill` is the ID, `name` is the display name.
  if (m.type === "skill" && typeof m.skill === "string" && m.skill.length > 0) {
    return [m.skill]
  }
  if (m.type === "user" && Array.isArray(m.skills)) {
    return m.skills
      .map((attachment) => (attachment as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  }
  return []
}

/** Project an ascending message window; summary/recent text never proves a new load. */
export function extractSkillLoadState(messages: readonly unknown[]): { loaded: Set<string>; compactionID?: string } {
  const loaded = new Set<string>()
  let compactionID: string | undefined
  for (const message of messages) {
    const entry = message as { id?: string; type?: unknown; status?: unknown }
    if (entry.type === "compaction" && entry.status === "completed") {
      // ponytail: conservatively reset all loads; exact retained-skill tracking needs host support.
      loaded.clear()
      compactionID = entry.id
    }
    for (const id of extractMessageSkillLoads(message)) loaded.add(id)
  }
  return { loaded, compactionID }
}

/**
 * Read newest-first history only as far as the last successful compaction.
 * Publish one snapshot so a late boundary cannot leave earlier loads marked.
 */
export async function backfillLoadedSkills(
  ctx: Context,
  sessionID: string,
  signal?: AbortSignal,
): Promise<ReturnType<typeof extractSkillLoadState> | undefined> {
  const loaded = new Set<string>()
  let cursor: string | undefined | null
  do {
    if (signal?.aborted) return
    const page = await ctx.client.message.list({
      sessionID,
      limit: 200,
      ...(cursor ? { cursor } : { order: "desc" as const }),
    })

    // The RPC need not support cancellation: discard late results and stop paging.
    if (signal?.aborted) return
    for (const message of page.data) {
      if (message.type === "compaction" && message.status === "completed") {
        return { loaded, compactionID: message.id }
      }
      for (const id of extractMessageSkillLoads(message)) loaded.add(id)
    }

    cursor = page.cursor?.next
  } while (cursor)
  return { loaded }
}
