import { describe, expect, test } from "bun:test"
import { extractMessageSkillLoads, sortSkillsByLoaded, toSummaries } from "../src/skill-data"

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
