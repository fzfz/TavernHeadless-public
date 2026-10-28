import { describe, expect, it } from "vitest";
import { nativeCardIssuesFromError } from "./failure-issues.js";

describe("native card failure issues", () => {
  it("extracts API issues that can be located in the editor", () => {
    expect(nativeCardIssuesFromError({
      details: {
        issues: [{
          code: "NATIVE_CARD_INITIAL_STATE_INVALID",
          path: "state/initial/opening-1.json",
          pointer: "/hour",
          message: "初始变量不符合结构。",
          action: "请修复 hour 的初始值。",
        }],
      },
    })).toEqual([{
      code: "NATIVE_CARD_INITIAL_STATE_INVALID",
      path: "state/initial/opening-1.json",
      pointer: "/hour",
      message: "初始变量不符合结构。",
      action: "请修复 hour 的初始值。",
    }]);
  });

  it("ignores malformed error details", () => {
    expect(nativeCardIssuesFromError({ details: { issues: [{ path: "bad.json" }] } })).toEqual([]);
    expect(nativeCardIssuesFromError(new Error("failed"))).toEqual([]);
  });
});
