import assert from "node:assert/strict";
import { setImmediate } from "node:timers";

import { createSessionHost } from "../shared/script-host.prototype.js";
import { createLegacyTestTransport } from "./script-host-legacy-transport.mjs";

class FakeEventTarget {
  #listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.#listeners.get(type) || new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    const handler = this["on" + event.type];
    const result = handler?.call(this, event);
    for (const listener of this.#listeners.get(event.type) || [])
      listener.call(this, event);
    return result;
  }
}

class FakeClassList {
  #values = new Set();

  constructor(value = "") {
    for (const name of value.split(/\s+/).filter(Boolean))
      this.#values.add(name);
  }

  contains(name) {
    return this.#values.has(name);
  }

  add(...names) {
    for (const name of names) this.#values.add(name);
  }

  remove(...names) {
    for (const name of names) this.#values.delete(name);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(ownerDocument, tagName = "div") {
    super();
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.offsetHeight = 96;
    this.clientHeight = 300;
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this._isShadow = false;
  }

  set className(value) {
    this._className = value;
    this.classList = new FakeClassList(value);
  }

  get className() {
    return this._className || "";
  }

  append(...children) {
    for (const child of children) {
      if (!child) continue;
      child.parentNode = this;
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    for (const child of this.children) {
      child.parentNode = null;
      child.parentElement = null;
    }
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
    this.parentElement = null;
  }

  attachShadow() {
    const shadow = new FakeElement(this.ownerDocument, "shadow-root");
    shadow._isShadow = true;
    this.shadowRoot = shadow;
    return shadow;
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (!this._isShadow || !value.includes('class="history"')) return;

    const history = this.ownerDocument.createElement("div");
    history.className = "history";
    history.setAttribute("aria-label", "对话记录");
    const live = this.ownerDocument.createElement("div");
    live.className = "live";
    const compose = this.ownerDocument.createElement("div");
    compose.className = "compose";
    const area = this.ownerDocument.createElement("textarea");
    const failure = this.ownerDocument.createElement("p");
    failure.className = "error";
    const retryState = this.ownerDocument.createElement("button");
    retryState.className = "retry-state";
    const retryFollowups = this.ownerDocument.createElement("button");
    retryFollowups.className = "retry-followups";
    const send = this.ownerDocument.createElement("button");
    send.className = "send";
    compose.append(area, failure, retryState, retryFollowups, send);
    this.replaceChildren(history, live, compose);
  }

  get innerHTML() {
    return this._innerHTML || "";
  }

  setAttribute() {}

  removeAttribute() {}

  closest() {
    return null;
  }

  getClientRects() {
    return [{}];
  }

  getBoundingClientRect() {
    return { top: 0, height: this.offsetHeight };
  }

  checkVisibility() {
    return true;
  }

  matches(selector) {
    if (selector.startsWith("."))
      return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches?.(selector)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child.matches?.(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.defaultView = new FakeEventTarget();
    this.visibilityState = "visible";
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }
}

const initial = {
  sessionId: "session-pending",
  branchId: "branch-pending",
  floorId: null,
  attemptId: null,
  versionId: "version-pending",
  snapshotId: "snapshot-initial",
  parentSnapshotId: null,
  variables: { trust: 1 },
  source: { kind: "initial", runId: null, jobId: null },
};

const committed = {
  sessionId: initial.sessionId,
  branchId: initial.branchId,
  floorId: "floor-committed",
  attemptId: "attempt-committed",
  versionId: initial.versionId,
  snapshotId: "snapshot-committed",
  parentSnapshotId: initial.snapshotId,
  variables: { trust: 2 },
  source: { kind: "floor", runId: "run-committed", jobId: null },
};

const turnCommit = {
  eventId: "event-committed",
  sessionId: initial.sessionId,
  branchId: initial.branchId,
  kind: "generated",
  previousCurrentSnapshotId: initial.snapshotId,
  before: initial,
  after: committed,
};

const base = `/script-api/sessions/${initial.sessionId}`;
const envelope = (type, data) => JSON.stringify({ type, data });
const stream = (...lines) =>
  new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const errorResponse = (code) => json({ error: { code, message: code } }, 500);

const makeSession = (processing) => ({
  sessionId: initial.sessionId,
  branchId: initial.branchId,
  versionId: initial.versionId,
  name: "Pending test",
  initial: structuredClone(initial),
  current: structuredClone(initial),
  messages: [],
  processing,
  delivery: { assets: {}, data: {} },
});

const policy = {
  overscanFloors: 0,
  historyCache: { maxEntries: 4, maxBytes: 4096 },
  settledStreamCache: { maxEntries: 4, maxBytes: 4096 },
  diagnosticsCache: { maxEntries: 4, maxBytes: 4096 },
};

const errors = {
  SCRIPT_FAILED: "script failed",
  INVALID_REQUEST: "invalid request",
  NETWORK_ERROR: "network error",
  RESULT_UNKNOWN: "result unknown",
  SEND_BUSY: "send busy",
  STATE_FOLLOWUP_FAILED: "followup failed",
  STATE_FOLLOWUPS_PENDING: "followups pending",
};

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(message);
}

function mountChat(host, document) {
  const root = document.createElement("main");
  const mounted = host.mountChat(root);
  const shadow = root.children[0].shadowRoot;
  return {
    mounted,
    shadow,
    area: shadow.querySelector("textarea"),
    send: shadow.querySelector(".send"),
    retryState: shadow.querySelector(".retry-state"),
    retryFollowups: shadow.querySelector(".retry-followups"),
    pendingText: shadow.querySelector(".live").children[0],
  };
}

async function mainPendingRecovery(document) {
  const requests = [];
  let postCount = 0;
  const pending = { input: "继续调查", text: "恢复后的待更新正文" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === "POST") {
      postCount++;
      if (postCount === 1) return errorResponse("RESULT_UNKNOWN");
      return stream(
        envelope("commit", turnCommit),
        envelope("completed", { snapshotId: committed.snapshotId }),
      );
    }
    if (url === base)
      return json({
        current: structuredClone(initial),
        processing: { pendingMain: pending, pendingFollowups: false },
      });
    if (url.startsWith(base + "/floors?"))
      return json({ items: [], nextCursor: null });
    throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
  };

  const host = createSessionHost({
    session: makeSession({ pendingMain: null, pendingFollowups: false }),
    transport: createLegacyTestTransport(initial.sessionId),
    policy,
    errors,
  });
  const view = mountChat(host, document);
  try {
    await waitFor(
      () => requests.some(({ url }) => url.startsWith(base + "/floors?")),
      "chat history list did not initialize",
    );

    view.area.value = pending.input;
    await view.area.dispatchEvent({ type: "input" });
    await view.send.onclick();

    assert.equal(view.pendingText.hidden, false);
    assert.equal(view.pendingText.textContent, pending.text);
    assert.equal(view.retryState.hidden, false);
    assert.equal(view.retryState.textContent, "重试变量更新");
    assert.equal(view.send.disabled, true);

    await view.retryState.onclick();
    await waitFor(
      () => view.retryState.hidden && view.pendingText.hidden,
      "main pending state was not cleared after commit",
    );
    const retryRequest = requests.find(
      ({ options }) =>
        options.method === "POST" &&
        options.headers?.["x-state-update-retry"] === "true",
    );
    assert.ok(
      retryRequest,
      "main retry must use the state-update retry header",
    );
    assert.deepEqual(JSON.parse(retryRequest.options.body), {
      text: pending.input,
    });
    assert.equal(view.pendingText.textContent, "");
    assert.equal(host.get("current").snapshotId, committed.snapshotId);
    assert.equal(view.send.disabled, false);
  } finally {
    view.mounted.destroy();
    globalThis.fetch = originalFetch;
  }
}

async function followupsRecovery(document) {
  const requests = [];
  let postCount = 0;
  const draft = "这段草稿等待后续处理";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === "POST") {
      postCount++;
      if (postCount === 1) return errorResponse("STATE_FOLLOWUP_FAILED");
      return stream(envelope("completed", { snapshotId: initial.snapshotId }));
    }
    if (url === base)
      return json({
        current: structuredClone(initial),
        processing: { pendingMain: null, pendingFollowups: true },
      });
    if (url.startsWith(base + "/floors?"))
      return json({ items: [], nextCursor: null });
    throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
  };

  const host = createSessionHost({
    session: makeSession({ pendingMain: null, pendingFollowups: false }),
    transport: createLegacyTestTransport(initial.sessionId),
    policy,
    errors,
  });
  const view = mountChat(host, document);
  try {
    await waitFor(
      () => requests.some(({ url }) => url.startsWith(base + "/floors?")),
      "chat history list did not initialize",
    );

    view.area.value = draft;
    await view.area.dispatchEvent({ type: "input" });
    await view.send.onclick();

    assert.equal(view.retryFollowups.hidden, false);
    assert.equal(view.retryFollowups.textContent, "重试后续处理");
    assert.equal(
      view.area.value,
      draft,
      "recovery must preserve the unsent draft",
    );
    assert.equal(view.send.disabled, true);

    await view.retryFollowups.onclick();
    await waitFor(
      () => view.retryFollowups.hidden,
      "followup retry did not clear pending state",
    );
    const retryRequest = requests.find(({ url }) =>
      url.endsWith("/followups/retry"),
    );
    assert.ok(retryRequest, "followup recovery must use the retry route");
    assert.equal(
      view.area.value,
      draft,
      "followup retry must preserve the draft",
    );
    assert.equal(view.send.disabled, false);
  } finally {
    view.mounted.destroy();
    globalThis.fetch = originalFetch;
  }
}

const originalDocument = globalThis.document;
const document = new FakeDocument();
globalThis.document = document;
try {
  await mainPendingRecovery(document);
  await followupsRecovery(document);
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
}

console.log(
  "Session host pending recovery passed: main body/retry, commit cleanup, followup retry recovery, and draft preservation",
);
