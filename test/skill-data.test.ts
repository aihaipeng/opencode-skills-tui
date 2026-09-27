import { describe, expect, test } from "bun:test"
import { backfillLoadedSkills, extractMessageSkillLoads, sortSkillsByLoaded, toSummaries } from "../src/skill-data"
import type { Plugin } from "@opencode/plugin/tui"

function assistantWithTools(entries: unknown[]) {
  return { id: "msg_tool", type: "assistant", content: entries }
}

describe("skill data", () => {
  test("deduplicates and sorts skill summaries", () => {
    const skills = [
      { name: "zeta", content: "last" },
      { name: "alpha", content: "first" },
      { name: "zeta", content: "duplicate" },
    ]

    expect(toSummaries(skills)).toEqual([
      { name: "alpha", content: "first" },
      { name: "zeta", content: "last" },
    ])
  })

  test("pins loaded skills before unloaded skills", () => {
    const skills = [
      { name: "beta", content: "" },
      { name: "alpha", content: "" },
      { name: "gamma", content: "" },
    ]

    expect(sortSkillsByLoaded(skills, new Set(["gamma"])).map((skill) => skill.name)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ])
    expect(skills.map((skill) => skill.name)).toEqual(["beta", "alpha", "gamma"])
  })

  test("extracts skill names from completed skill tool entries", () => {
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

  test("extracts loads from dedicated skill messages, using the display name", () => {
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

    expect(extractMessageSkillLoads(message)).toEqual(["OpenCode"])
    expect(extractMessageSkillLoads({ id: "msg_4", type: "assistant", content: [] })).toEqual([])
  })

  test("extracts skill names from user message attachments", () => {
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
})


test("extracts skill tags from every tool text part, not just the first", () => {
  expect(extractMessageSkillLoads(assistantWithTools([{
    type: "tool",
    name: "skill",
    state: {
      status: "completed",
      content: [
        { type: "text", text: "Loading skill..." },
        { type: "image", data: "not text" },
        { type: "text", text: '<skill_content name="beta">\n# Beta' },
        { type: "text", text: '<skill_content name="gamma">\n# Gamma' },
      ],
    },
  }]))).toEqual(["beta", "gamma"])
})

test("backfills all history pages with the next cursor", async () => {
  const calls: unknown[] = []
  const loaded: string[] = []
  const context = {
    client: { message: { list: async (input: { cursor?: string }) => {
      calls.push(input)
      return input.cursor
        ? { data: [{ type: "skill", name: "alpha" }], cursor: {} }
        : { data: [{ type: "skill", name: "beta" }], cursor: { next: "older" } }
    } } },
  } as unknown as Plugin.Context
  await backfillLoadedSkills(context, "session-1", (name) => loaded.push(name))
  expect(calls).toEqual([
    { sessionID: "session-1", limit: 200 },
    { sessionID: "session-1", limit: 200, cursor: "older" },
  ])
  expect(loaded).toEqual(["beta", "alpha"])
})

test("cancelling an in-flight backfill discards its result and stops pagination", async () => {
  const controller = new AbortController()
  let calls = 0
  let resolve!: (page: unknown) => void
  const pending = new Promise((done) => { resolve = done })
  const loaded: string[] = []
  const context = {
    client: { message: { list: () => { calls++; return pending } } },
  } as unknown as Plugin.Context
  const backfill = backfillLoadedSkills(context, "session-1", (name) => loaded.push(name), controller.signal)
  controller.abort()
  resolve({ data: [{ type: "skill", name: "alpha" }], cursor: { next: "older" } })
  await backfill
  expect(calls).toBe(1)
  expect(loaded).toEqual([])
  await backfillLoadedSkills(context, "session-1", (name) => loaded.push(name), controller.signal)
  expect(calls).toBe(1)
})

test("backfill failures propagate so the caller can retry", async () => {
  const context = {
    client: { message: { list: async () => { throw new Error("offline") } } },
  } as unknown as Plugin.Context
  await expect(backfillLoadedSkills(context, "session-1", () => {})).rejects.toThrow("offline")
})
