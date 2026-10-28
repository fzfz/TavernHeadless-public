import { describe, expect, it } from "vitest";
import {
  assertSiteEnvironment,
  parseSiteConfig,
  siteConfig,
} from "./site-config";

describe("documentation site configuration", () => {
  it("accepts a root Pages site and a project Pages site", () => {
    expect(parseSiteConfig(siteConfig).basePath).toBe("/TavernHeadless-docs/");
    expect(
      parseSiteConfig({
        ...siteConfig,
        basePath: "/",
        siteUrl: "https://example.github.io/",
      }).basePath,
    ).toBe("/");
  });
  it.each([
    { ...siteConfig, basePath: "missing-slashes" },
    { ...siteConfig, repository: "missing-owner" },
    { ...siteConfig, title: "" },
    { ...siteConfig, siteUrl: "http://example.com/" },
    { ...siteConfig, basePath: "/another/" },
    { ...siteConfig, extra: true },
    {},
  ])("rejects malformed configuration", (value) => {
    expect(() => parseSiteConfig(value)).toThrow();
  });
  it("accepts absent overrides and identical overrides", () => {
    expect(() => assertSiteEnvironment({})).not.toThrow();
    expect(() =>
      assertSiteEnvironment({ AGENT_REPOSITORY: siteConfig.repository }),
    ).not.toThrow();
  });
  it.each(["AGENT_REPOSITORY", "AGENT_PUBLIC_SITE_URL", "AGENT_BASE_PATH"])(
    "rejects conflicting %s",
    (name) => {
      expect(() => assertSiteEnvironment({ [name]: "other" })).toThrow();
    },
  );
});
