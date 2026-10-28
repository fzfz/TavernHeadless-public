import assert from "node:assert/strict";
import {
  BoundedCache,
  ScriptRuntimeError,
  createScriptRuntime,
  mountVirtualList,
} from "../shared/script-runtime.prototype.js";

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
    getFloor: async () => ({ before: current, after: current }),
    getMessages: async ({ floorId }) => [
      {
        id: `message-${floorId}`,
        role: "assistant",
        text: "Persisted text",
        floorId,
        attemptId: "attempt-1",
        streamId: "stream-1",
        status: "completed",
      },
    ],
    getSnapshot: async () => current,
    listFloors: async () => ({ items: [], nextCursor: null }),
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
      return name !== overrides.invalidSchema;
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
    },
  });
  return { document, root, shadow: root.shadowRoot, host, runtime, checked };
}

{
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
}

{
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
}

{
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
}

{
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
  host.listFloors = async () => ({
    items: [
      { floorId: "floor-1", attemptId: "attempt-1", snapshotId: "snapshot-1" },
      { floorId: "floor-2", attemptId: "attempt-2", snapshotId: "snapshot-2" },
    ],
    nextCursor: null,
  });
  host.getSnapshot = async (id) =>
    makeRecord(id, { trust: id === "snapshot-1" ? 1 : 2 });
  host.getFloor = () => new Promise((resolve) => (resolveFloor = resolve));
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
        pending = api.variables.getFloor({
          branchId: "branch-1",
          floorId: "floor-1",
        });
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
  resolveFloor?.({ before: current, after: current });
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
}

{
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
    async listFloors(params) {
      calls.push(params);
      return pages[params.cursor || "first"];
    },
    async getSnapshot(snapshotId) {
      return makeRecord(snapshotId);
    },
    render({ item }) {
      mounted.add(item.floorId);
      return () => mounted.delete(item.floorId);
    },
  });
  await list.ready;
  assert.deepEqual([...mounted], ["f1"]);
  await list.setVisibleRange(1, 1);
  assert.deepEqual([...mounted], ["f2"]);
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
}

{
  const document = new FakeDocument();
  const container = new FakeElement(document, "div");
  container.clientHeight = 0;
  let renders = 0;
  const list = mountVirtualList({
    container,
    branchId: "branch-1",
    overscan: 2,
    listFloors: async () => ({
      items: [
        { floorId: "hidden", attemptId: "attempt", snapshotId: "snapshot" },
      ],
      nextCursor: null,
    }),
    getSnapshot: async () => current,
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
}

{
  const { runtime } = buildRuntime({ invalidSchema: "chatSendParams" });
  await assert.rejects(
    runtime.api.chat.send({ text: "hello" }),
    (error) =>
      error instanceof ScriptRuntimeError && error.code === "INVALID_REQUEST",
  );
}

console.log(
  "Script runtime cache limits, atomic UI, callback disposal, floor scopes, pagination, and validation passed",
);
