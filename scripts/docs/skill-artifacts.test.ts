import { describe, expect, it } from "vitest";
import { buildSkillArtifacts, skillWorkflows } from "./skill-artifacts";

describe("published skills use repository workflows", () => {
  it("publishes each workflow below the configured Pages base", () => {
    const artifacts = buildSkillArtifacts("/different-project/");
    expect(artifacts[0]!.json).toBe(
      "/different-project/agent/skills/tavern-client-integration.json",
    );
    expect(artifacts[1]!.humanPage).toBe(
      "/different-project/agent/skills/tavern-project-contributing",
    );
    for (const [index, skill] of artifacts.entries()) {
      expect(skill.decisionRules).toEqual(skillWorkflows[index]!.decisionRules);
      expect(skill.workflow).toEqual(skillWorkflows[index]!.workflow);
      expect(skill.lastReviewedAt).toBe(skillWorkflows[index]!.lastReviewedAt);
      expect(
        skill.relatedDocs.every((doc) =>
          doc.path.startsWith("/different-project/"),
        ),
      ).toBe(true);
      expect(skill).not.toHaveProperty("$schema");
    }
  });
  it("supports a root site and preserves the relative source", () => {
    const artifacts = buildSkillArtifacts("/");
    expect(artifacts[0]!.json).toBe(
      "/agent/skills/tavern-client-integration.json",
    );
    expect(skillWorkflows[0]!.json).toBe(
      "agent/skills/tavern-client-integration.json",
    );
  });
  it.each(["https://upstream.example/skill.json", "/absolute", "../outside"])(
    "reports malformed path %s",
    (path) => {
      expect(() =>
        buildSkillArtifacts("/", [{ ...skillWorkflows[0]!, humanPage: path }]),
      ).toThrow();
    },
  );
});
