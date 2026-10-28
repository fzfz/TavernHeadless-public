import { describe, expect, it } from "vitest";
import { promptAssemblyInputSchema } from "../prompt-assembly-input.js";
import {
  statePromptSourceIdSchema,
  statePromptSourceIds,
  statePromptSourceNames,
  statePromptSources,
} from "../state-prompt-sources.js";

describe("prompt assembly input schema", () => {
  it("accepts sourced current messages, state text sources, and stat_data overrides", () => {
    expect(promptAssemblyInputSchema.parse({
      conversation: {
        currentMessages: [
          { role: "user", content: "I enter the room.", sourceId: "input-1", floorNo: 9 },
          { role: "assistant", content: "She looks up.", sourceId: "reply-1", floorNo: 9 },
        ],
        stateData: { stateBefore: "{\"before\":{\"hp\":3}}" },
      },
      variableContext: {
        sessionId: "session-1",
        statData: { hp: 3, tags: ["tired"] },
      },
    })).toMatchObject({
      conversation: {
        currentMessages: [
          { role: "user", sourceId: "input-1", floorNo: 9 },
          { role: "assistant", sourceId: "reply-1", floorNo: 9 },
        ],
      },
      variableContext: { statData: { hp: 3, tags: ["tired"] } },
    });
  });

  it("publishes one configured list of state prompt source identifiers", () => {
    expect(statePromptSourceNames).toEqual({
      definition: "stateDefinition",
      rules: "stateRules",
      before: "stateBefore",
      history: "stateHistory",
      evidence: "stateEvidence",
      outputContract: "stateOutputContract",
    });
    expect(statePromptSourceIds).toEqual([
      "stateDefinition",
      "stateRules",
      "stateBefore",
      "stateHistory",
      "stateEvidence",
      "stateOutputContract",
    ]);
    expect(statePromptSourceIdSchema.safeParse("unknown-source").error?.issues[0]?.message)
      .toBe(statePromptSources.errors.unknownSourceId);
  });
});
