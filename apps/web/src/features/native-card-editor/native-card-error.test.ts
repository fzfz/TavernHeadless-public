import { apiErrorMessages } from "@tavern/shared";
import { describe, expect, it } from "vitest";
import { nativeCardHumanError } from "./native-card-error.js";

describe("nativeCardHumanError", () => {
  it("uses the shared mapping after normalizing lower-case backend codes", () => {
    expect(nativeCardHumanError(
      Object.assign(new Error("private upstream details"), { code: "role_release_initialization_failed" }),
      "fallback",
      { ROLE_RELEASE_INITIALIZATION_FAILED: "初始化失败，请重试。", ROLE_USER_REQUEST_FAILED: "请求失败。" },
    )).toBe("初始化失败，请重试。");
  });

  it("uses the shared unknown-code template without exposing server messages", () => {
    expect(nativeCardHumanError(
      Object.assign(new Error("English server internals"), { code: "new_server_code" }),
      "fallback",
      { API_ERROR_UNMAPPED: "未知接口错误 {code}，请联系管理员。", ROLE_USER_REQUEST_FAILED: "请求失败。" },
    )).toBe("未知接口错误 new_server_code，请联系管理员。");
  });

  it("maps fetch failures and sends uncoded non-network exceptions through the shared unmapped template", () => {
    expect(nativeCardHumanError(new TypeError("Failed to fetch"), "fallback", { NETWORK_ERROR: "连接失败。" })).toBe("连接失败。");
    expect(nativeCardHumanError(new Error("English TypeError details"), "fallback"))
      .toBe(apiErrorMessages.API_ERROR_UNMAPPED.replaceAll("{code}", "（未返回）"));
  });
});
