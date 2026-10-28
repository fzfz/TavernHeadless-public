import { describe, expect, it } from "vitest";
import { nativeCardPathFailure } from "./native-card-path-failure.js";

describe("nativeCardPathFailure", () => {
  it("keeps invalid path syntax separate from unsupported package directory rules", () => {
    expect(nativeCardPathFailure("../data.json", "路径语法无效。" )).toBe("路径语法无效。");
    expect(nativeCardPathFailure("data/nested/browser-copy.json", "路径语法无效。"))
      .toBe("文件路径不属于当前包格式支持的目录。请将文件移动到规则规定的目录并同步引用。");
  });

  it("reports the shared purpose mismatch when the path is allowed for another purpose", () => {
    expect(nativeCardPathFailure("data/browser-copy.json", "路径语法无效。", "media"))
      .toBe("清单中的文件用途不符合该文件的目录规则。请按目录规则修正 manifest.json 中的 purpose。");
  });

  it("accepts paths supported for the requested purpose", () => {
    expect(nativeCardPathFailure("assets/browser-copy.png", "路径语法无效。", "media")).toBeUndefined();
  });
});
