import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTavernClient, type TavernClient } from "@tavern/sdk";
import type { FastifyInstance } from "fastify";
import RoleAppsView from "../../web/src/pages/RoleAppsView.vue";
import labels from "../../web/src/config/role-apps.json";
import {
  mountComponent,
  settleComponent,
  type ComponentNode,
} from "../../web/src/test/component-host.js";
import { buildTestApp } from "./helpers/create-test-db.js";
import { loadStorageConfig } from "../src/storage-config.js";
import { floors, messages, messagePages } from "../src/db/schema.js";
import { configuration, seedRoleResources } from "./helpers/role-workspace.js";
vi.mock("../../web/node_modules/dompurify", () => {
  const sanitize = (markup: string) => markup;
  const purifier = Object.assign(() => ({ sanitize }), { sanitize });
  return { default: purifier, sanitize };
});
const bridge = vi.hoisted(() => ({
  client: undefined as TavernClient | undefined,
  rejectNextSessionPatch: false,
  failNextTimeline: false,
}));
vi.mock("../../web/src/lib/api.js", () => ({
  get apiClient() {
    return bridge.client;
  },
}));
// The separately mounted legacy managers are outside this role-workspace flow.
vi.mock("../../web/src/App.vue", () => ({ default: { render: () => null } }));
vi.mock("../../web/src/composables/useRoleLabels.js", () => ({
  useRoleLabels: () => ({ labels, locale: ref("zh-CN") }),
}));
let app: FastifyInstance, root: string, draftId: string, sessionId: string;
let database: Awaited<ReturnType<typeof buildTestApp>>["database"];
let host: ReturnType<typeof mountComponent>;
let mutationGate: Promise<void> | undefined;
let location: {
  href: string;
  search: string;
  assign: ReturnType<typeof vi.fn>;
};
function buttons(text: string) {
  return host.all(
    (n) => n.tagName === "BUTTON" && n.textContent.trim() === text,
  );
}
function trialNavigationButtons() {
  return host.all(
    (node) =>
      node.tagName === "BUTTON" &&
      String(node.props.class).split(" ").includes("navitem") &&
      node.textContent.includes(labels.configurationRevision),
  );
}
async function click(text: string) {
  const button = buttons(text)[0];
  expect(button, text).toBeDefined();
  button!.click();
  await settleComponent();
}
async function input(node: ComponentNode, value: string) {
  node.value = value;
  node.dispatchEvent(new Event("input"));
  await settleComponent();
}
function namedInput(label: string) {
  return host
    .all((n) => n.tagName === "LABEL" && n.textContent.trim() === label)[0]!
    .children.find((n) => n.tagName === "INPUT")!;
}
function seedTimelineTurns(targetSessionId: string, count: number) {
  const now = Date.now();
  const floorRows = Array.from({ length: count }, (_, index) => {
    const floorNo = index + 1;
    return {
      id: `${targetSessionId}-floor-${floorNo}`,
      sessionId: targetSessionId,
      floorNo,
      branchId: "main",
      parentFloorId:
        floorNo === 1 ? null : `${targetSessionId}-floor-${floorNo - 1}`,
      state: "committed" as const,
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now + floorNo,
      updatedAt: now + floorNo,
    };
  });
  database.insert(floors).values(floorRows).run();
  database
    .insert(messagePages)
    .values(
      floorRows.map((floor) => ({
        id: `${floor.id}-page`,
        floorId: floor.id,
        pageNo: 0,
        pageKind: "mixed" as const,
        isActive: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  database
    .insert(messages)
    .values(
      floorRows.flatMap((floor, index) => {
        const firstTurn = index === 0;
        const messagesForTurn: (typeof messages.$inferInsert)[] = [
          {
            id: `${floor.id}-user`,
            pageId: `${floor.id}-page`,
            seq: 0,
            role: "user" as const,
            content: firstTurn ? "**User line 1**" : `User line ${index + 1}`,
            contentFormat: firstTurn
              ? ("markdown" as const)
              : ("text" as const),
            tokenCount: 0,
            isHidden: false,
            createdAt: now,
          },
          {
            id: `${floor.id}-assistant`,
            pageId: `${floor.id}-page`,
            seq: 1,
            role: "assistant" as const,
            content: firstTurn
              ? '{"reply":"Character reply 1"}'
              : `Character reply ${index + 1}`,
            contentFormat: firstTurn ? ("json" as const) : ("text" as const),
            tokenCount: 0,
            isHidden: false,
            createdAt: now + 1,
          },
        ];
        if (firstTurn) {
          messagesForTurn.push({
            id: `${floor.id}-narrator`,
            pageId: `${floor.id}-page`,
            seq: 2,
            role: "narrator" as const,
            content: "*Narrator line 1*",
            contentFormat: "text" as const,
            tokenCount: 0,
            isHidden: false,
            createdAt: now + 2,
          });
        }
        return messagesForTurn;
      }),
    )
    .run();
}
async function submitModal() {
  host
    .all((n) => n.tagName === "FORM" && n.props.role === "dialog")[0]!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await settleComponent();
}
beforeEach(async () => {
  mutationGate = undefined;
  bridge.failNextTimeline = false;
  root = await mkdtemp(join(tmpdir(), "role-ui-"));
  const storage = loadStorageConfig({ DATA_DIR: root });
  const built = await buildTestApp({
    databasePath: ":memory:",
    storage,
    logger: false,
    auth: { mode: "off" },
  });
  app = built.app;
  database = built.database;
  await seedRoleResources(built.database, storage);
  bridge.client = createTavernClient({
    baseUrl: "http://ui.test",
    fetchImpl: async (url, init) => {
      const u = new URL(String(url));
      if (init?.method === "PATCH") await mutationGate;
      if (bridge.failNextTimeline && u.pathname.endsWith("/timeline")) {
        bridge.failNextTimeline = false;
        return new Response(
          JSON.stringify({
            error: { code: "internal_error", message: "test" },
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }
      if (
        bridge.rejectNextSessionPatch &&
        init?.method === "PATCH" &&
        u.pathname.startsWith("/sessions/")
      ) {
        bridge.rejectNextSessionPatch = false;
        u.pathname = "/sessions/missing-session";
      }
      const r = await app.inject({
        method: (init?.method ?? "GET") as
          | "GET"
          | "POST"
          | "PUT"
          | "PATCH"
          | "DELETE",
        url: u.pathname + u.search,
        headers: Object.fromEntries(new Headers(init?.headers)),
        payload: init?.body as string,
      });
      return new Response(r.body, {
        status: r.statusCode,
        headers: r.headers as Record<string, string>,
      });
    },
  });
  const draft = await bridge.client.roleApps.create({
    configuration: configuration(),
  });
  draftId = draft.id;
  sessionId = (
    await bridge.client.roleApps.createPreview({
      id: draft.id,
      expectedRevision: draft.revision,
    })
  ).session.id as string;
  location = { href: "http://ui.test/", search: "", assign: vi.fn() };
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location,
      innerWidth: 1440,
      history: {
        replaceState(_a: unknown, _b: unknown, url: URL | string) {
          const u = new URL(String(url));
          location.href = u.href;
          location.search = u.search;
        },
      },
    }),
  );
  vi.stubGlobal("document", {
    activeElement: null,
    body: { classList: { add() {}, remove() {} } },
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ userWebBaseUrl: "http://ui.test:43982" })),
  );
  host = mountComponent(RoleAppsView, {});
  await vi.waitFor(() => expect(buttons(labels.rename)).toHaveLength(1));
});
afterEach(async () => {
  host?.unmount();
  await app?.close();
  await rm(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
describe("role workspace Vue events through official SDK and Fastify", () => {
  it("shows ordered role messages and opening identity, paginates turns, and opens the selected turn", async () => {
    seedTimelineTurns(sessionId, labels.pageSize);

    await click(labels.trialDetail);
    await click(labels.refresh);
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain("Character reply 29"),
    );
    expect(host.root.textContent).toContain(
      "The lighthouse keeper greets SDK Visitor.",
    );
    expect(host.root.textContent).toContain("SDK Role");
    expect(host.root.textContent).toContain("SDK Visitor");
    expect(host.root.textContent).not.toContain("Character reply 30");
    const messageArticles = host.all(
      (node) =>
        node.tagName === "ARTICLE" &&
        String(node.props.class).split(" ").includes("message"),
    );
    expect(messageArticles[0]?.textContent).toContain(
      "The lighthouse keeper greets SDK Visitor.",
    );
    const userMessageIndex = messageArticles.findIndex((node) =>
      node.textContent.includes("SDK Visitor"),
    );
    const replyMessageIndex = messageArticles.findIndex(
      (node) =>
        node.props.class === "message assistant" &&
        node.children.some(
          (child) =>
            child.tagName === "ARTICLE" &&
            child.props.class === "markdown-block" &&
            String(child.props.innerHTML).includes("Character reply 1"),
        ),
    );
    expect(userMessageIndex).toBeGreaterThanOrEqual(0);
    expect(replyMessageIndex).toBeGreaterThan(userMessageIndex);

    const narratorMessage = messageArticles.find((node) =>
      node.textContent.includes("叙述者"),
    );
    expect(narratorMessage?.textContent).not.toContain("SDK Role");

    await click(labels.loadMore);
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain("Character reply 30"),
    );
    buttons(labels.viewGeneration)[0]!.click();
    await settleComponent();
    expect(new URL(location.href).searchParams.get("floorId")).toBe(
      `${sessionId}-floor-1`,
    );
    expect(new URL(location.href).searchParams.get("branchId")).toBe("main");
  });

  it("renders markdown and JSON through MarkdownBlock while keeping text literal", async () => {
    seedTimelineTurns(sessionId, 1);
    await click(labels.trialDetail);
    await click(labels.refresh);
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain("Narrator line 1"),
    );

    const markdownBlocks = host.all(
      (node) =>
        node.tagName === "ARTICLE" && node.props.class === "markdown-block",
    );
    expect(markdownBlocks).toHaveLength(2);
    expect(markdownBlocks[0]!.props.innerHTML).toContain(
      "<strong>User line 1</strong>",
    );
    expect(markdownBlocks[1]!.props.innerHTML).toContain(
      'class="language-json"',
    );
    expect(markdownBlocks[1]!.props.innerHTML).toContain("Character reply 1");
    expect(
      host.all(
        (node) =>
          node.tagName === "P" && node.textContent === "*Narrator line 1*",
      ),
    ).toHaveLength(1);
  });

  it("clears the previous load-more state when the next session is empty or fails to load", async () => {
    seedTimelineTurns(sessionId, labels.pageSize);
    await click(labels.trialDetail);
    await click(labels.refresh);
    await vi.waitFor(() => expect(buttons(labels.loadMore)).toHaveLength(1));

    await click(labels.newTrial);
    await vi.waitFor(() => expect(trialNavigationButtons()).toHaveLength(2));
    const emptySession = (
      await bridge.client!.roleApps.listPreviews({ id: draftId })
    )[0]!;
    database.delete(floors).where(eq(floors.sessionId, emptySession.id)).run();
    trialNavigationButtons()[0]!.click();
    await settleComponent();
    await vi.waitFor(() =>
      expect(new URL(location.href).searchParams.get("sessionId")).toBe(
        emptySession.id,
      ),
    );
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain(labels.noRecords),
    );
    expect(buttons(labels.loadMore)).toHaveLength(0);

    await click(labels.newTrial);
    await vi.waitFor(() => expect(trialNavigationButtons()).toHaveLength(3));
    bridge.failNextTimeline = true;
    trialNavigationButtons()[0]!.click();
    await settleComponent();
    await vi.waitFor(() =>
      expect(
        host.all((node) => node.props.role === "alert").length,
      ).toBeGreaterThan(0),
    );
    expect(buttons(labels.loadMore)).toHaveLength(0);
  });

  it.each([
    { mode: "select", rejects: false },
    { mode: "select", rejects: true },
    { mode: "more", rejects: false },
    { mode: "more", rejects: true },
  ])(
    "ignores a delayed $mode response after switching sessions (rejects=$rejects)",
    async ({ mode, rejects }) => {
      seedTimelineTurns(sessionId, labels.pageSize);
      await click(labels.newTrial);
      await vi.waitFor(() => expect(trialNavigationButtons()).toHaveLength(2));
      const nextSession = (
        await bridge.client!.roleApps.listPreviews({ id: draftId })
      )[0]!;
      if (mode === "more") {
        trialNavigationButtons()[1]!.click();
        await vi.waitFor(() =>
          expect(buttons(labels.loadMore)).toHaveLength(1),
        );
      }
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered = false;
      const original = bridge.client!.sessions.timeline.bind(
        bridge.client!.sessions,
      );
      const spy = vi
        .spyOn(bridge.client!.sessions, "timeline")
        .mockImplementation(async (query) => {
          const result = await original(query);
          if (
            query.sessionId === sessionId &&
            query.offset === (mode === "more" ? labels.pageSize : 0)
          ) {
            entered = true;
            await gate;
            if (rejects)
              throw Object.assign(new Error(), { code: "NETWORK_ERROR" });
          }
          return result;
        });
      try {
        if (mode === "more") buttons(labels.loadMore)[0]!.click();
        else trialNavigationButtons()[1]!.click();
        await vi.waitFor(() => expect(entered).toBe(true));
        trialNavigationButtons()[0]!.click();
        await vi.waitFor(() =>
          expect(new URL(location.href).searchParams.get("sessionId")).toBe(
            nextSession.id,
          ),
        );
        await vi.waitFor(() =>
          expect(host.root.textContent).toContain(labels.noRecords),
        );
        release();
        await settleComponent();
        expect(host.root.textContent).not.toContain("Character reply");
        expect(buttons(labels.loadMore)).toHaveLength(0);
        expect(host.all((node) => node.props.role === "alert")).toHaveLength(0);
        expect(new URL(location.href).searchParams.get("sessionId")).toBe(
          nextSession.id,
        );
      } finally {
        release();
        spy.mockRestore();
      }
    },
  );

  it("shows the empty-generation state and reports timeline failures", async () => {
    expect(host.root.textContent).toContain(labels.noRecords);
    expect(host.root.textContent).toContain(
      "The lighthouse keeper greets SDK Visitor.",
    );
    expect(host.root.textContent).not.toContain(labels.opening);

    bridge.failNextTimeline = true;
    await click(labels.trialDetail);
    await click(labels.refresh);
    await vi.waitFor(() =>
      expect(
        host.all((node) => node.props.role === "alert").length,
      ).toBeGreaterThan(0),
    );
    expect(host.root.textContent).not.toContain(labels.noRecords);
  });

  it("wires the workspace separators to drag events and stops updating after release", async () => {
    const rootNode = host.all(
      (n) =>
        !!n.props.style &&
        typeof n.props.style === "object" &&
        "--left-pane-width" in (n.props.style as object),
    )[0]!;
    const handles = host.all((n) => n.props.role === "separator");
    expect(handles).toHaveLength(2);
    const originalLeft = (rootNode.props.style as Record<string, string>)[
      "--left-pane-width"
    ];
    handles[0]!.dispatchEvent(
      Object.assign(new Event("mousedown", { cancelable: true }), {
        clientX: 100,
      }),
    );
    window.dispatchEvent(
      Object.assign(new Event("mousemove"), { clientX: 150 }),
    );
    await settleComponent();
    expect(
      (rootNode.props.style as Record<string, string>)["--left-pane-width"],
    ).not.toBe(originalLeft);
    window.dispatchEvent(new Event("mouseup"));
    const afterLeft = (rootNode.props.style as Record<string, string>)[
      "--left-pane-width"
    ];
    window.dispatchEvent(
      Object.assign(new Event("mousemove"), { clientX: 250 }),
    );
    await settleComponent();
    expect(
      (rootNode.props.style as Record<string, string>)["--left-pane-width"],
    ).toBe(afterLeft);
    const originalRight = (rootNode.props.style as Record<string, string>)[
      "--right-pane-width"
    ];
    handles[1]!.dispatchEvent(
      Object.assign(new Event("mousedown", { cancelable: true }), {
        clientX: 500,
      }),
    );
    window.dispatchEvent(
      Object.assign(new Event("mousemove"), { clientX: 450 }),
    );
    await settleComponent();
    expect(
      (rootNode.props.style as Record<string, string>)["--right-pane-width"],
    ).not.toBe(originalRight);
    window.dispatchEvent(new Event("mouseup"));
    const beforeKeyboard = Number.parseFloat(
      (rootNode.props.style as Record<string, string>)["--left-pane-width"]!,
    );
    handles[0]!.dispatchEvent(
      Object.assign(new Event("keydown", { cancelable: true }), {
        key: "ArrowRight",
      }),
    );
    await settleComponent();
    expect(
      (rootNode.props.style as Record<string, string>)["--left-pane-width"],
    ).toBe(`${beforeKeyboard + labels.layout.keyboardResizeStep}px`);
  });
  it("edits a draft, cancels navigation, then saves and rereads its revision", async () => {
    await click(labels.roleConfiguration);
    await input(namedInput(labels.name), "Revised lighthouse");
    await click(labels.new);
    expect(host.root.textContent).toContain(labels.allChanges);
    await click(labels.keepEditing);
    expect(namedInput(labels.name).value).toBe("Revised lighthouse");
    await click(labels.save);
    await vi.waitFor(async () =>
      expect(
        (await bridge.client!.roleApps.get({ id: draftId })).configuration.name,
      ).toBe("Revised lighthouse"),
    );
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain(labels.saved),
    );
    expect(buttons(labels.save).every((n) => n.props.disabled)).toBe(true);
  });
  it("undoes draft edits and discards them before opening a new role", async () => {
    await click(labels.roleConfiguration);
    await input(namedInput(labels.name), "Discard this");
    await click(labels.undo);
    await vi.waitFor(() => expect(buttons(labels.rename)).toHaveLength(1));
    await click(labels.roleConfiguration);
    expect(namedInput(labels.name).value).toBe("SDK Lighthouse");
    await input(namedInput(labels.name), "Discard again");
    await click(labels.new);
    await click(labels.discard);
    expect(namedInput(labels.name).value).toBe("");
    expect(
      (await bridge.client!.roleApps.get({ id: draftId })).configuration.name,
    ).toBe("SDK Lighthouse");
  });
  it("validates, publishes, stops and reactivates a saved role", async () => {
    await click(labels.check);
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain(labels.checkPassed),
    );
    await click(labels.publish);
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain(labels.alreadyPublished),
    );
    expect(
      await bridge.client!.roleReleases.list({ activeOnly: true }),
    ).toHaveLength(1);
    await click(labels.stopPublication);
    await vi.waitFor(async () =>
      expect(
        await bridge.client!.roleReleases.list({ activeOnly: true }),
      ).toHaveLength(0),
    );
    await vi.waitFor(() =>
      expect(buttons(labels.activatePublication)).toHaveLength(1),
    );
    await click(labels.activatePublication);
    await vi.waitFor(async () =>
      expect(
        await bridge.client!.roleReleases.list({ activeOnly: true }),
      ).toHaveLength(1),
    );
  });
  it("creates one preview on repeated clicks and opens the real created session URL", async () => {
    const initial = (
      await bridge.client!.roleApps.listPreviews({ id: draftId })
    ).length;
    const button = buttons(labels.newTrial)[0]!;
    button.click();
    button.click();
    await vi.waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    const destination = new URL(location.assign.mock.calls[0]![0]);
    expect(destination.origin).toBe("http://ui.test:43982");
    expect(destination.searchParams.get("sessionId")).not.toBe(sessionId);
    expect(
      await bridge.client!.roleApps.listPreviews({ id: draftId }),
    ).toHaveLength(initial + 1);
    expect(
      (
        await bridge.client!.sessions.getDetail({
          sessionId: destination.searchParams.get("sessionId")!,
        })
      ).metadata,
    ).toHaveProperty("role_preview");
  });
  it("keeps rename open when its backdrop is clicked during a pending save", async () => {
    await click(labels.rename);
    await input(namedInput(labels.namePrompt), "Pending rename");
    let release!: () => void;
    mutationGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await submitModal();
      const backdrop = host.all(
        (node) => node.props.class === "modal-backdrop",
      )[0]!;
      backdrop.dispatchEvent(new Event("click"));
      await settleComponent();
      expect(
        host.all(
          (node) => node.tagName === "FORM" && node.props.role === "dialog",
        ),
      ).toHaveLength(1);
    } finally {
      release();
    }
    await vi.waitFor(() =>
      expect(
        host.all(
          (node) => node.tagName === "FORM" && node.props.role === "dialog",
        ),
      ).toHaveLength(0),
    );
    expect((await bridge.client!.sessions.getDetail({ sessionId })).title).toBe(
      "Pending rename",
    );
  });
  it("cancels rename, prevents blank input and saves a renamed session", async () => {
    const original = (await bridge.client!.sessions.getDetail({ sessionId }))
      .title;
    await click(labels.rename);
    await input(namedInput(labels.namePrompt), "Cancelled");
    await click(labels.cancel);
    expect((await bridge.client!.sessions.getDetail({ sessionId })).title).toBe(
      original,
    );
    await click(labels.rename);
    await input(namedInput(labels.namePrompt), "   ");
    await submitModal();
    expect(
      host.all((n) => n.tagName === "FORM" && n.props.role === "dialog"),
    ).toHaveLength(1);
    expect((await bridge.client!.sessions.getDetail({ sessionId })).title).toBe(
      original,
    );
    await input(namedInput(labels.namePrompt), "Renamed preview");
    await submitModal();
    await vi.waitFor(() =>
      expect(
        host.all((n) => n.tagName === "FORM" && n.props.role === "dialog"),
      ).toHaveLength(0),
    );
    expect((await bridge.client!.sessions.getDetail({ sessionId })).title).toBe(
      "Renamed preview",
    );
    expect(host.root.textContent).toContain("Renamed preview");
  });
  it("archives and restores a preview with persisted status", async () => {
    await click(labels.archive);
    await vi.waitFor(() => expect(buttons(labels.restore)).toHaveLength(1));
    expect(
      (await bridge.client!.sessions.getDetail({ sessionId })).status,
    ).toBe("archived");
    await click(labels.restore);
    await vi.waitFor(() => expect(buttons(labels.archive)).toHaveLength(1));
    expect(
      (await bridge.client!.sessions.getDetail({ sessionId })).status,
    ).toBe("active");
  });
  it("cancels deletion and only removes a preview after confirmation", async () => {
    await click(labels.deleteShort);
    await click(labels.cancel);
    expect((await bridge.client!.sessions.getDetail({ sessionId })).id).toBe(
      sessionId,
    );
    await click(labels.deleteShort);
    await submitModal();
    await vi.waitFor(() =>
      expect(
        host.all((n) => n.tagName === "FORM" && n.props.role === "dialog"),
      ).toHaveLength(0),
    );
    expect(
      await bridge.client!.roleApps.listPreviews({ id: draftId }),
    ).toHaveLength(0);
    expect(buttons(labels.rename)).toHaveLength(0);
  });

  it("retains a conflicting draft without a false network error", async () => {
    await click(labels.roleConfiguration);
    await input(namedInput(labels.name), "Local draft");
    const current = await bridge.client!.roleApps.get({ id: draftId });
    await bridge.client!.roleApps.update({
      id: draftId,
      expectedRevision: current.revision,
      configuration: { ...current.configuration, name: "Remote draft" },
    });
    await click(labels.save);
    await vi.waitFor(() => expect(host.root.textContent).toContain("版本"));
    expect(namedInput(labels.name).value).toBe("Local draft");
    expect(
      (await bridge.client!.roleApps.get({ id: draftId })).configuration.name,
    ).toBe("Remote draft");
    expect(host.root.textContent).not.toContain("检查网络");
  });
  it("keeps rename input after a server error and clears the error after a successful retry", async () => {
    bridge.rejectNextSessionPatch = true;
    await click(labels.rename);
    await input(namedInput(labels.namePrompt), "Retry title");
    await submitModal();
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain("请求的资源不存在"),
    );
    expect(namedInput(labels.namePrompt).value).toBe("Retry title");
    await submitModal();
    await vi.waitFor(() =>
      expect(
        host.all((n) => n.tagName === "FORM" && n.props.role === "dialog"),
      ).toHaveLength(0),
    );
    expect((await bridge.client!.sessions.getDetail({ sessionId })).title).toBe(
      "Retry title",
    );
    expect(host.root.textContent).not.toContain("请求的资源不存在");
  });

  it("switches role apps through the selector and keeps unsaved changes when cancelled", async () => {
    const other = await bridge.client!.roleApps.create({
      configuration: { ...configuration(), name: "Other role" },
    });
    host.unmount();
    host = mountComponent(RoleAppsView, {});
    await vi.waitFor(() => expect(buttons(labels.rename)).toHaveLength(1));
    await click(labels.roleConfiguration);
    await input(namedInput(labels.name), "Unsaved role");
    const selector = host.all(
      (n) => n.tagName === "SELECT" && n.props["aria-label"] === labels.allApps,
    )[0]!;
    selector.value = other.id;
    selector.dispatchEvent(new Event("change"));
    await settleComponent();
    await click(labels.keepEditing);
    expect(namedInput(labels.name).value).toBe("Unsaved role");
    expect(selector.value).toBe(draftId);
    selector.value = other.id;
    selector.dispatchEvent(new Event("change"));
    await settleComponent();
    await click(labels.discard);
    await vi.waitFor(() =>
      expect(new URL(location.href).searchParams.get("id")).toBe(other.id),
    );
    expect(buttons(labels.rename)).toHaveLength(0);
  });

  it("toggles navigation and inspector drawers and dismisses the backdrop", async () => {
    await click(labels.navigation);
    expect(
      host.all((n) => n.props["aria-label"] === labels.workspaceNav)[0]!.props
        .class,
    ).toContain("drawer-open");
    await click(labels.inspector);
    expect(
      host.all((n) => n.props["aria-label"] === labels.workspaceNav)[0]!.props
        .class,
    ).not.toContain("drawer-open");
    const backdrop = host.all(
      (n) => n.tagName === "BUTTON" && n.props["aria-label"] === labels.close,
    )[0]!;
    expect(backdrop).toBeDefined();
    backdrop.click();
    await settleComponent();
    expect(
      host.all(
        (n) => n.tagName === "BUTTON" && n.props["aria-label"] === labels.close,
      ),
    ).toHaveLength(0);
  });

  it("shows validation details for an incomplete draft without creating or changing a role", async () => {
    await click(labels.roleConfiguration);
    await input(namedInput(labels.name), "");
    await click(labels.save);
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain(
        "提交的字段格式或数值不符合接口要求",
      ),
    );
    expect(host.root.textContent).not.toContain("检查网络");
    expect(
      (await bridge.client!.roleApps.get({ id: draftId })).configuration.name,
    ).toBe("SDK Lighthouse");
    expect(namedInput(labels.name).value).toBe("");
    expect(buttons(labels.publish)[0]!.props.disabled).toBe(true);
  });

  it("pages through history and opens and returns from the selected generation detail", async () => {
    for (let index = 1; index <= labels.pageSize + 1; index++)
      await bridge.client!.floors.create({
        sessionId,
        branchId: "main",
        floorNo: index,
        state: "committed",
      });
    host.unmount();
    host = mountComponent(RoleAppsView, {});
    await vi.waitFor(() => expect(buttons(labels.loadMore)).toHaveLength(1));
    const before = buttons(labels.viewGeneration).length;
    await click(labels.loadMore);
    await vi.waitFor(() => expect(buttons(labels.loadMore)).toHaveLength(0));
    expect(buttons(labels.viewGeneration).length).toBeGreaterThan(before);
    await click(labels.viewGeneration);
    expect(new URL(location.href).searchParams.get("floorId")).toBeTruthy();
    expect(host.root.textContent).toContain(labels.generationDetail);
    await click(labels.returnTrial);
    expect(new URL(location.href).searchParams.has("floorId")).toBe(false);
    expect(buttons(labels.viewGeneration).length).toBeGreaterThan(before);
  });
  it("opens each session inspection page and returns to the same session", async () => {
    for (const title of [
      labels.variables,
      labels.memory,
      labels.branches,
      labels.sessionConfiguration,
    ]) {
      await click(title);
      await vi.waitFor(() =>
        expect(buttons(labels.refresh).length).toBeGreaterThan(0),
      );
      await click(labels.refresh);
      await click(labels.returnTrial);
      expect(new URL(location.href).searchParams.get("sessionId")).toBe(
        sessionId,
      );
      expect(buttons(labels.rename)).toHaveLength(1);
    }
  });
});
