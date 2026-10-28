import { describe, expect, it, vi } from "vitest";
import { createPublishedReleaseSession } from "./publication-session.js";

describe("createPublishedReleaseSession", () => {
  it("creates from the fixed release and navigates to the returned session without historical filters", async () => {
    const createSession = vi.fn().mockResolvedValue({ session: { id: "new-session" } });
    const openUrl = vi.fn();
    const result = await createPublishedReleaseSession({
      releaseId: "published-release",
      userWebBaseUrl: "https://example.test/role/?sessionId=old&snapshotId=old-state&floorId=old-floor#history",
      createSession,
      openUrl,
    });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith({ releaseId: "published-release", input: {} });
    expect(result).toEqual({ sessionId: "new-session", url: "https://example.test/role/?sessionId=new-session" });
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(result.url);
  });

  it("waits for the real session result before opening a page", async () => {
    let resolveSession!: (value: { session: { id: string } }) => void;
    const createSession = vi.fn().mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
    const openUrl = vi.fn();
    const pending = createPublishedReleaseSession({ releaseId: "release", userWebBaseUrl: "http://localhost:5174", createSession, openUrl });
    expect(openUrl).not.toHaveBeenCalled();
    resolveSession({ session: { id: "created" } });
    await pending;
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("http://localhost:5174/?sessionId=created");
  });

  it("rejects invalid configuration before creating a session", async () => {
    const createSession = vi.fn();
    const openUrl = vi.fn();
    await expect(createPublishedReleaseSession({ releaseId: "release", userWebBaseUrl: "invalid-url", createSession, openUrl })).rejects.toThrow();
    expect(createSession).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it.each([undefined, "", 123])("rejects the invalid returned session id %s", async (id) => {
    const createSession = vi.fn().mockResolvedValue({ session: { id } });
    const openUrl = vi.fn();
    await expect(createPublishedReleaseSession({ releaseId: "release", userWebBaseUrl: "http://localhost:5174", createSession, openUrl })).rejects.toThrow();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("preserves an API failure and does not navigate", async () => {
    const error = new Error("request failed");
    const createSession = vi.fn().mockRejectedValue(error);
    const openUrl = vi.fn();
    await expect(createPublishedReleaseSession({ releaseId: "release", userWebBaseUrl: "http://localhost:5174", createSession, openUrl })).rejects.toBe(error);
    expect(openUrl).not.toHaveBeenCalled();
  });
});
