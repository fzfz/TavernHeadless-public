import { describe, expect, it } from "vitest";
import { modelCallPersistenceDetailsSchema } from "@tavern/shared";
import {
  ModelCallPersistenceError,
  modelCallPersistenceDetails,
} from "../model-call-recorder.js";

describe("model call persistence diagnostics", () => {
  it("preserves provider and database causes through aggregate and SDK wrappers", () => {
    const model = Object.assign(new Error("provider unavailable"), {
      code: "HTTP_503",
    });
    const database = Object.assign(new Error("database locked"), {
      code: "SQLITE_BUSY",
    });
    const failure = new ModelCallPersistenceError(
      "call",
      "failed",
      new AggregateError([model, database], "model and save failed"),
    );
    const wrapper = new Error("SDK wrapper", { cause: failure });
    const details = modelCallPersistenceDetailsSchema.parse(
      modelCallPersistenceDetails(wrapper),
    );
    expect(details).toMatchObject({
      call_id: "call",
      stage: "failed",
      turn_committed: false,
    });
    expect(details.error.causes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "HTTP_503",
          message: "provider unavailable",
        }),
        expect.objectContaining({
          code: "SQLITE_BUSY",
          message: "database locked",
        }),
      ]),
    );
  });
  it("identifies a committed turn without inventing a call identifier", () => {
    const failure = new ModelCallPersistenceError(
      null,
      "turn_outcome",
      new Error("database locked"),
      true,
      { floorId: "floor", runId: "run" },
    );
    expect(modelCallPersistenceDetails(failure)).toMatchObject({
      call_id: null,
      floor_id: "floor",
      run_id: "run",
      turn_committed: true,
    });
    expect(failure.message).toContain("floor");
    expect(failure.message).toContain("run");
    expect(failure.message).toContain("already been committed");
    expect(failure.message).toContain("retrying persistence");
  });
  it("leaves unrelated errors outside the persistence contract", () => {
    expect(modelCallPersistenceDetails(new Error("unrelated"))).toBeUndefined();
  });
});
