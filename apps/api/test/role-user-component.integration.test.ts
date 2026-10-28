import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createTavernClient, type TavernClient } from "@tavern/sdk";
import type { RoleReleasePublic } from "@tavern/shared";
import { buildTestApp } from "./helpers/create-test-db.js";
import { characterVersions } from "../src/db/schema.js";
import { loadStorageConfig } from "../src/storage-config.js";
import {
  configuration,
  ids,
  seedRoleResources,
} from "./helpers/role-workspace.js";
import App from "../../user-web/src/App.vue";
import type { RoleApplicationContext } from "../../user-web/src/lib/bootstrap.js";
import labels from "../../user-web/src/config/ui.json";
import policy from "../../user-web/public/config/runtime-policy.json";
import {
  mountComponent,
  settleComponent,
} from "../../web/src/test/component-host.js";

// Chat rendering and model generation are covered separately. This suite mounts
// the actual user application and sends its UI operations through SDK and Fastify.
vi.mock("../../user-web/src/features/chat/ChatSession.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: {
        sessionId: { type: String, required: true },
        floorId: { type: String, default: null },
      },
      emits: ["ready", "failure", "current"],
      setup(props) {
        return () =>
          h("div", {
            "data-session-id": props.sessionId,
            "data-floor-id": props.floorId,
          });
      },
    }),
  };
});
let app: FastifyInstance;
let client: TavernClient;
let dataRoot: string;
let host: ReturnType<typeof mountComponent> | undefined;
let release: RoleReleasePublic;
let context: RoleApplicationContext;
let location: { href: string };
let confirm: ReturnType<typeof vi.fn>;
let failedPath: string | null;
let requests: Array<{ method: string; path: string }>;
function button(text: string) {
  const result = host!.all(
    (n) => n.tagName === "BUTTON" && n.textContent.trim() === text,
  )[0];
  if (!result) throw new Error(`Missing user action: ${text}`);
  return result;
}
async function click(text: string) {
  button(text).click();
  await settleComponent();
}
async function mount() {
  host = mountComponent(App, { context });
  await vi.waitFor(() =>
    expect(host!.all((n) => n.props.role === "status")).toHaveLength(0),
  );
  await settleComponent();
}
async function chooseRole() {
  const card = host!.all(
    (n) => n.tagName === "BUTTON" && n.props.class === "role-card",
  )[0];
  expect(card).toBeDefined();
  card!.click();
  await settleComponent();
}
function currentSession() {
  return host!.all((n) => typeof n.props["data-session-id"] === "string")[0]
    ?.props["data-session-id"] as string | undefined;
}
beforeEach(async () => {
  failedPath = null;
  requests = [];
  dataRoot = await mkdtemp(join(tmpdir(), "role-user-component-"));
  const storage = loadStorageConfig({ DATA_DIR: dataRoot });
  const built = await buildTestApp({
    databasePath: ":memory:",
    storage,
    logger: false,
    auth: { mode: "off" },
  });
  app = built.app;
  await seedRoleResources(built.database, storage);
  const stored = built.database
    .select()
    .from(characterVersions)
    .where(eq(characterVersions.id, ids.characterVersion))
    .get()!;
  built.database
    .update(characterVersions)
    .set({
      dataJson: JSON.stringify({
        ...JSON.parse(stored.dataJson),
        alternateGreetings: ["The keeper waits by the northern gate."],
      }),
    })
    .where(eq(characterVersions.id, ids.characterVersion))
    .run();
  client = createTavernClient({
    baseUrl: "http://user-ui.test",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      requests.push({ method, path: url.pathname });
      if (url.pathname === failedPath) {
        failedPath = null;
        throw new TypeError("Isolated browser transport failure");
      }
      const response = await app.inject({
        method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        url: url.pathname + url.search,
        headers: Object.fromEntries(new Headers(init?.headers)),
        payload: init?.body as string,
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: response.headers as Record<string, string>,
      });
    },
  });
  const draft = await client.roleApps.create({
    configuration: configuration(),
  });
  release = await client.roleApps.publish({
    id: draft.id,
    expectedRevision: draft.revision,
  });
  context = {
    client,
    sessionId: null,
    snapshotId: null,
    characterName: null,
    roleReleaseId: null,
    preview: null,
    config: {
      apiBaseUrl: "http://user-ui.test",
      adminBaseUrl: "http://admin-ui.test",
    },
    policy,
  };
  location = { href: "http://user-ui.test/?floorId=old-floor" };
  confirm = vi.fn(() => true);
  vi.stubGlobal("window", {
    location,
    confirm,
    history: {
      replaceState(_state: unknown, _title: string, url: URL | string) {
        location.href = String(url);
      },
    },
  });
});
afterEach(async () => {
  host?.unmount();
  host = undefined;
  await app?.close();
  if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
describe("user application events through the official SDK and Fastify", () => {
  it("opens and cancels the opening picker, then starts exactly one session with the selected opening", async () => {
    await mount();
    expect(host!.root.textContent).toContain(release.name);
    await chooseRole();
    expect(host!.all((n) => n.props.role === "dialog")).toHaveLength(1);
    await click(labels.cancel);
    expect(host!.all((n) => n.props.role === "dialog")).toHaveLength(0);
    expect(await client.sessions.list()).toHaveLength(0);
    await chooseRole();
    const alternate = release.openings.find((opening) => !opening.default)!;
    expect(alternate).toBeDefined();
    const radio = host!.all(
      (n) =>
        n.tagName === "INPUT" &&
        n.props.type === "radio" &&
        n.value === alternate.id,
    )[0]!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    await settleComponent();
    const start = button(labels.start);
    start.click();
    start.click();
    await vi.waitFor(() => expect(currentSession()).toBeTruthy());
    const sessions = await client.sessions.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(currentSession());
    const detail = await client.sessions.getDetail({
      sessionId: sessions[0]!.id,
    });
    expect(detail.metadata).toMatchObject({
      role_release_id: release.id,
      opening_id: alternate.id,
    });
    expect(new URL(location.href).searchParams.get("sessionId")).toBe(
      sessions[0]!.id,
    );
    expect(new URL(location.href).searchParams.has("floorId")).toBe(false);
    expect(host!.all((n) => n.props.role === "dialog")).toHaveLength(0);
  });
  it("continues formal history, returns to the catalog, and leaves ordinary sessions outside formal history", async () => {
    const formal = await client.roleReleases.createSession({
      releaseId: release.id,
    });
    await client.sessions.update({
      sessionId: formal.session.id as string,
      title: "Continue this story",
    });
    await client.sessions.create({ title: "Unrelated ordinary session" });
    await mount();
    await click(labels.history);
    expect(host!.root.textContent).toContain("Continue this story");
    expect(host!.root.textContent).not.toContain("Unrelated ordinary session");
    expect(button(labels.history).props["aria-pressed"]).toBe(true);
    await click(labels.continue);
    expect(currentSession()).toBe(formal.session.id);
    await click(labels.back);
    await vi.waitFor(() =>
      expect(host!.all((n) => n.props.class === "role-card")).toHaveLength(1),
    );
    expect(currentSession()).toBeUndefined();
    expect(new URL(location.href).searchParams.has("sessionId")).toBe(false);
    expect(button(labels.catalog).props["aria-pressed"]).toBe(true);
    await click(labels.history);
    expect(host!.root.textContent).toContain("Continue this story");
  });
  it("cancels, rejects blank input and saves a renamed history session", async () => {
    const formal = await client.roleReleases.createSession({
      releaseId: release.id,
    });
    const original = (
      await client.sessions.getDetail({ sessionId: formal.session.id as string })
    ).title;
    await mount();
    await click(labels.history);
    await click(labels.renameSession);
    const input = () =>
      host!.all(
        (n) =>
          n.tagName === "INPUT" &&
          n.props.placeholder === labels.renameSessionPlaceholder,
      )[0]!;
    input().value = "Unsubmitted name";
    input().dispatchEvent(new Event("input"));
    await click(labels.cancelSessionRename);
    expect(
      (await client.sessions.getDetail({ sessionId: formal.session.id as string })).title,
    ).toBe(original);
    await click(labels.renameSession);
    input().value = "   ";
    input().dispatchEvent(new Event("input"));
    await settleComponent();
    expect(button(labels.saveSessionName).props.disabled).toBe(true);
    input().value = "  Renamed user story  ";
    input().dispatchEvent(new Event("input"));
    await settleComponent();
    await click(labels.saveSessionName);
    await vi.waitFor(() =>
      expect(host!.root.textContent).toContain("Renamed user story"),
    );
    expect(
      (await client.sessions.getDetail({ sessionId: formal.session.id as string })).title,
    ).toBe("Renamed user story");
  });
  it("keeps a session when deletion is cancelled or fails, then removes it after confirmed retry", async () => {
    const formal = await client.roleReleases.createSession({
      releaseId: release.id,
    });
    await mount();
    await click(labels.history);
    const deletesBefore = requests.filter(
      (request) => request.method === "DELETE",
    ).length;
    confirm.mockReturnValueOnce(false);
    await click(labels.delete);
    expect(confirm).toHaveBeenCalledWith(labels.deleteConfirm);
    expect(
      requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(deletesBefore);
    expect(await client.sessions.list()).toHaveLength(1);
    failedPath = `/sessions/${formal.session.id}`;
    await click(labels.delete);
    await vi.waitFor(() =>
      expect(host!.all((n) => n.props.role === "alert")).toHaveLength(1),
    );
    expect(host!.all((n) => n.tagName === "ARTICLE")).toHaveLength(1);
    await click(labels.delete);
    await vi.waitFor(() =>
      expect(host!.all((n) => n.tagName === "ARTICLE")).toHaveLength(0),
    );
    expect(host!.root.textContent).toContain(labels.emptyHistory);
    expect(await client.sessions.list()).toHaveLength(0);
  });
  it("retries a failed catalog load and recovers the published role and formal history", async () => {
    const formal = await client.roleReleases.createSession({
      releaseId: release.id,
    });
    await client.sessions.update({
      sessionId: formal.session.id as string,
      title: "History after recovery",
    });
    failedPath = "/role-releases";
    await mount();
    expect(host!.all((n) => n.props.role === "alert")).toHaveLength(1);
    await click(labels.retry);
    await vi.waitFor(() =>
      expect(host!.all((n) => n.props.class === "role-card")).toHaveLength(1),
    );
    expect(host!.all((n) => n.props.role === "alert")).toHaveLength(0);
    expect(host!.root.textContent).toContain(release.name);
    await click(labels.history);
    expect(host!.root.textContent).toContain("History after recovery");
  });
  it("keeps the selected opening when session creation fails and succeeds after retry", async () => {
    await mount();
    await chooseRole();
    failedPath = `/role-releases/${release.id}/sessions`;
    await click(labels.start);
    await vi.waitFor(() =>
      expect(host!.all((n) => n.props.role === "alert")).toHaveLength(1),
    );
    expect(host!.all((n) => n.props.role === "dialog")).toHaveLength(1);
    expect(await client.sessions.list()).toHaveLength(0);
    await click(labels.start);
    await vi.waitFor(() => expect(currentSession()).toBeTruthy());
    expect(await client.sessions.list()).toHaveLength(1);
  });
});
