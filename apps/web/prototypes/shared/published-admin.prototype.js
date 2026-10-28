const JSON_HEADERS = Object.freeze({ "Content-Type": "application/json" });
const MODEL_SLOTS = Object.freeze([
  "*",
  "narrator",
  "director",
  "verifier",
  "memory",
]);
const MODEL_SLOT_LABELS = Object.freeze({
  "*": "默认模型",
  narrator: "演绎角色",
  director: "导演",
  verifier: "校验",
  memory: "记忆",
});
const PROMPT_MODE_LABELS = Object.freeze({
  compat_strict: "严格兼容",
  compat_plus: "增强兼容",
  native: "原生模式",
});

function normalizeErrorCode(code) {
  return String(code || "NETWORK_ERROR").toUpperCase();
}

function mappedError(errorMessages, code, backendMessage) {
  const normalized = normalizeErrorCode(code);
  return Object.assign(
    new Error(errorMessages?.[normalized] || errorMessages?.NETWORK_ERROR),
    { code: normalized, backendMessage },
  );
}

function unwrap(body) {
  return body && typeof body === "object" && "data" in body ? body.data : body;
}

function requiredString(value, field = "必填配置") {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new TypeError("A required value is missing"), {
      code: "PUBLISH_FIELD_REQUIRED",
      field,
    });
  }
  return value.trim();
}

function optionalObjectJson(value, field) {
  const source = String(value ?? "").trim();
  if (!source) return null;
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw Object.assign(new TypeError("Model parameters must be JSON"), {
      code: "PUBLISH_PARAMS_JSON_INVALID",
      field,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new TypeError("Model parameters must be an object"), {
      code: "PUBLISH_PARAMS_OBJECT_REQUIRED",
      field,
    });
  }
  return parsed;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function sortVersions(versions) {
  return [...versions].sort(
    (left, right) =>
      (left.version_no ?? left.version ?? 0) -
      (right.version_no ?? right.version ?? 0),
  );
}

function latestVersionId(resource) {
  return resource?.versions?.at(-1)?.id || "";
}

function selectedResource(resources, id) {
  return resources.find((resource) => resource.id === id) || null;
}

export function isPublishedBackendMode(
  locationLike = globalThis.location,
  documentLike = globalThis.document,
) {
  const source = new URLSearchParams(locationLike?.search || "").get("source");
  return (
    source === "backend" ||
    documentLike?.documentElement?.dataset?.backendMode === "published" ||
    documentLike?.body?.dataset?.backendMode === "published"
  );
}

export function createPublishedAdminClient({
  fetchImpl = globalThis.fetch,
  errorMessages = {},
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  async function request(url, options, full = false) {
    let response;
    try {
      response = await fetchImpl(url, options);
    } catch (error) {
      throw mappedError(errorMessages, "NETWORK_ERROR", error?.message);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw mappedError(errorMessages, "NETWORK_ERROR");
    }
    if (!response.ok) {
      throw mappedError(errorMessages, body?.error?.code, body?.error?.message);
    }
    return full ? body : unwrap(body);
  }

  async function listPages(path) {
    const items = [];
    let offset = 0;
    while (true) {
      const separator = path.includes("?") ? "&" : "?";
      const page = await request(
        `${path}${separator}limit=100&offset=${offset}`,
        undefined,
        true,
      );
      items.push(...page.data);
      if (!page.meta?.has_more) return items;
      if (page.data.length === 0) {
        throw mappedError(errorMessages, "NETWORK_ERROR");
      }
      offset += page.data.length;
    }
  }

  return {
    listCharacters: () =>
      listPages("/characters?status=active&sort_by=name&sort_order=asc"),
    listCharacterVersions: (id) =>
      listPages(
        `/characters/${encodeURIComponent(id)}/versions?sort_by=version_no&sort_order=asc`,
      ),
    listPresets: () => request("/presets"),
    getPreset: (id) => request(`/presets/${encodeURIComponent(id)}`),
    listPresetVersions: (id) =>
      request(`/presets/${encodeURIComponent(id)}/versions`),
    listRegexProfiles: () => request("/regex-profiles"),
    listRegexProfileVersions: (id) =>
      request(`/regex-profiles/${encodeURIComponent(id)}/versions`),
    listWorldbooks: () => request("/worldbooks"),
    listWorldbookVersions: (id) =>
      request(`/worldbooks/${encodeURIComponent(id)}/versions`),
    listUsers: () =>
      listPages("/users?status=active&sort_by=name&sort_order=asc"),
    listProfiles: () => request("/llm-profiles?status=active"),
    listReleases: () => request("/role-releases"),
    listSessions: (status = "") =>
      listPages(
        `/sessions?sort_by=updated_at&sort_order=desc${status ? `&status=${encodeURIComponent(status)}` : ""}`,
      ),
    publish(payload) {
      return request("/role-releases", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      });
    },
    createTrial({ releaseId, userId, openingId }) {
      return request(
        `/role-releases/${encodeURIComponent(releaseId)}/sessions`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            user_id: userId,
            ...(openingId ? { opening_id: openingId } : {}),
          }),
        },
      );
    },
  };
}

async function attachVersions(resources, loader) {
  return Promise.all(
    resources.map(async (resource) => ({
      ...resource,
      versions: sortVersions(await loader(resource.id)),
    })),
  );
}

async function attachPresetDetails(resources, client) {
  return Promise.all(
    resources.map(async (resource) => ({
      ...resource,
      detail: await client.getPreset(resource.id),
    })),
  );
}

export async function loadPublishedAdminCatalog(client) {
  const [
    characters,
    presets,
    regexProfiles,
    worldbooks,
    users,
    profiles,
    releases,
  ] = await Promise.all([
    client.listCharacters(),
    client.listPresets(),
    client.listRegexProfiles(),
    client.listWorldbooks(),
    client.listUsers(),
    client.listProfiles(),
    client.listReleases(),
  ]);

  const [
    versionedCharacters,
    versionedPresets,
    versionedRegex,
    versionedWorldbooks,
  ] = await Promise.all([
    attachVersions(characters, client.listCharacterVersions),
    attachVersions(
      await attachPresetDetails(presets, client),
      client.listPresetVersions,
    ),
    attachVersions(regexProfiles, client.listRegexProfileVersions),
    attachVersions(worldbooks, client.listWorldbookVersions),
  ]);

  return {
    characters: versionedCharacters,
    presets: versionedPresets,
    regexProfiles: versionedRegex,
    worldbooks: versionedWorldbooks,
    users,
    profiles,
    releases,
  };
}

export function createPublishedAdminDraft(catalog, previous = {}) {
  if (!previous.slots) {
    const selectedId = previous.characterId || catalog.characters[0]?.id;
    const release = catalog.releases.find(
      (item) => item.character_id === selectedId,
    );
    if (release)
      previous = {
        name: release.name,
        characterId: release.character_id,
        characterVersionId: release.character_version_id,
        presetId: release.preset_id,
        presetVersionId: release.preset_version_id,
        regexProfileId: release.regex_profile_id,
        regexProfileVersionId: release.regex_profile_version_id,
        worldbookId: release.worldbook_id || "",
        worldbookVersionId: release.worldbook_version_id || "",
        defaultUserId: release.default_user_id,
        promptMode: release.prompt_mode,
        slots: Object.fromEntries(
          MODEL_SLOTS.map((slot) => {
            const binding = release.model_slots.find(
              (item) => item.slot === slot,
            );
            return [
              slot,
              {
                enabled: Boolean(binding),
                profileId: binding?.profile_id || "",
                paramsText: binding?.params
                  ? JSON.stringify(binding.params, null, 2)
                  : "",
              },
            ];
          }),
        ),
      };
  }

  const characterId =
    selectedResource(catalog.characters, previous.characterId)?.id ||
    catalog.characters[0]?.id ||
    "";
  const presetId =
    selectedResource(catalog.presets, previous.presetId)?.id ||
    catalog.presets[0]?.id ||
    "";
  const regexProfileId =
    selectedResource(catalog.regexProfiles, previous.regexProfileId)?.id ||
    catalog.regexProfiles[0]?.id ||
    "";
  const worldbookId =
    selectedResource(catalog.worldbooks, previous.worldbookId)?.id || "";
  const profileId =
    catalog.profiles.find(
      (profile) => profile.id === previous.slots?.narrator?.profileId,
    )?.id ||
    catalog.profiles[0]?.id ||
    "";
  const selectedCharacter = selectedResource(catalog.characters, characterId);
  const selectedPreset = selectedResource(catalog.presets, presetId);
  const presetOutputTokens = selectedPreset?.detail?.data?.openai_max_tokens;
  const narratorDefaults = {
    reasoning_effort: "none",
    ...(Number.isInteger(presetOutputTokens) && presetOutputTokens > 0
      ? { max_output_tokens: presetOutputTokens }
      : {}),
  };

  return {
    name:
      previous.name ||
      selectedCharacter?.name ||
      selectedCharacter?.snapshot?.name ||
      "",
    characterId,
    characterVersionId: selectedCharacter?.versions.some(
      (version) => version.id === previous.characterVersionId,
    )
      ? previous.characterVersionId
      : latestVersionId(selectedCharacter),
    presetId,
    presetVersionId: selectedResource(catalog.presets, presetId)?.versions.some(
      (version) => version.id === previous.presetVersionId,
    )
      ? previous.presetVersionId
      : latestVersionId(selectedResource(catalog.presets, presetId)),
    regexProfileId,
    regexProfileVersionId: selectedResource(
      catalog.regexProfiles,
      regexProfileId,
    )?.versions.some((version) => version.id === previous.regexProfileVersionId)
      ? previous.regexProfileVersionId
      : latestVersionId(
          selectedResource(catalog.regexProfiles, regexProfileId),
        ),
    worldbookId,
    worldbookVersionId: worldbookId
      ? selectedResource(catalog.worldbooks, worldbookId)?.versions.some(
          (version) => version.id === previous.worldbookVersionId,
        )
        ? previous.worldbookVersionId
        : latestVersionId(selectedResource(catalog.worldbooks, worldbookId))
      : "",
    defaultUserId:
      catalog.users.find((user) => user.id === previous.defaultUserId)?.id ||
      catalog.users[0]?.id ||
      "",
    promptMode: previous.promptMode || "compat_strict",
    slots: Object.fromEntries(
      MODEL_SLOTS.map((slot) => [
        slot,
        {
          enabled: previous.slots?.[slot]?.enabled ?? slot === "narrator",
          profileId:
            catalog.profiles.find(
              (profile) => profile.id === previous.slots?.[slot]?.profileId,
            )?.id || profileId,
          paramsText:
            previous.slots?.[slot]?.paramsText ??
            (slot === "narrator"
              ? JSON.stringify(narratorDefaults, null, 2)
              : ""),
        },
      ]),
    ),
  };
}

export function buildRoleReleasePayload(draft) {
  const modelSlots = MODEL_SLOTS.filter(
    (slot) => draft.slots?.[slot]?.enabled,
  ).map((slot) => ({
    slot,
    profile_id: requiredString(
      draft.slots[slot].profileId,
      `${MODEL_SLOT_LABELS[slot]}模型配置`,
    ),
    params: optionalObjectJson(
      draft.slots[slot].paramsText,
      `${MODEL_SLOT_LABELS[slot] || slot} 槽位`,
    ),
  }));
  if (modelSlots.length === 0) {
    throw Object.assign(new TypeError("At least one model slot is required"), {
      code: "PUBLISH_SLOT_REQUIRED",
    });
  }

  const worldbookId = String(draft.worldbookId || "").trim();
  return {
    name: requiredString(draft.name, "发布名称"),
    character_id: requiredString(draft.characterId, "角色"),
    character_version_id: requiredString(draft.characterVersionId, "角色版本"),
    preset_id: requiredString(draft.presetId, "提示词预设"),
    preset_version_id: requiredString(draft.presetVersionId, "预设版本"),
    regex_profile_id: requiredString(draft.regexProfileId, "正则配置"),
    regex_profile_version_id: requiredString(
      draft.regexProfileVersionId,
      "正则版本",
    ),
    worldbook_id: worldbookId || null,
    worldbook_version_id: worldbookId
      ? requiredString(draft.worldbookVersionId, "世界书版本")
      : null,
    prompt_mode: requiredString(draft.promptMode, "提示词模式"),
    model_slots: modelSlots,
    default_user_id: requiredString(draft.defaultUserId, "默认演绎人设"),
  };
}

export function publishedTrialUrl(
  sessionId,
  locationLike = globalThis.location,
) {
  const url = new URL(
    "/prototype/apps/user-web/prototypes/script-roleplay.prototype.html",
    locationLike.origin,
  );
  url.searchParams.set("source", "backend");
  url.searchParams.set("session", requiredString(sessionId));
  return url.href;
}

function optionList(items, selectedId, label) {
  return items
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}" ${item.id === selectedId ? "selected" : ""}>${escapeHtml(label(item))}</option>`,
    )
    .join("");
}

function resourceFields({ key, label, resources, draft, optional = false }) {
  const idKey = `${key}Id`;
  const versionKey = `${key}VersionId`;
  const resource = selectedResource(resources, draft[idKey]);
  return `<div class="binding"><label class="field">${escapeHtml(label)}<select name="${idKey}" data-published-resource="${key}">${optional ? '<option value="">不使用</option>' : ""}${optionList(resources, draft[idKey], (item) => item.name)}</select></label><label class="field">${escapeHtml(label)}版本<select name="${versionKey}">${optionList(resource?.versions || [], draft[versionKey], (version) => `v${version.version_no ?? version.version ?? "?"} · ${version.id}`)}</select></label></div>`;
}

function slotFields(slot, draft, profiles) {
  const state = draft.slots[slot];
  return `<details class="version" ${state.enabled ? "open" : ""}><summary>${escapeHtml(MODEL_SLOT_LABELS[slot])}</summary><label class="field"><span><input type="checkbox" name="slot_${slot}_enabled" ${state.enabled ? "checked" : ""}> 启用</span></label><label class="field">模型配置<select name="slot_${slot}_profile">${optionList(profiles, state.profileId, (profile) => `${profile.preset_name} · ${profile.model_id}`)}</select></label><label class="field">参数 JSON<textarea name="slot_${slot}_params" rows="4">${escapeHtml(state.paramsText)}</textarea></label></details>`;
}

function releasesHtml(releases) {
  if (releases.length === 0) {
    return '<p class="empty">尚无发布记录。</p>';
  }
  return releases
    .map((release) => {
      const defaultOpening =
        release.openings.find((opening) => opening.default) ||
        release.openings[0];
      return `<div class="version"><div class="row"><strong>${escapeHtml(release.name)}</strong><button type="button" data-published-trial="${escapeHtml(release.id)}" data-published-user="${escapeHtml(release.default_user_id)}" data-published-opening="${escapeHtml(defaultOpening?.id || "")}">用默认人设试聊</button></div><p class="small">${escapeHtml(release.character_snapshot?.name || release.character_id)} · ${escapeHtml(PROMPT_MODE_LABELS[release.prompt_mode] || release.prompt_mode)} · ${new Date(release.created_at).toLocaleString()}</p><details><summary>查看发布所用的资源版本</summary><p class="mono">角色版本：${escapeHtml(release.character_version_id)}<br>预设版本：${escapeHtml(release.preset_version_id)}<br>正则版本：${escapeHtml(release.regex_profile_version_id)}</p></details></div>`;
    })
    .join("");
}

export function filterReleasesByCharacter(releases, characterId) {
  return (releases || []).filter(
    (release) => release.character_id === characterId,
  );
}

function panelHtml(state) {
  if (state.loading) {
    return '<section data-published-admin-root><h2>角色配置与发布</h2><p role="status">正在加载配置…</p></section>';
  }
  if (state.error) {
    return `<section data-published-admin-root><h2>角色配置与发布</h2><p role="alert">${escapeHtml(state.error)}</p><button type="button" data-published-refresh>重新加载</button></section>`;
  }

  const { catalog, draft } = state;
  const visibleReleases = filterReleasesByCharacter(
    catalog.releases,
    draft.characterId,
  );
  return `<section data-published-admin-root><div class="row"><h2>角色配置与发布</h2><button type="button" data-published-refresh>刷新资源</button></div><form data-published-form><label class="field">发布名称<input name="name" maxlength="200" value="${escapeHtml(draft.name)}"></label>${resourceFields({ key: "character", label: "角色", resources: catalog.characters, draft })}${resourceFields({ key: "preset", label: "提示词预设", resources: catalog.presets, draft })}${resourceFields({ key: "regexProfile", label: "正则配置", resources: catalog.regexProfiles, draft })}${resourceFields({ key: "worldbook", label: "世界书", resources: catalog.worldbooks, draft, optional: true })}<label class="field">默认演绎人设<select name="defaultUserId">${optionList(catalog.users, draft.defaultUserId, (user) => user.name)}</select></label><label class="field">提示词模式<select name="promptMode">${["compat_strict", "compat_plus", "native"].map((mode) => `<option value="${mode}" ${mode === draft.promptMode ? "selected" : ""}>${PROMPT_MODE_LABELS[mode]}</option>`).join("")}</select></label><h2>模型槽位配置</h2>${MODEL_SLOTS.map((slot) => slotFields(slot, draft, catalog.profiles)).join("")}<p data-published-status class="small" role="status"></p><button class="primary" type="submit">发布角色</button></form><h2 style="margin-top:24px">发布记录</h2><div data-published-releases>${releasesHtml(visibleReleases)}</div></section>`;
}

function readDraft(form) {
  const data = new FormData(form);
  return {
    name: String(data.get("name") || ""),
    characterId: String(data.get("characterId") || ""),
    characterVersionId: String(data.get("characterVersionId") || ""),
    presetId: String(data.get("presetId") || ""),
    presetVersionId: String(data.get("presetVersionId") || ""),
    regexProfileId: String(data.get("regexProfileId") || ""),
    regexProfileVersionId: String(data.get("regexProfileVersionId") || ""),
    worldbookId: String(data.get("worldbookId") || ""),
    worldbookVersionId: String(data.get("worldbookVersionId") || ""),
    defaultUserId: String(data.get("defaultUserId") || ""),
    promptMode: String(data.get("promptMode") || ""),
    slots: Object.fromEntries(
      MODEL_SLOTS.map((slot) => [
        slot,
        {
          enabled: data.has(`slot_${slot}_enabled`),
          profileId: String(data.get(`slot_${slot}_profile`) || ""),
          paramsText: String(data.get(`slot_${slot}_params`) || ""),
        },
      ]),
    ),
  };
}

async function readErrorMessages(fetchImpl) {
  const response = await fetchImpl(
    "/prototype/apps/web/prototypes/shared/card-errors.json",
  );
  if (!response.ok) throw new Error("无法读取错误提示，请刷新页面后重试。");
  return response.json();
}

export function createPublishedAdminController({
  documentLike = globalThis.document,
  locationLike = globalThis.location,
  fetchImpl = globalThis.fetch,
  navigate = (url) => locationLike.assign(url),
} = {}) {
  const state = {
    loading: true,
    error: null,
    catalog: null,
    draft: null,
    errorMessages: null,
  };
  let client;
  let observer;
  let trialObserver;
  let historyObserver;
  let historyItems = [];
  let historyError = "";
  let historyLoading = true;
  let historyGeneration = 0;
  let contextSessionId = "";
  let contextCharacterId = "";

  function applyCharacterContext({ sessionId, characterId }) {
    if (
      !characterId ||
      (sessionId === contextSessionId && characterId === contextCharacterId)
    )
      return;
    contextSessionId = sessionId || "";
    contextCharacterId = characterId;
    renderHistory();
    if (!state.catalog) return;
    if (!state.catalog.characters.some((item) => item.id === characterId))
      return;
    state.draft = createPublishedAdminDraft(state.catalog, { characterId });
    render();
  }

  function renderHistory() {
    const list = documentLike.querySelector("#sessionList");
    if (!list) return;
    const visibleHistory = historyItems.filter(
      (session) =>
        !contextCharacterId ||
        session.character_binding?.character_id === contextCharacterId,
    );
    const count = documentLike.querySelector("#sessionCount");
    if (count)
      count.textContent = historyLoading ? "" : `${visibleHistory.length} 条`;
    list.innerHTML = `<div data-published-history>${historyLoading ? '<p class="small">正在读取演绎记录…</p>' : historyError ? `<p class="small">${escapeHtml(historyError)}</p>` : visibleHistory.length ? visibleHistory.map((session) => `<button class="navitem" data-open-published-session="${escapeHtml(session.id)}">${escapeHtml(session.title || session.character_binding?.snapshot_summary?.name || session.id)}<br><span class="small">${session.user_binding?.snapshot_summary?.name ? `演绎人设：${escapeHtml(session.user_binding.snapshot_summary.name)}<br>` : ""}${session.status === "archived" ? "已归档" : "进行中"}<br>更新于：${escapeHtml(new Date(session.updated_at).toLocaleString())}</span></button>`).join("") : '<p class="small">暂无演绎记录。</p>'}</div>`;
    list.querySelectorAll("[data-open-published-session]").forEach((button) => {
      button.onclick = () => {
        const sessionId = button.dataset.openPublishedSession;
        const EventClass =
          documentLike.defaultView?.CustomEvent || globalThis.CustomEvent;
        if (typeof EventClass === "function") {
          documentLike.dispatchEvent(
            new EventClass("published-admin:session-select", {
              detail: { sessionId },
            }),
          );
          return;
        }
        navigate(publishedTrialUrl(sessionId, locationLike));
      };
    });
  }

  async function refreshHistory() {
    if (!client) return;
    const generation = ++historyGeneration;
    historyLoading = true;
    historyError = "";
    renderHistory();
    try {
      const items = await client.listSessions(
        documentLike.querySelector("#sessionFilter")?.value || "",
      );
      if (generation !== historyGeneration) return;
      historyItems = items;
    } catch (error) {
      if (generation !== historyGeneration) return;
      historyError = messageFor(error);
      historyItems = [];
    }
    historyLoading = false;
    renderHistory();
  }

  function messageFor(error, fallback = "NETWORK_ERROR") {
    return (
      state.errorMessages?.[normalizeErrorCode(error?.code)] ||
      state.errorMessages?.[fallback] ||
      state.errorMessages?.NETWORK_ERROR ||
      ""
    );
  }

  function showStatus(message) {
    const panelStatus = documentLike.querySelector("[data-published-status]");
    if (panelStatus) panelStatus.textContent = message;
    const notice = documentLike.querySelector("#notice");
    if (notice) notice.textContent = message;
  }

  async function startTrial({ releaseId, userId, openingId, button }) {
    if (button) button.disabled = true;
    showStatus("正在创建会话…");
    try {
      const result = await client.createTrial({
        releaseId,
        userId,
        openingId: openingId || undefined,
      });
      navigate(publishedTrialUrl(result.session.id, locationLike));
    } catch (error) {
      showStatus(messageFor(error));
      if (button) button.disabled = false;
    }
  }

  function defaultRelease() {
    if (state.draft?.characterId) {
      return state.catalog?.releases.find(
        (release) => release.character_id === state.draft?.characterId,
      );
    }
    return state.catalog?.releases[0];
  }

  function startDefaultTrial() {
    const release = defaultRelease();
    if (!release) {
      showStatus(messageFor({ code: "ACTION_UNAVAILABLE" }));
      return;
    }
    const opening =
      release.openings.find((item) => item.default) || release.openings[0];
    startTrial({
      releaseId: release.id,
      userId: release.default_user_id,
      openingId: opening?.id,
    });
  }

  function capturePublishedTrial(event) {
    const button = event.target.closest?.("button");
    if (
      !button ||
      (button.id !== "newTrial" && button.dataset.action !== "start")
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    startDefaultTrial();
  }

  function capturePublishedShortcut(event) {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== "n" ||
      event.target.closest?.("input,textarea,select,[contenteditable]")
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    startDefaultTrial();
  }

  function updateTrialEntryPoint() {
    const button = documentLike.querySelector("#newTrial");
    if (!button) return;
    if (button.textContent !== "开始试聊") button.textContent = "开始试聊";
    button.disabled = state.loading || !defaultRelease();
  }

  function isBindingsTab() {
    return (
      documentLike
        .querySelector('[data-tab="bindings"]')
        ?.getAttribute("aria-selected") === "true"
    );
  }

  function attachEvents(container) {
    const root = container.querySelector("[data-published-admin-root]");
    if (!root) return;
    root
      .querySelector("[data-published-refresh]")
      ?.addEventListener("click", () => refresh());
    const form = root.querySelector("[data-published-form]");
    form?.addEventListener("change", (event) => {
      state.draft = readDraft(form);
      const key = event.target.dataset.publishedResource;
      if (!key) return;
      if (key === "character") {
        contextCharacterId = state.draft.characterId;
        state.draft = createPublishedAdminDraft(state.catalog, {
          characterId: state.draft.characterId,
        });
        render();
        return;
      }
      const collection = key === "regexProfile" ? "regexProfiles" : `${key}s`;
      const idKey = `${key}Id`;
      const versionKey = `${key}VersionId`;
      state.draft[versionKey] = latestVersionId(
        selectedResource(state.catalog[collection], state.draft[idKey]),
      );
      if (key === "preset") {
        const maxOutputTokens = selectedResource(
          state.catalog.presets,
          state.draft.presetId,
        )?.detail?.data?.openai_max_tokens;
        if (Number.isInteger(maxOutputTokens) && maxOutputTokens > 0) {
          const current =
            optionalObjectJson(
              state.draft.slots.narrator.paramsText,
              "演绎角色模型槽位",
            ) || {};
          state.draft.slots.narrator.paramsText = JSON.stringify(
            { ...current, max_output_tokens: maxOutputTokens },
            null,
            2,
          );
        }
      }
      render();
    });
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-published-status]");
      state.draft = readDraft(form);
      try {
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        status.textContent = "正在发布…";
        const release = await client.publish(
          buildRoleReleasePayload(state.draft),
        );
        state.catalog.releases = [release, ...state.catalog.releases];
        status.textContent = `已发布“${release.name}”。`;
        root.querySelector("[data-published-releases]").innerHTML =
          releasesHtml(
            filterReleasesByCharacter(
              state.catalog.releases,
              state.draft.characterId,
            ),
          );
        attachTrialEvents(root);
        submit.disabled = false;
      } catch (error) {
        status.textContent = (
          state.errorMessages[normalizeErrorCode(error.code)] ||
          state.errorMessages.INVALID_REQUEST
        ).replaceAll("{field}", error.field || "配置");
        form.querySelector('button[type="submit"]').disabled = false;
      }
    });
    attachTrialEvents(root);
  }

  function attachTrialEvents(root) {
    root.querySelectorAll("[data-published-trial]").forEach((button) => {
      button.onclick = () =>
        startTrial({
          releaseId: button.dataset.publishedTrial,
          userId: button.dataset.publishedUser,
          openingId: button.dataset.publishedOpening,
          button,
        });
    });
  }

  function render() {
    updateTrialEntryPoint();
    if (!isBindingsTab()) return;
    const container = documentLike.querySelector("#inspectorContent");
    if (!container) return;
    container.innerHTML = panelHtml(state);
    attachEvents(container);
  }

  async function refresh() {
    state.loading = true;
    state.error = null;
    render();
    try {
      state.errorMessages ||= await readErrorMessages(fetchImpl);
      client = createPublishedAdminClient({
        fetchImpl,
        errorMessages: state.errorMessages,
      });
      await refreshHistory();
      const catalog = await loadPublishedAdminCatalog(client);
      state.catalog = catalog;
      state.draft = createPublishedAdminDraft(
        catalog,
        contextCharacterId
          ? { characterId: contextCharacterId }
          : state.draft || {},
      );
      state.loading = false;
    } catch (error) {
      state.loading = false;
      state.error =
        state.errorMessages?.[normalizeErrorCode(error.code)] ||
        state.errorMessages?.NETWORK_ERROR ||
        error.message;
    }
    render();
  }

  function mount() {
    const container = documentLike.querySelector("#inspectorContent");
    if (!container) return false;
    observer = new MutationObserver(() => {
      if (
        isBindingsTab() &&
        !container.querySelector("[data-published-admin-root]")
      ) {
        render();
      }
    });
    observer.observe(container, { childList: true });
    const historyList = documentLike.querySelector("#sessionList");
    if (historyList) {
      const section = historyList.closest("section");
      section.querySelector("h2").textContent = "演绎记录";
      const filter = documentLike.querySelector("#sessionFilter");
      filter.parentElement.firstChild.textContent = "会话状态";
      filter.innerHTML =
        '<option value="">全部会话</option><option value="active">进行中</option><option value="archived">已归档</option>';
      filter.onchange = refreshHistory;
      const refreshButton = documentLike.createElement("button");
      refreshButton.type = "button";
      refreshButton.textContent = "刷新记录";
      refreshButton.onclick = refreshHistory;
      section.querySelector(".row").append(refreshButton);
      historyObserver = new MutationObserver(() => {
        if (!historyList.querySelector("[data-published-history]"))
          renderHistory();
      });
      historyObserver.observe(historyList, { childList: true });
      renderHistory();
    }
    const trialButton = documentLike.querySelector("#newTrial");
    if (trialButton) {
      trialObserver = new MutationObserver(updateTrialEntryPoint);
      trialObserver.observe(trialButton, { childList: true });
    }
    documentLike.addEventListener("click", capturePublishedTrial, true);
    documentLike.addEventListener("formal-admin:character-context", (event) =>
      applyCharacterContext(event.detail || {}),
    );
    globalThis.addEventListener?.("keydown", capturePublishedShortcut, true);
    render();
    refresh();
    return true;
  }

  return {
    mount,
    refresh,
    destroy: () => {
      observer?.disconnect();
      trialObserver?.disconnect();
      historyObserver?.disconnect();
      documentLike.removeEventListener("click", capturePublishedTrial, true);
      globalThis.removeEventListener?.(
        "keydown",
        capturePublishedShortcut,
        true,
      );
    },
    state,
  };
}

if (
  typeof document !== "undefined" &&
  isPublishedBackendMode(globalThis.location, document)
) {
  const start = () => {
    const controller = createPublishedAdminController();
    controller.mount();
    globalThis.publishedAdminPrototype = controller;
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
