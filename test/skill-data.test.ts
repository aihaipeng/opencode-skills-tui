import { expect, test } from "bun:test"
import {
  backfillLoadedSkills,
  extractSkillLoadState,
  extractMessageSkillLoads,
  estimateTokens,
  estimateSkillTokens,
  estimateSkillListingTotal,
  formatTokenCount,
  loadAvailableSkills,
  loadSkillFileSamples,
  renderSkillListing,
  renderSkillLoad,
  sortSkillsByLoaded,
  toSummaries,
} from "../src/skill-data"
import type { Plugin } from "@opencode/plugin/tui"

function assistantWithTools(entries: unknown[]) {
  return { id: "msg_tool", type: "assistant", content: entries }
}

test.each(["explicit", "context", "default"])("discovery syncs the host skill and agent catalogs at the %s location", async (source) => {
  const explicit = { directory: "requested-location" }
  const current = { directory: "plugin-location" }
  const fallback = { directory: "default-location" }
  const location = source === "explicit" ? explicit : source === "context" ? current : fallback
  const calls: unknown[] = []
  const skills = [
    { id: "local", name: "Local", description: "Local skill", path: "/project/SKILL.md", content: "Local body" },
    { id: "http", name: "HTTP", description: "Downloaded skill", path: "/cache/http.md", content: "HTTP body" },
    { id: "builtin", name: "Built-in", description: "Embedded skill", path: "/builtin/opencode.md", content: "Embedded body" },
    { id: "plugin", name: "Plugin", description: "Registered skill", path: "/package/SKILL.md", content: "Plugin body" },
  ]
  const context = {
    location: source === "default" ? undefined : current,
    data: { location: {
      default: () => fallback,
      skill: {
        sync: async (ref: unknown) => { calls.push(["skill", ref]) },
        list: (ref: unknown) => { calls.push(["list", ref]); return skills },
      },
      agent: { sync: async (ref: unknown) => { calls.push(["agent", ref]) } },
    } },
  } as unknown as Plugin.Context
  expect(await loadAvailableSkills(context, source === "explicit" ? explicit : undefined)).toEqual(toSummaries(skills))
  expect(calls).toEqual([["skill", location], ["agent", location], ["list", location]])
})

test("deduplicates and sorts skill summaries by ID, not by display name", () => {
  const skills = [
    { id: "zeta", name: "Alpha", description: "Zeta", content: "last" },
    { id: "alpha", name: "Zeta", description: "Alpha", content: "first" },
    { id: "zeta", name: "Duplicate", description: "Zeta", content: "duplicate" },
  ]

  expect(toSummaries(skills)).toEqual([
    { id: "alpha", name: "Zeta", description: "Alpha", content: "first", modelVisible: true },
    { id: "zeta", name: "Alpha", description: "Zeta", content: "last", modelVisible: true },
  ])
})

test("token estimates use UTF-8 bytes divided by four and round up, without model dependencies", () => {
  for (const [text, expected] of [["", 0], ["a", 1], ["ab", 1], ["abcdef", 2], ["中文", 2], ["😀", 1], ["中文😀", 3]] as const) {
    expect(estimateTokens(text)).toBe(expected)
  }
  expect(formatTokenCount(128)).toBe("128")
  expect(formatTokenCount(1300)).toBe("1.3k")
})

test("skill costs reproduce OpenCode 2.0.24's full listing and ordinary load payloads", () => {
  const skill = { id: "demo", name: "Demo", description: "Review code.", path: "/synthetic/demo/SKILL.md", content: " \n## Workflow\n检查边界条件。\n ", fileSamples: ["/synthetic/demo/scripts/check.ts"] }
  const listing = "  <skill>\n    <id>demo</id>\n    <name>Demo</name>\n    <description>Review code.</description>\n  </skill>"
  const output = '<skill_content name="Demo">\n# Skill: Demo\n\n## Workflow\n检查边界条件。\n\nBase directory for this skill: /synthetic/demo\nRelative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.\nNote: file list is sampled.\n\n<skill_files>\n<file>/synthetic/demo/scripts/check.ts</file>\n</skill_files>\n</skill_content>'
  expect(renderSkillListing(skill)).toBe(listing)
  expect(renderSkillLoad(skill)).toBe(output)
  expect(estimateSkillTokens(skill, "listing")).toBe(26)
  expect(estimateSkillTokens(skill, "load-delta")).toBe(Math.ceil(Buffer.byteLength(output) / 4))
  expect(estimateSkillTokens(skill, "loaded-total")).toBe(26 + Math.ceil(Buffer.byteLength(output) / 4))
  expect(estimateSkillTokens({ ...skill, id: "long-id".repeat(20) }, "listing")).toBeGreaterThan(26)
  expect(estimateSkillTokens({ ...skill, path: "/other/SKILL.md", content: "not preview text" }, "listing")).toBe(26)
  for (const hidden of [{ ...skill, modelVisible: false }, { ...skill, description: undefined }]) {
    expect(estimateSkillTokens(hidden, "listing")).toBe(0)
    expect(estimateSkillTokens(hidden, "loaded-total")).toBe(estimateSkillTokens(hidden, "load-delta"))
  }
  expect(estimateSkillTokens({ ...skill, content: "" }, "load-delta")).toBeGreaterThan(0)
  for (const mode of ["listing", "load-delta", "loaded-total"] as const) {
    expect(estimateSkillTokens({ id: "removed", content: "" }, mode)).toBeUndefined()
  }
  expect(estimateSkillTokens({ ...skill, fileSamples: undefined }, "load-delta")).toBeUndefined()
  expect(estimateSkillTokens({ ...skill, path: undefined }, "loaded-total")).toBeUndefined()
  expect(renderSkillLoad({ ...skill, path: "/builtin/demo.md", fileSamples: undefined }))
    .toContain("Base directory for this skill: /builtin")
  expect(renderSkillLoad({ ...skill, path: String.raw`C:\skills\demo\SKILL.md`, fileSamples: [] }))
    .toContain(String.raw`Base directory for this skill: C:\skills\demo`)
  expect(renderSkillLoad({ ...skill, path: String.raw`\\server\share\demo\SKILL.md`, fileSamples: [] }))
    .toContain(String.raw`Base directory for this skill: \\server\share\demo`)
})

test("listing totals render shared guidance and outer XML once, independent of body and path samples", () => {
  const skill = { id: "demo", name: "Demo", description: "Review code.", content: "" }
  const common = "Skills provide specialized instructions and workflows for specific tasks.\nUse the skill tool to load a skill when a task matches its description.\nThe user may also invoke a skill directly. When that happens, its instructions appear in the conversation as a <skill_content> block, the same shape the skill tool returns. A skill that is already present this way does not need to be invoked again."
  const listing = `${common}\n<available_skills>\n${renderSkillListing(skill)}\n</available_skills>`
  expect(estimateSkillListingTotal([skill])).toBe(135)
  expect(estimateSkillListingTotal([skill])).toBe(Math.ceil(Buffer.byteLength(listing) / 4))
  expect(estimateSkillListingTotal([skill, { ...skill, id: "hidden", modelVisible: false }])).toBe(135)
  const second = { ...skill, id: "other" }
  expect(estimateSkillListingTotal([second, skill])).toBe(Math.ceil(Buffer.byteLength(`${common}\n<available_skills>\n${renderSkillListing(skill)}\n${renderSkillListing(second)}\n</available_skills>`) / 4))
  expect(estimateSkillListingTotal([])).toBe(0)
  expect(estimateSkillListingTotal([{ ...skill, description: undefined }])).toBe(0)
  expect(estimateSkillListingTotal([{ ...skill, name: undefined }])).toBeUndefined()
})

test.each(["posix", "windows"] as const)("file samples use the connected server's %s paths, hidden files and sorted first ten names only", async (style) => {
  const { posix, win32 } = await import("node:path")
  const path = style === "windows" ? win32 : posix
  const root = style === "windows" ? String.raw`C:\server\skills\demo` : "/server/skills/demo"
  const location = { directory: style === "windows" ? String.raw`C:\server\project` : "/server/project", workspaceID: "remote" }
  const tree = new Map([
    [root, [
      { path: "zz-unused", type: "directory" }, { path: "docs", type: "directory" },
      { path: "SKILL.md", type: "file" }, { path: ".hidden", type: "file" },
      { path: "docs.md", type: "file" }, { path: "LICENSE", type: "file" },
    ]],
    [path.join(root, "docs"), [
      { path: "SKILL.md", type: "file" },
      ...Array.from({ length: 20 }, (_, i) => ({ path: `reference-${19 - i}`.padEnd(14, "x"), type: "file" })),
    ]],
  ])
  const calls: unknown[] = []
  const context = { client: { file: { list: async (input: any) => {
    calls.push(input)
    return { location, data: tree.get(input.path)!.map((entry) => ({
      type: entry.type,
      path: path.relative(location.directory, path.join(input.path, entry.path)),
    })) }
  } } } } as unknown as Plugin.Context
  const skill = { id: "demo", name: "Demo", path: path.join(root, "SKILL.md"), content: "not read" }
  const all = [...tree].flatMap(([directory, entries]) => entries.filter((entry) => entry.type === "file" && entry.path !== "SKILL.md")
    .map((entry) => path.join(directory, entry.path))).toSorted().slice(0, 10)
  expect(await loadSkillFileSamples(context, skill, location)).toEqual(all)
  expect(calls).toEqual([{ location, path: root }, { location, path: path.join(root, "docs") }])
  expect(await loadSkillFileSamples(context, { ...skill, path: "/builtin/demo.md" }, location)).toEqual([])
  expect(await loadSkillFileSamples(context, { ...skill, path: undefined }, location)).toBeUndefined()
  expect(calls.length).toBe(2)
})

test("file sampling rejects escaped entries and discards aborted asynchronous reads", async () => {
  const location = { directory: "/server/project" }
  const skill = { id: "demo", name: "Demo", path: "/server/demo/SKILL.md", content: "" }
  const escaped = { client: { file: { list: async () => ({ location, data: [{ type: "directory", path: "/elsewhere" }] }) } } } as unknown as Plugin.Context
  await expect(loadSkillFileSamples(escaped, skill, location)).rejects.toThrow("escaped")
  const controller = new AbortController()
  const pending = Promise.withResolvers<any>()
  let calls = 0
  const context = { client: { file: { list: () => { calls++; return pending.promise } } } } as unknown as Plugin.Context
  const result = loadSkillFileSamples(context, skill, location, controller.signal)
  controller.abort()
  pending.resolve({ location, data: [{ type: "directory", path: "../demo/docs" }] })
  expect(await result).toBeUndefined()
  expect(await loadSkillFileSamples(context, skill, location, controller.signal)).toBeUndefined()
  expect(calls).toBe(1)
})

test("missing, empty or invalid IDs never fall back to skill names", () => {
  const skills = [
    { name: "missing", description: "No ID" },
    { id: "", name: "empty", description: "Empty ID" },
    { id: 42, name: "invalid", description: "Invalid ID" },
    { id: "valid", name: "missing", description: "Valid ID" },
  ] as unknown as Parameters<typeof toSummaries>[0]
  expect(toSummaries(skills).map((skill) => skill.id)).toEqual(["valid"])
})

test("only model-visible skills survive description, invocation and last-matching permission filters", () => {
  const skills = [
    { id: "visible", name: "visible", description: "Visible", autoinvoke: true },
    { id: "missing", name: "missing" },
    { id: "manual", name: "manual", description: "Manual", autoinvoke: false },
    { id: "private-one", name: "Private", description: "Private" },
    { id: "private-ask", name: "Ask", description: "Needs approval" },
  ]
  expect(toSummaries(skills, [
    { action: "*", resource: "*", effect: "allow" },
    { action: "skill", resource: "private-*", effect: "deny" },
    { action: "skill", resource: "private-ask", effect: "ask" },
  ]).map((skill) => skill.id)).toEqual(["private-ask", "visible"])
})

test("panel summaries include successful hidden loads and missing definitions by exact ID", () => {
  const skills = [
    { id: "visible", name: "Visible", description: "Visible" },
    { id: "missing", name: "Shared name", content: "Missing description body" },
    { id: "manual", name: "Shared name", description: "Manual", autoinvoke: false, path: "/skills/manual/SKILL.md", content: "Manual body" },
    { id: "denied", name: "Shared name", description: "Denied", content: "Denied body" },
    { id: "not-loaded", name: "Shared name", description: "Still hidden", autoinvoke: false },
  ]
  const permissions = [{ action: "skill", resource: "denied", effect: "deny" as const }]
  const loaded = new Set(["missing", "manual", "denied", "removed", "", "manual"])
  expect(toSummaries(skills, permissions).map((skill) => skill.id)).toEqual(["visible"])
  expect(toSummaries(skills, permissions, loaded)).toEqual([
    { id: "denied", name: "Shared name", description: "Denied", content: "Denied body", modelVisible: false },
    { id: "manual", name: "Shared name", description: "Manual", path: "/skills/manual/SKILL.md", content: "Manual body", modelVisible: false },
    { id: "missing", name: "Shared name", content: "Missing description body", modelVisible: false },
    { id: "removed", content: "", modelVisible: false },
    { id: "visible", name: "Visible", description: "Visible", content: "", modelVisible: true },
  ])
  expect(toSummaries(skills, permissions, new Set()).map((skill) => skill.id)).toEqual(["visible"])
})

test("display modes preserve model visibility while listing registered or loaded-only IDs", () => {
  const skills = [
    { id: "visible", name: "Visible", description: "Visible" },
    { id: "manual", name: "Manual", description: "Manual", autoinvoke: false },
    { id: "denied", name: "Denied", description: "Denied" },
    { id: "missing", name: "Missing" },
  ]
  const rules = [{ action: "skill", resource: "denied", effect: "deny" as const }]
  const loaded = new Set(["manual", "removed"])
  expect(toSummaries(skills, rules, loaded, "model").map((skill) => skill.id)).toEqual(["manual", "removed", "visible"])
  expect(toSummaries(skills, rules, loaded, "registered").map((skill) => [skill.id, skill.modelVisible])).toEqual([
    ["denied", false],
    ["manual", false],
    ["missing", false],
    ["removed", false],
    ["visible", true],
  ])
  expect(toSummaries(skills, rules, loaded, "loaded").map((skill) => skill.id)).toEqual(["manual", "removed"])
  expect(toSummaries(skills, rules, undefined, "registered").map((skill) => skill.id)).toEqual(["denied", "manual", "missing", "visible"])
  expect(toSummaries(skills, rules, new Set(), "loaded")).toEqual([])
  expect(toSummaries(skills, rules).map((skill) => skill.id)).toEqual(["visible"])
})

test("distinct model-visible IDs with the same display name are all listed", () => {
  expect(toSummaries([
    { id: "one", name: "Review", description: "First" },
    { id: "two", name: "Review", description: "Second" },
  ]).map((skill) => skill.id)).toEqual(["one", "two"])
})

test("visibility uses skill IDs and host wildcard semantics, not display names or glob syntax", () => {
  const skills = [
    { id: "private-one", name: "Friendly Name", description: "" },
    { id: "private.two", name: "Other", description: "Other" },
  ]
  expect(toSummaries(skills).length).toBe(2) // The host advertises an explicitly empty description.
  expect(toSummaries(skills, [{ action: "sk?ll", resource: "private-*", effect: "deny" }])
    .map((skill) => skill.id)).toEqual(["private.two"])
  expect(toSummaries(skills, [{ action: "skill", resource: "private.two", effect: "deny" }])
    .map((skill) => skill.id)).toEqual(["private-one"])
  expect(toSummaries(skills, [{ action: "skill", resource: "PRIVATE-*", effect: "deny" }]).length)
    .toBe(process.platform === "win32" ? 1 : 2)
})

test("pins loaded IDs before unloaded IDs and sorts by display name with an ID tie-break", () => {
  const skills = [
    { id: "beta", name: "alpha", content: "" },
    { id: "alpha", name: "gamma", content: "" },
    { id: "gamma", name: "beta", content: "" },
  ]

  expect(sortSkillsByLoaded(skills, new Set(["gamma"])).map((skill) => skill.id)).toEqual([
    "gamma",
    "beta",
    "alpha",
  ])
  expect(skills.map((skill) => skill.id)).toEqual(["beta", "alpha", "gamma"])
  expect(sortSkillsByLoaded(skills, new Set(["not-an-id"])).map((skill) => skill.id)).toEqual(["beta", "gamma", "alpha"])
  // Same display name falls back to the ID so rows keep a stable order.
  const sameName = [
    { id: "two", name: "Review", content: "" },
    { id: "one", name: "Review", content: "" },
  ]
  expect(sortSkillsByLoaded(sameName, new Set(["two"])).map((skill) => skill.id)).toEqual(["two", "one"])
  expect(sortSkillsByLoaded(sameName, new Set()).map((skill) => skill.id)).toEqual(["one", "two"])
})

test("pins loaded hidden skills above all unloaded rows, retaining visibility, name and ID tie-breaks", () => {
  const skills = [
    { id: "hidden-free", name: "Alpha", content: "", modelVisible: false },
    { id: "hidden-two", name: "Review", content: "", modelVisible: false },
    { id: "visible-free", name: "Alpha", content: "", modelVisible: true },
    { id: "hidden-one", name: "Review", content: "", modelVisible: false },
    { id: "visible-loaded", name: "Zulu", content: "", modelVisible: true },
  ]
  const before = [...skills]
  expect(sortSkillsByLoaded(skills, new Set(["hidden-two", "visible-loaded", "hidden-one"])).map((skill) => skill.id))
    .toEqual(["visible-loaded", "hidden-one", "hidden-two", "visible-free", "hidden-free"])
  expect(skills).toEqual(before)
})

test("extracts skill IDs from completed skill tool entries", () => {
  // Shape observed in real v2 session data: the skill tool call surfaces as
  // an assistant content entry with the tag in its output text.
  const message = assistantWithTools([
    {
      type: "tool",
      id: "call_239ebbc2054647a582275bac",
      name: "skill",
      executed: false,
      state: {
        status: "completed",
        input: { id: "handoff" },
        content: [
          {
            type: "text",
            text: '<skill_content name="handoff">\n# Skill: handoff\n',
          },
        ],
      },
      time: { created: 1790257024847, completed: 1790257024847 },
    },
  ])

  expect(extractMessageSkillLoads(message)).toEqual(["handoff"])
})

test("ignores non-skill tools and unfinished or failed skill calls", () => {
  const read = { type: "tool", name: "read", state: { status: "completed", input: {} } }
  const running = {
    type: "tool",
    name: "skill",
    state: { status: "running", input: { id: "handoff" } },
  }
  const failed = {
    type: "tool",
    name: "skill",
    state: { status: "error", input: { id: "handoff" }, error: "boom" },
  }

  expect(extractMessageSkillLoads(assistantWithTools([read]))).toEqual([])
  expect(extractMessageSkillLoads(assistantWithTools([running]))).toEqual([])
  expect(extractMessageSkillLoads(assistantWithTools([failed]))).toEqual([])
})

test("extracts IDs from dedicated skill messages even when the display name differs", () => {
  // Shape observed via the session.skill endpoint: display name may differ
  // from the skill id.
  const message = {
    id: "msg_3",
    time: { created: 1790277623317 },
    type: "skill",
    skill: "opencode",
    name: "OpenCode",
    text: "# OpenCode\n...",
  }

  expect(extractMessageSkillLoads(message)).toEqual(["opencode"])
  expect(extractMessageSkillLoads({ id: "msg_4", type: "assistant", content: [] })).toEqual([])
})

test("extracts skill IDs from user message attachments", () => {
  const message = {
    id: "msg_1",
    type: "user",
    text: "/handoff",
    files: [],
    agents: [],
    skills: [{ id: "handoff", name: "handoff" }],
  }
  const plain = { id: "msg_2", type: "user", text: "hello" }

  expect(extractMessageSkillLoads(message)).toEqual(["handoff"])
  expect(extractMessageSkillLoads(plain)).toEqual([])
})

test("current message loads ignore history before the latest successful compaction", () => {
  const state = extractSkillLoadState([
    { type: "skill", skill: "old" },
    { id: "msg_first", type: "compaction", status: "completed" },
    { type: "compaction", status: "failed" },
    { type: "skill", skill: "before" },
    { id: "msg_latest", type: "compaction", status: "completed", summary: "old was loaded", recent: '<skill_content name="before">' },
    { type: "skill", skill: "after" },
  ])
  expect([...state.loaded]).toEqual(["after"])
  expect(state.compactionID).toBe("msg_latest")
  expect([...extractSkillLoadState([
    { type: "skill", skill: "old" },
    { type: "compaction", status: "running" },
    { type: "skill", skill: "current" },
  ]).loaded]).toEqual(["old", "current"])
})

test("tool and attachment loads prefer IDs so same-name skills remain independently loaded", () => {
  expect(extractMessageSkillLoads(assistantWithTools([{
    type: "tool", name: "skill", state: {
      status: "completed", input: { id: "one" },
      content: [{ type: "text", text: '<skill_content name="Review">\n# Review' }],
    },
  }]))).toEqual(["one"])
  expect(extractMessageSkillLoads({ type: "user", skills: [{ id: "two", name: "Review" }] })).toEqual(["two"])
  const sameName = [
    { id: "one", name: "Review", content: "" },
    { id: "two", name: "Review", content: "" },
  ]
  expect(sortSkillsByLoaded(sameName, new Set(["two"])).map((skill) => skill.id)).toEqual(["two", "one"])
  // Display labels may contain quotes; the host's success wrapper still proves the ID loaded.
  expect(extractMessageSkillLoads(assistantWithTools([{
    type: "tool", name: "skill", state: {
      status: "completed", input: { id: "quoted-name" },
      content: [{ type: "text", text: '<skill_content name="Say "Hello"">\n# Skill' }],
    },
  }]))).toEqual(["quoted-name"])
})

test("messages without an exact skill ID never guess a load from a display name", () => {
  expect(extractMessageSkillLoads({ type: "skill", name: "visible" })).toEqual([])
  expect(extractMessageSkillLoads({ type: "skill", skill: "", name: "visible" })).toEqual([])
  expect(extractMessageSkillLoads({ type: "user", skills: [{ name: "visible" }, { id: "", name: "visible" }] })).toEqual([])
  expect(extractMessageSkillLoads(assistantWithTools([{
    type: "tool", name: "skill", state: {
      status: "completed", content: [{ type: "text", text: '<skill_content name="visible">\n# Visible' }],
    },
  }]))).toEqual([])
})

test("finds skill output after other text parts and tracks the invoked ID only once", () => {
  expect(extractMessageSkillLoads(assistantWithTools([{
    type: "tool",
    name: "skill",
    state: {
      status: "completed",
      input: { id: "beta-id" },
      content: [
        { type: "text", text: "Loading skill..." },
        { type: "image", data: "not text" },
        { type: "text", text: '<skill_content name="beta">\n# Beta' },
        { type: "text", text: '<skill_content name="gamma">\n# Gamma' },
      ],
    },
  }]))).toEqual(["beta-id"])
})

test("backfills all history pages with the next cursor", async () => {
  const calls: unknown[] = []
  const context = {
    client: { message: { list: async (input: { cursor?: string }) => {
      calls.push(input)
      return input.cursor
        ? { data: [{ type: "skill", skill: "alpha", name: "alpha" }], cursor: {} }
        : { data: [{ type: "skill", skill: "beta", name: "beta" }], cursor: { next: "older" } }
    } } },
  } as unknown as Plugin.Context
  const state = await backfillLoadedSkills(context, "session-1")
  expect(calls).toEqual([
    { sessionID: "session-1", limit: 200, order: "desc" },
    { sessionID: "session-1", limit: 200, cursor: "older" },
  ])
  expect([...state!.loaded]).toEqual(["beta", "alpha"])
})

test("backfill stops at the newest successful compaction", async () => {
  let calls = 0
  const context = {
    client: { message: { list: async (input: { cursor?: string }) => {
      calls++
      if (input.cursor) return { data: [{ type: "skill", skill: "old" }], cursor: {} }
      return {
        data: [{ type: "skill", skill: "current" }, { id: "msg_compact", type: "compaction", status: "completed" }, { type: "skill", skill: "old" }],
        cursor: { next: "older" },
      }
    } } },
  } as unknown as Plugin.Context
  const state = await backfillLoadedSkills(context, "session-1")
  expect([...state!.loaded]).toEqual(["current"])
  expect(state!.compactionID).toBe("msg_compact")
  expect(calls).toBe(1)
})

test("paged backfill skips running and failed compactions and stops before older stages", async () => {
  const calls: unknown[] = []
  const context = {
    client: { message: { list: async (input: { cursor?: string }) => {
      calls.push(input)
      return input.cursor ? {
        data: [
          { type: "user", skills: [{ id: "attachment" }] },
          { id: "msg_latest", type: "compaction", status: "completed" },
          { type: "skill", skill: "old" },
          { id: "msg_previous", type: "compaction", status: "completed" },
        ], cursor: { next: "never-read" },
      } : {
        data: [
          { type: "compaction", status: "failed" },
          { type: "skill", skill: "direct" },
          { type: "compaction", status: "running" },
          assistantWithTools([{ type: "tool", name: "skill", state: {
            status: "completed", input: { id: "tool" },
            content: [{ type: "text", text: '<skill_content name="Tool">' }],
          } }]),
        ], cursor: { next: "older" },
      }
    } } },
  } as unknown as Plugin.Context
  const state = await backfillLoadedSkills(context, "session-1")
  expect([...state!.loaded]).toEqual(["direct", "tool", "attachment"])
  expect(state!.compactionID).toBe("msg_latest")
  expect(calls).toEqual([
    { sessionID: "session-1", limit: 200, order: "desc" },
    { sessionID: "session-1", limit: 200, cursor: "older" },
  ])
})

test("cancelling an in-flight backfill discards its result and stops pagination", async () => {
  const controller = new AbortController()
  let calls = 0
  const { promise: pending, resolve } = Promise.withResolvers<unknown>()
  const context = {
    client: { message: { list: () => { calls++; return pending } } },
  } as unknown as Plugin.Context
  const backfill = backfillLoadedSkills(context, "session-1", controller.signal)
  controller.abort()
  resolve({ data: [{ type: "skill", skill: "alpha", name: "alpha" }], cursor: { next: "older" } })
  expect(await backfill).toBeUndefined()
  expect(calls).toBe(1)
  await backfillLoadedSkills(context, "session-1", controller.signal)
  expect(calls).toBe(1)
})

test("backfill failures propagate so the caller can retry", async () => {
  const context = {
    client: { message: { list: async () => { throw new Error("offline") } } },
  } as unknown as Plugin.Context
  await expect(backfillLoadedSkills(context, "session-1")).rejects.toThrow("offline")
})
