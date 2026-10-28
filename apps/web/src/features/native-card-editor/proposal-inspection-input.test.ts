import { describe, expect, it } from "vitest";
import { parseProposalInspectionInput } from "./proposal-inspection-input.js";

describe("parseProposalInspectionInput", () => {
  it("parses fixed source messages and a candidate proposal", () => {
    expect(parseProposalInspectionInput(
      '[{"messageId":"m1","revision":2,"role":"assistant","text":"固定消息"}]',
      '{"changes":[{"op":"set","path":"/score","value":2}],"evidenceMessageIds":["m1"]}',
    )).toEqual({
      valid: true,
      input: {
        sourceMessages: [{ messageId: "m1", revision: 2, role: "assistant", text: "固定消息" }],
        proposal: { changes: [{ op: "set", path: "/score", value: 2 }], evidenceMessageIds: ["m1"] },
      },
    });
  });

  it("distinguishes invalid JSON from invalid schema data", () => {
    expect(parseProposalInspectionInput("{", "{} ")).toEqual({ valid: false, reason: "invalid_json" });
    expect(parseProposalInspectionInput("[]", '{"changes":[]}')).toEqual({ valid: false, reason: "invalid_shape" });
  });
});
