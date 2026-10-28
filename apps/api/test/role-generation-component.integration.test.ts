import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTavernClient,
  type TavernClient,
  type TimelineFloor,
} from "@tavern/sdk";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./helpers/create-test-db.js";
import { loadStorageConfig } from "../src/storage-config.js";
import RoleGenerationDetail from "../../web/src/components/workspace/RoleGenerationDetail.vue";
import {
  mountComponent,
  settleComponent,
} from "../../web/src/test/component-host.js";
import labels from "../../web/src/config/role-apps.json";
import categories from "../../web/src/config/role-generation-categories.json";
import dryCopy from "../../web/src/config/generation-dry-run.json";
import { modelCallUi } from "@tavern/shared";
import { modelCallRecords } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
const bridge = vi.hoisted(() => ({
  client: undefined as TavernClient | undefined,
}));
vi.mock("../../web/src/lib/api.js", () => ({
  get apiClient() {
    return bridge.client;
  },
}));
let app: FastifyInstance,
  root: string,
  sessionId: string,
  history: TimelineFloor[],
  host: ReturnType<typeof mountComponent>;
let onSelect: ReturnType<typeof vi.fn>,
  onClose: ReturnType<typeof vi.fn>,
  provider: ReturnType<typeof vi.fn>;
let location: { href: string };
let dryRunBody: Record<string, any> | undefined;
function button(text: string) {
  return host.all(
    (n) => n.tagName === "BUTTON" && n.textContent.trim() === text,
  )[0]!;
}
async function click(text: string) {
  expect(button(text), text).toBeDefined();
  button(text).click();
  await settleComponent();
}
beforeEach(async () => {
  dryRunBody = undefined;
  root = await mkdtemp(join(tmpdir(), "generation-ui-"));
  provider = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: "response",
          object: "chat.completion",
          created: 1,
          model: "offline",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "The lighthouse door opens.",
              },
              finish_reason: "stop",
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  const built = await buildTestApp({
    databasePath: ":memory:",
    storage: loadStorageConfig({ DATA_DIR: root }),
    logger: false,
    auth: { mode: "off" },
    enablePromptDryRun: true,
    orchestration: {
      providers: [
        {
          id: "test",
          type: "openai-compatible",
          apiMode: "chat",
          apiKey: "offline",
          options: { fetch: provider },
        },
      ],
      defaultModel: { providerId: "test", modelId: "offline" },
    },
  });
  app = built.app;
  bridge.client = createTavernClient({
    baseUrl: "http://generation.test",
    fetchImpl: async (input, init) => {
      const u = new URL(String(input));
      const r = await app.inject({
        method: (init?.method ?? "GET") as "GET" | "POST",
        url: u.pathname + u.search,
        headers: Object.fromEntries(new Headers(init?.headers)),
        payload: init?.body as string,
      });
      if (u.pathname.endsWith("/respond/dry-run")) dryRunBody = r.json().data;
      return new Response(r.body, {
        status: r.statusCode,
        headers: r.headers as Record<string, string>,
      });
    },
  });
  sessionId = (
    await bridge.client.sessions.create({
      title: "Lighthouse test",
      promptMode: "native",
      userSnapshot: {
        name: "Visitor",
        description:
          "Visitor is a thirty-year-old lighthouse visitor. Narrate Visitor in third person.",
      },
    })
  )!.id;
  await bridge.client.sessions.respond({
    sessionId,
    message: "Knock on the door.",
    generationParams: { stream: false },
  });
  await bridge.client.sessions.respond({
    sessionId,
    message: "Ask to enter.",
    generationParams: { stream: false },
  });
  history = (await bridge.client.sessions.timeline({ sessionId })).floors;
  const source = built.database
    .select()
    .from(modelCallRecords)
    .where(eq(modelCallRecords.floorId, history[0]!.id))
    .get()!;
  const extra = {
    ...JSON.parse(source.recordJson),
    callId: "fixture-second-call",
    invocationId: "fixture-second-invocation",
    model: "offline-second",
    text: "Distinct recorded response.",
    preparedAt: source.preparedAt + 1,
  };
  built.database
    .insert(modelCallRecords)
    .values({
      ...source,
      callId: extra.callId,
      invocationId: extra.invocationId,
      preparedAt: extra.preparedAt,
      recordJson: JSON.stringify(extra),
    })
    .run();
  onSelect = vi.fn();
  onClose = vi.fn();
  location = { href: "http://generation.test/?sessionId=" + sessionId };
  vi.stubGlobal("window", {
    location,
    history: {
      replaceState(_a: unknown, _b: unknown, url: URL | string) {
        location.href = String(url);
      },
    },
  });
  vi.stubGlobal("document", { activeElement: null });
  host = mountComponent(RoleGenerationDetail, {
    floor: history[0]!,
    floors: history,
    sessionId,
    branchId: "main",
    onSelect,
    onClose,
  });
  await vi.waitFor(() =>
    expect(button(labels.refresh)?.props.disabled).toBe(false),
  );
});
afterEach(async () => {
  host?.unmount();
  await app?.close();
  await rm(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
describe("generation detail events with real stored model calls", () => {
  it("switches inspection tabs, selects call evidence and filters an empty result", async () => {
    await click(categories.find((c) => c.key === "stages")!.label);
    await vi.waitFor(() =>
      expect(
        host.all(
          (n) => n.tagName === "BUTTON" && n.props.class === "card active",
        ).length,
      ).toBe(1),
    );
    expect(host.root.textContent).toContain("offline");
    const initialCallId = new URL(location.href).searchParams.get("callId");
    const otherCard = host.all(
      (n) => n.tagName === "BUTTON" && n.props.class === "card",
    )[0]!;
    otherCard.click();
    await settleComponent();
    expect(new URL(location.href).searchParams.get("callId")).not.toBe(
      initialCallId,
    );
    expect(
      host.all(
        (n) => n.tagName === "BUTTON" && n.props.class === "card active",
      )[0],
    ).toBe(otherCard);
    const selectedExtra =
      new URL(location.href).searchParams.get("callId") ===
      "fixture-second-call";
    const resultText = () =>
      JSON.parse(
        host
          .all(
            (n) =>
              n.tagName === "DETAILS" &&
              n.children.some(
                (child) =>
                  child.tagName === "SUMMARY" &&
                  child.textContent.includes(modelCallUi.result),
              ),
          )[0]!
          .querySelectorAll("pre")[0]!.textContent,
      ).text;
    expect(resultText()).toBe(
      selectedExtra
        ? "Distinct recorded response."
        : "The lighthouse door opens.",
    );
    host
      .all((n) => n.tagName === "BUTTON" && n.props.class === "card")[0]!
      .click();
    await settleComponent();
    expect(resultText()).toBe(
      selectedExtra
        ? "The lighthouse door opens."
        : "Distinct recorded response.",
    );
    const fields = host.all((n) => n.tagName === "INPUT");
    fields[0]!.value = "missing-run";
    fields[0]!.dispatchEvent(new Event("input"));
    await settleComponent();
    host
      .all((n) => n.tagName === "FORM")[0]!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain(modelCallUi.empty),
    );
    fields[0]!.value = "";
    fields[0]!.dispatchEvent(new Event("input"));
    await settleComponent();
    host
      .all((n) => n.tagName === "FORM")[0]!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(host.root.textContent).toContain("offline"));
    for (const category of categories) {
      await click(category.label);
      expect(
        host.all(
          (n) => n.tagName === "BUTTON" && n.textContent === category.label,
        )[0]!.props["aria-selected"],
      ).toBe(true);
    }
  });
  it("collapses and expands sections and emits floor navigation and return actions", async () => {
    await click(labels.collapseAll);
    expect(
      host
        .all(
          (n) =>
            n.tagName === "DETAILS" && n.props.class === "generation-section",
        )
        .every((n) => !n.open),
    ).toBe(true);
    await click(labels.expandAll);
    expect(
      host
        .all(
          (n) =>
            n.tagName === "DETAILS" && n.props.class === "generation-section",
        )
        .every((n) => n.open),
    ).toBe(true);
    expect(button(labels.previousRecord).props.disabled).toBe(true);
    await click(labels.nextRecord);
    expect(onSelect).toHaveBeenCalledWith(history[1]);
    const select = host.all((n) => n.tagName === "SELECT")[0]!;
    select.value = history[1]!.id;
    select.dispatchEvent(new Event("change"));
    await settleComponent();
    expect(onSelect).toHaveBeenCalledTimes(2);
    await click(labels.returnTrial);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("previews assembled messages through dry-run without making another model request", async () => {
    const form = host.all((n) => n.tagName === "FORM").at(-1)!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await settleComponent();
    expect(host.root.textContent).toContain(dryCopy.emptyInput);
    const area = host.all((n) => n.tagName === "TEXTAREA")[0]!;
    area.value = "Ask about the storm.";
    area.dispatchEvent(new Event("input"));
    await settleComponent();
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(host.root.textContent).toContain(dryCopy.resultScope),
    );
    expect(host.root.textContent).toContain("Ask about the storm.");
    expect(dryRunBody?.messages).toEqual([
      {
        role: "system",
        content:
          "Visitor is a thirty-year-old lighthouse visitor. Narrate Visitor in third person.",
      },
      { role: "user", content: "Knock on the door." },
      { role: "assistant", content: "The lighthouse door opens." },
      { role: "user", content: "Ask to enter." },
      { role: "assistant", content: "The lighthouse door opens." },
      { role: "user", content: "Ask about the storm." },
    ]);
    expect(dryRunBody?.prompt_snapshot).toMatchObject({
      prompt_mode: "native",
      preset_id: null,
    });
    expect(dryRunBody?.assembly).toMatchObject({
      preset_used: false,
      names_behavior_applied: "off",
      preprocessed_user_message: "Ask about the storm.",
    });
    expect(dryRunBody?.runtime_trace).toMatchObject({
      preset: { names_behavior_applied: "off" },
      history_normalization: {
        raw_entry_count: 5,
        effective_turn_count: 5,
        selected_turn_count: 5,
        violations: [],
      },
      delivery: { last_message_role: "user", ends_with_user: true },
      regex: { preprocessed_user_message: "Ask about the storm." },
    });
    const messageList = host.all((n) => n.tagName === "OL")[0]!;
    expect(
      messageList.children
        .filter((n) => n.tagName === "LI")
        .map((n) => n.querySelectorAll("pre")[0]!.textContent),
    ).toEqual(dryRunBody!.messages.map((m: { content: string }) => m.content));
    const detailText = (title: string) =>
      host
        .all(
          (n) =>
            n.tagName === "DETAILS" &&
            n.children.some(
              (child) =>
                child.tagName === "SUMMARY" &&
                child.textContent.includes(title),
            ),
        )[0]!
        .querySelectorAll("pre")[0]!.textContent;
    expect(JSON.parse(detailText(dryCopy.assembly))).toMatchObject({
      namesBehaviorApplied: "off",
      preprocessedUserMessage: "Ask about the storm.",
    });
    expect(JSON.parse(detailText(dryCopy.promptSnapshot))).toMatchObject({
      promptMode: "native",
      presetId: null,
    });
    expect(JSON.parse(detailText(dryCopy.runtimeTrace))).toMatchObject({
      historyNormalization: { rawEntryCount: 5 },
      delivery: { endsWithUser: true },
    });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(
      (await bridge.client!.sessions.timeline({ sessionId })).floors,
    ).toHaveLength(history.length);
  });
});
