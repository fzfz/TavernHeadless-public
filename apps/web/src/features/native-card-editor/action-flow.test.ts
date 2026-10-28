import { describe, expect, it, vi } from "vitest";
import { saveAndContinueLabel, saveThenRunAction } from "./action-flow.js";

const labels = {
  saveAndLeave: "保存后离开",
  saveAndCheck: "保存后检查",
  saveAndPreview: "保存后预览",
  saveAndPublish: "保存后发布",
  saveAndBuild: "保存后打包",
};

describe("native card editor save continuation", () => {
  it.each([
    ["check", "保存后检查"],
    ["preview", "保存后预览"],
    ["publish", "保存后发布"],
    ["build", "保存后打包"],
  ] as const)("labels the %s action", (action, expected) => {
    expect(saveAndContinueLabel(action, labels)).toBe(expected);
  });

  it("continues with the requested action only after a successful save", async () => {
    const save = vi.fn().mockResolvedValue(true);
    const run = vi.fn().mockResolvedValue(undefined);

    await expect(saveThenRunAction("check", save, run)).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith("check");
  });

  it("keeps the requested action pending when save fails", async () => {
    const run = vi.fn().mockResolvedValue(undefined);

    await expect(saveThenRunAction("preview", vi.fn().mockResolvedValue(false), run)).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
