let cardSchema;
let cardTimer = null;
let cardAudio = null;
let cardActiveSession = null;
const cardFrames = (s) =>
  userVisibleMessages(s)
    .filter(
      (m) =>
        m.role === "assistant" &&
        (m.opening ||
          s.rounds.find((f) => f.id === m.floorId)?.state === "committed"),
    )
    .flatMap((m) =>
      messageDisplay(s, m)
        .text.split(/\n\s*\n/)
        .filter(Boolean)
        .map((text, i) => ({ id: m.id + ":" + i, text })),
    );
function cardContext(s, item) {
  const records = s.cardRecords;
  const current = records.at(-1);
  const view = records.find((r) => r.snapshotId === s.cardViewId) || current;
  const frames = cardFrames(s);
  s.cardReading = Math.max(0, Math.min(s.cardReading || 0, frames.length - 1));
  return {
    view: view.variables,
    current: current.variables,
    ui: s.cardUi,
    item,
    read: {
      text: frames[s.cardReading]?.text || "",
      index: s.cardReading,
      count: frames.length,
      auto: !!s.cardAuto,
      music: !!cardAudio && !cardAudio.paused,
    },
  };
}
function cardAllowed(s, a, ctx) {
  if (!CardContract.condition(a.when, ctx)) return false;
  if (a.type.startsWith("chat."))
    return !s.running && !s.failed && s.status === "active";
  if (a.type === "history.prev")
    return (
      (s.cardViewId
        ? s.cardRecords.findIndex((r) => r.snapshotId === s.cardViewId)
        : s.cardRecords.length - 1) > 0
    );
  if (a.type === "history.latest") return !!s.cardViewId;
  if (a.type === "reading.prev") return ctx.read.index > 0;
  if (["reading.next", "reading.latest", "reading.auto"].includes(a.type))
    return ctx.read.index < ctx.read.count - 1;
  return true;
}
async function cardAction(s, id) {
  const a = s.cardPackage.actions[id],
    ctx = cardContext(s);
  if (!a || !cardAllowed(s, a, ctx)) return;
  if (a.type === "ui.toggle") s.cardUi[a.target] = !s.cardUi[a.target];
  if (a.type === "history.prev") {
    const i = s.cardViewId
      ? s.cardRecords.findIndex((r) => r.snapshotId === s.cardViewId)
      : s.cardRecords.length - 1;
    s.cardViewId = s.cardRecords[i - 1].snapshotId;
  }
  if (a.type === "history.latest") s.cardViewId = null;
  if (a.type === "reading.prev") {
    s.cardReading--;
    s.cardAuto = null;
  }
  if (a.type === "reading.next") s.cardReading++;
  if (a.type === "reading.latest") {
    s.cardReading = ctx.read.count - 1;
    s.cardAuto = null;
  }
  if (a.type === "reading.auto") s.cardAuto = s.cardAuto ? null : a.intervalMs;
  if (a.type === "chat.fill") s.input = String(CardContract.value(a.text, ctx));
  if (a.type === "chat.send") {
    const input = s.input;
    s.input = String(CardContract.value(a.text, ctx));
    s.cardPendingAction = id;
    send(s);
    s.input = input;
    render();
    return;
  }
  if (a.type === "audio.toggle") {
    if (cardAudio?.datasetAsset !== a.asset) {
      cardAudio?.pause();
      cardAudio = new Audio(roleAsset(s.cardPackage.assets[a.asset].file));
      cardAudio.datasetAsset = a.asset;
      cardAudio.loop = true;
    }
    try {
      if (cardAudio.paused) await cardAudio.play();
      else cardAudio.pause();
    } catch {
      notify(CardErrors.AUDIO_FAILED);
    }
  }
  render();
}
function renderCardPackage(s, messages, composer) {
  clearTimeout(cardTimer);
  if (cardActiveSession !== s.id) {
    cardAudio?.pause();
    cardAudio = null;
    if (cardActiveSession) {
      const old = sessions.find((x) => x.id === cardActiveSession);
      if (old) old.cardAuto = null;
    }
    cardActiveSession = s.id;
  }
  document.body.classList.add("role-stage-mode");
  const pkg = s.cardPackage;
  const host = document.createElement("section");
  host.className = "card-package-host";
  host.style.cssText = "height:calc(100vh - 118px);overflow:auto;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = ":host{display:block}" + pkg.css;
  shadow.append(style);
  function build(n, item) {
    const ctx = cardContext(s, item);
    const el = document.createElement(
      {
        box: "div",
        text: "div",
        image: "img",
        meter: "progress",
        button: "button",
        repeat: "div",
        slot: "slot",
      }[n.type],
    );
    el.dataset.node = n.id;
    el.className = n.class || "";
    el.hidden = !CardContract.condition(n.when, ctx);
    for (const [cls, c] of Object.entries(n.classWhen || {}))
      el.classList.toggle(cls, CardContract.condition(c, ctx));
    if (n.type === "slot") el.name = n.name;
    const v = n.value ? CardContract.value(n.value, ctx) : null;
    if (["text", "button"].includes(n.type)) el.textContent = String(v);
    if (n.type === "image") {
      if (!pkg.assets[v]) throw Error("图片资源未声明：" + v);
      el.src = roleAsset(pkg.assets[v].file);
      el.alt = n.alt || "";
    }
    if (n.type === "meter") {
      el.max = n.max - n.min;
      el.value = Math.max(0, Math.min(n.max, Number(v)) - n.min);
    }
    if (n.type === "button") {
      el.disabled = !cardAllowed(s, pkg.actions[n.action], ctx);
      el.onclick = () => cardAction(s, n.action);
    }
    if (n.type === "repeat") {
      if (!Array.isArray(v)) throw Error("列表字段必须为数组：" + n.id);
      v.forEach((member) =>
        (n.children || []).forEach((c) => el.append(build(c, member))),
      );
    } else (n.children || []).forEach((c) => el.append(build(c, item)));
    return el;
  }
  shadow.append(build(pkg.tree));
  messages.slot = "history";
  composer.slot = "composer";
  host.append(messages, composer);
  $("mainView").append(host);
  const frames = cardFrames(s);
  if (s.cardReading >= frames.length - 1) s.cardAuto = null;
  if (s.cardAuto)
    cardTimer = setTimeout(() => {
      s.cardReading++;
      if (getSession() === s) render();
    }, s.cardAuto);
}
const generateBeforeCardPackage = generate;
generate = async (s, target, resume = false) => {
  if (!s.cardPackage) return generateBeforeCardPackage(s, target, resume);
  if (s.running || s.status !== "active") return;
  const f = target || s.rounds.at(-1);
  const a = {
    id: "run-" + nextId++,
    attempt_no: f.attempts.length + 1,
    started_at: Date.now(),
    ended_at: null,
    state: "running",
    error: null,
  };
  f.attempts.push(a);
  s.running = true;
  s.failed = false;
  f.state = "generating";
  const actionId = s.cardPendingAction;
  delete s.cardPendingAction;
  render();
  try {
    const response = await fetch("/prototype-runtime/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: s.id,
        branchId: s.activeBranch,
        floorId: f.id,
        attemptId: a.id,
        cardId: s.backendCharacter,
        versionId: s.backendVersion,
        expectedSnapshotId: s.cardRecords.at(-1).snapshotId,
        ...(actionId ? { actionId } : { text: f.input }),
      }),
    });
    const body = await response.json();
    if (!response.ok) throw Error(body.error.message);
    const record = body.data;
    const issue =
      CardContract.check(record, cardSchema.definitions.commit, cardSchema) ||
      CardContract.variables(s.cardPackage, record.variables);
    if (issue) throw Error(CardContract.explain(issue));
    if (
      record.versionId !== s.backendVersion ||
      record.floorId !== f.id ||
      record.attemptId !== a.id ||
      record.sessionId !== s.id ||
      record.branchId !== s.activeBranch
    )
      throw Error(CardErrors.IDENTITY_MISMATCH);
    f.input = record.input;
    const inputMessage = s.messages.find(
      (m) => m.floorId === f.id && m.role === "user",
    );
    if (inputMessage) inputMessage.text = record.input;
    s.cardRecords.push(clone(record));
    a.state = "completed";
    a.ended_at = Date.now();
    f.state = "committed";
    const m = {
      id: "message-" + nextId++,
      role: "assistant",
      text: record.text,
      floorId: f.id,
      branchId: s.activeBranch,
      at: Date.now(),
      source: "Local",
    };
    s.messages.push(m);
    f.result = {
      floor_id: f.id,
      assistant_message_id: m.id,
      generated_text: m.text,
      committed_at: Date.now(),
      usage: null,
    };
    f.debug.variables = Object.entries(record.variables).map(
      ([key, value]) => ({ key, value, scope: "local" }),
    );
    updateGenerationResponses(f, a);
  } catch (error) {
    a.state = "failed";
    a.ended_at = Date.now();
    a.error = { code: "display_commit_failed", message: error.message };
    f.state = "failed";
    s.failed = true;
    notify(error.message);
  } finally {
    s.running = false;
    if (getSession() === s) render();
  }
};
window.addEventListener("pagehide", () => {
  clearTimeout(cardTimer);
  cardAudio?.pause();
});

const renderBeforeCardLifecycle = render;
render = () => {
  const s = getSession();
  if (userHome || !s?.cardPackage || s.id !== cardActiveSession) {
    clearTimeout(cardTimer);
    cardAudio?.pause();
    cardAudio = null;
    const old = sessions.find((x) => x.id === cardActiveSession);
    if (old) old.cardAuto = null;
    cardActiveSession = null;
  }
  renderBeforeCardLifecycle();
};
