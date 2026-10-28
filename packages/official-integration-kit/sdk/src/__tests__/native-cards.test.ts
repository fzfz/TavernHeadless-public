import { describe, expect, it, vi } from "vitest";
import { createTavernClient } from "../index.js";

describe("native character card SDK", () => {
  it.each([
    ['attachment; filename="character-build-1.zip"', "character-build-1.zip"],
    ["attachment; filename=plain.zip", "plain.zip"],
    [
      "attachment; filename=plain.zip; filename*=UTF-8''%E9%9B%BE%E6%B8%AF.zip",
      "雾港.zip",
    ],
    [null, null],
  ])(
    "keeps the ZIP response filename in the artifact result: %s",
    async (header, fileName) => {
      const fetchImpl = vi.fn(
        async () =>
          new Response("ZIP", {
            headers: header ? { "content-disposition": header } : {},
          }),
      );
      const client = createTavernClient({
        baseUrl: "http://api.test",
        fetchImpl,
        getHeaders: () => ({ authorization: "Bearer test" }),
      });
      const artifact = await client.nativeCards.downloadArtifact({
        buildId: "build-1",
      });
      expect(artifact.fileName).toBe(fileName);
      expect(await artifact.blob.text()).toBe("ZIP");
      const [url, options] = fetchImpl.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe("http://api.test/native-card-builds/build-1/download");
      expect(new Headers(options.headers).get("authorization")).toBe(
        "Bearer test",
      );
    },
  );
  it("reports failed artifact requests through the normal SDK error", async () => {
    const client = createTavernClient({
      baseUrl: "http://api.test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "NATIVE_CARD_BUILD_NOT_READY",
              message: "not ready",
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    });
    await expect(
      client.nativeCards.downloadArtifact({ buildId: "build-1" }),
    ).rejects.toMatchObject({ code: "NATIVE_CARD_BUILD_NOT_READY" });
  });
  it.each(['attachment; filename=""', "attachment; filename*=UTF-8''%ZZ.zip"])(
    "rejects an invalid artifact filename: %s",
    async (header) => {
      const client = createTavernClient({
        baseUrl: "http://api.test",
        fetchImpl: async () =>
          new Response("ZIP", { headers: { "content-disposition": header } }),
      });
      await expect(
        client.nativeCards.downloadArtifact({ buildId: "build-1" }),
      ).rejects.toThrow();
    },
  );
  it("uploads the selected ZIP bytes with authenticated transport", async () => {
    const result = {
      id: "import-1",
      fileName: "garden.zip",
      packageId: "garden",
      name: "花园向导",
      summary: {
        formatVersion: "1.0.0",
        worldbookCount: 0,
        openingCount: 0,
        initialStateCount: 0,
        stateUpdate: {
          rules: false,
          schema: false,
          validators: false,
          tools: false,
        },
        promptController: false,
        frontend: { page: false, script: false, style: false, media: false },
        regexProfileCount: 0,
      },
      files: [],
      issues: [],
      status: "ready",
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: result }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createTavernClient({
      baseUrl: "http://api.test",
      fetchImpl,
      getHeaders: () => ({ authorization: "Bearer test" }),
    });
    const file = new Blob([new Uint8Array([0x50, 0x4b, 3, 4])], {
      type: "application/zip",
    });
    expect(
      await client.nativeCards.checkImport({ file, fileName: "garden.zip" }),
    ).toEqual(result);
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "http://api.test/native-cards/imports?fileName=garden.zip",
    );
    expect(new Headers(options.headers).get("authorization")).toBe(
      "Bearer test",
    );
    expect(options.body).toBe(file);
  });
  it("keeps file operations and expected revision in a single request", async () => {
    const card = {
      id: "card-1",
      characterId: "character-1",
      packageId: "garden",
      name: "花园向导",
      revision: 2,
      createdAt: 1,
      updatedAt: 2,
      files: [],
      versions: [],
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: card }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createTavernClient({
      baseUrl: "http://api.test",
      fetchImpl,
    });
    const operations = [
      {
        op: "write" as const,
        path: "openings/first.txt",
        encoding: "utf8" as const,
        content: "欢迎来到花园。",
      },
    ];
    expect(
      await client.nativeCards.save({
        cardId: "card-1",
        expectedRevision: 1,
        operations,
      }),
    ).toEqual(card);
    const [, options] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(options.body))).toEqual({
      expectedRevision: 1,
      operations,
    });
  });
  it("surfaces a conflict without retrying or changing the submitted revision", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "NATIVE_CARD_REVISION_CONFLICT",
              message: "读取最新修订后合并修改。",
              details: { currentRevision: 2 },
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    );
    const client = createTavernClient({
      baseUrl: "http://api.test",
      fetchImpl,
    });
    await expect(
      client.nativeCards.save({
        cardId: "card-1",
        expectedRevision: 1,
        operations: [{ op: "delete", path: "assets/old.png" }],
      }),
    ).rejects.toMatchObject({ code: "NATIVE_CARD_REVISION_CONFLICT" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("downloads a binary ZIP and normalizes download failures", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
          headers: { "content-type": "application/zip" },
        }),
    );
    const client = createTavernClient({
      baseUrl: "http://api.test",
      fetchImpl,
    });
    const zip = await client.nativeCards.downloadBuild({ buildId: "build-1" });
    expect(new Uint8Array(await zip.arrayBuffer())).toEqual(
      new Uint8Array([0x50, 0x4b, 3, 4]),
    );
    fetchImpl.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "NATIVE_CARD_BUILD_NOT_READY",
              message: "等待打包完成后重试下载。",
            },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    );
    await expect(
      client.nativeCards.downloadBuild({ buildId: "build-1" }),
    ).rejects.toMatchObject({ code: "NATIVE_CARD_BUILD_NOT_READY" });
  });
});
