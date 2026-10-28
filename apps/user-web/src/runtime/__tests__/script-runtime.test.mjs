import { checkVisibilityAndFill } from "./visibility-animation-cases.mjs";
import { roleRuntimeValidators } from "@tavern/shared";
import { it } from "vitest";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import {
  BoundedCache,
  ScriptRuntimeError,
  createScriptRuntime,
  mountVirtualList,
} from "../script-runtime.ts";

class FakeClassList {
  values = new Set();
  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) {
    return this.values.has(name);
  }
}

class FakeEventTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type, event = { type }) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(ownerDocument, tagName = "div", selectors = []) {
    super();
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.selectors = new Set(selectors);
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.hidden = false;
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.checked = false;
    this.min = 0;
    this.max = 100;
    this.alt = "";
    this.src = "";
    this.clientHeight = 96;
    this.offsetHeight = 96;
    this.scrollTop = 0;
  }
  append(...children) {
    for (const child of children) {
      if (child?.isFragment) this.children.push(...child.children);
      else this.children.push(child);
    }
  }
  replaceChildren(...children) {
    this.children = [...children];
  }
  removeAttribute(name) {
    this[name] = "";
  }
  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (node.selectors?.has(selector)) matches.push(node);
      for (const child of node.children || []) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
  }
  set innerHTML(value) {
    this._innerHTML = value;
  }
  get innerHTML() {
    return this._innerHTML || "";
  }
  attachShadow() {
    this.shadowRoot = new FakeElement(this.ownerDocument, "shadow-root");
    return this.shadowRoot;
  }
}

class FakeAudio extends FakeElement {
  constructor(ownerDocument) {
    super(ownerDocument, "audio");
    this.paused = true;
    this.currentTime = 0;
    this.loop = false;
    this.volume = 1;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.defaultView = new FakeEventTarget();
    this.visibilityState = "visible";
  }
  createElement(tagName) {
    if (tagName === "audio") return new FakeAudio(this);
    if (tagName === "template") {
      const template = new FakeElement(this, "template");
      template.content = {
        cloneNode: () => ({ isFragment: true, children: [] }),
      };
      return template;
    }
    return new FakeElement(this, tagName);
  }
}

const source = { kind: "initial", runId: null, jobId: null };
const makeRecord = (snapshotId, variables = {}) => ({
  sessionId: "session-1",
  branchId: "branch-1",
  floorId: null,
  attemptId: null,
  versionId: "version-1",
  snapshotId,
  parentSnapshotId: null,
  variables,
  source,
});
const current = makeRecord("snapshot-1", { trust: 10 });

function makeHost() {
  const state = {
    current,
    view: current,
    watches: { current: new Set(), view: new Set() },
    commits: new Set(),
    streams: new Set(),
    reports: [],
    chatMounts: 0,
  };
  return {
    state,
    get(scope) {
      return state[scope];
    },
    watch(scope, callback) {
      state.watches[scope].add(callback);
      callback(state[scope]);
      return () => state.watches[scope].delete(callback);
    },
    onTurnCommitted(callback) {
      state.commits.add(callback);
      return () => state.commits.delete(callback);
    },
    onTextStream(callback, filter) {
      const registration = { callback, filter };
      state.streams.add(registration);
      return () => state.streams.delete(registration);
    },
    getMessages: async ({ floorId }) => [
      {
        id: `message-${floorId}`,
        role: "assistant",
        text: "Persisted text",
        floorId,
        streamId: "stream-1",
        status: "completed",
      },
    ],
    getSnapshot: async () => current,
    listFloors: async () => ({ items: [], nextCursor: null }),
    listSnapshots: async () => ({ items: [], nextCursor: null }),
    select: async (snapshotId) => ({ snapshotId }),
    latest: async () => ({ snapshotId: state.current.snapshotId }),
    setDraft: async () => null,
    send: async () => ({ snapshotId: state.current.snapshotId }),
    mountChat() {
      state.chatMounts += 1;
      let active = true;
      return {
        destroy() {
          if (!active) return;
          active = false;
          state.chatMounts -= 1;
        },
      };
    },
    report(error) {
      state.reports.push(error);
    },
  };
}

function buildRuntime(overrides = {}) {
  const document = new FakeDocument();
  const root = new FakeElement(document, "main");
  const host = overrides.host || makeHost();
  const checked = [];
  const runtime = createScriptRuntime({
    root,
    host,
    policy: {
      overscanFloors: 0,
      historyCache: { maxEntries: 2, maxBytes: 1024 },
      settledStreamCache: { maxEntries: 2, maxBytes: 1024 },
      diagnosticsCache: { maxEntries: 10, maxBytes: 4096 },
    },
    errors: {
      INVALID_REQUEST: "invalid",
      UI_REGISTRATION_INVALID: "registration invalid",
      UI_UPDATE_INVALID: "update invalid",
      ASSET_NOT_FOUND: "asset missing",
      DATA_NOT_FOUND: "data missing",
      CHAT_ALREADY_MOUNTED: "chat mounted",
      FLOOR_VIEW_DISPOSED: "floor disposed",
      RESULT_UNKNOWN: "unknown",
      AUDIO_FAILED: "audio failed",
    },
    validate(name, value) {
      checked.push([name, value]);
      return overrides.validate ? overrides.validate(name, value) : name !== overrides.invalidSchema;
    },
    delivery: {
      html: "<section></section>",
      css: ":host{display:block}",
      scriptUrl:
        overrides.scriptUrl ||
        "data:text/javascript," +
          encodeURIComponent(
            'export function mount({api}){globalThis.__scriptRuntimeMount=api.data.get("config").label}',
          ),
      floorHtml: "<article data-floor></article>",
      assets: {
        portrait: {
          kind: "image",
          url: "/portrait.webp",
          label: "Portrait",
          tags: ["portrait"],
        },
        bgm: {
          kind: "audio",
          url: "/bgm.mp3",
          label: "Music",
          tags: ["bgm"],
        },
      },
      data: { config: { label: "mounted" } },
      ...overrides.delivery,
    },
  });
  return { document, root, shadow: root.shadowRoot, host, runtime, checked };
}

it("migrated runtime behavior 1", async () => {
  const exact = new TextEncoder().encode(
    JSON.stringify({ key: "中文", value: { text: "楼层" } }),
  ).length;
  const cache = new BoundedCache({ maxEntries: 2, maxBytes: exact });
  assert.equal(cache.set("中文", { text: "楼层" }), true);
  assert.equal(
    cache.bytes,
    exact,
    "UTF-8 bytes include multibyte Chinese text",
  );
  assert.equal(cache.set("oversize", "x".repeat(exact)), false);
  assert.equal(cache.size, 1, "a single oversize value is not cached");
  const lru = new BoundedCache({ maxEntries: 2, maxBytes: 1024 });
  lru.set("first", 1);
  lru.set("second", 2);
  assert.equal(lru.get("first"), 1);
  lru.set("third", 3);
  assert.equal(
    lru.has("second"),
    false,
    "get promotes an entry before eviction",
  );
});

it("migrated runtime behavior 2", async () => {
  const { document, shadow, host, runtime, checked } = buildRuntime();
  const text = new FakeElement(document, "p", ["[data-text]"]);
  const image = new FakeElement(document, "img", ["[data-image]"]);
  const control = new FakeElement(document, "button", ["[data-control]"]);
  const progress = new FakeElement(document, "progress", ["[data-progress]"]);
  delete progress.min;
  const chat = new FakeElement(document, "div", ["[data-chat]"]);
  shadow.append(text, image, control, progress, chat);
  const layout = runtime.api.ui.register("main", {
    elements: {
      text: { selector: "[data-text]", kind: "text" },
      image: { selector: "[data-image]", kind: "image" },
      control: { selector: "[data-control]", kind: "control" },
      progress: { selector: "[data-progress]", kind: "progress" },
      chat: { selector: "[data-chat]", kind: "container" },
    },
  });
  layout.update({
    text: { text: "before", classes: { active: true } },
    image: { asset: "portrait", alt: "Portrait" },
    control: { disabled: true, checked: true },
    progress: { value: 7, min: 0, max: 100 },
  });
  assert.equal(text.textContent, "before");
  assert.equal(text.classList.contains("active"), true);
  assert.equal(image.src, "/portrait.webp");
  assert.equal(progress.value, 7);
  assert.equal(progress.max, 100);
  assert.equal("min" in progress, false, "progress minimum zero is implicit");
  assert.throws(
    () => layout.update({ progress: { min: 1 } }),
    (error) => error.code === "UI_UPDATE_INVALID",
  );
  assert.throws(
    () =>
      layout.update({
        text: { text: "must not apply" },
        image: { asset: "missing" },
      }),
    (error) => error.code === "UI_UPDATE_INVALID",
  );
  assert.equal(text.textContent, "before", "invalid patches are atomic");
  assert.throws(
    () => layout.update({ text: { checked: true } }),
    (error) => error.code === "UI_UPDATE_INVALID",
  );

  let mapped = 0;
  const stopBinding = layout.bind("current", (record) => {
    mapped += 1;
    return { text: { text: String(record.variables.trust) } };
  });
  assert.equal(
    text.textContent,
    "10",
    "bindings receive the immediate host value",
  );
  host.state.current = makeRecord("snapshot-2", { trust: 20 });
  for (const callback of host.state.watches.current)
    callback(host.state.current);
  for (const callback of host.state.watches.current)
    callback(makeRecord("snapshot-2", { trust: 999 }));
  assert.equal(text.textContent, "20");
  stopBinding();
  for (const callback of host.state.watches.current)
    callback(makeRecord("snapshot-3", { trust: 30 }));
  assert.equal(
    mapped,
    2,
    "same-snapshot and released bindings receive no later callbacks",
  );

  let clicks = 0;
  const stopClick = layout.on("control", "click", () => {
    clicks += 1;
  });
  control.dispatch("click");
  stopClick();
  control.dispatch("click");
  assert.equal(clicks, 1);

  const widget = runtime.api.widgets.mountChat(layout, "chat");
  assert.equal(host.state.chatMounts, 1);
  assert.throws(
    () => runtime.api.widgets.mountChat(layout, "chat"),
    (error) => error.code === "CHAT_ALREADY_MOUNTED",
  );
  widget.destroy();
  runtime.api.widgets.mountChat(layout, "chat").destroy();
  assert.equal(host.state.chatMounts, 0);

  assert.deepEqual(
    runtime.api.assets.list({ tag: "portrait" })[0].id,
    "portrait",
  );
  assert.equal(runtime.api.assets.url("bgm"), "/bgm.mp3");
  assert.throws(
    () => runtime.api.data.get("missing"),
    (error) => error.code === "DATA_NOT_FOUND",
  );
  assert(Object.isFrozen(runtime.api.data.get("config")));
  const messages = await runtime.api.messages.getFloor({
    branchId: "branch-1",
    floorId: "floor-1",
  });
  assert.equal(messages[0].text, "Persisted text");
  assert(Object.isFrozen(messages) && Object.isFrozen(messages[0]));
  assert(checked.some(([name]) => name === "layoutRegistration"));
  assert(checked.some(([name]) => name === "layoutPatch"));

  let delayedRuns = 0;
  runtime.api.timers.after(20, () => {
    delayedRuns += 1;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  document.visibilityState = "hidden";
  document.dispatch("visibilitychange");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(delayedRuns, 0, "hidden pages pause display timers");
  document.visibilityState = "visible";
  document.dispatch("visibilitychange");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(delayedRuns, 1, "visible pages resume without catch-up calls");

  await runtime.mount();
  assert.equal(globalThis.__scriptRuntimeMount, "mounted");
  delete globalThis.__scriptRuntimeMount;
  layout.remove();
  assert.equal(runtime.diagnostics().layouts, 0);
});

it("migrated runtime behavior 3", async () => {
  const { host, runtime } = buildRuntime();
  let commits = 0;
  runtime.api.variables.onTurnCommitted(() => {
    commits += 1;
  });
  const event = {
    eventId: "event-1",
    sessionId: "session-1",
    branchId: "branch-1",
    kind: "generated",
    previousCurrentSnapshotId: "snapshot-0",
    before: current,
    after: current,
  };
  for (let index = 0; index < 150; index += 1)
    for (const callback of host.state.commits)
      callback({ ...event, eventId: `event-${index}` });
  assert.equal(commits, 150, "long-lived commit subscriptions retain no IDs");

  const revisions = [];
  const stopStream = runtime.api.messages.onTextStream(
    (stream) => revisions.push(stream.revision),
    { floorId: "floor-1" },
  );
  const baseStream = {
    sessionId: "session-1",
    branchId: "branch-1",
    floorId: "floor-1",
    attemptId: "attempt-1",
    streamId: "stream-1",
    runId: "run-1",
    jobId: null,
    messageId: null,
    type: "update",
    status: "streaming",
    text: "hello",
    error: null,
  };
  for (const { callback } of host.state.streams) {
    callback({ ...baseStream, revision: 1 });
    callback({ ...baseStream, revision: 2, text: "hello again" });
    callback({ ...baseStream, revision: 3, type: "end", status: "completed" });
  }
  assert.deepEqual(revisions, [1, 2, 3]);
  assert.equal(runtime.diagnostics().settledStreamCacheEntries, 1);
  stopStream();
  assert.equal(host.state.streams.size, 0);
});

it("migrated runtime behavior 4", async () => {
  const { document, shadow, runtime } = buildRuntime();
  const floors = new FakeElement(document, "div", ["[data-floors]"]);
  floors.clientHeight = 96;
  shadow.append(floors);
  runtime.api.ui.register("history", {
    elements: { floors: { selector: "[data-floors]", kind: "container" } },
  });
  const host = makeHost();
  let resolveFloor;
  let resolveMessages;
  host.listSnapshots = async () => ({
    items: [
      { floorId: "floor-1", attemptId: "attempt-1", snapshotId: "snapshot-1" },
      { floorId: "floor-2", attemptId: "attempt-2", snapshotId: "snapshot-2" },
    ],
    nextCursor: null,
  });
  host.getSnapshot = (id) =>
    id === "pending-snapshot"
      ? new Promise((resolve) => (resolveFloor = resolve))
      : Promise.resolve(makeRecord(id, { trust: id === "snapshot-1" ? 1 : 2 }));
  host.getMessages = () =>
    new Promise((resolve) => (resolveMessages = resolve));
  const separate = buildRuntime({ host });
  const target = new FakeElement(separate.document, "div", ["[data-floors]"]);
  separate.shadow.append(target);
  const targetLayout = separate.runtime.api.ui.register("history", {
    elements: { floors: { selector: "[data-floors]", kind: "container" } },
  });
  let oldFloorApi;
  let pending;
  let pendingMessages;
  let mediaStarted;
  const list = separate.runtime.api.ui.mountFloors(
    targetLayout,
    "floors",
    ({ api, record }) => {
      if (record.snapshotId === "snapshot-1") {
        oldFloorApi = api;
        pending = api.variables.getSnapshot("pending-snapshot");
        pending.catch(() => {});
        pendingMessages = api.messages.getFloor({
          branchId: "branch-1",
          floorId: "floor-1",
        });
        pendingMessages.catch(() => {});
        api.events.on("document", "floor-pending", () => pending);
        api.timers.every(60_000, () => {});
        mediaStarted = api.media.play({
          asset: "bgm",
          channel: "floor-bgm",
          loop: true,
          volume: 0.25,
        });
      }
    },
  );
  await list.ready;
  await mediaStarted;
  separate.document.dispatch("floor-pending");
  assert.deepEqual(
    {
      floorScopes: separate.runtime.diagnostics().floorScopes,
      timers: separate.runtime.diagnostics().timers,
      media: separate.runtime.diagnostics().media,
      eventListeners: separate.runtime.diagnostics().eventListeners,
    },
    { floorScopes: 1, timers: 1, media: 1, eventListeners: 1 },
  );
  await list.setVisibleRange(1, 1);
  await assert.rejects(
    pending,
    (error) => error.code === "FLOOR_VIEW_DISPOSED",
  );
  await assert.rejects(
    pendingMessages,
    (error) => error.code === "FLOOR_VIEW_DISPOSED",
  );
  assert.throws(
    () => oldFloorApi.ui.register("late", { elements: {} }),
    (error) => error.code === "FLOOR_VIEW_DISPOSED",
  );
  resolveFloor?.(makeRecord("pending-snapshot"));
  resolveMessages?.([]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    host.state.reports.length,
    0,
    "expected floor disposal rejections are not diagnostic failures",
  );
  list.destroy();
  assert.equal(separate.runtime.diagnostics().floorScopes, 0);
  assert.equal(separate.runtime.diagnostics().timers, 0);
  assert.equal(separate.runtime.diagnostics().media, 0);
});

it("migrated runtime behavior 5", async () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, "div");
  container.clientHeight = 96;
  const calls = [];
  const mounted = new Set();
  const pages = {
    first: {
      items: [{ floorId: "f1", attemptId: "a1", snapshotId: "s1" }],
      nextCursor: "second",
    },
    second: {
      items: [{ floorId: "f2", attemptId: "a2", snapshotId: "s2" }],
      nextCursor: "third",
    },
    third: {
      items: [{ floorId: "f3", attemptId: "a3", snapshotId: "s3" }],
      nextCursor: null,
    },
  };
  const list = mountVirtualList({
    container,
    branchId: "branch-1",
    overscan: 0,
    pageSize: 1,
    async listItems(params) {
      calls.push(params);
      return pages[params.cursor || "first"];
    },
    itemKey: (item) => item.snapshotId,
    async getRecord(item) {
      return makeRecord(item.snapshotId);
    },
    render({ item }) {
      mounted.add(item.floorId);
      return () => mounted.delete(item.floorId);
    },
  });
  await list.ready;
  assert.deepEqual([...mounted], ["f1"]);
  assert.equal(calls.length, 1, "initial render loads one page");
  await list.loadNext();
  await list.setVisibleRange(1, 1);
  assert.deepEqual([...mounted], ["f2"]);
  await list.loadNext();
  await list.setVisibleRange(2, 2);
  assert.deepEqual([...mounted], ["f3"]);
  assert.deepEqual(
    calls.map(({ cursor }) => cursor || null),
    [null, "second", "third"],
    "opaque backend cursors are used in order",
  );
  assert.equal(list.diagnostics().mounted, 1);
  list.destroy();
  assert.equal(mounted.size, 0);
});

it("migrated runtime behavior 6", async () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, "div");
  container.clientHeight = 0;
  let renders = 0;
  const list = mountVirtualList({
    container,
    branchId: "branch-1",
    overscan: 2,
    listItems: async () => ({
      items: [
        { floorId: "hidden", attemptId: "attempt", snapshotId: "snapshot" },
      ],
      nextCursor: null,
    }),
    itemKey: (item) => item.snapshotId,
    getRecord: async () => current,
    render() {
      renders += 1;
    },
  });
  await list.ready;
  assert.equal(renders, 0, "a collapsed floor container mounts no live scope");
  container.clientHeight = 96;
  document.defaultView.dispatch("resize");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(renders, 1, "a visible floor container mounts after resize");
  list.destroy();
});

it("migrated runtime behavior 7", async () => {
  const { runtime } = buildRuntime({ invalidSchema: "chatSendParams" });
  await assert.rejects(
    runtime.api.chat.send({ text: "hello" }),
    (error) =>
      error instanceof ScriptRuntimeError && error.code === "INVALID_REQUEST",
  );
});

console.log(
  "Script runtime cache limits, atomic UI, callback disposal, floor scopes, pagination, and validation passed",
);

it("releases the page scope and visibility listener on destroy", async () => {
  const { document, shadow, runtime } = buildRuntime();
  assert.equal(document.listeners.get("visibilitychange").size, 1);
  runtime.destroy();
  runtime.destroy();
  assert.equal(document.listeners.get("visibilitychange").size, 0);
  assert.equal(runtime.getDiagnostics().scopes, 0);
  assert.equal(shadow.children.length, 0);
  await assert.rejects(runtime.mount(), { code: "FLOOR_VIEW_DISPOSED" });
});

it("does not initialize a script when its page is destroyed during import", async () => {
  const { runtime } = buildRuntime({
    scriptUrl:
      'data:text/javascript,export function mount(){throw new Error("late mount");}',
  });
  const mounting = runtime.mount();
  runtime.destroy();
  await assert.rejects(mounting, { code: "FLOOR_VIEW_DISPOSED" });
  assert.equal(runtime.getDiagnostics().scopes, 0);
});

it("loads the newest chat page and defers refresh while reading older messages", async () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, "div");
  const calls = [];
  const pages = {
    first: {
      items: [{ floorId: "f1000" }, { floorId: "f999" }],
      nextCursor: "older",
    },
    older: {
      items: [{ floorId: "f998" }, { floorId: "f997" }],
      nextCursor: "many-more",
    },
  };
  const list = mountVirtualList({
    container,
    branchId: "main",
    followTail: true,
    overscan: 0,
    pageSize: 2,
    listItems: async (query) => {
      calls.push(query.cursor);
      return pages[query.cursor || "first"];
    },
    itemKey: (item) => item.floorId,
    getRecord: async (item) => ({ text: item.floorId }),
    render({ container: row, record }) {
      row.textContent = record.text;
    },
  });
  await list.ready;
  assert.deepEqual(
    calls,
    [undefined],
    "initializing a thousand-floor history issues one request",
  );
  assert.equal(list.diagnostics().lastVisibleFloorId, "f1000");
  await list.loadNext();
  assert.deepEqual(calls, [undefined, "older"]);
  assert.equal(
    list.diagnostics().firstVisibleFloorId,
    "f1000",
    "prepending preserves the viewed message",
  );
  container.scrollTop = 0;
  await list.setVisibleRange(0, 0);
  assert.equal(list.diagnostics().firstVisibleFloorId, "f997");
  await list.refresh();
  assert.deepEqual(
    calls,
    [undefined, "older"],
    "refresh retains the historical viewport without fetching other pages",
  );
  assert.equal(list.diagnostics().firstVisibleFloorId, "f997");
  container.scrollTop = 288;
  await list.setVisibleRange(3, 3);
  await list.refresh();
  assert.deepEqual(
    calls,
    [undefined, "older", undefined],
    "following the tail reloads just the newest page",
  );
  assert.equal(list.diagnostics().lastVisibleFloorId, "f1000");
  list.destroy();
});

it("keeps a failed page cursor available for an explicit retry and stops at the last page", async () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, "div");
  let fail = true;
  let failRefresh = false;
  const calls = [];
  const list = mountVirtualList({
    container,
    branchId: "main",
    overscan: 0,
    listItems: async ({ cursor }) => {
      calls.push(cursor);
      if (!cursor && failRefresh) throw new Error("refresh unavailable");
      if (!cursor) return { items: [{ snapshotId: "s2" }], nextCursor: "old" };
      if (fail) throw new Error("page unavailable");
      return { items: [{ snapshotId: "s1" }], nextCursor: null };
    },
    itemKey: (item) => item.snapshotId,
    getRecord: async (item) => makeRecord(item.snapshotId),
    render() {},
  });
  await list.ready;
  await assert.rejects(list.loadNext(), /page unavailable/);
  assert.equal(list.diagnostics().items, 1);
  fail = false;
  await list.loadNext();
  await list.loadNext();
  assert.deepEqual(calls, [undefined, "old", "old"]);
  assert.equal(list.diagnostics().items, 2);
  assert.equal(list.diagnostics().hasNextPage, false);
  failRefresh = true;
  await assert.rejects(list.refresh(), /refresh unavailable/);
  assert.equal(
    list.diagnostics().items,
    2,
    "refresh failure keeps the displayed history",
  );
  list.destroy();
});

it("pins the latest message after asynchronous rendering changes its height", async () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, "div");
  let reads = 0;
  const list = mountVirtualList({
    container,
    branchId: "main",
    followTail: true,
    overscan: 0,
    listItems: async () => {
      reads++;
      return { items: [{ floorId: "latest" }], nextCursor: "older" };
    },
    itemKey: (item) => item.floorId,
    getRecord: async () => ({ text: "a long reply" }),
    render: async ({ container: row }) => {
      await Promise.resolve();
      row.offsetHeight = 1800;
    },
    onError: (error) => {
      throw error;
    },
  });
  await list.ready;
  assert.equal(container.scrollTop, 1800 - container.clientHeight);
  assert.equal(reads, 1);
  list.destroy();
});

it("reports automatic page failures and supplies a retry of the same cursor", async () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, "div");
  const calls = [];
  let fail = true;
  let reported;
  const list = mountVirtualList({
    container,
    branchId: "main",
    overscan: 0,
    listItems: async ({ cursor }) => {
      calls.push(cursor);
      if (!cursor)
        return { items: [{ snapshotId: "s2" }], nextCursor: "older" };
      if (fail) throw new Error("page unavailable");
      return { items: [{ snapshotId: "s1" }], nextCursor: null };
    },
    itemKey: (item) => item.snapshotId,
    getRecord: async (item) => makeRecord(item.snapshotId),
    render() {},
    onError: (error, retry) => {
      reported = { error, retry };
    },
  });
  await list.ready;
  container.dispatch("scroll");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reported.error.message, "page unavailable");
  assert.equal(list.diagnostics().items, 1);
  fail = false;
  await reported.retry();
  assert.deepEqual(calls, [undefined, "older", "older"]);
  list.destroy();
});

it("retries failed record rendering without skipping to the following page", async () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, "div");
  const pages = [];
  const reads = [];
  let fail = true;
  const list = mountVirtualList({
    container,
    branchId: "main",
    overscan: 1,
    listItems: async ({ cursor }) => {
      pages.push(cursor);
      if (!cursor)
        return { items: [{ snapshotId: "s2" }], nextCursor: "older" };
      return { items: [{ snapshotId: "s1" }], nextCursor: null };
    },
    itemKey: (item) => item.snapshotId,
    getRecord: async (item) => {
      reads.push(item.snapshotId);
      if (item.snapshotId === "s1" && fail)
        throw new Error("record unavailable");
      return makeRecord(item.snapshotId);
    },
    render() {},
  });
  await list.ready;
  await assert.rejects(list.loadNext(), /record unavailable/);
  fail = false;
  await list.loadNext();
  assert.deepEqual(pages, [undefined, "older"]);
  assert.deepEqual(reads, ["s2", "s1", "s1"]);
  assert.equal(list.diagnostics().mounted, 2);
  list.destroy();
});

it("holds page loading until record rendering completes and publishes the retry result", async () => {
  const document = new FakeDocument();
  const container = new FakeElement(document, "div");
  const pages = [];
  const states = [];
  let rejectRead;
  let fail = true;
  const list = mountVirtualList({
    container,
    branchId: "main",
    overscan: 1,
    listItems: async ({ cursor }) => {
      pages.push(cursor);
      return cursor
        ? { items: [{ snapshotId: "s1" }], nextCursor: null }
        : { items: [{ snapshotId: "s2" }], nextCursor: "older" };
    },
    itemKey: (item) => item.snapshotId,
    getRecord: async (item) => {
      if (item.snapshotId === "s1" && fail)
        return new Promise((resolve, reject) => {
          rejectRead = reject;
        });
      return makeRecord(item.snapshotId);
    },
    render() {},
    onChange: (state) => states.push(state),
  });
  await list.ready;
  const pending = list.loadNext();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1).loading, true);
  const duplicate = list.loadNext();
  const rejected = Promise.all([
    assert.rejects(pending, /record unavailable/),
    assert.rejects(duplicate, /record unavailable/),
  ]);
  rejectRead(new Error("record unavailable"));
  await rejected;
  assert.deepEqual(pages, [undefined, "older"]);
  fail = false;
  await list.loadNext();
  assert.deepEqual(states.at(-1), { loading: false, hasNextPage: false });
  assert.deepEqual(pages, [undefined, "older"]);
  list.destroy();
});

it("inserts the API origin only at marked UTF-16 positions before rendering HTML", async () => {
  const { resolveRoleDocumentUrls } = await import("../script-runtime.ts");
  const html = '<p>😀 /role-assets/v1/image.svg</p><img src="/role-assets/v1/image.svg">';
  const rendered = resolveRoleDocumentUrls(html, "https://api.test:8443/role-assets/v1/frontend/index.html", [45]);
  assert.equal(rendered, '<p>😀 /role-assets/v1/image.svg</p><img src="https://api.test:8443/role-assets/v1/image.svg">');
  assert.equal(resolveRoleDocumentUrls(html, "https://web.test/api/role-assets/v1/frontend/index.html", [45]), '<p>😀 /role-assets/v1/image.svg</p><img src="https://web.test/api/role-assets/v1/image.svg">');
  assert.equal(resolveRoleDocumentUrls("<p>empty</p>", "https://api.test/role-assets/v1/index.html", []), "<p>empty</p>");
});

it("mounts floor HTML with its own fixed resource path before the role callback reads the DOM", async () => {
  const document = new FakeDocument();
  const container = new FakeElement(document);
  const rendered = [];
  const list = mountVirtualList({
    container,
    branchId: "branch-1",
    listItems: async () => ({ items: [{ snapshotId: "initial" }], nextCursor: null }),
    getRecord: async () => makeRecord("initial"),
    itemKey: item => item.snapshotId,
    floorHtml: '<img src="/role-assets/fixed/frontend/floors/icon.svg">',
    floorHtmlUrl: "https://api.test:8443/role-assets/fixed/frontend/floors/item.html",
    floorHtmlAssetOriginOffsets: [10],
    render: ({ container }) => { rendered.push(container.innerHTML); },
  });
  await list.ready;
  assert.deepEqual(rendered, ['<img src="https://api.test:8443/role-assets/fixed/frontend/floors/icon.svg">']);
  list.destroy();
});

it("keeps the public API method allowlist immutable during character execution", async () => {
  const { nativeCardFileRules } = await import("@tavern/shared");
  const { runtime } = buildRuntime();
  const methods = nativeCardFileRules.frontendModuleApi.methods;
  assert.deepEqual(Object.keys(runtime.api).sort(), Object.keys(methods).sort());
  for (const [namespace, entries] of Object.entries(methods)) {
    assert.deepEqual(Object.keys(runtime.api[namespace]).sort(), Object.keys(entries).sort());
    assert.throws(() => { runtime.api[namespace].hostAccess = () => null; }, TypeError);
  }
  assert.equal(runtime.api.data.get("config").label, "mounted");
  runtime.destroy();
});

it("mounts and disposes native system chat without importing a package script", async () => {
  const { runtime, host, shadow } = buildRuntime({ delivery: {
    mode: "system_chat", html: "", css: "", scriptUrl: null, floorHtml: null,
  } });
  await runtime.mount();
  assert.equal(host.state.chatMounts, 1);
  assert.equal(shadow.children.length, 1);
  assert.equal(runtime.getDiagnostics().widgets, 1);
  runtime.destroy();
  assert.equal(host.state.chatMounts, 0);
  assert.equal(shadow.children.length, 0);
});

it("validates both state repair methods and returns immutable operation results", async () => {
  const {host,runtime}=buildRuntime({validate: (name, value) => roleRuntimeValidators[name](value)});
  const calls=[];
  host.recalculateLatest=async params=>{calls.push(params);return {operationId:"operation",before:current,after:current};};
  host.restoreMissing=host.recalculateLatest;
  const params={branchId:current.branchId,expectedSnapshotId:current.snapshotId};
  const result=await runtime.api.variables.recalculateLatest({...params,floorId:"floor-1"});
  assert.equal(result.operationId,"operation");assert.equal(Object.isFrozen(result.after.variables),true);
  await runtime.api.variables.restoreMissing(params);assert.equal(calls.length,2);
  await assert.rejects(runtime.api.variables.recalculateLatest({...params,floorId:""}));
  assert.equal(calls.length,2);
  host.restoreMissing=async()=>{throw Object.assign(new Error("Current state changed"),{code:"ROLE_STATE_REPAIR_STALE"});};
  await assert.rejects(runtime.api.variables.restoreMissing(params),{code:"ROLE_STATE_REPAIR_STALE"});
  runtime.destroy();
  await assert.rejects(runtime.api.variables.restoreMissing(params));
});

it("fill updates and visibility animations preserve atomicity, timing, queues and disposal", async () => {
  await checkVisibilityAndFill(buildRuntime, FakeElement);
});
