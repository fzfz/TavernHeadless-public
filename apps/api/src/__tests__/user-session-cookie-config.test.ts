import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("browser session cookie configuration", () => {
  it.each([undefined, "llm-key"])(
    "keeps the default cookie policy with LLM_API_KEY=%s",
    (apiKey) => {
      vi.stubEnv("LLM_API_KEY", apiKey);
      vi.stubEnv("USER_SESSION_COOKIE_NAME", undefined);
      vi.stubEnv("USER_SESSION_COOKIE_SECURE", undefined);
      expect(loadConfig().userSessionCookie).toEqual({
        name: "tavern_session",
        secure: "auto",
      });
    },
  );

  it.each([
    "",
    "bad name",
    "bad;name",
    "bad=name",
    "bad,name",
    "bad/name",
    "bad:name",
    "会话",
    "bad\r\nname",
  ])("rejects the invalid cookie name %j", (name) => {
    vi.stubEnv("USER_SESSION_COOKIE_NAME", name);
    expect(() => loadConfig()).toThrow("USER_SESSION_COOKIE_NAME");
  });

  it.each(["", "auto", "TRUE", "FALSE", "1", "0", "yes", " false "])(
    "rejects the non-boolean Secure setting %j",
    (secure) => {
      vi.stubEnv("USER_SESSION_COOKIE_SECURE", secure);
      expect(() => loadConfig()).toThrow(
        "USER_SESSION_COOKIE_SECURE must be true or false",
      );
    },
  );

  it("accepts an explicit Secure setting", () => {
    vi.stubEnv("USER_SESSION_COOKIE_SECURE", "true");
    expect(loadConfig().userSessionCookie.secure).toBe(true);
  });
  it("loads the environment cookie name and explicit HTTP setting through AppConfig", () => {
    vi.stubEnv("USER_SESSION_COOKIE_NAME", "tavern_staging_session");
    vi.stubEnv("USER_SESSION_COOKIE_SECURE", "false");

    expect(loadConfig().userSessionCookie).toEqual({
      name: "tavern_staging_session",
      secure: false,
    });
  });
});
