import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createTavernClient, type TavernClient } from "@tavern/sdk";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/create-test-db.js";
import RoleSessionPanel from "../../web/src/components/workspace/RoleSessionPanel.vue";
import labels from "../../web/src/config/role-apps.json";
import {
  mountComponent,
  settleComponent,
} from "../../web/src/test/component-host.js";
const bridge = vi.hoisted(() => ({
  client: undefined as TavernClient | undefined,
  patchGate: undefined as Promise<void> | undefined,
}));
vi.mock("../../web/src/lib/api.js", () => ({
  get apiClient() {
    return bridge.client;
  },
}));
vi.mock("../../web/src/composables/useRoleLabels.js", () => ({
  useRoleLabels: () => ({ labels, locale: ref("zh-CN") }),
}));
let app: FastifyInstance,
  sessionId: string,
  host: ReturnType<typeof mountComponent>;
beforeEach(async () => {
  bridge.patchGate = undefined;
  app = (
    await buildTestApp({
      databasePath: ":memory:",
      logger: false,
      auth: { mode: "off" },
    })
  ).app;
  bridge.client = createTavernClient({
    baseUrl: "http://local.test",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const response = await app.inject({
        method: (init?.method ?? "GET") as "GET" | "PATCH",
        url: url.pathname + url.search,
        headers: Object.fromEntries(new Headers(init?.headers)),
        payload: init?.body as string,
      });
      if (init?.method === "PATCH" && bridge.patchGate) await bridge.patchGate;
      return new Response(response.body, {
        status: response.statusCode,
        headers: response.headers as Record<string, string>,
      });
    },
  });
  sessionId = (
    await bridge.client.sessions.create({ title: "Original session" })
  )!.id;
  vi.stubGlobal("document", { activeElement: null });
  host = mountComponent(RoleSessionPanel, {
    panel: "session-config",
    sessionId,
  });
  await vi.waitFor(() =>
    expect(host.all((n) => n.tagName === "INPUT").length).toBe(1),
  );
});
afterEach(async () => {
  host?.unmount();
  await app.close();
  vi.unstubAllGlobals();
});
it("exposes unsaved session edits to navigation and persists them on form submit", async () => {
  const state = host.instance as unknown as { dirty: boolean };
  expect(state.dirty).toBe(false);
  const input = host.all((n) => n.tagName === "INPUT")[0]!;
  input.value = "Updated session";
  input.dispatchEvent(new Event("input"));
  await settleComponent();
  expect(state.dirty).toBe(true);
  expect((await bridge.client!.sessions.getDetail({ sessionId })).title).toBe(
    "Original session",
  );
  host
    .all((n) => n.tagName === "FORM")[0]!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(async () =>
    expect((await bridge.client!.sessions.getDetail({ sessionId })).title).toBe(
      "Updated session",
    ),
  );
  await vi.waitFor(() => expect(state.dirty).toBe(false));
});
it("keeps unsaved edits and reports a session deleted before save", async () => {
  const state = host.instance as unknown as { dirty: boolean };
  const input = host.all((n) => n.tagName === "INPUT")[0]!;
  input.value = "Unsaved session";
  input.dispatchEvent(new Event("input"));
  await settleComponent();
  await bridge.client!.sessions.remove({ sessionId });
  host
    .all((n) => n.tagName === "FORM")[0]!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() =>
    expect(host.all((n) => n.props.role === "alert").length).toBe(1),
  );
  expect(state.dirty).toBe(true);
  expect(input.value).toBe("Unsaved session");
  expect(host.root.textContent).not.toContain("检查网络");
});

it("retains edits made while an earlier save is pending", async () => {
  let release!: () => void;
  bridge.patchGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = host.instance as unknown as { dirty: boolean };
  const input = host.all((n) => n.tagName === "INPUT")[0]!;
  input.value = "Submitted title";
  input.dispatchEvent(new Event("input"));
  await settleComponent();
  host
    .all((n) => n.tagName === "FORM")[0]!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(async () =>
    expect((await bridge.client!.sessions.getDetail({ sessionId })).title).toBe(
      "Submitted title",
    ),
  );
  input.value = "Later edit";
  input.dispatchEvent(new Event("input"));
  release();
  await settleComponent();
  await vi.waitFor(() =>
    expect(host.all((n) => n.props.role === "status").length).toBe(0),
  );
  expect(state.dirty).toBe(true);
  expect(input.value).toBe("Later edit");
});
