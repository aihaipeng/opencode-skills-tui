import { describe, expect, test } from "bun:test"
import { sortSkillsByLoaded, toSummaries } from "../src/skill-data"

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
})
