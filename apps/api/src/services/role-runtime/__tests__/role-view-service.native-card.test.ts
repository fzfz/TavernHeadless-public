import { afterEach, expect, it, vi } from "vitest";
import type { DisplaySnapshotService } from "../display-snapshot-service.js";
import type { StateUpdateService } from "../state-update-service.js";
import type { RoleAssetService } from "../role-asset-service.js";
import { RoleViewService } from "../role-view-service.js";

afterEach(() => vi.restoreAllMocks());

it("delivers native frontend URLs and fixed-version JSON data", async () => {
  const characterSnapshot = {
    name: "雾港来信",
    extensions: {
      tavern_headless: {
        nativePackage: { cardId: "card", revision: 5 },
        openings: {
          items: [
            { id: "first", displayText: "开场正文", variables: { location: "邮局" } },
          ],
        },
      },
    },
  };
  const session = {
    id: "session",
    accountId: "owner",
    characterId: "character",
    characterVersionId: "version / fixed",
    characterSnapshotJson: JSON.stringify(characterSnapshot),
    userSnapshotJson: JSON.stringify({ name: "裴修远", description: "邮局管理员" }),
    metadataJson: JSON.stringify({ opening_id: "first" }),
    title: "雾港来信",
  };
  const initial = {
    sessionId: "session",
    branchId: "main",
    floorId: null,
    attemptId: null,
    versionId: "version / fixed",
    snapshotId: "snapshot-initial",
    parentSnapshotId: null,
    variables: { location: "邮局" },
    source: { kind: "initial", runId: null, jobId: null },
  };
  const snapshots = {
    session: vi.fn(() => session),
    first: vi.fn(() => initial),
    latest: vi.fn(() => null),
  } as unknown as DisplaySnapshotService;
  const updates = {
    pending: vi.fn(() => null),
    isRunning: vi.fn(() => false),
  } as unknown as StateUpdateService;
  const nativeRevision = vi.fn(async () => ({
    package: {
      frontendManifest: {
        apiVersion: 1,
        html: "frontend/index.html",
        css: "frontend/style.css",
        script: "frontend/main.js",
        floorHtml: "frontend/floors/item.html",
        assets: {
          cover: { kind: "image", file: "assets/portrait.svg", label: "雾港夜景", tags: ["封面"] },
        },
        data: { caseFile: "data/case.json" },
      },
    },
  } as never));
  const read = vi.fn(async (_accountId: string, _versionId: string, path: string) => ({
    content: Buffer.from(path.endsWith(".html") ? '<img src="./icon.svg">' : `file:${path}`),
    mime: "text/plain",
  }));
  const readData = vi.fn(async (_accountId: string, _versionId: string, path: string) => {
    expect(path).toBe("data/case.json");
    return JSON.stringify({ location: "雾港邮局", clue: "灯塔素描" });
  });
  const assets = { nativeRevision, read, readData } as unknown as RoleAssetService;

  const view = await new RoleViewService(snapshots, updates, assets).get("owner", "session");

  expect(nativeRevision).toHaveBeenCalledWith("owner", "version / fixed");
  expect(readData).toHaveBeenCalledWith("owner", "version / fixed", "data/case.json");
  expect(view.delivery).toMatchObject({
    htmlUrl: "/role-assets/version%20%2F%20fixed/frontend/index.html",
    htmlAssetOriginOffsets: [10],
    floorHtmlUrl: "/role-assets/version%20%2F%20fixed/frontend/floors/item.html",
    floorHtmlAssetOriginOffsets: [10],
    cssUrl: "/role-assets/version%20%2F%20fixed/frontend/style.css",
    scriptUrl: "/role-assets/version%20%2F%20fixed/frontend/main.js",
    dataUrls: { caseFile: "/role-assets/version%20%2F%20fixed/data/case.json" },
    data: { caseFile: { location: "雾港邮局", clue: "灯塔素描" }, opening: "开场正文" },
    assets: {
      cover: {
        kind: "image",
        url: "/role-assets/version%20%2F%20fixed/assets/portrait.svg",
        label: "雾港夜景",
        tags: ["封面"],
      },
    },
  });
  expect(view.delivery.html).toBe('<img src="/role-assets/version%20%2F%20fixed/frontend/icon.svg">');
  expect(view.delivery.floorHtml).toBe('<img src="/role-assets/version%20%2F%20fixed/frontend/floors/icon.svg">');
  expect(view.delivery.css).toBe("file:frontend/style.css");
});

it("rejects a native data file that does not contain JSON", async () => {
  const snapshot = {
    extensions: {
      tavern_headless: {
        nativePackage: { cardId: "card", revision: 1 },
        openings: { items: [{ id: "first", displayText: "Hello", variables: {} }] },
      },
    },
  };
  const snapshots = {
    session: () => ({
      id: "session", accountId: "owner", characterVersionId: "version",
      characterSnapshotJson: JSON.stringify(snapshot),
      userSnapshotJson: JSON.stringify({ name: "User" }),
      metadataJson: JSON.stringify({ opening_id: "first" }),
    }),
    first: () => ({
      sessionId: "session", branchId: "main", floorId: null, attemptId: null,
      versionId: "version", snapshotId: "initial", parentSnapshotId: null,
      variables: {}, source: { kind: "initial", runId: null, jobId: null },
    }),
    latest: () => null,
  } as unknown as DisplaySnapshotService;
  const assets = {
    nativeRevision: async () => ({
      package: { frontendManifest: {
        apiVersion: 1, html: "index.html", css: "style.css", script: "main.js",
        assets: {}, data: { case: "data/case.json" },
      } },
    } as never),
    read: async () => ({ content: Buffer.from(""), mime: "text/plain" }),
    readData: async () => "not-json",
  } as unknown as RoleAssetService;
  const updates = { pending: () => null, isRunning: () => false } as unknown as StateUpdateService;

  await expect(new RoleViewService(snapshots, updates, assets).get("owner", "session"))
    .rejects.toMatchObject({ code: "ROLE_VIEW_CONFIG_INVALID" });
});

it("uses the system chat for a native package without frontend or state-update files", async () => {
  const characterSnapshot = {
    name: "花园向导",
    extensions: {
      tavern_headless: {
        nativePackage: { cardId: "card", revision: 1 },
        openings: {
          items: [{ id: "first", displayText: "门口有人等候。", variables: { location: "花园门口" } }],
        },
      },
    },
  };
  const session = {
    id: "session",
    accountId: "owner",
    characterId: "character",
    characterVersionId: "version",
    characterSnapshotJson: JSON.stringify(characterSnapshot),
    userSnapshotJson: JSON.stringify({ name: "裴修远", description: "花园管理员" }),
    metadataJson: JSON.stringify({ opening_id: "first" }),
    title: "花园向导",
  };
  const initial = {
    sessionId: "session",
    branchId: "main",
    floorId: null,
    attemptId: null,
    versionId: "version",
    snapshotId: "snapshot-initial",
    parentSnapshotId: null,
    variables: { location: "花园门口" },
    source: { kind: "initial", runId: null, jobId: null },
  };
  const snapshots = {
    session: vi.fn(() => session),
    first: vi.fn(() => initial),
    latest: vi.fn(() => null),
  } as unknown as DisplaySnapshotService;
  const updates = {
    pending: vi.fn(() => null),
    isRunning: vi.fn(() => false),
  } as unknown as StateUpdateService;
  const read = vi.fn(async () => ({ content: Buffer.from("unexpected"), mime: "text/plain" }));
  const assets = {
    nativeRevision: vi.fn(async () => ({ package: { frontendManifest: undefined } } as never)),
    read,
    readData: vi.fn(),
  } as unknown as RoleAssetService;

  const view = await new RoleViewService(snapshots, updates, assets).get("owner", "session");

  expect(snapshots.first).toHaveBeenCalledWith("owner", "session", "main");
  expect(view.initial).toEqual(initial);
  expect(view.delivery).toMatchObject({
    mode: "system_chat",
    html: "",
    css: "",
    scriptUrl: null,
    floorHtml: null,
    data: { opening: "门口有人等候。" },
    assets: {},
  });
  expect(read).not.toHaveBeenCalled();
  expect(assets.readData).not.toHaveBeenCalled();
});
