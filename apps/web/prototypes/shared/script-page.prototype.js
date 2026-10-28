import {
  createFormalTransport,
  createRoleCatalogTransport,
} from "./formal-transport.prototype.js";
import { createSessionHost } from "./script-host.prototype.js";
import { createScriptRuntime } from "./script-runtime.prototype.js";
import * as validators from "./script-validators.prototype.js";

const notice = document.querySelector("#notice");
let errors;

function runtimeError(code, backendMessage) {
  const normalized = String(code || "NETWORK_ERROR").toUpperCase();
  return Object.assign(
    new Error(errors?.[code] || errors?.[normalized] || errors?.NETWORK_ERROR),
    { code: normalized, backendMessage },
  );
}

async function readJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, options);
  const body = await response.json();
  if (!response.ok) throw runtimeError(body?.error?.code, body?.error?.message);
  return body;
}

export async function loadRoleCatalog(fetchImpl = globalThis.fetch) {
  const client = createRoleCatalogTransport({
    fetchImpl,
    makeError: runtimeError,
  });
  const [releases, users] = await Promise.all([
    client.listReleases(),
    client.listUsers(),
  ]);
  return { releases, users };
}

export async function createSessionFromRelease(
  { releaseId, userId, openingId },
  fetchImpl = globalThis.fetch,
) {
  return createRoleCatalogTransport({
    fetchImpl,
    makeError: runtimeError,
  }).createSession({ releaseId, userId, openingId });
}

function profileText(snapshot) {
  return [snapshot?.description, snapshot?.personality, snapshot?.scenario]
    .filter((item) => typeof item === "string" && item.trim())
    .join("\n\n");
}

function configureReleaseDialog({ releases, users, roleClient, onCreated }) {
  const dialog = document.querySelector("#openingDialog");
  const options = document.querySelector("#openingOptions");
  const startButton = document.querySelector("#openingStart");
  const errorText = document.querySelector("#openingError");
  const characterProfile = document.querySelector("#characterProfile");
  const performer = document.querySelector("#performer");
  const performerProfile = document.querySelector("#performerProfile");
  let selectedRelease = null;

  performer.replaceChildren();
  for (const user of users) performer.add(new Option(user.name, user.id));
  const updatePerformer = () => {
    const user = users.find((item) => item.id === performer.value);
    performerProfile.textContent = user?.snapshot?.description || "";
  };
  performer.onchange = updatePerformer;

  async function open(releaseId) {
    errorText.textContent = "";
    selectedRelease = await roleClient.getRelease(releaseId);
    document.querySelector("#openingTitle").textContent =
      `开始与${selectedRelease.character_snapshot.name}的演绎`;
    characterProfile.textContent = profileText(
      selectedRelease.character_snapshot,
    );
    options.replaceChildren();
    for (const opening of selectedRelease.openings) {
      const label = document.createElement("label");
      label.className = "opening-option";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "opening";
      radio.value = opening.id;
      radio.checked = opening.default;
      label.append(
        radio,
        document.createTextNode(
          opening.title +
            (opening.kind === "introduction"
              ? " · 介绍"
              : opening.default
                ? " · 默认开场"
                : ""),
        ),
      );
      const summary = document.createElement("p");
      summary.textContent = opening.summary;
      label.append(summary);
      options.append(label);
    }
    const defaultUser = users.find(
      (item) => item.id === selectedRelease.default_user_id,
    );
    if (defaultUser) performer.value = defaultUser.id;
    updatePerformer();
    startButton.disabled = users.length === 0;
    if (users.length === 0)
      errorText.textContent = "请先创建并启用一个演绎人设，再开始会话。";
    dialog.showModal();
  }

  document.querySelector("#openingCancel").onclick = () => dialog.close();
  startButton.onclick = async () => {
    const openingId = options.querySelector("input:checked")?.value;
    if (!selectedRelease || !openingId) {
      errorText.textContent = errors.OPENING_REQUIRED;
      return;
    }
    if (!performer.value) {
      errorText.textContent = "请选择演绎人设后再开始会话。";
      return;
    }
    startButton.disabled = true;
    errorText.textContent = "";
    try {
      const result = await createSessionFromRelease({
        releaseId: selectedRelease.id,
        userId: performer.value,
        openingId,
      });
      onCreated(result.session.id);
    } catch (error) {
      errorText.textContent = error.message;
      startButton.disabled = false;
    }
  };

  return { open, releases };
}

async function mountSession(sessionId, catalog, releaseDialog, policy) {
  const transport = createFormalTransport({
    sessionId,
    makeError: runtimeError,
  });
  const session = await transport.loadSession();
  const selector = document.querySelector("#characters");
  const currentRelease = catalog.releases.find(
    (release) => release.character_id === session.characterId,
  );
  if (currentRelease) selector.value = currentRelease.id;
  const openingButton = document.querySelector("#chooseOpening");
  openingButton.hidden = !currentRelease;
  openingButton.onclick = () =>
    releaseDialog.open(currentRelease.id).catch((error) => {
      notice.textContent = error.message;
    });

  const history = document.querySelector("#history");
  let historyGeneration = 0;
  async function updateHistory() {
    const generation = ++historyGeneration;
    let cursor;
    const entries = [];
    do {
      const page = await host.listFloors({
        branchId: session.branchId,
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      entries.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    if (generation !== historyGeneration) return;
    const selectedValue = history.value;
    history.replaceChildren(new Option("当前状态", "latest"));
    entries.forEach((item, index) =>
      history.add(new Option(`第 ${index + 1} 轮`, item.snapshotId)),
    );
    history.value = [...history.options].some(
      (option) => option.value === selectedValue,
    )
      ? selectedValue
      : "latest";
  }
  const host = createSessionHost({
    session,
    transport,
    policy,
    errors,
    onReport: (error) => {
      notice.textContent = error.message;
    },
    onState: ({ following, view }) => {
      history.value = following ? "latest" : view.snapshotId;
    },
  });
  host.onTurnCommitted(() => updateHistory().catch(host.report));
  history.onchange = () => {
    (history.value === "latest"
      ? host.latest()
      : host.select(history.value)
    ).catch(host.report);
  };
  const runtime = createScriptRuntime({
    root: document.querySelector("#role"),
    delivery: session.delivery,
    host,
    policy,
    errors,
    validate: (name, value) => validators[name]?.(value) === true,
  });
  await runtime.mount();
  await updateHistory();
  document.title = `${session.name} · Tavern`;
  globalThis.scriptPrototype = {
    runtime,
    host,
    session,
    transport,
    ready: true,
    documentId: crypto.randomUUID(),
  };
}

async function start() {
  errors = await readJson(
    "/prototype/apps/web/prototypes/shared/card-errors.json",
  );
  const policy = await readJson(
    "/prototype/docs/character-authoring/runtime-resource-policy.json",
  );
  const catalog = await loadRoleCatalog();
  const roleClient = createRoleCatalogTransport({ makeError: runtimeError });
  const selector = document.querySelector("#characters");
  selector.replaceChildren(new Option("选择发布角色", ""));
  for (const release of catalog.releases) {
    selector.add(
      new Option(release.character_snapshot.name || release.name, release.id),
    );
  }
  const navigateToSession = (sessionId) => {
    const url = new URL(location.href);
    url.searchParams.set("session", sessionId);
    location.assign(url.href);
  };
  const sessionsDialog = document.querySelector("#sessionsDialog");
  const sessionsItems = document.querySelector("#sessionsItems");
  const sessionsError = document.querySelector("#sessionsError");
  let sessionsGeneration = 0;
  async function refreshSessions() {
    const generation = ++sessionsGeneration;
    sessionsItems.textContent = "正在读取演绎记录…";
    sessionsError.textContent = "";
    try {
      const items = await roleClient.listSessions(document.querySelector("#sessionsStatus").value);
      if (generation !== sessionsGeneration) return;
      sessionsItems.replaceChildren();
      if (!items.length) sessionsItems.textContent = "暂无演绎记录。";
      for (const item of items) {
        const button = document.createElement("button");
        button.className = "opening-option";
        button.style.textAlign = "left";
        const title = document.createElement("strong");
        title.textContent = item.title || item.character_binding?.snapshot_summary?.name || item.id;
        const details = document.createElement("p");
        const persona = item.user_binding?.snapshot_summary?.name;
        details.textContent = `${persona ? `演绎人设：${persona} · ` : ""}${item.status === "archived" ? "已归档" : "进行中"} · 更新于：${new Date(item.updated_at).toLocaleString()}`;
        button.append(title, details);
        button.onclick = () => navigateToSession(item.id);
        sessionsItems.append(button);
      }
    } catch (error) {
      if (generation !== sessionsGeneration) return;
      sessionsItems.replaceChildren();
      sessionsError.textContent = error.message;
    }
  }
  document.querySelector("#mySessions").onclick = () => { sessionsDialog.showModal(); refreshSessions(); };
  document.querySelector("#sessionsStatus").onchange = refreshSessions;
  document.querySelector("#sessionsRefresh").onclick = refreshSessions;
  document.querySelector("#sessionsClose").onclick = () => sessionsDialog.close();
  const releaseDialog = configureReleaseDialog({
    ...catalog,
    roleClient,
    onCreated: navigateToSession,
  });
  selector.onchange = () => {
    if (!selector.value) return;
    releaseDialog.open(selector.value).catch((error) => {
      notice.textContent = error.message;
    });
  };
  const sessionId = new URLSearchParams(location.search).get("session");
  if (sessionId) {
    await mountSession(sessionId, catalog, releaseDialog, policy);
    return;
  }
  if (catalog.releases.length > 0) {
    selector.value = catalog.releases[0].id;
    await releaseDialog.open(selector.value);
  } else {
    notice.textContent = "当前没有已发布角色。请在管理端发布角色后重试。";
  }
  globalThis.scriptPrototype = { ready: true, session: null };
}

start().catch((error) => {
  notice.textContent = error.message;
  globalThis.scriptPrototype = { ready: false, error: error.message };
});
