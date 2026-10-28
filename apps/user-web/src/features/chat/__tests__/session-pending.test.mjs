import { it } from "vitest";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";

import { createSessionHost } from "../session-controller.ts";
import { createLegacyTestTransport } from "./legacy-transport.fixture.mjs";
import { mountChatWidget } from "../chat-widget.ts";

it("preserves pending state and recovery ordering", async () => {
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

    focus() {
      this.ownerDocument.activeElement = this;
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

    insertBefore(child, before) {
      child.remove();
      const index = before ? this.children.indexOf(before) : -1;
      child.parentNode = this;
      child.parentElement = this;
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
      return child;
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
      const retryResponse = this.ownerDocument.createElement("button");
      retryResponse.className = "retry-response";
      const send = this.ownerDocument.createElement("button");
      send.className = "send";
      compose.append(area, failure, retryState, retryResponse, send);
      const older = this.ownerDocument.createElement("button");
      older.className = "older-messages";
      const historyError = this.ownerDocument.createElement("p");
      historyError.className = "history-error";
      this.replaceChildren(older, historyError, history, live, compose);
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

  const makeSession = (processing, current = initial) => ({
    sessionId: initial.sessionId,
    branchId: initial.branchId,
    versionId: initial.versionId,
    name: "Pending test",
    initial: structuredClone(initial),
    current: structuredClone(current),
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
      history: shadow.querySelector(".records"),
      area: shadow.querySelector("textarea"),
      send: shadow.querySelector(".send"),
      failure: shadow.querySelector(".error"),
      retryState: shadow.querySelector(".retry-state"),
      retryResponse: shadow.querySelector(".retry-response"),
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
      assert.equal(view.retryState.textContent, "重试角色状态更新");
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

  async function failedResponseRecovery(document) {
    const requests = [];
    let postCount = 0;
    const input = "请继续调查北门。";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url, options });
      if (options.method === "POST") {
        postCount++;
        if (postCount === 1)
          return errorResponse("MODEL_PROVIDER_REQUEST_FAILED");
        return stream(
          envelope("text", {
            sessionId: initial.sessionId,
            branchId: initial.branchId,
            floorId: "floor-retried",
            attemptId: "attempt-retried",
            streamId: "stream-retried",
            runId: "run-retried",
            jobId: null,
            messageId: "message-retried",
            revision: 0,
            type: "end",
            status: "completed",
            text: "调查结果已经确认。",
            error: null,
          }),
          envelope("commit", {
            ...turnCommit,
            eventId: "event-retried",
            after: committed,
          }),
          envelope("completed", { snapshotId: initial.snapshotId }),
        );
      }
      if (url === base)
        return json({
          current: structuredClone(initial),
          processing: { pendingMain: null, pendingFollowups: false },
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

      view.area.value = input;
      await view.area.dispatchEvent({ type: "input" });
      await view.send.onclick();

      assert.equal(view.retryResponse.hidden, false);
      assert.equal(view.retryResponse.textContent, "重试生成回复");
      assert.equal(view.area.disabled, false);
      assert.equal(view.send.disabled, true);

      await view.retryResponse.onclick();
      await waitFor(
        () => view.retryResponse.hidden,
        "failed reply retry did not clear pending input",
      );
      const sends = requests.filter(
        ({ url, options }) =>
          url.endsWith("/send") && options.method === "POST",
      );
      assert.equal(sends.length, 2);
      assert.deepEqual(
        sends.map(({ options }) => JSON.parse(options.body)),
        [{ text: input }, { text: input }],
        "retry must submit the retained user input with the same text",
      );
      assert.equal(sends[1].options.headers["x-state-update-retry"], undefined);
      assert.equal(view.send.disabled, true);
    } finally {
      view.mounted.destroy();
      globalThis.fetch = originalFetch;
    }
  }

  async function committedStateResponseLostRecovery(document) {
    const recovered = {
      ...committed,
      floorId: "floor-state-committed",
      attemptId: "attempt-state-committed",
      snapshotId: "snapshot-state-committed",
    };
    let first = true;
    const transport = {
      subscribeState: () => () => {},
      listFloors: async () => ({ items: [], nextCursor: null }),
      getSnapshot: async () => recovered,
      getMessages: async () => [],
      send: async ({ emit }) => {
        if (first) {
          first = false;
          emit({
            type: "text",
            data: {
              sessionId: initial.sessionId,
              branchId: initial.branchId,
              floorId: recovered.floorId,
              attemptId: recovered.attemptId,
              streamId: "stream-state-committed",
              runId: "run-state-committed",
              jobId: null,
              messageId: "message-state-committed",
              revision: 0,
              type: "end",
              status: "completed",
              text: "服务器已提交的回复",
              error: null,
            },
          });
          throw Object.assign(new Error("state response was lost"), {
            code: "ROLE_STATE_UPDATE_FAILED",
          });
        }
        throw new Error("the recovered composer should not retry old state");
      },
      loadSession: async () =>
        makeSession({ pendingMain: null, pendingFollowups: false }, recovered),
      dispose() {},
    };
    const host = createSessionHost({
      session: makeSession({ pendingMain: null, pendingFollowups: false }),
      transport,
      policy,
      errors,
    });
    const view = mountChat(host, document);
    try {
      view.area.value = "已完成的原始输入";
      view.area.oninput();
      await view.send.onclick();

      assert.equal(host.get("current").snapshotId, recovered.snapshotId);
      assert.equal(view.retryState.hidden, true);
      assert.equal(view.pendingText.hidden, true);
      assert.equal(view.shadow.querySelector(".pending-user").hidden, true);
      assert.equal(view.area.disabled, false);
      assert.equal(view.send.disabled, true);
      await assert.rejects(host.retryPendingStateUpdate(), {
        code: "STATE_RETRY_INVALID",
      });
    } finally {
      view.mounted.destroy();
    }
  }

  async function immediateActionMessage(document) {
    let finish;
    const transport = {
      subscribeState: () => () => {},
      listFloors: async () => ({ items: [], nextCursor: null }),
      send: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      dispose() {},
      loadSession: async () =>
        makeSession({ pendingMain: null, pendingFollowups: false }),
    };
    const host = createSessionHost({
      session: makeSession({ pendingMain: null, pendingFollowups: false }),
      transport,
      policy,
      errors,
    });
    const view = mountChat(host, document);
    const sent = host.send({ text: "已选择的行动" }).catch(() => {});
    assert.equal(
      view.shadow.querySelector(".pending-user").textContent,
      "已选择的行动",
    );
    assert.equal(view.shadow.querySelector(".pending-user").hidden, false);
    finish();
    await sent;
    view.mounted.destroy();
  }

  async function keyboardImmediateMessage(document, modifiers = {}) {
    let finish,
      count = 0;
    const transport = {
      subscribeState: () => () => {},
      listFloors: async () => ({ items: [], nextCursor: null }),
      send: () => {
        count++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      dispose() {},
    };
    const host = createSessionHost({
      session: makeSession({ pendingMain: null, pendingFollowups: false }),
      transport,
      policy,
      errors,
    });
    const view = mountChat(host, document);
    view.area.value = "输入框中的行动";
    view.area.oninput();
    let prevented = false;
    const enter = {
      ...modifiers,
      key: "Enter",
      preventDefault: () => {
        prevented = true;
      },
    };
    view.area.onkeydown({ ...enter, shiftKey: true });
    view.area.onkeydown({ ...enter, isComposing: true });
    view.area.onkeydown({ ...enter, keyCode: 229 });
    assert.equal(count, 0);
    assert.equal(prevented, false);
    view.area.onkeydown(enter);
    assert.equal(count, 1);
    assert.equal(prevented, true);
    assert.equal(
      view.shadow.querySelector(".pending-user").textContent,
      "输入框中的行动",
    );
    assert.equal(view.shadow.querySelector(".pending-user").hidden, false);
    view.area.onkeydown(enter);
    assert.equal(count, 1);
    finish();
    await tick();
    view.mounted.destroy();
  }

  async function streamingDisplay(document) {
    let deliver,
      finish,
      calls = 0;
    const transport = {
      subscribeState: () => () => {},
      listFloors: async () => ({ items: [], nextCursor: null }),
      dispose() {},
      send: ({ emit }) => {
        calls++;
        deliver = emit;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    };
    const host = createSessionHost({
      session: makeSession({ pendingMain: null, pendingFollowups: false }),
      transport,
      policy,
      errors,
    });
    const view = mountChat(host, document);
    const sent = host.send({ text: "敲门" });
    await assert.rejects(
      host.send({ text: "重复点击" }),
      (error) => error.code === "SEND_BUSY",
    );
    assert.equal(calls, 1);
    assert.equal(view.send.disabled, true);
    const event = {
      sessionId: initial.sessionId,
      branchId: initial.branchId,
      floorId: "stream-floor",
      attemptId: "stream-attempt",
      streamId: "stream-display",
      runId: "stream-run",
      jobId: null,
      messageId: null,
      revision: 1,
      type: "snapshot",
      status: "streaming",
      text: "第一段",
      error: null,
    };
    deliver({ type: "text", data: event });
    const live = view.shadow.querySelector(".live");
    assert.ok(
      live
        .querySelectorAll(".body")
        .some((node) => node.textContent === "第一段"),
    );
    deliver({
      type: "text",
      data: { ...event, revision: 2, text: "第一段，第二段" },
    });
    assert.ok(
      live
        .querySelectorAll(".body")
        .some((node) => node.textContent === "第一段，第二段"),
    );
    deliver({
      type: "text",
      data: { ...event, revision: 1, text: "过期分块" },
    });
    assert.equal(
      live
        .querySelectorAll(".body")
        .some((node) => node.textContent === "过期分块"),
      false,
    );
    deliver({
      type: "text",
      data: {
        ...event,
        revision: 3,
        type: "end",
        status: "completed",
        text: "完整回复",
      },
    });
    deliver({ type: "completed", data: { snapshotId: initial.snapshotId } });
    finish();
    await sent;
    assert.equal(
      live
        .querySelectorAll(".body")
        .some((node) => node.textContent === "第一段，第二段"),
      false,
    );
    view.mounted.destroy();
  }

  function message(role, text, floorId = committed.floorId) {
    return {
      id: `${role}-${text}`,
      role,
      text,
      floorId,
      streamId: `stream-${role}-${text}`,
      status: "completed",
    };
  }

  async function mountHistory(document, delivery, messages) {
    const reports = [];
    const transport = {
      subscribeState: () => () => {},
      listFloors: async () => ({
        items: [
          {
            floorId: committed.floorId,
            floorNo: 1,
            state: "committed",
          },
        ],
        nextCursor: null,
      }),
      getSnapshot: async () => committed,
      getMessages: async () => messages,
      dispose() {},
    };
    const host = createSessionHost({
      session: {
        ...makeSession({ pendingMain: null, pendingFollowups: false }),
        delivery,
      },
      transport,
      policy,
      errors,
      onReport(error) {
        reports.push(error);
      },
    });
    const view = mountChat(host, document);
    const articleFor = (text) =>
      view.history.children
        .flatMap((row) => row.children)
        .find(
          (article) =>
            article.tagName === "ARTICLE" &&
            article.querySelector("p")?.textContent === text,
        );
    await waitFor(
      () =>
        reports.length > 0 || messages.every(({ text }) => articleFor(text)),
      "role message history did not render",
    );
    return { host, view, reports, articleFor };
  }

  async function optionalMessagePresentation(document) {
    const text = "正文没有依赖人名或头像。";
    const { host, view, reports, articleFor } = await mountHistory(
      document,
      { assets: {}, data: {} },
      [message("user", text)],
    );
    try {
      const article = articleFor(text);
      assert.ok(article, "the message body remains visible without metadata");
      assert.equal(article.querySelector("img"), null);
      assert.equal(article.querySelector(".name"), null);
      assert.equal(article.classList.contains("no-avatar"), true);
      assert.deepEqual(reports, []);
      assert.deepEqual(host.diagnostics().diagnostics, {
        entries: 0,
        bytes: 0,
      });
    } finally {
      view.mounted.destroy();
    }
  }

  async function referencedImagePresentation(document) {
    const text = "配置的姓名和头像正常显示。";
    const { view, reports, articleFor } = await mountHistory(
      document,
      {
        assets: {
          characterPortrait: {
            kind: "image",
            url: "/role-assets/version/portrait.png",
            label: "角色立绘",
            tags: ["avatar"],
          },
        },
        data: {
          characterAvatar: "characterPortrait",
          characterName: "林岚",
        },
      },
      [message("assistant", text)],
    );
    try {
      const article = articleFor(text);
      assert.ok(article, "the message body remains visible with metadata");
      assert.equal(
        article.querySelector("img")?.src,
        "/role-assets/version/portrait.png",
      );
      assert.equal(article.querySelector("img")?.alt, "林岚");
      assert.equal(article.querySelector(".name")?.textContent, "林岚");
      assert.deepEqual(reports, []);
    } finally {
      view.mounted.destroy();
    }
  }

  async function imageAndAgentLabelsWithoutNames(document) {
    const assistantText = "头像可显示，但没有配置姓名。";
    const agentText = "没有姓名的 Agent 补充正文。";
    const { view, reports, articleFor } = await mountHistory(
      document,
      {
        assets: {
          characterPortrait: {
            kind: "image",
            url: "/role-assets/version/portrait.png",
            label: "角色立绘",
            tags: ["avatar"],
          },
        },
        data: { characterAvatar: "characterPortrait" },
      },
      [message("assistant", assistantText), message("agent", agentText)],
    );
    try {
      const assistant = articleFor(assistantText);
      assert.ok(assistant);
      assert.equal(
        assistant.querySelector("img")?.src,
        "/role-assets/version/portrait.png",
      );
      assert.equal(assistant.querySelector("img")?.alt, "");
      assert.equal(assistant.querySelector(".name"), null);

      const agent = articleFor(agentText);
      assert.ok(agent);
      assert.equal(agent.querySelector("img")?.alt, "");
      assert.equal(agent.querySelector(".name")?.textContent, "补充");
      assert.equal(agent.querySelector("p")?.textContent, agentText);
      assert.deepEqual(reports, []);
    } finally {
      view.mounted.destroy();
    }
  }

  async function nonImageAvatarReferenceShowsOnlyTextAndName(document) {
    const text = "音频资产不能作为头像显示。";
    const { view, reports, articleFor } = await mountHistory(
      document,
      {
        assets: {
          characterAudio: {
            kind: "audio",
            url: "/role-assets/version/voice.ogg",
            label: "角色语音",
            tags: [],
          },
        },
        data: {
          characterAvatar: "characterAudio",
          characterName: "林岚",
        },
      },
      [message("assistant", text)],
    );
    try {
      const article = articleFor(text);
      assert.ok(article, "the message body remains visible");
      assert.equal(article.querySelector("img"), null);
      assert.equal(article.querySelector(".name")?.textContent, "林岚");
      assert.deepEqual(reports, []);
    } finally {
      view.mounted.destroy();
    }
  }

  async function missingImageReferencePreservesCompletedReply(document) {
    const inputText = "页面保持这条已经完成的消息。";
    const responseText = "林岚收好登记册，走到窗边。";
    let historyMessages = [];
    let finishSend;
    const reports = [];
    const transport = {
      subscribeState: () => () => {},
      listFloors: async () => ({
        items: historyMessages.length
          ? [
              {
                floorId: committed.floorId,
                floorNo: 1,
                state: "committed",
              },
            ]
          : [],
        nextCursor: null,
      }),
      getSnapshot: async () => committed,
      getMessages: async () => historyMessages,
      send: ({ emit }) => {
        emit({
          type: "text",
          data: {
            sessionId: initial.sessionId,
            branchId: initial.branchId,
            floorId: committed.floorId,
            attemptId: committed.attemptId,
            streamId: "stream-completed-without-avatar",
            runId: "run-completed-without-avatar",
            jobId: null,
            messageId: null,
            revision: 1,
            type: "snapshot",
            status: "streaming",
            text: "林岚收好",
            error: null,
          },
        });
        return new Promise((resolve) => {
          finishSend = () => {
            historyMessages = [
              message("user", inputText),
              message("assistant", responseText),
            ];
            emit({
              type: "text",
              data: {
                sessionId: initial.sessionId,
                branchId: initial.branchId,
                floorId: committed.floorId,
                attemptId: committed.attemptId,
                streamId: "stream-completed-without-avatar",
                runId: "run-completed-without-avatar",
                jobId: null,
                messageId: "message-completed-without-avatar",
                revision: 2,
                type: "end",
                status: "completed",
                text: responseText,
                error: null,
              },
            });
            emit({ type: "commit", data: turnCommit });
            emit({
              type: "completed",
              data: { snapshotId: committed.snapshotId },
            });
            resolve();
          };
        });
      },
      dispose() {},
    };
    const host = createSessionHost({
      session: {
        ...makeSession({ pendingMain: null, pendingFollowups: false }),
        delivery: {
          assets: {},
          data: {
            characterAvatar: "missing-character-asset",
            characterName: "林岚",
          },
        },
      },
      transport,
      policy,
      errors,
      onReport(error) {
        reports.push(error);
      },
    });
    const view = mountChat(host, document);
    try {
      view.area.value = inputText;
      await view.area.dispatchEvent({ type: "input" });
      const submitted = view.send.onclick();
      assert.ok(finishSend, "the send request has started");
      assert.ok(
        view.shadow
          .querySelector(".live")
          .querySelectorAll(".body")
          .some((node) => node.textContent === "林岚收好"),
        "the reply begins streaming before the request completes",
      );
      finishSend();
      await submitted;
      await waitFor(
        () =>
          view.history.children
            .flatMap((row) => row.children)
            .some(
              (article) =>
                article.tagName === "ARTICLE" &&
                article.querySelector("p")?.textContent === responseText,
            ),
        "the completed reply did not remain in the visible history",
      );
      const reply = view.history.children
        .flatMap((row) => row.children)
        .find(
          (article) =>
            article.tagName === "ARTICLE" &&
            article.querySelector("p")?.textContent === responseText,
        );
      assert.ok(reply);
      assert.equal(reply.querySelector("img"), null);
      assert.equal(reply.querySelector(".name")?.textContent, "林岚");
      assert.equal(view.failure.textContent, "");
      assert.deepEqual(reports, []);
    } finally {
      view.mounted.destroy();
    }
  }

  async function savedBodyWithoutVariableCommit(document) {
    const floorId = "body-state-failed";
    const input = "继续沿着走廊调查。";
    const text = "林岚在窗边停下，查看登记册。";
    const reports = [];
    const host = createSessionHost({
      session: makeSession({
        pendingMain: { floorId, input, text },
        pendingFollowups: false,
      }),
      transport: {
        subscribeState: () => () => {},
        listFloors: async () => ({
          items: [{ floorId, floorNo: 2, state: "committed" }],
          nextCursor: null,
        }),
        getMessages: async (query) => {
          assert.equal(query.floorId, floorId);
          return [
            message("user", input, floorId),
            message("assistant", text, floorId),
          ];
        },
        getSnapshot: async () => {
          throw new Error(
            "conversation history must not read variable snapshots",
          );
        },
        dispose() {},
      },
      policy,
      errors,
      onReport: (error) => reports.push(error),
    });
    const view = mountChat(host, document);
    try {
      await waitFor(
        () => view.history.children.some((row) => row.children.length === 2),
        "saved body without state was omitted",
      );
      const articles = view.history.children.flatMap((row) => row.children);
      assert.deepEqual(
        articles.map((item) => item.querySelector("p").textContent),
        [input, text],
      );
      assert.equal(host.get("current").snapshotId, initial.snapshotId);
      assert.equal(
        view.pendingText.hidden,
        true,
        "persisted reply is not duplicated in the temporary area",
      );
      assert.equal(view.shadow.querySelector(".pending-user").hidden, true);
      assert.equal(
        view.retryState.hidden,
        false,
        "state retry remains available independently of message history",
      );
      assert.ok(
        articles.every((item) => item.querySelector("button") === null),
        "conversation items do not masquerade as variable history entries",
      );
      assert.deepEqual(reports, []);
    } finally {
      view.mounted.destroy();
    }
  }

  async function manualHistoryPaging(document) {
    const queries = [];
    let failPage = true;
    let oldText = "f1",
      oldDeleted = false;
    const reports = [];
    const transport = {
      subscribeState: () => () => {},
      reconcile: async () => ({ current: initial, busy: false }),
      loadSession: async () =>
        makeSession({ pendingMain: null, pendingFollowups: false }),
      listFloors: async (query) => {
        queries.push(query);
        if (!query.cursor)
          return {
            items: [{ floorId: "f2", floorNo: 2, state: "committed" }],
            nextCursor: "before-2",
          };
        if (failPage)
          throw Object.assign(new Error("分页网络错误，请重试。"), {
            code: "NETWORK_ERROR",
          });
        return {
          ...(oldDeleted
            ? { items: [], nextCursor: null }
            : {
                items: [{ floorId: "f1", floorNo: 1, state: "committed" }],
                nextCursor: null,
              }),
        };
      },
      getMessages: async ({ floorId }) => [
        message("assistant", floorId === "f1" ? oldText : floorId, floorId),
      ],
      dispose() {},
    };
    const host = createSessionHost({
      session: makeSession({ pendingMain: null, pendingFollowups: false }),
      transport,
      policy,
      errors,
      onReport: (error) => reports.push(error),
    });
    const view = mountChat(host, document);
    const older = view.shadow.querySelector(".older-messages");
    const failure = view.shadow.querySelector(".history-error");
    try {
      await waitFor(
        () => !older.disabled && queries.length === 1,
        "first page did not finish",
      );
      assert.equal(
        older.hidden,
        false,
        "a short page retains an explicit load action",
      );
      await older.onclick();
      assert.equal(failure.hidden, false);
      assert.equal(older.textContent, "重新读取");
      failPage = false;
      await older.onclick();
      assert.equal(failure.hidden, true);
      assert.equal(older.hidden, true);
      assert.deepEqual(
        queries.map((query) => query.cursor),
        [undefined, "before-2", "before-2"],
      );
      assert.equal(reports.length, 1);
      const firstRow = view.history.children[0];
      await host.reconcile();
      assert.equal(
        view.history.children.length,
        2,
        "refresh retains explicitly loaded older floors",
      );
      assert.equal(
        view.history.children[0],
        firstRow,
        "unchanged history retains focused DOM controls",
      );
      oldText = "CHANGED";
      await host.reconcile();
      assert.equal(
        view.history.children[0].querySelector("p").textContent,
        "CHANGED",
        "refresh rereads already loaded older messages",
      );
      oldDeleted = true;
      await host.reconcile();
      assert.equal(
        view.history.children.length,
        1,
        "refresh removes a deleted older loaded floor",
      );
    } finally {
      view.mounted.destroy();
    }
  }

  const originalDocument = globalThis.document;
  const document = new FakeDocument();
  globalThis.document = document;
  try {
    const responses = [],
      reports = [],
      page = {
        items: [{ floorId: "owned", floorNo: 1, state: "committed" }],
        nextCursor: "older",
      };
    const widget = mountChatWidget(document.createElement("main"), {
      session: makeSession({ pendingMain: null, pendingFollowups: false }),
      state: () => ({
        busy: false,
        stopping: false,
        unknown: false,
        draft: "",
        pendingInput: null,
        pendingMain: null,
        editing: false,
        notice: "",
      }),
      subscribe: () => () => {},
      onText: () => () => {},
      listFloors: async () => (responses.length ? responses.shift() : page),
      getMessages: async () => [],
      setDraft() {},
      setEditing() {},
      send: async () => {},
      stop() {},
      reconcile: async () => {},
      retryResponse: async () => {},
      retryState: async () => {},
      report: (error) => reports.push(error),
    });
    await widget.ready;
    let rejectRefresh;
    responses.push(new Promise((_resolve, reject) => (rejectRefresh = reject)));
    const oldRefresh = widget.refresh();
    await widget.refresh();
    rejectRefresh(new Error("stale refresh"));
    await oldRefresh;
    assert.deepEqual(
      reports,
      [],
      "a stale refresh failure must not report against the current page",
    );
    let rejectOlder, resolveLatest;
    responses.push(new Promise((_resolve, reject) => (rejectOlder = reject)));
    const oldOlder = widget.loadNext();
    responses.push(new Promise((resolve) => (resolveLatest = resolve)));
    const latest = widget.refresh();
    rejectOlder(new Error("stale older"));
    await oldOlder;
    assert.deepEqual(reports, []);
    resolveLatest(page);
    await latest;
    let rejectDisposed;
    responses.push(
      new Promise((_resolve, reject) => (rejectDisposed = reject)),
    );
    const disposedOlder = widget.loadNext();
    widget.destroy();
    rejectDisposed(new Error("disposed older"));
    await disposedOlder;
    assert.deepEqual(
      reports,
      [],
      "destroyed widgets do not publish delayed failures",
    );
    const partialText = "PARTIAL OUTPUT";
    const interruptedHost = createSessionHost({
      session: makeSession({ pendingMain: null, pendingFollowups: false }),
      policy,
      errors,
      transport: {
        subscribeState: () => () => {},
        listFloors: async () => ({ items: [], nextCursor: null }),
        loadSession: async () =>
          makeSession({ pendingMain: null, pendingFollowups: false }),
        send: async ({ emit }) => {
          emit({
            type: "text",
            data: {
              sessionId: initial.sessionId,
              branchId: initial.branchId,
              floorId: committed.floorId,
              attemptId: committed.attemptId,
              streamId: "interrupted",
              runId: "interrupted-run",
              jobId: null,
              messageId: null,
              revision: 1,
              type: "snapshot",
              status: "streaming",
              text: partialText,
              error: null,
            },
          });
          throw Object.assign(new Error("stream interrupted"), {
            code: "RESULT_UNKNOWN",
          });
        },
      },
    });
    const interruptedView = mountChat(interruptedHost, document);
    interruptedView.area.value = "继续调查";
    await interruptedView.area.dispatchEvent({ type: "input" });
    await interruptedView.send.onclick();
    assert.equal(
      interruptedView.shadow.querySelector(".live").querySelector(".body")
        ?.textContent,
      partialText,
      "interrupted text remains readable outside saved history",
    );
    assert.equal(interruptedView.history.children.length, 0);
    interruptedView.mounted.destroy();
    let releaseAcceptance;
    const delayedHost = createSessionHost({
      session: makeSession({ pendingMain: null, pendingFollowups: false }),
      policy,
      errors,
      transport: {
        subscribeState: () => () => {},
        listFloors: async () => ({ items: [], nextCursor: null }),
        getMessages: async () => [],
        send: ({ emit }) =>
          new Promise((resolve) => {
            releaseAcceptance = () => {
              emit({ type: "commit", data: turnCommit });
              emit({
                type: "completed",
                data: { snapshotId: committed.snapshotId },
              });
              resolve();
            };
          }),
      },
    });
    const delayedView = mountChat(delayedHost, document);
    delayedView.area.value = "正在发送的消息";
    await delayedView.area.dispatchEvent({ type: "input" });
    const delayedSend = delayedView.send.onclick();
    delayedView.area.value = "等待首个流事件时输入的下一条";
    await delayedView.area.dispatchEvent({ type: "input" });
    releaseAcceptance();
    await delayedSend;
    assert.equal(delayedView.area.value, "等待首个流事件时输入的下一条");
    delayedView.mounted.destroy();
    await immediateActionMessage(document);
    await keyboardImmediateMessage(document);
    await keyboardImmediateMessage(document, { ctrlKey: true });
    await keyboardImmediateMessage(document, { metaKey: true });
    await streamingDisplay(document);
    await savedBodyWithoutVariableCommit(document);
    await manualHistoryPaging(document);
    await mainPendingRecovery(document);
    await failedResponseRecovery(document);
    await committedStateResponseLostRecovery(document);
    await optionalMessagePresentation(document);
    await referencedImagePresentation(document);
    await imageAndAgentLabelsWithoutNames(document);
    await nonImageAvatarReferenceShowsOnlyTextAndName(document);
    await missingImageReferencePreservesCompletedReply(document);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }

  console.log(
    "Session host pending recovery passed: main body/state retry, failed response retry, commit cleanup, and draft preservation",
  );
});
