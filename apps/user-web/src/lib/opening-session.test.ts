import { describe, expect, it } from "vitest";
import { createRoleReleaseSessionBodySchema } from "@tavern/shared";
import { openingSessionInput } from "./opening-session.js";

describe("opening session requests", () => {
  it("creates a group session for a group-only opening", () => {
    expect(
      createRoleReleaseSessionBodySchema.parse(
        openingSessionInput({ id: "garden", audience: "group" }),
      ),
    ).toEqual({ opening_id: "garden", session_type: "group" });
  });

  it.each(["individual", "both", undefined] as const)(
    "keeps the default session type for %s openings",
    (audience) => {
      expect(
        createRoleReleaseSessionBodySchema.parse(
          openingSessionInput({ id: "post-office", audience }),
        ),
      ).toEqual({ opening_id: "post-office" });
    },
  );

  it("leaves opening selection to the release when none is selected", () => {
    expect(
      createRoleReleaseSessionBodySchema.parse(openingSessionInput(undefined)),
    ).toEqual({});
  });
});
