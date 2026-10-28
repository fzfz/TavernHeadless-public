// Native role layout prototype. Data is derived from existing API fixtures;
// presentation configuration follows role-view-config.schema.prototype.json.
const roleAssetBase = new URL("role-view-assets/", document.currentScript.src);
const roleAsset = (name) => new URL(name, roleAssetBase).href;
const chosenPresentation = prototypeQuery.get("presentation") || "bookshop";
const roleDefaults = RoleViewDefinition.variants[chosenPresentation];
if (!roleDefaults) throw new Error("Unknown presentation fixture");
if (prototypeQuery.has("presentation") && !incomingPrototype) {
  for (const config of [
    saved,
    draft,
    ...releases.map((r) => r.config),
    ...sessions.flatMap((s) => [s.config, ...s.rounds.map((f) => f.config)]),
  ])
    config.presentation = clone(roleDefaults);
}

let editingRoleView = null;
function ensureRoleView(config) {
  if (!config.presentation) {
    config.presentation = clone(roleDefaults);
    config.presentation.characterName = getResource(config.character.id).name;
  }
  return config.presentation;
}
ensureRoleView(saved);
ensureRoleView(draft);
releases.forEach((r) => ensureRoleView(r.config));
sessions.forEach((s) => {
  ensureRoleView(s.config);
  s.performer ??= clone(RoleViewDefinition.performer);
  s.rounds.forEach((f) => ensureRoleView(f.config));
});
function roleFloors(s) {
  const visibleIds = new Set(
    s.messages
      .filter(
        (m) =>
          !m.branchId ||
          m.branchId === s.activeBranch ||
          s.branches
            .find((b) => b.id === s.activeBranch)
            ?.inherited?.includes(m.id),
      )
      .map((m) => m.floorId),
  );
  return s.rounds.filter(
    (f) => f.state === "committed" && visibleIds.has(f.id),
  );
}
function roleRecord(s, floor) {
  const config = ensureRoleView(floor ? floor.config : s.config);
  if (!floor)
    return {
      id: s.id + ":initial",
      config: clone(config),
      variables: clone(RoleViewDefinition.initial),
      performer: clone(s.performer),
      floor: null,
    };
  const run = floor.attempts.at(-1)?.id;
  if (!floor.roleDisplay || floor.roleDisplay.run !== run) {
    floor.roleDisplay = {
      id: floor.id + ":" + run,
      run,
      config: clone(config),
      performer: clone(s.performer),
      variables: Object.fromEntries(
        (floor.debug?.variables || []).map((v) => [v.key, clone(v.value)]),
      ),
      floor: floor.id,
    };
  }
  return floor.roleDisplay;
}
// A configured body marker mounts the independent view. Saved message text stays intact.
const beforeRoleMessageDisplay = messageDisplay;
messageDisplay = (s, m) => {
  const f = s.rounds.find((f) => f.id === m.floorId);
  const cfg = ensureRoleView(f ? f.config : s.config);
  return beforeRoleMessageDisplay(s, {
    ...m,
    text: cfg.bodyMarker ? m.text.split(cfg.bodyMarker).join("") : m.text,
  });
};
const roleShadowStyle = `
:host{display:block;color:#273b46;font:14px/1.6 system-ui,sans-serif;--accent:#b98952}*{box-sizing:border-box}header{display:flex;gap:12px;justify-content:space-between;padding:15px 19px;border-bottom:1px solid #dfddd4;background:#f5f3ec}header span{font-weight:700}header strong{font-size:13px;color:#6c726d}.status-grid{display:grid;grid-template-columns:100px 1fr;gap:22px;padding:20px}.status-grid img{width:100%;height:159px;object-fit:cover;object-position:top;background:#dbe3e1;border-radius:6px}.status-grid>div{min-width:0}label{display:block;font-size:12px;color:#72796f}h2{font-size:22px;line-height:1.25;margin:6px 0 13px;font-weight:600}progress{appearance:none;width:100%;height:7px;border:none;border-radius:10px;overflow:hidden;background:#e6e5df}progress::-webkit-progress-bar{background:#e6e5df}progress::-webkit-progress-value{background:var(--accent);border-radius:10px}:host([compact]) .status-grid{grid-template-columns:1fr;padding:12px 18px}:host([compact]) .status-grid img{display:none}:host([compact]) .status-grid>div{display:grid;grid-template-columns:1fr 1fr;gap:4px 15px}:host([compact]) .status-grid h2{font-size:19px;margin:0 0 5px}:host([compact]) progress{grid-column:1/-1}:host([compact]) .status-grid label:nth-of-type(2){grid-column:2;grid-row:1}:host([compact]) .status-grid h2:nth-of-type(2){grid-column:2;grid-row:2}.clue{border-top:1px solid #e3e2da;padding:14px 20px}.clue p{margin:5px 0;font-size:14px}.role-card{background:#fffefa;border:1px solid #d7d8d1;border-radius:12px;overflow:hidden} @media(max-width:450px){.status-grid{grid-template-columns:80px 1fr;gap:14px}.status-grid img{height:142px}header{padding:12px 15px}}`;
function mountRoleCard(host, record) {
  const cfg = record.config,
    values = record.variables;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${roleShadowStyle}\n${cfg.css}</style><div class="role-card">${DOMPurify.sanitize(cfg.html, { ALLOWED_TAGS: ["header", "section", "div", "span", "strong", "p", "label", "h2", "img", "progress", "details", "summary", "br"], ALLOWED_ATTR: ["class", "data-bind", "data-meter", "data-portrait", "alt"] })}</div>`;
  host.style.setProperty("--accent", cfg.accent);
  const bindings = {
    location: values[cfg.bindings.location],
    time: values[cfg.bindings.time],
    clue: values[cfg.bindings.clue],
    meterLabel: cfg.meterLabel,
    meterValue: values[cfg.meterKey],
  };
  root
    .querySelectorAll("[data-bind]")
    .forEach((e) => (e.textContent = bindings[e.dataset.bind] ?? "—"));
  root.querySelectorAll("[data-portrait]").forEach((e) => {
    if (cfg.media.portrait) e.src = roleAsset(cfg.media.portrait);
    else e.remove();
  });
  root.querySelectorAll("[data-meter]").forEach((e) => {
    e.max = cfg.meterMax;
    e.value = Number(values[cfg.meterKey]) || 0;
  });
}
function roleChoiceHTML(s, record, latest) {
  if (!record.config.showChoices) return "";
  const current = record.id === latest.id;
  const blocked = s.running || s.failed || s.status === "archived";
  return `<div class="role-choices">${record.config.choices.map((c) => `<button data-role-choice="${c.id}" data-role-source="${record.id}" ${blocked ? "disabled" : ""}><span>${esc(c.title)}</span><small>${current && c.action === "send" ? "发送" : "填入输入框"} ↗</small></button>`).join("")}</div>`;
}
function presentationSchemaIssue(value, schema, path = "presentation") {
  if (schema.anyOf)
    return schema.anyOf.some((s) => !presentationSchemaIssue(value, s, path))
      ? ""
      : `${path} 必须符合以下类型之一：${schema.anyOf.map((option) => option.type + (option.pattern ? `（格式 ${option.pattern}）` : "")).join("、")}。请修改该字段。`;
  if (schema.enum && !schema.enum.includes(value))
    return `${path} 必须使用以下值之一：${schema.enum.join("、")}。请修改该值。`;
  const type =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (
    schema.type &&
    (schema.type === "integer"
      ? !Number.isInteger(value)
      : type !== schema.type)
  )
    return `${path} 必须为 ${schema.type}，请修改该字段。`;
  if (schema.type === "object") {
    for (const key of schema.required || [])
      if (!(key in value)) return `${path}.${key} 缺失，请补充该字段。`;
    for (const [key, v] of Object.entries(value)) {
      if (!schema.properties[key]) {
        if (schema.additionalProperties === false)
          return `${path}.${key} 未定义，请移除该字段。`;
        continue;
      }
      const issue = presentationSchemaIssue(
        v,
        schema.properties[key],
        `${path}.${key}`,
      );
      if (issue) return issue;
    }
  }
  if (schema.type === "array")
    for (let i = 0; i < value.length; i++) {
      const issue = presentationSchemaIssue(
        value[i],
        schema.items,
        `${path}[${i}]`,
      );
      if (issue) return issue;
    }
  if (schema.minLength && value.length < schema.minLength)
    return `${path} 不能为空，请填写该字段。`;
  if (schema.pattern && !new RegExp(schema.pattern).test(value))
    return `${path} 不符合格式 ${schema.pattern}，请修改该字段。`;
  if (schema.minimum !== undefined && value < schema.minimum)
    return `${path} 必须至少为 ${schema.minimum}，请修改该值。`;
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum)
    return `${path} 必须大于 ${schema.exclusiveMinimum}，请修改该值。`;
  return "";
}
function validateRoleComposition(cfg) {
  for (const [key, names] of [
    [
      "shell",
      cfg.layout === "novel"
        ? [
            "scene",
            "narrative",
            "playback",
            "history",
            "composer",
            "choices",
            "status",
          ]
        : ["scene", "chat"],
    ],
    ["scene", ["heading", "portrait", "status"]],
  ]) {
    const template = cfg[key];
    const doc = new DOMParser().parseFromString(template.html, "text/html");
    const nodes = [...doc.querySelectorAll("body *, head > *")];
    const invalidTag = nodes.find(
      (e) =>
        !["DIV", "SECTION", "ASIDE", "MAIN", "NAV", "SLOT"].includes(e.tagName),
    );
    if (invalidTag)
      return `${key} 布局中的 ${invalidTag.tagName.toLowerCase()} 标签不受支持，请替换为 div、section、aside、main 或 slot。`;
    for (const node of nodes) {
      const attribute = [...node.attributes].find(
        (a) => !["class", "name"].includes(a.name),
      );
      if (attribute)
        return `${key} 布局中的 ${attribute.name} 属性不受支持，请移除该属性。`;
    }
    const slots = [...doc.querySelectorAll("slot")];
    if (
      slots.length !== names.length ||
      names.some((name) => slots.filter((e) => e.name === name).length !== 1)
    )
      return `${key} 布局需要为 ${names.join("、")} 各保留一个命名插槽，请补齐缺失项并删除重复项及其他插槽。`;
    if (/<|@import|url\s*\(/i.test(template.css))
      return `${key} 布局的图片请通过资源配置指定，并移除 CSS 中的 HTML 或外部资源引用。`;
  }
  return "";
}
function mountRoleComposition(shell, cfg) {
  const issue = validateRoleComposition(cfg);
  if (issue) throw new Error(issue);
  shell.classList.add("role-composed");
  const scene = shell.querySelector(".role-scene");
  scene.slot = "scene";
  scene.querySelector(".role-chapter").slot = "heading";
  const portrait = scene.querySelector(".role-portrait");
  if (portrait) portrait.slot = "portrait";
  scene.querySelector(".role-state-panel").slot = "status";
  scene.attachShadow({ mode: "open" }).innerHTML =
    `<style>*{box-sizing:border-box}${cfg.scene.css}</style>${cfg.scene.html}`;
  shell.querySelector(".role-chat-pane").slot = "chat";
  const root = shell.attachShadow({ mode: "open" });
  root.innerHTML = `<style>:host{display:block}*{box-sizing:border-box}${cfg.shell.css}</style>${cfg.shell.html}<slot name="background"></slot>`;
  shell.querySelector(".role-scenery").slot = "background";
}
const beforeRoleConversation = renderConversation;
renderConversation = () => {
  beforeRoleConversation();
  document.body.classList.remove("role-stage-mode");
  if (prototypeSurface !== "user" || userHome || !getSession()) return;
  const s = sessionState(getSession()),
    cfg = ensureRoleView(s.config);
  s.performer ??= clone(RoleViewDefinition.performer);
  s.viewDetails ??= true;
  const floors = roleFloors(s),
    latestFloor = floors.at(-1);
  const latest = roleRecord(s, latestFloor);
  const selectedFloor = floors.find((f) => f.id === s.viewFloor) || latestFloor;
  const record = roleRecord(s, selectedFloor);
  const layout = cfg.layout;
  const head = document.querySelector(".session-head");
  head.classList.toggle("role-options-expanded", !!s.viewOptions);
  head.insertAdjacentHTML(
    "beforeend",
    '<button class="role-menu-button" data-role-menu>会话操作</button>',
  );
  const messages = $("messages");
  messages.querySelectorAll(".message .actions button").forEach((button) => {
    const icon =
      RoleViewDefinition.actionIcons[
        button.dataset.debugFloor ? "debug" : button.dataset.r
      ];
    if (!icon) return;
    const label = button.textContent.trim();
    button.classList.add("role-icon-action");
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span class="role-action-tip">${esc(label)}</span>`;
  });

  messages.querySelectorAll("article.message").forEach((article) => {
    const m = s.messages.find((m) => m.id === article.dataset.messageId);
    if (!["user", "assistant"].includes(m?.role)) return;
    article.classList.add("role-message-with-avatar");
    article.dataset.speaker = m.role;
    const avatar = document.createElement("img");
    avatar.className = "role-message-avatar";
    const floor = s.rounds.find((f) => f.id === m.floorId);
    const snapshot = roleRecord(s, floor?.state === "committed" ? floor : null);
    const identity =
      m.role === "user"
        ? snapshot.performer
        : {
            name: snapshot.config.characterName,
            avatar: snapshot.config.media.characterAvatar,
          };
    avatar.src = roleAsset(identity.avatar);
    article.querySelector(".row strong").textContent = identity.name;
    avatar.alt = "";
    avatar.width = 44;
    avatar.height = 44;
    const rail = document.createElement("div");
    rail.className = "role-avatar-rail";
    rail.append(avatar);
    article.prepend(rail);
  });
  if (s.cardPackage) {
    renderCardPackage(s, messages, $("composer"));
    return;
  }
  if (layout === "novel") {
    renderNovel(s, messages, $("composer"));
    return;
  }
  if (layout === "inline") {
    messages.querySelectorAll("article.message").forEach((article) => {
      const id = article.dataset.messageId;
      const m = s.messages.find((m) => m.id === id);
      const f = floors.find((f) => f.id === m?.floorId);
      if (m?.role !== "assistant" || !f) return;
      const rec = roleRecord(s, f);
      const card = document.createElement("div");
      card.className = "role-inline-card";
      article.querySelector(".markdown-block").after(card);
      mountRoleCard(card, rec);
      card.insertAdjacentHTML("afterend", roleChoiceHTML(s, rec, latest));
    });
    if (!floors.length) {
      const card = document.createElement("div");
      card.className = "role-inline-card";
      messages.append(card);
      mountRoleCard(card, record);
      card.insertAdjacentHTML("afterend", roleChoiceHTML(s, record, latest));
    }
    messages.scrollTop = s.chatScroll || 0;
    messages.onscroll = () => {
      s.chatScroll = messages.scrollTop;
    };
    return;
  }
  document.body.classList.add("role-stage-mode");
  const composer = $("composer");
  const shell = document.createElement("section");
  shell.className = "role-stage";
  shell.style.setProperty("--role-accent", cfg.accent);
  shell.style.setProperty("--chat-surface", cfg.chatTheme.surface);
  shell.style.setProperty("--chat-text", cfg.chatTheme.text);
  shell.innerHTML = `<div class="role-scenery" style="${record.config.media.background ? `background-image:url('${roleAsset(record.config.media.background)}')` : ""}"></div><aside class="role-scene"><div class="role-chapter"><span>${esc(record.config.characterName)}</span><h2>${esc(record.config.title)}</h2><p>${esc(record.variables[record.config.bindings.location] ?? "")} · ${esc(record.variables[record.config.bindings.time] ?? "")}</p></div>${record.config.media.portrait ? `<img class="role-portrait" src="${roleAsset(record.config.media.portrait)}" alt="${esc(record.config.characterName)}">` : ""}<div class="role-state-panel"><div class="role-state-heading"><label for="roleHistory">故事进度</label><select id="roleHistory">${floors.map((f) => `<option value="${f.id}" ${f.id === selectedFloor?.id ? "selected" : ""}>第 ${f.no} 轮${f.id === latestFloor?.id ? " · 当前" : ""}</option>`).join("") || '<option value="">初遇</option>'}</select></div><div id="roleStageCard"></div><button class="role-panel-toggle" data-role-panel>${s.viewDetails ? "收起状态" : "展开状态"}</button></div></aside><div class="role-chat-pane"><div class="role-chat-title"><span>与${esc(latest.config.characterName)}对话</span><button data-role-history>${s.viewHistory ? "收起对话记录" : "展开对话记录"}</button></div><div class="role-chat-content"></div><div class="role-current-actions">${roleChoiceHTML(s, latest, latest)}</div></div>`;
  mountRoleComposition(shell, cfg);
  $("mainView").append(shell);
  shell.querySelector(".role-chat-content").append(messages);
  shell.querySelector(".role-chat-pane").append(composer);
  const failure = messages.querySelector(":scope > p.danger");
  if (failure) shell.querySelector(".role-current-actions").prepend(failure);
  $("roleStageCard").setAttribute("compact", "");
  mountRoleCard($("roleStageCard"), record);
  shell.classList.toggle("show-role-details", !!s.viewDetails);
  shell.classList.toggle("show-role-history", !!s.viewHistory);
  if (!s.viewHistory) {
    const articles = [...messages.querySelectorAll("article.message")];
    articles.slice(0, -2).forEach((a) => a.classList.add("role-older-message"));
  }
  $("roleHistory").onchange = (e) => {
    s.viewFloor = e.target.value;
    render();
  };
  messages.scrollTop = s.chatScroll || 0;
  messages.onscroll = () => {
    s.chatScroll = messages.scrollTop;
  };
};
const beforeRoleInspector = renderInspector;
renderInspector = () => {
  beforeRoleInspector();
  if (prototypeSurface !== "admin" || tab !== "bindings") return;
  const cfg = ensureRoleView(draft);
  $("inspectorContent").insertAdjacentHTML(
    "afterbegin",
    `<section class="box role-settings-entry"><div class="row"><h2>演绎界面</h2><span class="tag">${cfg.layout === "novel" ? "视觉小说" : cfg.layout === "stage" ? "整屏布局" : "消息内布局"}</span></div><p>${esc(cfg.title)}</p><button data-role-edit>编辑布局与字段</button></section>`,
  );
};
const roleDialog = document.createElement("dialog");
roleDialog.id = "roleViewEditor";
document.body.append(roleDialog);
function refreshRolePreview() {
  const host = $("roleEditorPreview");
  host.innerHTML = "";
  const ps = getSession() ||
    sessions[0] || {
      id: "editor",
      config: draft,
      messages: [],
      rounds: [],
      branches: [],
      activeBranch: "main",
    };
  const sample = roleRecord(ps, roleFloors(ps).at(-1));
  const rec = { ...sample, config: editingRoleView };
  host.classList.toggle("preview-stage", editingRoleView.layout === "stage");
  if (editingRoleView.layout === "stage")
    host.innerHTML = `<div class="preview-scene" style="${editingRoleView.media.background ? `background-image:url('${roleAsset(editingRoleView.media.background)}')` : ""}"><h2>${esc(editingRoleView.title)}</h2>${editingRoleView.media.portrait ? `<img src="${roleAsset(editingRoleView.media.portrait)}" alt="${esc(editingRoleView.characterName)}">` : ""}</div>`;
  const card = document.createElement("div");
  host.append(card);
  mountRoleCard(card, rec);
}
function validateRoleTemplate(cfg) {
  const schemaIssue = presentationSchemaIssue(cfg, RolePresentationSchema);
  if (schemaIssue) return schemaIssue;
  if (cfg.layout === "novel" && !cfg.novel)
    return "视觉小说布局缺少 novel 播放配置，请填写播放间隔、音乐和画廊。";

  const compositionIssue = validateRoleComposition(cfg);
  if (compositionIssue) return compositionIssue;
  const forbidden = cfg.css.match(/<|@import|url\s*\(/i);
  if (forbidden)
    return `CSS 含有 ${forbidden[0]}，请移除这处 HTML 或外部资源引用。`;
  const doc = new DOMParser().parseFromString(cfg.html, "text/html");
  const tags = [
    "HEADER",
    "SECTION",
    "DIV",
    "SPAN",
    "STRONG",
    "P",
    "LABEL",
    "H2",
    "IMG",
    "PROGRESS",
    "DETAILS",
    "SUMMARY",
    "BR",
  ];
  const attrs = ["class", "data-bind", "data-meter", "data-portrait", "alt"];
  const bad = [...doc.querySelectorAll("body *, head > *")].find(
    (e) => !tags.includes(e.tagName),
  );
  if (bad)
    return `HTML 中的 ${bad.tagName.toLowerCase()} 标签不受支持，请移除该标签。`;
  for (const e of doc.body.querySelectorAll("*")) {
    const attr = [...e.attributes].find((a) => !attrs.includes(a.name));
    if (attr) return `HTML 中的 ${attr.name} 属性不受支持，请移除该属性。`;
    if (
      e.dataset.bind &&
      !["location", "time", "clue", "meterLabel", "meterValue"].includes(
        e.dataset.bind,
      )
    )
      return `字段 ${e.dataset.bind} 未定义，请使用 location、time、clue、meterLabel 或 meterValue。`;
  }
  return "";
}
function openRoleEditor() {
  editingRoleView = clone(ensureRoleView(draft));
  roleDialog.innerHTML = `<div class="row"><div><h2>演绎界面</h2><p class="small">${esc(getResource(draft.character.id).name)}</p></div><button data-role-close>关闭</button></div><div class="role-editor-grid"><div class="role-editor-fields"><label class="field">默认布局<select data-view-field="layout"><option value="stage">整屏演绎</option><option value="inline">消息内状态栏</option><option value="novel">视觉小说</option></select></label><label class="field">故事标题<input data-view-field="title" value="${esc(editingRoleView.title)}"></label><label class="field">强调色<input type="color" data-view-field="accent" value="${editingRoleView.accent}"></label><label class="field">进度条变量<select data-view-field="meterKey"><option value="relationship.trust">relationship.trust · 信任</option></select></label><div class="role-two-fields"><label class="field">显示名称<input data-view-field="meterLabel" value="${esc(editingRoleView.meterLabel)}"></label><label class="field">最大值<input type="number" min="1" data-view-field="meterMax" value="${editingRoleView.meterMax}"></label></div><label class="field">剧情选项<select data-view-field="showChoices"><option value="true">显示</option><option value="false">隐藏</option></select></label><details><summary>页面编排与资源</summary>${[
    ["media", "图片资源"],
    ["chatTheme", "聊天主题"],
    ["choices", "剧情选项"],
    ["shell", "页面布局 HTML / CSS"],
    ["scene", "角色展示区 HTML / CSS"],
  ]
    .map(
      ([key, label]) =>
        `<label class="field">${label}<textarea class="role-template-source" data-view-structured="${key}" spellcheck="false">${esc(JSON.stringify(editingRoleView[key], null, 2))}</textarea></label>`,
    )
    .join(
      "",
    )}</details><details><summary>状态栏 HTML</summary><textarea class="role-template-source" data-view-field="html" spellcheck="false">${esc(editingRoleView.html)}</textarea></details><details><summary>状态栏 CSS</summary><textarea class="role-template-source" data-view-field="css" spellcheck="false">${esc(editingRoleView.css)}</textarea></details><details open><summary>字段绑定</summary>${Object.entries(
    { location: "地点", time: "时间", clue: "线索" },
  )
    .map(
      ([key, label]) =>
        `<label class="field">${label}<select data-view-binding="${key}">${["scene.location", "scene.time", "story.clue"].map((v) => `<option value="${v}" ${editingRoleView.bindings[key] === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>`,
    )
    .join(
      "",
    )}</details></div><div><div class="row"><h3>显示效果</h3><span class="small">${(getSession() || sessions[0]) && roleFloors(getSession() || sessions[0]).length ? "第 " + roleFloors(getSession() || sessions[0]).at(-1).no + " 轮" : "初始状态"}</span></div><div id="roleEditorPreview"></div></div></div><p id="roleEditError" class="danger"></p><div class="actions"><button class="primary" data-role-apply>应用到角色配置</button><button data-role-close>取消</button></div>`;
  roleDialog.querySelector('[data-view-field="layout"]').value =
    editingRoleView.layout;
  roleDialog.querySelector('[data-view-field="showChoices"]').value = String(
    editingRoleView.showChoices,
  );
  refreshRolePreview();
  roleDialog.showModal();
}
roleDialog.addEventListener("input", (e) => {
  if (e.target.dataset.viewStructured) {
    const key = e.target.dataset.viewStructured;
    let parsed;
    try {
      parsed = JSON.parse(e.target.value);
    } catch (error) {
      $("roleEditError").textContent =
        `${key} 的 JSON 语法错误：${error.message}。请修正后预览。`;
      return;
    }
    try {
      const next = { ...editingRoleView, [key]: parsed };
      const issue = validateRoleTemplate(next);
      if (issue) {
        $("roleEditError").textContent = issue;
        return;
      }
      editingRoleView = next;
      $("roleEditError").textContent = "";
      refreshRolePreview();
    } catch (error) {
      $("roleEditError").textContent =
        `${key} 预览失败：${error.message}。请检查该字段。`;
    }
    return;
  }
  if (e.target.dataset.viewBinding) {
    editingRoleView.bindings[e.target.dataset.viewBinding] = e.target.value;
    refreshRolePreview();
    return;
  }
  const key = e.target.dataset.viewField;
  if (!key) return;
  editingRoleView[key] =
    key === "meterMax"
      ? Number(e.target.value)
      : key === "showChoices"
        ? e.target.value === "true"
        : e.target.value;
  const issue = validateRoleTemplate(editingRoleView);
  $("roleEditError").textContent = issue;
  if (!issue) refreshRolePreview();
});
document.addEventListener(
  "click",
  (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    const d = button.dataset;
    if (!Object.keys(d).some((k) => k.startsWith("role"))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const s = getSession();
    if ("roleEdit" in d) openRoleEditor();
    if ("roleClose" in d) roleDialog.close();
    if ("roleApply" in d) {
      if (
        !editingRoleView.title.trim() ||
        !editingRoleView.meterLabel.trim() ||
        editingRoleView.meterMax <= 0 ||
        !Number.isFinite(editingRoleView.meterMax) ||
        !editingRoleView.html.trim()
      ) {
        $("roleEditError").textContent =
          "请填写标题、显示名称、状态栏 HTML，并设置大于 0 的最大值。";
        return;
      }
      const issue = validateRoleTemplate(editingRoleView);
      if (issue) {
        $("roleEditError").textContent = issue;
        return;
      }
      editingRoleView.version = ensureRoleView(draft).version + 1;
      draft.presentation = clone(editingRoleView);
      roleDialog.close();
      render();
      notify("布局已应用，请保存角色配置。");
    }
    if ("roleMenu" in d) {
      s.viewOptions = !s.viewOptions;
      render();
    }
    if ("rolePanel" in d) {
      s.viewDetails = !s.viewDetails;
      render();
    }
    if ("roleHistory" in d) {
      s.viewHistory = !s.viewHistory;
      render();
    }
    if (d.roleChoice) {
      if (s.running || s.failed || s.status === "archived") return;
      const latest = roleRecord(s, roleFloors(s).at(-1));
      const source = [
        roleRecord(s, null),
        ...roleFloors(s).map((f) => roleRecord(s, f)),
      ].find((r) => r.id === d.roleSource);
      const choice = source?.config.choices.find((c) => c.id === d.roleChoice);
      if (!choice) return;
      s.input = choice.text;
      if (d.roleSource === latest.id && choice.action === "send") send(s);
      else {
        render();
        $("prompt").focus();
      }
    }
  },
  true,
);
const beforeRoleDebugger = renderDebugger;
renderDebugger = () => {
  beforeRoleDebugger();
  const s = getSession(),
    f = selectedFloor(s);
  if (editor?.tab !== "processing" || f?.state !== "committed") return;
  const rec = roleRecord(s, f);
  const section = document.createElement("section");
  section.className = "box role-display-evidence";
  section.innerHTML = `<h2>界面显示</h2><p class="small">${esc(rec.config.title)} · 模板版本 ${rec.config.version}</p><table><thead><tr><th>字段</th><th>变量键</th><th>本轮值</th></tr></thead><tbody>${Object.entries(
    rec.config.bindings,
  )
    .map(
      ([name, key]) =>
        `<tr><td>${esc({ location: "地点", time: "时间", clue: "线索" }[name])}</td><td>${esc(key)}</td><td>${esc(String(rec.variables[key]))}</td></tr>`,
    )
    .join(
      "",
    )}<tr><td>${esc(rec.config.meterLabel)}</td><td>${esc(rec.config.meterKey)}</td><td>${esc(String(rec.variables[rec.config.meterKey]))}</td></tr></tbody></table><div class="role-debug-card"></div>`;
  document.querySelector(".generation-content").append(section);
  mountRoleCard(section.querySelector(".role-debug-card"), rec);
};
render();
