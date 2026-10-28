import { describe, expect, it } from "vitest";
import { apiErrorMessages } from "@tavern/shared";

import { parseSourcePromptContextJson } from "../source-context.js";

describe("source prompt context", () => {
  it("keeps legacy contexts readable when request injections are absent", () => {
    const legacyContext = {
      agentResults: [],
      agentContributors: [],
      memorySummary: "remembered",
    };

    expect(parseSourcePromptContextJson(JSON.stringify(legacyContext))).toEqual(
      legacyContext,
    );
  });

  it("rejects request injections that do not match the saved builder input structure", () => {
    const validContext = {
      agentResults: [],
      agentContributors: [],
    };

    expect(() =>
      parseSourcePromptContextJson(
        JSON.stringify({
          ...validContext,
          requestInjections: "not-an-array",
        }),
      ),
    ).toThrow(apiErrorMessages.ROLE_STATE_SOURCE_CONTEXT_INVALID);

    expect(() =>
      parseSourcePromptContextJson(
        JSON.stringify({
          ...validContext,
          requestInjections: [
            { sourceKind: "client_injection", title: "Temporary" },
          ],
        }),
      ),
    ).toThrow(apiErrorMessages.ROLE_STATE_SOURCE_CONTEXT_INVALID);
  });
});
