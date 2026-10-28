import { BoundedCache, mountVirtualList } from "./script-runtime.prototype.js";
import * as schemas from "./script-validators.prototype.js";
const immutable = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
};
export function createSessionHost({
  session,
  transport,
  policy,
  errors,
  onState = () => {},
  onReport = () => {},
}) {
  if (!transport) throw new TypeError("transport is required");
  const cache = new BoundedCache(policy.historyCache),
    settled = new BoundedCache(policy.settledStreamCache),
    diagnostics = new BoundedCache(policy.diagnosticsCache);
  const callbacks = {
    current: new Set(),
    view: new Set(),
    commit: new Set(),
    text: new Set(),
  };
  const active = new Map(),
    lists = new Set(),
    widgets = new Set();
  let current = immutable(session.current),
    view = current,
    following = true,
    busy = false,
    pendingFollowups = Boolean(session.processing?.pendingFollowups),
    pendingMain = session.processing?.pendingMain || null,
    draft = "",
    serial = 0,
    selection = 0,
    stateVersion = 0,
    recoveryVersion = 0;
  const error = (code) =>
    Object.assign(new Error(errors[code] || errors.SCRIPT_FAILED), { code });
  const report = (e) => {
    diagnostics.set(String(++serial), {
      code: e.code || "SCRIPT_FAILED",
      message: e.message,
      snapshotId: current.snapshotId,
      versionId: session.versionId,
    });
    onReport(e);
  };
  const safe = (fn, ...args) => {
    try {
      fn(...args);
    } catch (e) {
      report(e);
    }
  };
  const notify = (key, value) =>
    callbacks[key].forEach((cb) => safe(cb, value));
  const validate = (name, value) => {
    if (!schemas[name](value)) throw error("INVALID_REQUEST");
    return value;
  };
  async function snapshot(id) {
    const key = "snapshot:" + id;
    let value = cache.get(key);
    if (!value) {
      value = immutable(validate("record", await transport.getSnapshot(id)));
      cache.set(key, value);
    }
    return value;
  }
  function apply(record) {
    validate("record", record);
    if (
      record.sessionId !== session.sessionId ||
      record.branchId !== session.branchId
    )
      throw error("IDENTITY_MISMATCH");
    const next = immutable(record);
    if (next.snapshotId !== current.snapshotId) {
      current = next;
      stateVersion++;
      notify("current", current);
    }
    if (following && view.snapshotId !== current.snapshotId) {
      view = current;
      notify("view", view);
    }
    onState({ busy, current, view, following });
  }
  function watch(scope, cb) {
    if (!["current", "view"].includes(scope)) throw error("INVALID_REQUEST");
    callbacks[scope].add(cb);
    safe(cb, scope === "current" ? current : view);
    return () => callbacks[scope].delete(cb);
  }
  function onTextStream(cb, filter = {}) {
    validate("textStreamFilter", filter);
    const match = (e) =>
      (!filter.floorId || e.floorId === filter.floorId) &&
      (!filter.streamId || e.streamId === filter.streamId);
    const listener = (e) => {
      if (match(e)) cb(e);
    };
    callbacks.text.add(listener);
    for (const e of active.values()) safe(listener, { ...e, type: "snapshot" });
    return () => callbacks.text.delete(listener);
  }
  function text(event, versions) {
    validate("textStreamEvent", event);
    if (
      event.sessionId !== session.sessionId ||
      event.branchId !== session.branchId
    )
      throw error("IDENTITY_MISMATCH");
    if (
      versions.has(event.streamId) &&
      versions.get(event.streamId) >= event.revision
    )
      return;
    versions.set(event.streamId, event.revision);
    const e = immutable(event);
    if (e.status === "streaming") active.set(e.streamId, e);
    else {
      active.delete(e.streamId);
      if (!e.messageId) settled.set(e.streamId, e);
    }
    notify("text", e);
    if (e.status !== "streaming" && e.messageId) {
      cache.delete("messages:" + e.floorId);
      for (const list of lists) list.refresh().catch(report);
    }
  }
  async function select(id) {
    validate("historySelectParams", { snapshotId: id });
    const requestId = ++selection;
    const next = await snapshot(id);
    if (requestId !== selection) return { snapshotId: view.snapshotId };
    following = false;
    if (view.snapshotId !== next.snapshotId) {
      view = next;
      notify("view", view);
    }
    onState({ busy, current, view, following });
    return { snapshotId: view.snapshotId };
  }
  async function latest() {
    selection++;
    following = true;
    if (view.snapshotId !== current.snapshotId) {
      view = current;
      notify("view", view);
    }
    onState({ busy, current, view, following });
    return { snapshotId: view.snapshotId };
  }
  function updateWidgets() {
    widgets.forEach((w) => w());
  }
  const send = ({ text: input }, testHeaders = {}, route = "/send") => {
    validate("chatSendParams", { text: input });
    if (busy) return Promise.reject(error("SEND_BUSY"));
    busy = true;
    updateWidgets();
    onState({ busy, current, view, following });
    return new Promise((resolve, reject) => {
      let resolved = false;
      let accepted = false;
      const versions = new Map(),
        commits = new Set();
      (async () => {
        const process = (envelope) => {
          if (!accepted) {
            accepted = true;
            if (route === "/send" && !testHeaders["x-state-update-retry"])
              draft = "";
            updateWidgets();
          }
          const data = envelope.data;
          if (envelope.type === "text") {
            if (!data.jobId && data.status === "completed" && data.text)
              pendingMain = { input, text: data.text };
            text(data, versions);
            updateWidgets();
          } else if (envelope.type === "commit") {
            validate("turnCommit", data);
            if (!commits.has(data.eventId)) {
              commits.add(data.eventId);
              pendingMain = null;
              updateWidgets();
              apply(data.after);
              notify("commit", immutable(data));
              for (const list of lists) list.refresh().catch(report);
            }
          } else if (envelope.type === "current") apply(data);
          else if (envelope.type === "completed") {
            validate("chatSendResult", data);
            resolved = true;
            pendingFollowups = false;
            busy = false;
            updateWidgets();
            onState({ busy, current, view, following });
            resolve(data);
          } else if (envelope.type === "error") throw error(data.code);
          else throw error("INVALID_REQUEST");
        };
        await transport.send({
          text: input,
          current,
          route,
          testHeaders,
          emit: process,
        });
        if (!resolved || [...active.keys()].some((id) => versions.has(id)))
          throw error("RESULT_UNKNOWN");
      })()
        .catch(async (e) => {
          const failure = e.code ? e : error("RESULT_UNKNOWN");
          const preservePendingMain = Boolean(pendingMain);
          if (
            ["STATE_FOLLOWUP_FAILED", "STATE_FOLLOWUPS_PENDING"].includes(
              failure.code,
            )
          )
            pendingFollowups = true;
          for (const [id, event] of active) {
            if (versions.has(id)) {
              const interrupted = immutable({
                ...event,
                type: "snapshot",
                status: "failed",
                error: {
                  code: failure.code,
                  message: failure.message,
                },
              });
              active.delete(id);
              settled.set(id, interrupted);
              notify("text", interrupted);
            }
          }
          {
            try {
              const recoveryId = ++recoveryVersion;
              const stateVersionAtRequest = stateVersion;
              const restored = await transport.loadSession();
              if (
                recoveryId === recoveryVersion &&
                stateVersion === stateVersionAtRequest
              ) {
                if (!preservePendingMain)
                  pendingMain = restored.processing?.pendingMain || null;
                pendingFollowups = Boolean(
                  restored.processing?.pendingFollowups,
                );
                apply(restored.current);
                for (const list of lists) list.refresh().catch(report);
              }
            } catch (syncError) {
              report(syncError);
            }
          }
          if (!resolved) {
            busy = false;
            updateWidgets();
            onState({ busy, current, view, following });
            reject(failure);
          } else report(failure);
        })
        .finally(() => {
          versions.clear();
          commits.clear();
        });
    });
  };
  async function listFloors(params) {
    validate("historyListFloorsParams", params);
    return validate("floorPage", await transport.listFloors(params));
  }
  const host = {
    get: (scope) => (scope === "view" ? view : current),
    watch,
    onTurnCommitted(cb) {
      callbacks.commit.add(cb);
      return () => callbacks.commit.delete(cb);
    },
    onTextStream,
    getSnapshot: snapshot,
    async getFloor(params) {
      validate("variablesGetFloorParams", params);
      const { floorId, ...q } = params;
      return validate(
        "floorVariables",
        await transport.getFloor({ floorId, ...q }),
      );
    },
    async getMessages(params) {
      validate("messagesGetFloorParams", params);
      return immutable(
        validate("messagesGetFloorResult", await transport.getMessages(params)),
      );
    },
    listFloors,
    select,
    latest,
    async setDraft(text) {
      validate("chatSetDraftParams", { text });
      draft = text;
      updateWidgets();
      return null;
    },
    send,
    report,
    diagnostics() {
      return {
        busy,
        chatWidgets: widgets.size,
        activeStreams: active.size,
        listeners: Object.fromEntries(
          Object.entries(callbacks).map(([k, v]) => [k, v.size]),
        ),
        history: { entries: cache.size, bytes: cache.bytes },
        settled: { entries: settled.size, bytes: settled.bytes },
        diagnostics: { entries: diagnostics.size, bytes: diagnostics.bytes },
        lists: [...lists].map((l) => l.diagnostics()),
      };
    },
    mountChat(element) {
      const wrapper = document.createElement("div");
      element.append(wrapper);
      const shadow = wrapper.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>:host{display:block;color:inherit;font:14px/1.65 system-ui}*{box-sizing:border-box}.history{height:300px;overflow:auto;scrollbar-color:#667c7e #12242b}.message{display:grid;grid-template-columns:40px 1fr;gap:12px;padding:15px 4px;border-bottom:1px solid #ffffff20}.avatar{width:40px;height:40px;object-fit:cover;object-position:top;background:#526b6d;border-radius:10px;position:sticky;top:8px}.name{color:#d0bb8f;font-size:12px}p{white-space:pre-wrap;margin:6px 0}.actions{display:flex;justify-content:flex-end}button{cursor:pointer;background:#ffffff0a;border:1px solid #ffffff30;color:inherit;padding:8px 13px;border-radius:5px}button:disabled{opacity:.4;cursor:default}textarea{font:inherit;background:#162c33;color:#edf4ef;border:1px solid #ffffff30;border-radius:6px;width:100%;min-height:75px;padding:10px;resize:vertical}.compose{padding-top:12px}.compose footer{display:flex;align-items:center;justify-content:space-between;margin-top:8px}.error{color:#ffb7b1}.live{padding:8px 0}.live:empty{display:none}</style><div class="history" aria-label="对话记录"></div><div class="live" aria-live="polite"></div><div class="compose"><label>发送消息<textarea placeholder="输入消息"></textarea></label><p class="error" role="alert"></p><footer><small>Ctrl / ⌘ + Enter 发送</small><button class="retry-state" hidden></button><button class="retry-followups" hidden></button><button class="send">发送消息</button></footer></div>`;
      const area = shadow.querySelector("textarea"),
        button = shadow.querySelector(".send"),
        retry = shadow.querySelector(".retry-followups"),
        retryState = shadow.querySelector(".retry-state"),
        failure = shadow.querySelector(".error"),
        streamContainer = shadow.querySelector(".live"),
        streams = new Map();
      const pendingText = document.createElement("p");
      streamContainer.append(pendingText);
      const renderState = () => {
        pendingText.textContent = pendingMain?.text || "";
        pendingText.hidden = !pendingMain;
        retryState.hidden = !pendingMain;
        retryState.disabled = busy;
        retryState.textContent = "重试变量更新";
        if (area.value !== draft) area.value = draft;
        button.disabled = busy || pendingFollowups || Boolean(pendingMain);
        retry.hidden = !pendingFollowups;
        retry.disabled = busy;
        retry.textContent = "重试后续处理";
        button.textContent = busy ? "正在回复…" : "发送消息";
      };
      widgets.add(renderState);
      renderState();
      area.oninput = () => {
        draft = area.value;
      };
      const submit = async () => {
        if (!draft.trim() || busy || pendingMain || pendingFollowups) return;
        failure.textContent = "";
        try {
          await send({ text: draft });
        } catch (e) {
          failure.textContent = e.message;
        }
      };
      retryState.onclick = async () => {
        failure.textContent = "";
        try {
          await send(
            { text: pendingMain.input },
            { "x-state-update-retry": "true" },
          );
        } catch (e) {
          failure.textContent = e.message;
        }
      };
      retry.onclick = async () => {
        failure.textContent = "";
        try {
          await send({ text: "重试后续处理" }, {}, "/followups/retry");
        } catch (e) {
          failure.textContent = e.message;
        }
      };
      button.onclick = submit;
      area.onkeydown = (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submit();
        }
      };
      const off = onTextStream((e) => {
        let node = streams.get(e.streamId);
        if (!node) {
          node = document.createElement("p");
          streams.set(e.streamId, node);
          streamContainer.append(node);
        }
        node.textContent = e.text;
        if (e.status !== "streaming") {
          node.remove();
          streams.delete(e.streamId);
        }
      });
      const list = mountVirtualList({
        container: shadow.querySelector(".history"),
        followTail: true,
        branchId: session.branchId,
        overscan: policy.overscanFloors,
        listFloors,
        getSnapshot: async (id) => {
          const record = await snapshot(id);
          const key = "messages:" + record.floorId;
          let messages = cache.get(key);
          if (!messages) {
            messages = await transport.getMessages({
              branchId: session.branchId,
              floorId: record.floorId,
              attemptId: record.attemptId,
            });
            cache.set(key, messages);
          }
          return { record, messages };
        },
        render: ({ container, record: bundle }) => {
          for (const message of bundle.messages) {
            const article = document.createElement("article");
            article.className = "message";
            const avatar = document.createElement("img");
            avatar.className = "avatar";
            const user = message.role === "user";
            const assetId =
              session.delivery.data[
                user ? "performerAvatar" : "characterAvatar"
              ];
            avatar.src = session.delivery.assets[assetId].url;
            avatar.alt =
              session.delivery.data[user ? "performerName" : "characterName"];
            const body = document.createElement("div");
            const name = document.createElement("strong");
            name.className = "name";
            name.textContent =
              avatar.alt + (message.role === "agent" ? " · 补充" : "");
            const p = document.createElement("p");
            p.textContent = message.text;
            const actions = document.createElement("div");
            actions.className = "actions";
            const history = document.createElement("button");
            history.textContent = "◷";
            history.title = "查看这一轮的状态";
            history.setAttribute("aria-label", history.title);
            history.onclick = () =>
              select(bundle.record.snapshotId).catch(report);
            actions.append(history);
            body.append(name, p, actions);
            article.append(avatar, body);
            container.append(article);
          }
          return () => container.replaceChildren();
        },
      });
      lists.add(list);
      list.ready.catch(report);
      return {
        destroy() {
          off();
          list.destroy();
          lists.delete(list);
          widgets.delete(renderState);
          streams.clear();
          wrapper.remove();
        },
      };
    },
  };
  return host;
}
