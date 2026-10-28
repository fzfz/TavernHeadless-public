import { describe, expect, it, vi } from "vitest";
import {
  loadPublishedHistory,
  publicationComparisonBase,
} from "./published-history";
const commit = "a".repeat(40);
const item = {
  commit,
  publishedAt: "2026-09-14T00:00:00Z",
  breaking: false,
  manifest: `/docs/agent/manifests/${commit}.json`,
};
const siteUrl = "https://example.github.io/docs/";
const repository = "example/docs";
const manifest = { source: { repo: repository, commit } };
const response = (value: unknown) => new Response(JSON.stringify(value));

describe("published documentation history", () => {
  it("records a first publication only for an absent history", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    expect(
      (await loadPublishedHistory(siteUrl, repository, 50, request)).state,
    ).toBe("first-publication");
  });
  it("keeps local publication history and its comparison base", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ retention: 50, items: [item] }))
      .mockResolvedValueOnce(response(manifest));
    const result = await loadPublishedHistory(siteUrl, repository, 50, request);
    expect(result.items).toEqual([item]);
    expect(result.compareBaseCommit).toBe(commit);
    expect(JSON.parse(result.manifestContents.get(commit)!)).toEqual(manifest);
  });
  it("validates the comparison source with retention one", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ retention: 1, items: [item] }))
      .mockResolvedValueOnce(response(manifest));
    expect(
      (await loadPublishedHistory(siteUrl, repository, 1, request)).items,
    ).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("accepts a published empty history", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(response({ retention: 50, items: [] }));
    expect(
      (await loadPublishedHistory(siteUrl, repository, 50, request)).state,
    ).toBe("existing-publication");
  });
  it.each([403, 500])(
    "reports HTTP %s instead of claiming first publication",
    async (status) => {
      const request = vi.fn().mockResolvedValue(new Response(null, { status }));
      await expect(
        loadPublishedHistory(siteUrl, repository, 50, request),
      ).rejects.toThrow();
    },
  );
  it("reports network failure", async () => {
    await expect(
      loadPublishedHistory(
        siteUrl,
        repository,
        50,
        vi.fn().mockRejectedValue(new Error("offline")),
      ),
    ).rejects.toThrow("offline");
  });
  it.each([
    { retention: 50, items: "invalid" },
    { retention: 50, items: [{ ...item, commit: "invalid" }] },
  ])("reports malformed history", async (history) => {
    await expect(
      loadPublishedHistory(
        siteUrl,
        repository,
        50,
        vi.fn().mockResolvedValue(response(history)),
      ),
    ).rejects.toThrow();
  });
  it.each([
    {
      ...item,
      manifest: `https://upstream.github.io/docs/agent/manifests/${commit}.json`,
    },
    { ...item, manifest: "/other.json" },
  ])("rejects a manifest outside the configured site path", async (entry) => {
    const request = vi
      .fn()
      .mockResolvedValue(response({ retention: 50, items: [entry] }));
    await expect(
      loadPublishedHistory(siteUrl, repository, 50, request),
    ).rejects.toThrow();
  });
  it.each([
    { source: { repo: "upstream/docs", commit } },
    { source: { repo: repository, commit: "b".repeat(40) } },
    {},
  ])("rejects an unrelated manifest", async (value) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ retention: 50, items: [item] }))
      .mockResolvedValueOnce(response(value));
    await expect(
      loadPublishedHistory(siteUrl, repository, 50, request),
    ).rejects.toThrow();
  });
  it("reports an unavailable retained manifest", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ retention: 50, items: [item] }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      loadPublishedHistory(siteUrl, repository, 50, request),
    ).rejects.toThrow();
  });
});

describe("comparison base for repeated publication", () => {
  it.each([1, 50])(
    "retains the published baseline with retention %s",
    async (retention) => {
      const base = "b".repeat(40);
      const request = vi
        .fn()
        .mockResolvedValueOnce(response({ retention, items: [item] }))
        .mockResolvedValueOnce(
          response({ ...manifest, compareBase: { commit: base } }),
        );
      const history = await loadPublishedHistory(
        siteUrl,
        repository,
        retention,
        request,
      );
      expect(publicationComparisonBase(history, commit)).toBe(base);
      expect(publicationComparisonBase(history, "c".repeat(40))).toBe(commit);
    },
  );
  it("keeps an absent baseline absent for a root publication", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ retention: 50, items: [item] }))
      .mockResolvedValueOnce(response(manifest));
    expect(
      publicationComparisonBase(
        await loadPublishedHistory(siteUrl, repository, 50, request),
        commit,
      ),
    ).toBeNull();
  });
  it("has no published baseline before the first publication", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    expect(
      publicationComparisonBase(
        await loadPublishedHistory(siteUrl, repository, 50, request),
        commit,
      ),
    ).toBeNull();
  });
  it("rejects malformed published comparison evidence", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response({ retention: 50, items: [item] }))
      .mockResolvedValueOnce(
        response({ ...manifest, compareBase: { commit: "invalid" } }),
      );
    await expect(
      loadPublishedHistory(siteUrl, repository, 50, request),
    ).rejects.toThrow();
  });
});
