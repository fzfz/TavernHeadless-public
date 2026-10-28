export function selectCharacterSession(sessions, characterId) {
  return (
    sessions.find(
      (session) =>
        !characterId || session.character_binding?.character_id === characterId,
    ) || null
  );
}

import { mountGenerationDetails, generationDetailsUrl } from "./formal-generation-details.prototype.js";

const JSON_HEADERS = Object.freeze({ "Content-Type": "application/json" });

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

function pretty(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function unwrapped(body) {
  return body && typeof body === "object" && Object.hasOwn(body, "data")
    ? body.data
    : body;
}

function itemsOf(body) {
  const value = unwrapped(body);
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

function displayItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  for (const key of ["resolved", "slots", "floors", "records", "jobs"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return value && typeof value === "object" ? [value] : [];
}

export function isFormalAdminMode(locationLike = globalThis.location) {
  return (
    new URLSearchParams(locationLike?.search || "").get("source") === "backend"
  );
}

export function formalSessionStatusLabel(status) {
  return status === "active"
    ? "进行中"
    : status === "archived"
      ? "已归档"
      : String(status || "");
}

export function formalResourceSourceLabel(source) {
  return source === "sillytavern"
    ? "导入格式：SillyTavern"
    : source
      ? `来源：${source}`
      : "";
}

export function formalResourceStatusLabel(status) {
  return status === "active"
    ? "启用"
    : status === "disabled"
      ? "停用"
      : status === "deleted"
        ? "已删除"
        : String(status || "");
}

export function formalMessageRoleLabel(role) {
  return role === "user"
    ? "演绎者"
    : role === "assistant"
      ? "角色"
      : role === "system"
        ? "系统"
        : String(role || "消息");
}

export function flattenFormalTimeline(payload) {
  const timeline = unwrapped(payload);
  return [...(timeline?.floors || [])]
    .sort((left, right) => left.floor_no - right.floor_no)
    .flatMap((floor) => {
      const pages = floor.active_pages?.length
        ? [...floor.active_pages].sort(
            (left, right) => left.page_no - right.page_no,
          )
        : floor.active_page
          ? [floor.active_page]
          : (floor.pages || []).filter((item) => item.is_active);
      if (!pages.length) {
        return (floor.messages || []).map((message) => ({
          ...message,
          floor_id: floor.id,
          floor_no: floor.floor_no,
          page_id: null,
          page_no: null,
          page_kind: null,
        }));
      }
      return pages.flatMap((page) =>
        [...(page.messages || [])]
          .sort((left, right) => left.seq - right.seq)
          .map((message) => ({
            ...message,
            floor_id: floor.id,
            floor_no: floor.floor_no,
            page_id: page.id,
            page_no: page.page_no,
            page_kind: page.page_kind,
          })),
      );
    });
}

export function buildFormalResourceUpdate(kind, detail, name, value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (kind === "character") {
    return {
      method: "POST",
      path: `/characters/${encodeURIComponent(detail.id)}/versions`,
      body: { snapshot: parsed, expected_revision: detail.revision },
    };
  }
  if (kind === "preset") {
    return {
      method: "PUT",
      path: `/presets/${encodeURIComponent(detail.id)}`,
      body: { name, editor: parsed, expected_version: detail.version },
    };
  }
  if (kind === "worldbook") {
    return {
      method: "PUT",
      path: `/worldbooks/${encodeURIComponent(detail.id)}`,
      body: { name, data: parsed, expected_version: detail.version },
    };
  }
  if (kind === "regex") {
    return {
      method: "PUT",
      path: `/regex-profiles/${encodeURIComponent(detail.id)}`,
      body: { name, data: parsed, expected_version: detail.version },
    };
  }
  if (kind === "persona") {
    const { status, ...snapshot } = parsed;
    return {
      method: "PATCH",
      path: `/users/${encodeURIComponent(detail.id)}`,
      body: {
        snapshot,
        ...(status ? { status } : {}),
        expected_revision: detail.revision,
      },
    };
  }
  if (kind === "model") {
    return {
      method: "PATCH",
      path: `/llm-profiles/${encodeURIComponent(detail.id)}`,
      body: parsed,
    };
  }
  throw Object.assign(new Error("Unknown resource kind"), {
    code: "INVALID_REQUEST",
  });
}

export function createFormalAdminClient({
  fetchImpl = globalThis.fetch,
  errorMessages = {},
} = {}) {
  async function request(path, { method = "GET", body, raw = false } = {}) {
    let response;
    try {
      response = await fetchImpl(path, {
        method,
        ...(body === undefined
          ? {}
          : { headers: JSON_HEADERS, body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw Object.assign(new Error(errorMessages.NETWORK_ERROR || ""), {
        code: "NETWORK_ERROR",
        cause: error,
      });
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const code = String(
        payload?.error?.code || "NETWORK_ERROR",
      ).toUpperCase();
      throw Object.assign(
        new Error(errorMessages[code] || errorMessages.NETWORK_ERROR || ""),
        { code, backendMessage: payload?.error?.message },
      );
    }
    return raw ? payload : unwrapped(payload);
  }

  async function list(path) {
    const rows = [];
    for (let offset = 0; ; offset += 100) {
      const separator = path.includes("?") ? "&" : "?";
      const body = await request(
        `${path}${separator}limit=100&offset=${offset}`,
        { raw: true },
      );
      rows.push(...itemsOf(body));
      if (!body?.meta?.has_more) return rows;
    }
  }

  return {
    request,
    list,
    loadShell: async () => {
      const [
        workspaces,
        projects,
        sessions,
        characters,
        presets,
        worldbooks,
        regex,
        personas,
        models,
      ] = await Promise.all([
        list("/workspaces"),
        list("/projects"),
        list("/sessions?sort_by=updated_at&sort_order=desc"),
        list("/characters?status=active&sort_by=name&sort_order=asc"),
        request("/presets"),
        request("/worldbooks"),
        request("/regex-profiles"),
        list("/users?status=active&sort_by=name&sort_order=asc"),
        request("/llm-profiles?status=active"),
      ]);
      return {
        workspaces,
        projects,
        sessions,
        resources: {
          character: characters,
          preset: presets,
          worldbook: worldbooks,
          regex,
          persona: personas,
          model: models,
        },
      };
    },
    timeline: (id) =>
      request(
        `/sessions/${encodeURIComponent(id)}/timeline?limit=100&offset=0`,
        { raw: true },
      ),
    session: (id) => request(`/sessions/${encodeURIComponent(id)}`),
    updateSession: (id, body) =>
      request(`/sessions/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    deleteSession: (id) =>
      request(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    dryRun: (id, message) =>
      request(`/sessions/${encodeURIComponent(id)}/respond/dry-run`, {
        method: "POST",
        body: { message, debug_options: { include_worldbook_matches: true } },
      }),
    resourceDetail(kind, id) {
      if (kind === "preset")
        return request(`/presets/${encodeURIComponent(id)}/editor`);
      const roots = {
        character: "characters",
        worldbook: "worldbooks",
        regex: "regex-profiles",
        persona: "users",
        model: "llm-profiles",
      };
      return request(`/${roots[kind]}/${encodeURIComponent(id)}`);
    },
    saveResource(kind, detail, name, value) {
      const update = buildFormalResourceUpdate(kind, detail, name, value);
      return request(update.path, update);
    },
    createResource(kind, name, value) {
      const data = typeof value === "string" ? JSON.parse(value) : value;
      if (kind === "persona") {
        const snapshot = { ...data };
        delete snapshot.status;
        return request("/users", { method: "POST", body: { snapshot } });
      }
      if (kind === "model")
        return request("/llm-profiles", { method: "POST", body: data });
      if (kind === "character")
        return request("/import/character", {
          method: "POST",
          body: { payload: data, create_session: false },
        });
      const route = kind === "regex" ? "regex" : kind;
      return request(`/import/${route}`, {
        method: "POST",
        body: { name, data },
      });
    },
    deleteResource(kind, id) {
      const roots = {
        character: "characters",
        preset: "presets",
        worldbook: "worldbooks",
        regex: "regex-profiles",
        persona: "users",
        model: "llm-profiles",
      };
      return request(`/${roots[kind]}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
  };
}

const RESOURCE_META = Object.freeze({
  character: ["角色卡", "角色"],
  preset: ["提示词预设", "预设"],
  worldbook: ["世界书", "世界书"],
  regex: ["正则配置", "正则"],
  persona: ["演绎人设", "人设"],
  model: ["模型配置", "模型"],
});

async function readErrorMessages(fetchImpl) {
  const response = await fetchImpl(
    "/prototype/apps/web/prototypes/shared/card-errors.json",
  );
  if (!response.ok) throw new Error("无法读取错误提示，请刷新页面后重试。");
  return response.json();
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function fieldInput(name, label, value, type = "text", attributes = "") {
  return `<label class="field">${escapeHtml(label)}<input name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(value ?? "")}" ${attributes}></label>`;
}

function fieldTextarea(name, label, value, rows = 5) {
  return `<label class="field">${escapeHtml(label)}<textarea name="${escapeHtml(name)}" rows="${rows}">${escapeHtml(value ?? "")}</textarea></label>`;
}

function fieldSelect(name, label, value, options) {
  return `<label class="field">${escapeHtml(label)}<select name="${escapeHtml(name)}">${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${String(optionValue) === String(value) ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select></label>`;
}

const PROMPT_POSITIONS = Object.freeze([
  [0, "相对顺序"],
  [1, "指定对话深度"],
]);
const WORLDBOOK_POSITIONS = Object.freeze([
  [0, "角色定义之前"],
  [1, "角色定义之后"],
  [2, "作者注释之前"],
  [3, "作者注释之后"],
  [4, "指定对话深度"],
  [5, "示例消息之前"],
  [6, "示例消息之后"],
  [7, "Outlet 宏槽位"],
]);
const REGEX_PLACEMENTS = Object.freeze([
  [1, "演绎者输入"],
  [2, "角色回复"],
  [5, "世界书内容"],
  [0, "Markdown 显示"],
  [3, "斜杠命令"],
  [6, "推理内容"],
]);

function commaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function agentConfigurationFields(value = {}) {
  return `${fieldInput("mcp_server_ids", "MCP 服务器 ID（逗号分隔）", (value.mcp_bindings || []).map((item) => item.mcp_server_id).join(", "))}${fieldInput("event_types", "订阅事件（逗号分隔）", (value.event_subscriptions || []).map((item) => item.type).join(", "))}${fieldInput("grant_outputs", "允许输出目标（逗号分隔）", (value.grants?.allowed_output_targets || []).join(", "))}${fieldInput("grant_reads", "允许读取范围（逗号分隔）", (value.grants?.reads || []).join(", "))}${fieldTextarea("agent_metadata", "附加信息（高级 JSON）", pretty(value.metadata || {}), 5)}`;
}

function scopeOptions(selected) {
  return [
    ["floor", "楼层"],
    ["session", "会话"],
    ["project", "项目"],
    ["workspace", "工作区"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`,
    )
    .join("");
}

export function buildAgentConfiguration(data, original = {}) {
  const mcpIds = commaList(data.get("mcp_server_ids"));
  const eventTypes = commaList(data.get("event_types"));
  const originalMcp = original.mcp_bindings || [];
  const originalEvents = original.event_subscriptions || [];
  const grants = { ...(original.grants || {}) };
  grants.allowed_output_targets = commaList(data.get("grant_outputs"));
  grants.reads = commaList(data.get("grant_reads"));
  return {
    mcp_bindings: mcpIds.map(
      (id) =>
        originalMcp.find((entry) => entry.mcp_server_id === id) || {
          mcp_server_id: id,
        },
    ),
    event_subscriptions: eventTypes.map(
      (type) => originalEvents.find((entry) => entry.type === type) || { type },
    ),
    grants,
    metadata: JSON.parse(String(data.get("agent_metadata") || "{}")),
  };
}

function advancedJson(value) {
  return `<details class="version"><summary>高级 JSON</summary>${fieldTextarea("advanced", "完整配置", pretty(value), 18)}</details>`;
}

export function roleStateConfigurationFields(value) {
  const extension = value.extensions?.tavern_headless;
  if (!extension?.stateUpdate) return "";
  const bundle = extension.stateUpdate;
  return `<section class="box" id="role-variable-configuration"><h2>变量更新配置</h2>${fieldTextarea("state_update_profile", "Agent 指令、变量结构与写入权限（JSON）", pretty(bundle.profile), 16)}<h3>规则与计算文件</h3>${Object.entries(bundle.files).map(([name, content], index) => `<details class="version"><summary>${escapeHtml(name)}${bundle.profile.ruleFiles?.includes(name) ? " · Agent 更新规则" : ""}</summary>${fieldTextarea(`state_file_${index}`, name, content, 14)}</details>`).join("")}<button type="button" data-state-contract>查看已保存版本的 Agent 指令与输出契约</button><pre data-state-contract-result></pre><h3>各开场的初始变量</h3>${(extension.openings?.items || []).map((item,index)=>`<details class="version"><summary>${escapeHtml(item.title || item.id)}</summary>${fieldTextarea(`opening_variables_${index}`, "初始变量（JSON）", pretty(item.variables), 12)}</details>`).join("")}</section>`;
}

export function applyRoleStateConfiguration(value, original, data) {
  const extension = original.extensions?.tavern_headless;
  if (!extension?.stateUpdate || !data.has("state_update_profile")) return;
  const target = value.extensions.tavern_headless;
  target.stateUpdate.profile = JSON.parse(String(data.get("state_update_profile")));
  Object.keys(extension.stateUpdate.files).forEach((name,index)=>{
    target.stateUpdate.files[name] = String(data.get(`state_file_${index}`));
  });
  (target.openings?.items || []).forEach((item,index)=>{
    item.variables = JSON.parse(String(data.get(`opening_variables_${index}`)));
  });
}

function characterFields(value) {
  const characterBook = value.characterBook ?? value.character_book;
  return `${fieldInput("name", "名称", value.name, "text", "required maxlength=200")}${fieldTextarea("description", "角色说明", value.description)}${fieldTextarea("personality", "性格", value.personality)}${fieldTextarea("scenario", "场景", value.scenario)}${fieldTextarea("greeting", "开场白", value.greeting ?? value.primaryGreeting ?? value.first_mes)}${fieldTextarea("mes_example", "示例对话", value.exampleDialogue ?? value.mes_example)}${fieldTextarea("alternate_greetings", "备选开场白（JSON 数组）", pretty(value.alternateGreetings ?? value.alternate_greetings ?? []), 6)}${fieldTextarea("group_only_greetings", "群聊开场白（JSON 数组）", pretty(value.groupOnlyGreetings ?? value.group_only_greetings ?? []), 5)}${fieldTextarea("system_prompt", "角色系统提示词", value.systemPrompt ?? value.system_prompt)}${fieldTextarea("post_history_instructions", "历史后指令", value.postHistoryInstructions ?? value.post_history_instructions)}${fieldTextarea("creator_notes", "作者备注", value.creatorNotes ?? value.creator_notes)}${fieldInput("creator", "作者", value.creator)}${fieldInput("character_version", "角色版本标记", value.characterVersion ?? value.character_version)}${fieldInput("nickname", "昵称", value.nickname)}${fieldInput("tags", "标签（逗号分隔）", (value.tags || []).join(", "))}${fieldTextarea("source", "来源（JSON 数组）", pretty(value.source || []), 4)}<section class="box"><h2>内嵌世界书</h2><label class="field"><span><input type="checkbox" name="character_book_enabled" ${characterBook ? "checked" : ""}> 启用内嵌世界书</span></label>${worldbookSettingsFields(
    characterBook || {},
    {
      prefix: "character_book_",
      entryAttribute: "data-character-book-entry",
      listAttribute: "data-character-book-entry-list",
      addAttribute: "data-character-book-entry-add",
      includeName: true,
    },
  )}</section>${roleStateConfigurationFields(value)}`;
}

function presetEntryFields(entry, index) {
  return `<details class="version" data-preset-entry data-entry-key="${index}"><summary>${escapeHtml(entry.name || entry.identifier || `条目 ${index + 1}`)}</summary><div class="actions"><button type="button" data-entry-up>上移</button><button type="button" data-entry-down>下移</button><button type="button" class="danger" data-entry-delete>删除</button></div><input type="hidden" name="entry_${index}_identifier" value="${escapeHtml(entry.identifier || "")}">${fieldInput(`entry_${index}_name`, "名称", entry.name)}<label class="field">角色<select name="entry_${index}_role"><option value="system" ${entry.role === "system" ? "selected" : ""}>系统</option><option value="user" ${entry.role === "user" ? "selected" : ""}>演绎者</option><option value="assistant" ${entry.role === "assistant" ? "selected" : ""}>角色</option></select></label>${fieldTextarea(`entry_${index}_content`, "内容", entry.content, 8)}${fieldSelect(`entry_${index}_injection_position`, "插入位置", entry.injection_position ?? 0, PROMPT_POSITIONS)}${fieldInput(`entry_${index}_injection_depth`, "插入深度", entry.injection_depth ?? 4, "number")}${fieldInput(`entry_${index}_injection_order`, "插入顺序", entry.injection_order ?? 100, "number")}${fieldTextarea(`entry_${index}_injection_trigger`, "注入触发条件（JSON 数组）", pretty(entry.injection_trigger || []), 4)}${fieldTextarea(`entry_${index}_extra`, "扩展字段（JSON 对象）", pretty(entry.extra || {}), 4)}<label class="field"><span><input type="checkbox" name="entry_${index}_enabled" ${entry.enabled ? "checked" : ""}> 启用条目</span></label><label class="field"><span><input type="checkbox" name="entry_${index}_system_prompt" ${entry.system_prompt ? "checked" : ""}> 系统提示词条目</span></label><label class="field"><span><input type="checkbox" name="entry_${index}_marker" ${entry.marker ? "checked" : ""}> 标记条目</span></label><label class="field"><span><input type="checkbox" name="entry_${index}_forbid_overrides" ${entry.forbid_overrides ? "checked" : ""}> 禁止覆盖</span></label></details>`;
}

export function worldbookEntryKeywordLists(entry) {
  return {
    primary:
      Array.isArray(entry.key) && entry.key.length > 0
        ? entry.key
        : Array.isArray(entry.keys)
          ? entry.keys
          : [],
    secondary:
      Array.isArray(entry.keysecondary) && entry.keysecondary.length > 0
        ? entry.keysecondary
        : Array.isArray(entry.secondary_keys)
          ? entry.secondary_keys
          : [],
  };
}

function worldbookEntryFields(
  entry,
  index,
  key,
  { prefix = "", entryAttribute = "data-worldbook-entry" } = {},
) {
  const { primary: keys, secondary } = worldbookEntryKeywordLists(entry);
  const extension = entry.extensions || {};
  const triState = [
    ["", "沿用世界书设置"],
    ["true", "是"],
    ["false", "否"],
  ];
  const migration = extension.tavern_headlessMigration;
  const usage = migration ? `<p class="small">${escapeHtml(({"variable-rule":"已迁移到 Agent 变量规则", "retired-protocol":"原始导入记录 · 旧输出协议已停用", "opening-state":"已迁移到开场初始变量"})[migration.usage] || migration.usage)} · ${escapeHtml(migration.target)}</p>` : "";
  const fieldPrefix = `${prefix}entry_${index}_`;
  return `<details class="version" ${entryAttribute} data-entry-key="${index}"><summary>${escapeHtml(entry.comment || `条目 ${index + 1}`)}</summary>${usage}<div class="actions"><button type="button" data-entry-up>上移</button><button type="button" data-entry-down>下移</button><button type="button" class="danger" data-entry-delete>删除</button></div><input type="hidden" name="${fieldPrefix}key_id" value="${escapeHtml(key)}">${fieldInput(`${fieldPrefix}comment`, "条目名称", entry.comment)}${fieldInput(`${fieldPrefix}keys`, "主触发词（逗号分隔）", keys.join(", "))}${fieldInput(`${fieldPrefix}secondary_keys`, "辅助触发词（逗号分隔）", secondary.join(", "))}<label class="field"><span><input type="checkbox" name="${fieldPrefix}selective" ${entry.selective ? "checked" : ""}> 使用辅助触发词</span></label>${fieldSelect(
    `${fieldPrefix}selectiveLogic`,
    "辅助词匹配逻辑",
    extension.selectiveLogic ?? entry.selectiveLogic ?? 0,
    [
      [0, "至少一个辅助词命中"],
      [1, "辅助词未全部命中"],
      [2, "辅助词均未命中"],
      [3, "全部辅助词命中"],
    ],
  )}${fieldTextarea(`${fieldPrefix}content`, "内容", entry.content, 8)}${fieldSelect(`${fieldPrefix}position`, "插入位置", extension.position ?? entry.position ?? 0, WORLDBOOK_POSITIONS)}${fieldInput(`${fieldPrefix}depth`, "指定深度", extension.depth ?? entry.depth ?? 4, "number")}${fieldSelect(
    `${fieldPrefix}role`,
    "指定深度消息角色",
    extension.role ?? entry.role ?? 0,
    [
      [0, "系统"],
      [1, "演绎者"],
      [2, "角色"],
    ],
  )}${fieldInput(`${fieldPrefix}outletName`, "Outlet 名称", extension.outlet_name ?? entry.outletName ?? entry.outlet_name ?? "")}${fieldInput(`${fieldPrefix}order`, "插入优先级", entry.insertion_order ?? entry.order ?? 100, "number")}${fieldInput(`${fieldPrefix}scanDepth`, "独立扫描深度", extension.scan_depth ?? entry.scanDepth ?? "", "number")}${fieldSelect(`${fieldPrefix}caseSensitive`, "大小写敏感", extension.case_sensitive ?? entry.caseSensitive ?? "", triState)}${fieldSelect(`${fieldPrefix}matchWholeWords`, "全词匹配", extension.match_whole_words ?? entry.matchWholeWords ?? "", triState)}${fieldInput(`${fieldPrefix}delayUntilRecursion`, "递归触发起始层级", extension.delay_until_recursion ?? entry.delayUntilRecursion ?? "", "number")}<label class="field"><span><input type="checkbox" name="${fieldPrefix}constant" ${entry.constant ? "checked" : ""}> 始终启用</span></label><label class="field"><span><input type="checkbox" name="${fieldPrefix}disable" ${
    entry.enabled !== undefined
      ? !entry.enabled
        ? "checked"
        : ""
      : entry.disable
        ? "checked"
        : ""
  }> 停用条目</span></label><label class="field"><span><input type="checkbox" name="${fieldPrefix}excludeRecursion" ${(extension.exclude_recursion ?? entry.excludeRecursion) ? "checked" : ""}> 仅初始轮触发</span></label><label class="field"><span><input type="checkbox" name="${fieldPrefix}preventRecursion" ${(extension.prevent_recursion ?? entry.preventRecursion) ? "checked" : ""}> 内容不进入递归缓冲区</span></label></details>`;
}

function worldbookSettingsFields(
  value,
  {
    prefix = "",
    entryAttribute = "data-worldbook-entry",
    listAttribute = "data-entry-list",
    addAttribute = "data-entry-add",
    includeName = false,
  } = {},
) {
  const entries = value.entries || {};
  return `${includeName ? fieldInput(`${prefix}name`, "世界书名称", value.name) : ""}${fieldInput(`${prefix}scanDepth`, "默认扫描深度", value.scanDepth ?? 2, "number", 'min="0"')}${fieldSelect(
    `${prefix}caseSensitive`,
    "默认大小写敏感",
    String(value.caseSensitive ?? false),
    [
      ["true", "是"],
      ["false", "否"],
    ],
  )}${fieldSelect(
    `${prefix}matchWholeWords`,
    "默认全词匹配",
    String(value.matchWholeWords ?? false),
    [
      ["true", "是"],
      ["false", "否"],
    ],
  )}<label class="field"><span><input type="checkbox" name="${prefix}recursive" ${value.recursive ? "checked" : ""}> 启用递归扫描</span></label>${fieldInput(`${prefix}maxRecursionSteps`, "最大递归次数", value.maxRecursionSteps ?? 0, "number", 'min="0"')}<h3>世界书条目</h3><div ${listAttribute}>${Object.entries(
    entries,
  )
    .map(([key, entry], index) =>
      worldbookEntryFields(entry, index, key, { prefix, entryAttribute }),
    )
    .join(
      "",
    )}</div><button type="button" ${addAttribute}>新增世界书条目</button>`;
}

export function regexSourceLabel(source) {
  if (!source) return "";
  return `${source.kind === "preset" ? "预设" : "角色卡"}：${source.name} · 原顺序 ${source.index + 1}`;
}

function regexEntryFields(entry, index) {
  const selectedPlacements = new Set((entry.placement || []).map(String));
  return `<details class="version" data-regex-entry data-entry-key="${index}"><summary>${escapeHtml(entry.scriptName || `规则 ${index + 1}`)}</summary>${entry.source ? `<p class="muted">${escapeHtml(regexSourceLabel(entry.source))}</p>` : ""}<div class="actions"><button type="button" data-entry-up>上移</button><button type="button" data-entry-down>下移</button><button type="button" class="danger" data-entry-delete>删除</button></div>${fieldInput(`entry_${index}_scriptName`, "规则名称", entry.scriptName)}${fieldTextarea(`entry_${index}_findRegex`, "查找表达式", entry.findRegex, 3)}${fieldTextarea(`entry_${index}_replaceString`, "替换内容", entry.replaceString, 3)}${fieldTextarea(`entry_${index}_trimStrings`, "捕获内容裁剪文本（JSON 数组）", pretty(entry.trimStrings || []), 4)}<fieldset><legend>应用位置</legend>${REGEX_PLACEMENTS.map(([placement, label]) => `<label><input type="checkbox" name="entry_${index}_placement" value="${placement}" ${selectedPlacements.has(String(placement)) ? "checked" : ""}> ${escapeHtml(label)}</label>`).join("")}</fieldset>${fieldInput(`entry_${index}_minDepth`, "最小深度（-1 表示不限）", entry.minDepth ?? -1, "number")}${fieldInput(`entry_${index}_maxDepth`, "最大深度（-1 表示不限）", entry.maxDepth ?? -1, "number")}${fieldSelect(
    `entry_${index}_substituteRegex`,
    "表达式宏替换",
    entry.substituteRegex ?? 0,
    [
      [0, "不替换宏"],
      [1, "原样替换"],
      [2, "转义后替换"],
    ],
  )}<label class="field"><span><input type="checkbox" name="entry_${index}_disabled" ${entry.disabled ? "checked" : ""}> 停用规则</span></label><label class="field"><span><input type="checkbox" name="entry_${index}_markdownOnly" ${entry.markdownOnly ? "checked" : ""}> 仅显示文本</span></label><label class="field"><span><input type="checkbox" name="entry_${index}_promptOnly" ${entry.promptOnly ? "checked" : ""}> 仅提示词</span></label><label class="field"><span><input type="checkbox" name="entry_${index}_runOnEdit" ${entry.runOnEdit ? "checked" : ""}> 编辑时运行</span></label></details>`;
}

function resourceFieldPanel(kind, detail, value) {
  const title = detail.name || detail.preset_name || RESOURCE_META[kind][0];
  let fields = "";
  if (kind === "character") fields = characterFields(value);
  if (kind === "persona")
    fields = `${fieldInput("name", "名称", value.name, "text", "required")}${fieldTextarea("description", "人设说明", value.description)}${fieldTextarea("personality", "性格", value.personality)}${fieldSelect(
      "status",
      "状态",
      value.status || detail.status || "active",
      [
        ["active", "启用"],
        ["disabled", "停用"],
      ],
    )}`;
  if (kind === "preset") {
    const top = value.top_level || {};
    fields = `${fieldInput("resource_name", "预设名称", detail.name, "text", "required")}${fieldInput("default_character_id", "默认提示词轨道", value.default_character_id, "number")}${fieldInput("temperature", "温度", top.temperature, "number", 'step="0.01"')}${fieldInput("top_p", "Top P", top.top_p, "number", 'step="0.01"')}${fieldInput("openai_max_context", "上下文上限", top.openai_max_context, "number")}${fieldInput("openai_max_tokens", "输出上限", top.openai_max_tokens, "number")}<h2>提示词条目</h2><div data-entry-list>${(value.entries || []).map(presetEntryFields).join("")}</div><button type="button" data-entry-add>新增提示词条目</button>`;
  }
  if (kind === "worldbook") {
    fields = `${fieldInput("resource_name", "世界书名称", detail.name, "text", "required")}${worldbookSettingsFields(value)}`;
  }
  if (kind === "regex")
    fields = `${fieldInput("resource_name", "正则配置名称", detail.name, "text", "required")}<h2>正则规则</h2><div data-entry-list>${value.map(regexEntryFields).join("")}</div><button type="button" data-entry-add>新增正则规则</button><section class="box"><h2>正则测试</h2>${fieldTextarea("regex_test_input", "输入文本", "", 5)}${fieldSelect(
      "regex_test_placement",
      "执行位置",
      2,
      REGEX_PLACEMENTS.filter(([value]) => value === 1 || value === 2),
    )}${fieldSelect("regex_test_channel", "执行通道", "persist", [
      ["persist", "持久化文本"],
      ["prompt", "提示词"],
      ["display", "显示文本"],
      ["edit", "编辑后文本"],
    ])}${fieldInput("regex_test_depth", "消息深度", 0, "number", 'min="0"')}${fieldTextarea("regex_test_variables", "宏变量（JSON 对象）", "{}", 4)}<button type="button" data-regex-test>运行测试</button><div class="readonly" data-regex-test-result></div></section>`;
  if (kind === "model")
    fields = `${fieldInput("preset_name", "模型配置名称", value.preset_name, "text", "required")}${fieldInput("model_id", "模型 ID", value.model_id, "text", "required")}<label class="field">服务商<select name="provider">${[
      ["openai", "OpenAI"],
      ["anthropic", "Anthropic"],
      ["google", "Google"],
      ["deepseek", "DeepSeek"],
      ["xai", "xAI"],
      ["openai-compatible", "OpenAI 兼容"],
    ]
      .map(
        ([provider, label]) =>
          `<option value="${provider}" ${provider === value.provider ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label>${fieldInput("base_url", "服务地址", value.base_url)}${fieldInput("api_key_name", "凭证名称", value.api_key_name)}${fieldInput("api_key", detail.id === "新建" ? "凭证" : "更新凭证", "", "password", `autocomplete="new-password" ${detail.id === "新建" ? "required" : 'placeholder="已有凭证留空保持不变"'}`)}<p class="small">当前凭证：${escapeHtml(detail.api_key_masked || "未设置")}</p><label class="field">状态<select name="status"><option value="active" ${value.status === "active" ? "selected" : ""}>启用</option><option value="disabled" ${value.status === "disabled" ? "selected" : ""}>停用</option></select></label><div class="actions"><button type="button" data-model-discover>获取模型列表</button><button type="button" data-model-test>测试连接</button></div><div data-model-result class="readonly"></div>`;
  return `<section class="panel"><div class="row"><div><h1>${escapeHtml(title)}</h1><p class="small">${escapeHtml(RESOURCE_META[kind][1])} ID：${escapeHtml(detail.id)}</p></div><button type="button" data-back-resource>返回列表</button></div><form data-formal-editor>${fields}${advancedJson(value)}<p class="small" data-formal-status role="status"></p><button class="primary" type="submit">保存</button></form></section>`;
}

function integerValue(data, key, fallback) {
  const raw = String(data.get(key) ?? "").trim();
  return raw === "" ? fallback : Number(raw);
}

export function mergeOrderedEntryValues(order, originals, editedByKey) {
  return order.map((key) => ({
    ...(originals[Number(key)] || {}),
    ...(editedByKey[key] || {}),
  }));
}

export function synchronizeWorldbookEntry(original, edited) {
  const { rootPosition = edited.position, ...fields } = edited;
  return {
    ...original,
    ...fields,
    position: rootPosition,
    ...(Array.isArray(edited.key) ? { keys: edited.key } : {}),
    ...(Array.isArray(edited.keysecondary)
      ? { secondary_keys: edited.keysecondary }
      : {}),
    insertion_order: edited.order,
    enabled: !edited.disable,
    extensions: {
      ...(original.extensions || {}),
      position: edited.position,
      selectiveLogic: edited.selectiveLogic,
      role: edited.role,
      depth: edited.depth,
      scan_depth: edited.scanDepth,
      case_sensitive: edited.caseSensitive,
      match_whole_words: edited.matchWholeWords,
      exclude_recursion: edited.excludeRecursion,
      prevent_recursion: edited.preventRecursion,
      delay_until_recursion: edited.delayUntilRecursion,
      ...(edited.outletName !== undefined
        ? { outlet_name: edited.outletName }
        : {}),
    },
  };
}

export function mergeWorldbookEntryPairs(originalEntries, pairs) {
  const merged = pairs.map(([key, edited]) => {
    const original = Array.isArray(originalEntries)
      ? originalEntries[Number(key)] || {}
      : originalEntries?.[key] || {};
    return [key, synchronizeWorldbookEntry(original, edited)];
  });
  return Array.isArray(originalEntries)
    ? merged.map(([, entry]) => entry)
    : Object.fromEntries(merged);
}

export function setCharacterFieldAlias(
  target,
  original,
  canonical,
  imported,
  nextValue,
) {
  if (Object.hasOwn(original, imported) && !Object.hasOwn(original, canonical))
    target[imported] = nextValue;
  else target[canonical] = nextValue;
}

export function setCharacterBookAlias(target, original, nextValue) {
  const importedShape =
    Object.hasOwn(original, "character_book") ||
    (!Object.hasOwn(original, "characterBook") &&
      Object.hasOwn(original, "first_mes"));
  delete target.characterBook;
  delete target.character_book;
  if (nextValue === undefined) return;
  target[importedShape ? "character_book" : "characterBook"] = nextValue;
}

function nextEntryKey(list) {
  return (
    Math.max(
      -1,
      ...[...list.children].map((node) => Number(node.dataset.entryKey)),
    ) + 1
  );
}

function bindEntryControls(container) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest?.(
      "[data-entry-up],[data-entry-down],[data-entry-delete]",
    );
    if (!button) return;
    const entry = button.closest("[data-entry-key]");
    if (!entry) return;
    if (button.hasAttribute("data-entry-delete")) entry.remove();
    else if (
      button.hasAttribute("data-entry-up") &&
      entry.previousElementSibling
    )
      entry.parentElement.insertBefore(entry, entry.previousElementSibling);
    else if (button.hasAttribute("data-entry-down") && entry.nextElementSibling)
      entry.parentElement.insertBefore(entry.nextElementSibling, entry);
  });
}

function bindCharacterBookEntryAdd(container) {
  container
    .querySelector("[data-character-book-entry-add]")
    ?.addEventListener("click", () => {
      const list = container.querySelector("[data-character-book-entry-list]");
      const index = nextEntryKey(list);
      list.insertAdjacentHTML(
        "beforeend",
        worldbookEntryFields({}, index, String(Date.now()), {
          prefix: "character_book_",
          entryAttribute: "data-character-book-entry",
        }),
      );
    });
}

function readWorldbookFields(
  form,
  data,
  original,
  {
    prefix = "",
    entrySelector = "[data-worldbook-entry]",
    includeName = false,
  } = {},
) {
  const value = structuredClone(original || {});
  if (includeName) value.name = String(data.get(`${prefix}name`) || "");
  value.scanDepth = integerValue(
    data,
    `${prefix}scanDepth`,
    value.scanDepth ?? 2,
  );
  value.caseSensitive = String(data.get(`${prefix}caseSensitive`)) === "true";
  value.matchWholeWords =
    String(data.get(`${prefix}matchWholeWords`)) === "true";
  value.recursive = data.has(`${prefix}recursive`);
  value.maxRecursionSteps = integerValue(
    data,
    `${prefix}maxRecursionSteps`,
    value.maxRecursionSteps ?? 0,
  );
  const oldEntries = original?.entries || {};
  const oldEntryValues = Array.isArray(oldEntries)
    ? oldEntries
    : Object.values(oldEntries);
  let nextEmbeddedId =
    Math.max(
      -1,
      ...oldEntryValues.map((entry) => Number(entry.id ?? entry.uid ?? -1)),
    ) + 1;
  const pairs = [...form.querySelectorAll(entrySelector)].map((node) => {
    const index = node.dataset.entryKey;
    const fieldPrefix = `${prefix}entry_${index}_`;
    const oldKey = String(data.get(`${fieldPrefix}key_id`) || index);
    const oldEntry = Array.isArray(oldEntries)
      ? oldEntries[Number(oldKey)] || {}
      : oldEntries[oldKey] || {};
    const scanDepthRaw = String(
      data.get(`${fieldPrefix}scanDepth`) ?? "",
    ).trim();
    const delayRaw = String(
      data.get(`${fieldPrefix}delayUntilRecursion`) ?? "",
    ).trim();
    const triValue = (name) => {
      const raw = String(data.get(`${fieldPrefix}${name}`) ?? "");
      return raw === "" ? null : raw === "true";
    };
    const primaryKeys = commaList(data.get(`${fieldPrefix}keys`));
    const secondaryKeys = commaList(data.get(`${fieldPrefix}secondary_keys`));
    const position = integerValue(data, `${fieldPrefix}position`, 0);
    const identity = prefix
      ? oldEntry.uid !== undefined
        ? { uid: oldEntry.uid }
        : { id: oldEntry.id ?? nextEmbeddedId++ }
      : { uid: oldEntry.uid ?? (Number(oldKey) || index) };
    return [
      oldKey,
      {
        ...identity,
        comment: String(data.get(`${fieldPrefix}comment`) || ""),
        key: primaryKeys,
        keysecondary: secondaryKeys,
        selective: data.has(`${fieldPrefix}selective`),
        selectiveLogic: integerValue(data, `${fieldPrefix}selectiveLogic`, 0),
        content: String(data.get(`${fieldPrefix}content`) || ""),
        position,
        ...(prefix && typeof oldEntry.position === "string"
          ? { rootPosition: position === 0 ? "before_char" : "after_char" }
          : {}),
        depth: integerValue(data, `${fieldPrefix}depth`, 4),
        role: integerValue(data, `${fieldPrefix}role`, 0),
        order: integerValue(data, `${fieldPrefix}order`, 100),
        outletName: String(data.get(`${fieldPrefix}outletName`) || ""),
        scanDepth: scanDepthRaw === "" ? null : Number(scanDepthRaw),
        caseSensitive: triValue("caseSensitive"),
        matchWholeWords: triValue("matchWholeWords"),
        excludeRecursion: data.has(`${fieldPrefix}excludeRecursion`),
        preventRecursion: data.has(`${fieldPrefix}preventRecursion`),
        delayUntilRecursion: delayRaw === "" ? null : Number(delayRaw),
        constant: data.has(`${fieldPrefix}constant`),
        disable: data.has(`${fieldPrefix}disable`),
      },
    ];
  });
  value.entries = mergeWorldbookEntryPairs(oldEntries, pairs);
  return value;
}

function readResourceFields(kind, form, original) {
  const data = new FormData(form);
  const value = JSON.parse(String(data.get("advanced")));
  if (kind === "character") {
    for (const key of [
      "name",
      "description",
      "personality",
      "scenario",
      "creator",
      "nickname",
    ])
      value[key] = String(data.get(key) || "");
    const greeting = String(data.get("greeting") || "");
    setCharacterFieldAlias(value, original, "greeting", "first_mes", greeting);
    if (Object.hasOwn(original, "primaryGreeting"))
      value.primaryGreeting = greeting;
    setCharacterFieldAlias(
      value,
      original,
      "exampleDialogue",
      "mes_example",
      String(data.get("mes_example") || ""),
    );
    setCharacterFieldAlias(
      value,
      original,
      "systemPrompt",
      "system_prompt",
      String(data.get("system_prompt") || ""),
    );
    setCharacterFieldAlias(
      value,
      original,
      "postHistoryInstructions",
      "post_history_instructions",
      String(data.get("post_history_instructions") || ""),
    );
    setCharacterFieldAlias(
      value,
      original,
      "creatorNotes",
      "creator_notes",
      String(data.get("creator_notes") || ""),
    );
    setCharacterFieldAlias(
      value,
      original,
      "characterVersion",
      "character_version",
      String(data.get("character_version") || ""),
    );
    value.tags = String(data.get("tags") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    setCharacterFieldAlias(
      value,
      original,
      "alternateGreetings",
      "alternate_greetings",
      JSON.parse(String(data.get("alternate_greetings") || "[]")),
    );
    setCharacterFieldAlias(
      value,
      original,
      "groupOnlyGreetings",
      "group_only_greetings",
      JSON.parse(String(data.get("group_only_greetings") || "[]")),
    );
    value.source = JSON.parse(String(data.get("source") || "[]"));
    applyRoleStateConfiguration(value, original, data);
    const originalBook = original.characterBook ?? original.character_book;
    setCharacterBookAlias(
      value,
      original,
      data.has("character_book_enabled")
        ? readWorldbookFields(form, data, originalBook || {}, {
            prefix: "character_book_",
            entrySelector: "[data-character-book-entry]",
            includeName: true,
          })
        : undefined,
    );
  }
  if (kind === "persona") {
    value.name = String(data.get("name") || "");
    value.description = String(data.get("description") || "");
    value.personality = String(data.get("personality") || "");
    value.status = String(data.get("status") || "active");
  }
  if (kind === "preset") {
    value.default_character_id = integerValue(
      data,
      "default_character_id",
      value.default_character_id,
    );
    value.top_level ||= {};
    for (const key of [
      "temperature",
      "top_p",
      "openai_max_context",
      "openai_max_tokens",
    ]) {
      const raw = String(data.get(key) ?? "").trim();
      if (raw !== "") value.top_level[key] = Number(raw);
    }
    const nodes = [...form.querySelectorAll("[data-preset-entry]")];
    const edits = Object.fromEntries(
      nodes.map((node) => {
        const key = node.dataset.entryKey;
        return [
          key,
          {
            identifier: String(data.get(`entry_${key}_identifier`) || ""),
            name: String(data.get(`entry_${key}_name`) || ""),
            role: String(data.get(`entry_${key}_role`) || "system"),
            content: String(data.get(`entry_${key}_content`) || ""),
            injection_position: integerValue(
              data,
              `entry_${key}_injection_position`,
              0,
            ),
            injection_depth: integerValue(
              data,
              `entry_${key}_injection_depth`,
              4,
            ),
            injection_order: integerValue(
              data,
              `entry_${key}_injection_order`,
              100,
            ),
            enabled: data.has(`entry_${key}_enabled`),
            system_prompt: data.has(`entry_${key}_system_prompt`),
            marker: data.has(`entry_${key}_marker`),
            forbid_overrides: data.has(`entry_${key}_forbid_overrides`),
            injection_trigger: JSON.parse(
              String(data.get(`entry_${key}_injection_trigger`) || "[]"),
            ),
            extra: JSON.parse(String(data.get(`entry_${key}_extra`) || "{}")),
          },
        ];
      }),
    );
    value.entries = mergeOrderedEntryValues(
      nodes.map((node) => node.dataset.entryKey),
      original.entries || [],
      edits,
    );
  }
  if (kind === "worldbook") {
    Object.assign(value, readWorldbookFields(form, data, original));
  }
  if (kind === "regex") {
    const nodes = [...form.querySelectorAll("[data-regex-entry]")];
    const edits = Object.fromEntries(
      nodes.map((node) => {
        const key = node.dataset.entryKey;
        return [
          key,
          {
            scriptName: String(data.get(`entry_${key}_scriptName`) || ""),
            findRegex: String(data.get(`entry_${key}_findRegex`) || ""),
            replaceString: String(data.get(`entry_${key}_replaceString`) || ""),
            trimStrings: JSON.parse(
              String(data.get(`entry_${key}_trimStrings`) || "[]"),
            ),
            placement: data
              .getAll(`entry_${key}_placement`)
              .map((item) => Number(item))
              .filter(Number.isFinite),
            minDepth: integerValue(data, `entry_${key}_minDepth`, -1),
            maxDepth: integerValue(data, `entry_${key}_maxDepth`, -1),
            substituteRegex: integerValue(
              data,
              `entry_${key}_substituteRegex`,
              0,
            ),
            disabled: data.has(`entry_${key}_disabled`),
            markdownOnly: data.has(`entry_${key}_markdownOnly`),
            promptOnly: data.has(`entry_${key}_promptOnly`),
            runOnEdit: data.has(`entry_${key}_runOnEdit`),
          },
        ];
      }),
    );
    return mergeOrderedEntryValues(
      nodes.map((node) => node.dataset.entryKey),
      original,
      edits,
    );
  }
  if (kind === "model") {
    for (const key of ["preset_name", "provider", "model_id", "status"])
      value[key] = String(data.get(key) || "");
    for (const key of ["base_url", "api_key_name"])
      value[key] = String(data.get(key) || "").trim() || null;
    const secret = String(data.get("api_key") || "").trim();
    if (secret) value.api_key = secret;
    else delete value.api_key;
  }
  return value;
}

export function createFormalAdminController({
  documentLike = globalThis.document,
  locationLike = globalThis.location,
  fetchImpl = globalThis.fetch,
} = {}) {
  const state = {
    loading: true,
    errors: {},
    shell: null,
    selectedSessionId: new URLSearchParams(locationLike.search).get("session") || "",
    view: "conversation",
    resourceKind: "character",
  };
  let client;
  let renderGeneration = 0;
  const q = (selector) => documentLike.querySelector(selector);

  function errorText(error) {
    return (
      state.errors[String(error?.code || "NETWORK_ERROR").toUpperCase()] ||
      state.errors.NETWORK_ERROR ||
      ""
    );
  }
  function notice(text) {
    const node = q("#notice");
    if (node) node.textContent = text;
  }
  async function action(button, task, success) {
    if (button) button.disabled = true;
    try {
      const result = await task();
      notice(success);
      return result;
    } catch (error) {
      notice(errorText(error));
      throw error;
    } finally {
      if (button) button.disabled = false;
    }
  }
  async function previewRegex(form, original, button) {
    const data = new FormData(form);
    const result = await action(
      button,
      () =>
        client.request("/regex-profiles/preview", {
          method: "POST",
          body: {
            text: String(data.get("regex_test_input") || ""),
            scripts: readResourceFields("regex", form, original),
            placement: Number(data.get("regex_test_placement")),
            channel: String(data.get("regex_test_channel")),
            depth: Number(data.get("regex_test_depth") || 0),
            variables: JSON.parse(
              String(data.get("regex_test_variables") || "{}"),
            ),
          },
        }),
      "正则测试已完成。",
    );
    form.querySelector("[data-regex-test-result]").innerHTML =
      `<p style="white-space:pre-wrap">${escapeHtml(result.text)}</p><dl><dt>候选规则</dt><dd>${escapeHtml((result.candidate_rule_names || []).join("、") || "无")}</dd><dt>已匹配规则</dt><dd>${escapeHtml((result.matched_rule_names || []).join("、") || "无")}</dd></dl>${result.skipped_rules?.length ? `<details><summary>未执行规则</summary>${result.skipped_rules.map((item) => `<p>${escapeHtml(item.rule_name)}：${escapeHtml(item.reason)}</p>`).join("")}</details>` : ""}`;
  }
  function selectedSession() {
    return (
      state.shell?.sessions.find(
        (item) => item.id === state.selectedSessionId,
      ) || null
    );
  }
  function selectedProject() {
    const session = selectedSession();
    return (
      state.shell?.projects.find(
        (project) => project.name === session?.title,
      ) ||
      state.shell?.projects[0] ||
      null
    );
  }

  async function renderEvents(session) {
    const container = q("#workspaceEvents");
    if (!container) return;
    if (!session) {
      container.innerHTML = "";
      container.hidden = true;
      return;
    }
    container.hidden = false;
    container.innerHTML = '<h2>最近操作</h2><p class="small">正在读取…</p>';
    try {
      const logs = await client.list(
        `/sessions/${encodeURIComponent(session.id)}/operation-logs`,
      );
      if (selectedSession()?.id !== session.id) return;
      container.innerHTML = `<h2>最近操作</h2>${
        logs.length
          ? logs
              .slice(0, 10)
              .map(
                (item) =>
                  `<div class="version"><strong>${escapeHtml(item.action || item.operation || item.type || item.status || "操作")}</strong><p class="small">${escapeHtml(formatTime(item.created_at || item.updated_at))}</p></div>`,
              )
              .join("")
          : '<p class="small">暂无操作记录。</p>'
      }`;
    } catch (error) {
      if (selectedSession()?.id !== session.id) return;
      container.innerHTML = `<h2>最近操作</h2><p role="alert" class="small">${escapeHtml(errorText(error))}</p>`;
    }
  }

  function renderChrome() {
    const shell = state.shell;
    const account = q("#accountSelect");
    if (account) {
      account.innerHTML = (shell?.workspaces || [])
        .map(
          (workspace) =>
            `<option value="${escapeHtml(workspace.account_id)}">${escapeHtml(workspace.account_id)}</option>`,
        )
        .join("");
      account.disabled = (shell?.workspaces || []).length < 2;
    }
    const session = selectedSession();
    const characters = shell.resources.character;
    const characterId =
      new URLSearchParams(locationLike.search).get("character") ||
      session?.character_binding?.character_id ||
      characters[0]?.id ||
      "";
    let picker = q("#openApp");
    if (picker.tagName !== "SELECT") {
      const select = documentLike.createElement("select");
      select.id = "openApp";
      select.className = "navitem";
      select.setAttribute("aria-label", "选择角色");
      picker.replaceWith(select);
      picker = select;
    }
    picker.innerHTML = characters
      .map(
        (character) =>
          `<option value="${escapeHtml(character.id)}" ${character.id === characterId ? "selected" : ""}>${escapeHtml(character.name)}</option>`,
      )
      .join("");
    picker.disabled = characters.length === 0;
    picker.onchange = () => {
      const url = new URL(locationLike.href);
      url.searchParams.set("character", picker.value);
      locationLike.assign(url.href);
    };
    q("#workspaceSummary").textContent =
      selectedProject()?.name || shell?.workspaces[0]?.name || "";

    const EventClass =
      documentLike.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (characterId && typeof EventClass === "function") {
      documentLike.dispatchEvent(
        new EventClass("formal-admin:character-context", {
          detail: { sessionId: session?.id || "", characterId },
        }),
      );
    }
    const nav = q("#resourceNav");
    nav.innerHTML = Object.entries(RESOURCE_META)
      .map(
        ([kind, [label]]) =>
          `<button class="navitem" data-formal-resource="${kind}">${escapeHtml(label)} <span class="tag">${shell.resources[kind].length}</span></button>`,
      )
      .join("");
    nav.querySelectorAll("[data-formal-resource]").forEach(
      (button) =>
        (button.onclick = () => {
          state.resourceKind = button.dataset.formalResource;
          state.view = "resource";
          renderResourceList();
        }),
    );
  }

  async function renderConversation() {
    const generation = ++renderGeneration;
    state.view = "conversation";
    const main = q("#mainView");
    const session = selectedSession();
    void renderEvents(session);
    if (!session) {
      main.innerHTML =
        '<section class="panel"><h1>演绎会话</h1><p class="empty">当前没有演绎记录。</p></section>';
      return;
    }
    main.innerHTML = `<section class="panel"><div class="row"><div><h1>${escapeHtml(session.title || session.id)}</h1><p class="small">${escapeHtml(session.character_binding?.snapshot_summary?.name || "")} · ${escapeHtml(session.user_binding?.snapshot_summary?.name || "")}</p></div><div class="actions"><button data-formal-refresh>刷新</button><button class="primary" data-formal-continue>继续演绎</button></div></div><div data-formal-timeline><p class="small">正在读取会话…</p></div></section>`;
    try {
      const payload = await client.timeline(session.id);
      if (generation !== renderGeneration) return;
      const messages = flattenFormalTimeline(payload);
      main.querySelector("[data-formal-timeline]").innerHTML = messages.length
        ? messages
            .map(
              (message) =>
                `<article class="message ${escapeHtml(message.role)}"><div class="small">${escapeHtml(formalMessageRoleLabel(message.role))} · 第 ${message.floor_no} 层</div><div class="md">${escapeHtml(message.content)}</div></article>`,
            )
            .join("")
        : '<p class="empty">会话中还没有消息。</p>';
    } catch (error) {
      main.querySelector("[data-formal-timeline]").innerHTML =
        `<p role="alert">${escapeHtml(errorText(error))}</p>`;
    }
    main.querySelector("[data-formal-refresh]").onclick = renderConversation;
    main.querySelector("[data-formal-continue]").onclick = () => {
      const url = new URL(
        "/prototype/apps/user-web/prototypes/script-roleplay.prototype.html",
        locationLike.origin,
      );
      url.searchParams.set("source", "backend");
      url.searchParams.set("session", session.id);
      locationLike.assign(url.href);
    };
  }

  function renderResourceList() {
    renderGeneration += 1;
    const kind = state.resourceKind,
      [label] = RESOURCE_META[kind],
      items = state.shell.resources[kind];
    q("#mainView").innerHTML =
      `<section class="panel"><div class="row"><h1>${escapeHtml(label)}</h1><div class="actions"><button data-formal-new>新建</button><button data-formal-import>导入 JSON</button><button data-formal-reload>刷新</button></div></div><div class="cards">${items.length ? items.map((item) => `<article class="card"><button class="navitem" data-formal-resource-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name || item.preset_name || item.id)}</strong><span class="small">${escapeHtml(formalResourceSourceLabel(item.source) || item.provider || formalResourceStatusLabel(item.status))}</span></button><div class="actions">${["character", "preset", "worldbook", "regex"].includes(kind) ? `<button data-formal-export="${escapeHtml(item.id)}">导出</button>` : ""}<button class="danger" data-formal-delete="${escapeHtml(item.id)}">删除</button></div></article>`).join("") : `<p class="empty">暂无${escapeHtml(label)}。</p>`}</div></section>`;
    q("#mainView").querySelector("[data-formal-reload]").onclick = async () => {
      await refresh(false);
      renderResourceList();
    };
    q("#mainView").querySelector("[data-formal-new]").onclick = () =>
      renderResourceCreate(kind);
    q("#mainView").querySelector("[data-formal-import]").onclick = () => {
      const input = q("#importFile");
      input.value = "";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          const name =
            parsed.name ||
            parsed.preset_name ||
            file.name.replace(/\.json$/i, "");
          await client.createResource(kind, name, parsed);
          notice(`${label}已导入。`);
          await refresh(false);
          renderResourceList();
        } catch (error) {
          notice(
            error instanceof SyntaxError
              ? state.errors.VALIDATION_ERROR
              : errorText(error),
          );
        }
      };
      input.click();
    };
    q("#mainView")
      .querySelectorAll("[data-formal-resource-id]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            renderResourceEditor(kind, button.dataset.formalResourceId)),
      );
    q("#mainView")
      .querySelectorAll("[data-formal-export]")
      .forEach(
        (button) =>
          (button.onclick = () => {
            const route = kind === "regex" ? "regex" : kind;
            globalThis.open?.(
              `/export/${route}/${encodeURIComponent(button.dataset.formalExport)}`,
              "_blank",
              "noopener",
            );
          }),
      );
    q("#mainView")
      .querySelectorAll("[data-formal-delete]")
      .forEach(
        (button) =>
          (button.onclick = async () => {
            if (!globalThis.confirm?.(`删除这个${label}？`)) return;
            try {
              await action(
                button,
                () => client.deleteResource(kind, button.dataset.formalDelete),
                `${label}已删除。`,
              );
              await refresh(false);
              renderResourceList();
            } catch {
              return;
            }
          }),
      );
  }

  function renderResourceCreate(kind) {
    const [label] = RESOURCE_META[kind];
    const defaults = {
      character: {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name: "",
          description: "",
          personality: "",
          scenario: "",
          first_mes: "",
          mes_example: "",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          alternate_greetings: [],
          character_book: null,
          tags: [],
          creator: "",
          character_version: "1.0",
          extensions: {},
        },
      },
      preset: {
        entries: [],
        order_contexts: [],
        top_level: {},
        default_character_id: 100000,
      },
      worldbook: { entries: {} },
      regex: [],
      persona: { name: "", description: "" },
      model: {
        preset_name: "",
        provider: "openai-compatible",
        model_id: "",
        api_key: "",
      },
    };
    const value =
      kind === "character" ? defaults.character.data : defaults[kind];
    const detail = {
      id: "新建",
      name: `新建${label}`,
      preset_name: `新建${label}`,
    };
    q("#mainView").innerHTML = resourceFieldPanel(kind, detail, value);
    const form = q("#mainView [data-formal-editor]");
    q("#mainView [data-back-resource]").onclick = renderResourceList;
    bindEntryControls(form);
    bindCharacterBookEntryAdd(form);
    q("#mainView [data-entry-add]")?.addEventListener("click", () => {
      const list = q("#mainView [data-entry-list]");
      const index = nextEntryKey(list);
      if (kind === "preset")
        list.insertAdjacentHTML(
          "beforeend",
          presetEntryFields({ role: "system", enabled: true }, index),
        );
      if (kind === "worldbook")
        list.insertAdjacentHTML(
          "beforeend",
          worldbookEntryFields({}, index, String(Date.now())),
        );
      if (kind === "regex")
        list.insertAdjacentHTML(
          "beforeend",
          regexEntryFields({ placement: [1, 2] }, index),
        );
    });
    q("#mainView [data-regex-test]")?.addEventListener("click", (event) => {
      void previewRegex(form, value, event.currentTarget).catch((error) => {
        form.querySelector("[data-formal-status]").textContent =
          error instanceof SyntaxError
            ? state.errors.VALIDATION_ERROR
            : errorText(error);
      });
    });
    q("#mainView [data-model-discover]")?.addEventListener(
      "click",
      async (event) => {
        const data = new FormData(form);
        try {
          const result = await action(
            event.currentTarget,
            () =>
              client.request("/llm-profiles/models/discover", {
                method: "POST",
                body: {
                  provider: String(data.get("provider")),
                  api_key: String(data.get("api_key") || ""),
                  ...(String(data.get("base_url") || "").trim()
                    ? { base_url: String(data.get("base_url")).trim() }
                    : {}),
                },
              }),
            "模型列表已更新。",
          );
          q("#mainView [data-model-result]").textContent = pretty(result);
        } catch {
          return;
        }
      },
    );
    q("#mainView [data-model-test]")?.addEventListener(
      "click",
      async (event) => {
        const data = new FormData(form);
        try {
          const result = await action(
            event.currentTarget,
            () =>
              client.request("/llm-profiles/models/test", {
                method: "POST",
                body: {
                  provider: String(data.get("provider")),
                  model_id: String(data.get("model_id")),
                  api_key: String(data.get("api_key") || ""),
                  ...(String(data.get("base_url") || "").trim()
                    ? { base_url: String(data.get("base_url")).trim() }
                    : {}),
                },
              }),
            "模型连接测试完成。",
          );
          q("#mainView [data-model-result]").textContent = pretty(result);
        } catch {
          return;
        }
      },
    );
    form.onsubmit = async (event) => {
      event.preventDefault();
      const d = new FormData(form);
      try {
        const updated = readResourceFields(kind, form, value);
        if (kind === "model") {
          if (updated.base_url === null) delete updated.base_url;
          if (updated.api_key_name === null) delete updated.api_key_name;
          delete updated.status;
        }
        const createValue =
          kind === "character"
            ? { ...defaults.character, data: updated }
            : updated;
        await action(
          event.submitter,
          () =>
            client.createResource(
              kind,
              String(d.get("resource_name") || updated.name || ""),
              createValue,
            ),
          `${label}已新建。`,
        );
        await refresh(false);
        renderResourceList();
      } catch (error) {
        form.querySelector("[data-formal-status]").textContent =
          error instanceof SyntaxError
            ? state.errors.VALIDATION_ERROR
            : errorText(error);
      }
    };
  }

  async function renderResourceEditor(kind, id) {
    const generation = ++renderGeneration;
    const main = q("#mainView");
    main.innerHTML =
      '<section class="panel"><p role="status">正在读取资源…</p></section>';
    try {
      const detail = await client.resourceDetail(kind, id);
      if (generation !== renderGeneration) return;
      let value =
        detail.data ??
        detail.snapshot ??
        detail.latest_version?.snapshot ??
        detail.editor ??
        detail;
      if (kind === "character")
        value =
          detail.latest_version?.snapshot || detail.snapshot || detail.data;
      if (kind === "preset") value = detail.editor;
      if (kind === "persona") value = detail.snapshot;
      if (kind === "model")
        value = {
          preset_name: detail.preset_name,
          provider: detail.provider,
          model_id: detail.model_id,
          base_url: detail.base_url,
          api_key_name: detail.api_key_name,
          status: detail.status,
        };
      main.innerHTML = resourceFieldPanel(kind, detail, value);
      if (kind === "worldbook") {
        const releases = await client.request("/role-releases");
        if (generation !== renderGeneration) return;
        const owners = [...new Map(releases.filter(release=>release.worldbook_id===id).map(release=>[release.character_id,release])).values()];
        const navigation = documentLike.createElement("div");
        navigation.className = "actions";
        for (const owner of owners) {
          const button = documentLike.createElement("button");
          button.type="button";button.textContent=`编辑 ${owner.name} 的变量配置`;
          button.onclick=async()=>{await renderResourceEditor("character",owner.character_id);q("#role-variable-configuration")?.scrollIntoView({block:"start"});};
          navigation.append(button);
        }
        main.querySelector("h1").after(navigation);
      }
      const form = main.querySelector("[data-formal-editor]");
      main.querySelector("[data-back-resource]").onclick = renderResourceList;
      main.querySelector("[data-state-contract]")?.addEventListener("click", async () => {
        const target=main.querySelector("[data-state-contract-result]");
        try {
          const result=await client.request(`/characters/${encodeURIComponent(id)}/versions/${encodeURIComponent(detail.latest_version.id)}/state-contract`);
          target.textContent=pretty(result);
        } catch(error) {target.textContent=errorText(error);}
      });
      bindEntryControls(form);
      bindCharacterBookEntryAdd(form);
      main.querySelector("[data-entry-add]")?.addEventListener("click", () => {
        const list = main.querySelector("[data-entry-list]");
        const index = nextEntryKey(list);
        if (kind === "preset")
          list.insertAdjacentHTML(
            "beforeend",
            presetEntryFields(
              {
                identifier: `new-${Date.now()}`,
                role: "system",
                enabled: true,
              },
              index,
            ),
          );
        if (kind === "worldbook")
          list.insertAdjacentHTML(
            "beforeend",
            worldbookEntryFields({}, index, String(Date.now())),
          );
        if (kind === "regex")
          list.insertAdjacentHTML(
            "beforeend",
            regexEntryFields({ placement: [1, 2] }, index),
          );
      });
      main
        .querySelector("[data-regex-test]")
        ?.addEventListener("click", (event) => {
          void previewRegex(form, value, event.currentTarget).catch((error) => {
            form.querySelector("[data-formal-status]").textContent =
              error instanceof SyntaxError
                ? state.errors.VALIDATION_ERROR
                : errorText(error);
          });
        });
      main
        .querySelector("[data-model-discover]")
        ?.addEventListener("click", async (event) => {
          const data = new FormData(form);
          try {
            const result = await action(
              event.currentTarget,
              () =>
                client.request("/llm-profiles/models/discover", {
                  method: "POST",
                  body: {
                    profile_id: detail.id,
                    ...(String(data.get("api_key") || "").trim()
                      ? { api_key: String(data.get("api_key")).trim() }
                      : {}),
                  },
                }),
              "模型列表已更新。",
            );
            main.querySelector("[data-model-result]").textContent =
              pretty(result);
          } catch {
            return;
          }
        });
      main
        .querySelector("[data-model-test]")
        ?.addEventListener("click", async (event) => {
          const data = new FormData(form);
          try {
            const result = await action(
              event.currentTarget,
              () =>
                client.request("/llm-profiles/models/test", {
                  method: "POST",
                  body: {
                    profile_id: detail.id,
                    model_id: String(data.get("model_id")),
                    ...(String(data.get("api_key") || "").trim()
                      ? { api_key: String(data.get("api_key")).trim() }
                      : {}),
                  },
                }),
              "模型连接测试完成。",
            );
            main.querySelector("[data-model-result]").textContent =
              pretty(result);
          } catch {
            return;
          }
        });
      form.onsubmit = async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const status = form.querySelector("[data-formal-status]");
        try {
          const updated = readResourceFields(kind, form, value);
          await action(
            event.submitter,
            () =>
              client.saveResource(
                kind,
                detail,
                String(data.get("resource_name") || detail.name || ""),
                updated,
              ),
            "资源已保存。",
          );
          status.textContent = "资源已保存。";
          await refresh(false);
          await renderResourceEditor(kind, id);
        } catch (error) {
          status.textContent =
            error instanceof SyntaxError
              ? state.errors.VALIDATION_ERROR || errorText(error)
              : errorText(error);
        }
      };
    } catch (error) {
      main.innerHTML = `<section class="panel"><p role="alert">${escapeHtml(errorText(error))}</p></section>`;
    }
  }

  async function renderCollectionPage(title, load, actions = {}) {
    const generation = ++renderGeneration;
    const main = q("#mainView");
    main.innerHTML = `<section class="panel"><h1>${escapeHtml(title)}</h1><p role="status">正在读取…</p></section>`;
    try {
      const result = await load();
      if (generation !== renderGeneration) return;
      const items = displayItems(result);
      main.innerHTML = `<section class="panel"><div class="row"><h1>${escapeHtml(title)}</h1><button data-reload>刷新</button></div>${actions.create ? `<form data-create>${actions.create}</form>` : ""}<div class="cards">${items.length ? items.map((item) => `<article class="card"><strong>${escapeHtml(item.name || item.key || item.type || item.id)}</strong><pre class="mono">${escapeHtml(pretty(item))}</pre>${actions.item ? actions.item(item) : ""}</article>`).join("") : `<p class="empty">暂无${escapeHtml(title)}记录。</p>`}</div></section>`;
      main.querySelector("[data-reload]").onclick = () =>
        renderRuntime(state.view);
      actions.bind?.(main, items);
    } catch (error) {
      main.innerHTML = `<section class="panel"><h1>${escapeHtml(title)}</h1><p role="alert">${escapeHtml(errorText(error))}</p></section>`;
    }
  }

  async function renderVariables() {
    const session = selectedSession();
    await renderCollectionPage(
      "变量调试",
      () =>
        client.list(
          `/variables?scope=chat&scope_id=${encodeURIComponent(session.id)}`,
        ),
      {
        create:
          '<label class="field">变量名<input name="key" required></label><label class="field">JSON 值<textarea name="value" rows="4" required></textarea></label><button class="primary">写入会话变量</button>',
        item: (item) =>
          `<div class="actions"><button class="danger" data-variable-delete="${escapeHtml(item.id)}">删除</button></div>`,
        bind(main) {
          main.querySelector("[data-create]").onsubmit = async (event) => {
            event.preventDefault();
            const d = new FormData(event.currentTarget);
            try {
              await action(
                event.submitter,
                () =>
                  client.request("/variables", {
                    method: "PUT",
                    body: {
                      scope: "chat",
                      scope_id: session.id,
                      key: String(d.get("key")),
                      value: JSON.parse(String(d.get("value"))),
                    },
                  }),
                "变量已保存。",
              );
              renderVariables();
            } catch (error) {
              notice(
                error instanceof SyntaxError
                  ? state.errors.VALIDATION_ERROR
                  : errorText(error),
              );
            }
          };
          main.querySelectorAll("[data-variable-delete]").forEach(
            (button) =>
              (button.onclick = async () => {
                try {
                  await action(
                    button,
                    () =>
                      client.request(
                        `/variables/${encodeURIComponent(button.dataset.variableDelete)}`,
                        { method: "DELETE" },
                      ),
                    "变量已删除。",
                  );
                  renderVariables();
                } catch {
                  return;
                }
              }),
          );
        },
      },
    );
  }

  async function renderMemory() {
    const session = selectedSession();
    await renderCollectionPage(
      "记忆调试",
      () =>
        client.list(
          `/memories?scope=chat&scope_id=${encodeURIComponent(session.id)}`,
        ),
      {
        create:
          '<label class="field">记忆内容<textarea name="content" rows="4" required></textarea></label><label class="field">类型<select name="type"><option value="fact">事实</option><option value="summary">摘要</option><option value="open_loop">未结事项</option></select></label><button class="primary">新增记忆</button>',
        item: (item) =>
          `<div class="actions"><button data-memory-deprecate="${escapeHtml(item.id)}">标记过时</button><button class="danger" data-memory-delete="${escapeHtml(item.id)}">删除</button></div>`,
        bind(main) {
          main.querySelector("[data-create]").onsubmit = async (event) => {
            event.preventDefault();
            const d = new FormData(event.currentTarget);
            try {
              await action(
                event.submitter,
                () =>
                  client.request("/memories", {
                    method: "POST",
                    body: {
                      scope: "chat",
                      scope_id: session.id,
                      type: String(d.get("type")),
                      content: String(d.get("content")),
                    },
                  }),
                "记忆已新增。",
              );
              renderMemory();
            } catch {
              return;
            }
          };
          main.querySelectorAll("[data-memory-deprecate]").forEach(
            (button) =>
              (button.onclick = async () => {
                try {
                  await action(
                    button,
                    () =>
                      client.request(
                        `/memories/${encodeURIComponent(button.dataset.memoryDeprecate)}`,
                        { method: "PATCH", body: { status: "deprecated" } },
                      ),
                    "记忆状态已更新。",
                  );
                  renderMemory();
                } catch {
                  return;
                }
              }),
          );
          main.querySelectorAll("[data-memory-delete]").forEach(
            (button) =>
              (button.onclick = async () => {
                try {
                  await action(
                    button,
                    () =>
                      client.request(
                        `/memories/${encodeURIComponent(button.dataset.memoryDelete)}`,
                        { method: "DELETE" },
                      ),
                    "记忆已删除。",
                  );
                  renderMemory();
                } catch {
                  return;
                }
              }),
          );
        },
      },
    );
  }

  function renderManagerForm(kind, item = null) {
    const isTool = kind === "tools";
    const title = isTool ? "工具" : "MCP 服务器";
    const root = isTool ? "/tools/definitions" : "/mcp/servers";
    const value =
      item ||
      (isTool
        ? {
            name: "",
            description: "",
            parameters: { type: "object", properties: {} },
            side_effect_level: "none",
            allowed_slots: [],
            enabled: true,
            handler_type: "script",
            handler: {},
          }
        : {
            name: "",
            transport: "stdio",
            stdio: { command: "", args: [] },
            enabled: false,
          });
    const transport = value.transport || "stdio";
    const editableAdvanced = isTool
      ? {
          source: value.source || "custom",
          source_id: value.source_id ?? null,
        }
      : {
          tool_refresh_interval_ms: value.tool_refresh_interval_ms,
          default_side_effect_level: value.default_side_effect_level || "none",
          metadata_overrides: value.metadata_overrides || [],
        };
    q("#mainView").innerHTML =
      `<section class="panel"><div class="row"><h1>${item ? "编辑" : "新建"}${title}</h1><button data-manager-back>返回列表</button></div><form data-manager-form>${fieldInput("name", "名称", value.name, "text", "required")}${
        isTool
          ? `${fieldTextarea("description", "说明", value.description, 3)}<label class="field">副作用级别<select name="side_effect_level">${[
              ["none", "无"],
              ["sandbox", "沙箱内"],
              ["irreversible", "不可撤销"],
            ]
              .map(
                ([level, label]) =>
                  `<option value="${level}" ${level === value.side_effect_level ? "selected" : ""}>${label}</option>`,
              )
              .join(
                "",
              )}</select></label><label class="field">处理方式<select name="handler_type"><option value="script">脚本</option></select></label>${fieldInput("allowed_slots", "允许的模型槽位（逗号分隔）", (value.allowed_slots || []).join(", "))}${fieldTextarea("parameters", "参数 Schema", pretty(value.parameters || {}), 8)}${fieldTextarea("handler", "脚本处理配置", pretty(value.handler || {}), 6)}`
          : `<label class="field">连接方式<select name="transport"><option value="stdio" ${transport === "stdio" ? "selected" : ""}>本地进程</option><option value="http" ${transport === "http" ? "selected" : ""}>HTTP</option></select></label>${fieldInput("command", "启动命令", value.stdio?.command)}${fieldTextarea("args", "命令参数（每行一个）", (value.stdio?.args || []).join("\n"), 4)}${fieldTextarea("env", "环境变量 JSON（更新凭证时填写）", "", 4)}${fieldInput("url", "HTTP 地址", value.http?.url)}${fieldTextarea("headers", "HTTP 请求头 JSON（更新凭证时填写）", "", 4)}${fieldInput("tool_prefix", "工具名前缀", value.tool_prefix)}${fieldInput("connect_timeout_ms", "连接超时（毫秒）", value.connect_timeout_ms, "number")}${fieldInput("call_timeout_ms", "调用超时（毫秒）", value.call_timeout_ms, "number")}`
      }${item ? "" : `<label class="field"><span><input type="checkbox" name="enabled" ${value.enabled ? "checked" : ""}> 启用</span></label>`}${advancedJson(editableAdvanced)}<p data-formal-status class="small"></p><button class="primary">保存</button></form></section>`;
    q("#mainView [data-manager-back]").onclick = () =>
      renderStructuredManager(kind);
    const form = q("#mainView [data-manager-form]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        const body = JSON.parse(String(data.get("advanced")));
        body.name = String(data.get("name"));
        if (isTool) {
          body.description = String(data.get("description") || "");
          body.side_effect_level = String(data.get("side_effect_level"));
          body.handler_type = String(data.get("handler_type"));
          body.allowed_slots = String(data.get("allowed_slots") || "")
            .split(",")
            .map((slot) => slot.trim())
            .filter(Boolean);
          body.parameters = JSON.parse(String(data.get("parameters")));
          body.handler = JSON.parse(String(data.get("handler")));
        } else {
          body.transport = String(data.get("transport"));
          const toolPrefix = String(data.get("tool_prefix") || "").trim();
          if (toolPrefix) body.tool_prefix = toolPrefix;
          else if (item) body.tool_prefix = null;
          else delete body.tool_prefix;
          for (const key of ["connect_timeout_ms", "call_timeout_ms"]) {
            const raw = String(data.get(key) || "").trim();
            if (raw) body[key] = Number(raw);
            else delete body[key];
          }
          if (body.transport === "stdio") {
            body.stdio = {
              command: String(data.get("command") || ""),
              args: String(data.get("args") || "")
                .split("\n")
                .filter(Boolean),
            };
            const env = String(data.get("env") || "").trim();
            if (env) body.stdio.env = JSON.parse(env);
            delete body.http;
          } else {
            body.http = {
              ...(body.http || {}),
              url: String(data.get("url") || ""),
            };
            const headers = String(data.get("headers") || "").trim();
            if (headers) body.http.headers = JSON.parse(headers);
            delete body.stdio;
          }
        }
        if (!item) body.enabled = data.has("enabled");
        else delete body.enabled;
        await action(
          event.submitter,
          () =>
            client.request(
              item ? `${root}/${encodeURIComponent(item.id)}` : root,
              { method: item ? "PATCH" : "POST", body },
            ),
          `${title}已保存。`,
        );
        renderStructuredManager(kind);
      } catch (error) {
        form.querySelector("[data-formal-status]").textContent =
          error instanceof SyntaxError
            ? state.errors.VALIDATION_ERROR
            : errorText(error);
      }
    };
  }

  async function renderStructuredManager(kind) {
    state.view = kind;
    const generation = ++renderGeneration;
    const isTool = kind === "tools";
    const title = isTool ? "工具管理" : "MCP 管理";
    const root = isTool ? "/tools/definitions" : "/mcp/servers";
    q("#mainView").innerHTML =
      `<section class="panel"><p role="status">正在读取${title}…</p></section>`;
    try {
      const items = await client.list(root);
      if (generation !== renderGeneration) return;
      q("#mainView").innerHTML =
        `<section class="panel"><div class="row"><h1>${title}</h1><div class="actions"><button data-manager-new>新建</button><button data-manager-refresh>刷新</button></div></div><div class="cards">${items.map((item) => `<article class="card"><strong>${escapeHtml(item.name)}</strong><p class="small">${escapeHtml(isTool ? item.handler_type : item.transport)} · ${item.enabled ? "启用" : "停用"}</p><div class="actions"><button data-manager-edit="${escapeHtml(item.id)}">编辑</button><button data-manager-toggle="${escapeHtml(item.id)}">${item.enabled ? "停用" : "启用"}</button><button data-manager-delete="${escapeHtml(item.id)}">删除</button></div><details><summary>高级配置</summary><pre class="mono">${escapeHtml(pretty(item))}</pre></details></article>`).join("") || `<p class="empty">暂无${title}记录。</p>`}</div></section>`;
      const main = q("#mainView");
      main.querySelector("[data-manager-new]").onclick = () =>
        renderManagerForm(kind);
      main.querySelector("[data-manager-refresh]").onclick = () =>
        renderStructuredManager(kind);
      main.querySelectorAll("[data-manager-edit]").forEach(
        (button) =>
          (button.onclick = () =>
            renderManagerForm(
              kind,
              items.find((item) => item.id === button.dataset.managerEdit),
            )),
      );
      main.querySelectorAll("[data-manager-toggle]").forEach(
        (button) =>
          (button.onclick = async () => {
            const item = items.find(
              (entry) => entry.id === button.dataset.managerToggle,
            );
            try {
              await action(
                button,
                () =>
                  client.request(
                    `${root}/${encodeURIComponent(item.id)}/toggle`,
                    { method: "PATCH", body: { enabled: !item.enabled } },
                  ),
                `${title}状态已更新。`,
              );
              renderStructuredManager(kind);
            } catch {
              return;
            }
          }),
      );
      main.querySelectorAll("[data-manager-delete]").forEach(
        (button) =>
          (button.onclick = async () => {
            try {
              await action(
                button,
                () =>
                  client.request(
                    `${root}/${encodeURIComponent(button.dataset.managerDelete)}`,
                    { method: "DELETE" },
                  ),
                `${title}配置已删除。`,
              );
              renderStructuredManager(kind);
            } catch {
              return;
            }
          }),
      );
    } catch (error) {
      q("#mainView").innerHTML =
        `<section class="panel"><h1>${title}</h1><p role="alert">${escapeHtml(errorText(error))}</p></section>`;
    }
  }

  async function renderRuntime(view) {
    state.view = view;
    const session = selectedSession(),
      workspace = state.shell.workspaces[0],
      project = selectedProject();
    if (
      !session &&
      ["variables", "memory", "branches", "live-tools", "runtime"].includes(
        view,
      )
    ) {
      q("#mainView").innerHTML =
        '<section class="panel"><p class="empty">请选择会话。</p></section>';
      return;
    }
    if (view === "tools" || view === "mcp")
      return renderStructuredManager(view);
    if (view === "variables") return renderVariables();
    if (view === "memory") return renderMemory();
    if (view === "branches")
      return renderCollectionPage("分支与历史", () =>
        client.request(`/sessions/${encodeURIComponent(session.id)}/branches`),
      );
    if (view === "live-tools")
      return renderCollectionPage("实时工具调用", () =>
        client.list(
          `/tool-executions?session_id=${encodeURIComponent(session.id)}`,
        ),
      );
    if (view === "runtime")
      return renderCollectionPage(
        "演绎运行配置",
        async () => {
          const effective = await client.request(
            `/sessions/${encodeURIComponent(session.id)}/effective-config`,
          );
          const resolved = await client.request(
            `/llm-instances/resolved?session_id=${encodeURIComponent(session.id)}`,
          );
          return [effective, ...displayItems(resolved)];
        },
        {
          create: `<label class="field">模型槽位<select name="slot"><option value="narrator">演绎角色</option><option value="director">导演</option><option value="verifier">校验</option><option value="memory">记忆</option><option value="*">默认模型</option></select></label><label class="field">提示词预设<select name="preset_id"><option value="">沿用当前设置</option>${state.shell.resources.preset.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join("")}</select></label>${fieldInput("model_id_override", "模型 ID 覆盖", "")}${fieldInput("max_context_tokens", "上下文上限", "", "number", 'min="1"')}${fieldInput("max_output_tokens", "输出上限", "", "number", 'min="1"')}${fieldInput("temperature", "温度", "", "number", 'step="0.01"')}${fieldInput("top_p", "Top P", "", "number", 'step="0.01"')}<label class="field">推理强度<select name="reasoning_effort"><option value="">沿用当前设置</option><option value="none">无</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label class="field"><span><input type="checkbox" name="enabled" checked> 启用此槽位</span></label><button class="primary">保存会话覆盖</button>`,
          bind(main) {
            main.querySelector("[data-create]").onsubmit = async (event) => {
              event.preventDefault();
              const d = new FormData(event.currentTarget);
              try {
                const params = {};
                for (const key of [
                  "max_context_tokens",
                  "max_output_tokens",
                  "temperature",
                  "top_p",
                ]) {
                  const raw = String(d.get(key) || "").trim();
                  if (raw) params[key] = Number(raw);
                }
                const reasoning = String(d.get("reasoning_effort") || "");
                if (reasoning) params.reasoning_effort = reasoning;
                const presetId = String(d.get("preset_id") || "");
                const modelId = String(d.get("model_id_override") || "");
                await action(
                  event.submitter,
                  () =>
                    client.request(
                      `/llm-instances/${encodeURIComponent(String(d.get("slot")))}`,
                      {
                        method: "PUT",
                        body: {
                          scope: "session",
                          session_id: session.id,
                          preset_id: presetId || null,
                          model_id_override: modelId || null,
                          enabled: d.has("enabled"),
                          params: Object.keys(params).length ? params : null,
                        },
                      },
                    ),
                  "运行配置已保存。",
                );
                renderRuntime("runtime");
              } catch {
                return;
              }
            };
          },
        },
      );
    if (view === "agent-types") return renderAgentTypes(workspace);
    if (view === "agent-bindings") return renderAgentBindings(project);
  }

  async function renderAgentTypes(workspace) {
    const root = `/workspaces/${encodeURIComponent(workspace.id)}/agent-types`;
    await renderCollectionPage(
      "工作区 Agent 类型",
      () => client.request(root),
      {
        create: `${fieldInput("key", "类型 Key", "", "text", "required")}${fieldInput("name", "类型名称", "", "text", "required")}<label class="field">运行作用域<select name="scope_kind"><option value="floor">楼层</option><option value="session">会话</option><option value="project">项目</option><option value="workspace">工作区</option></select></label><label class="field">默认模型配置<select name="llm_profile_id"><option value="">不指定</option>${state.shell.resources.model.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.preset_name)}</option>`).join("")}</select></label>${agentConfigurationFields()}<button class="primary">新建类型</button>`,
        item: (item) =>
          `<div class="actions"><button data-agent-edit="${escapeHtml(item.id)}">编辑</button><button data-agent-toggle="${escapeHtml(item.id)}">${item.status === "active" ? "停用" : "启用"}</button></div>`,
        bind(main, items) {
          main.querySelector("[data-create]").onsubmit = async (event) => {
            event.preventDefault();
            try {
              const data = new FormData(event.currentTarget);
              const defaults = buildAgentConfiguration(data);
              const profileId = String(data.get("llm_profile_id") || "");
              if (profileId) defaults.llm_profile_id = profileId;
              await action(
                event.submitter,
                () =>
                  client.request(root, {
                    method: "POST",
                    body: {
                      key: String(data.get("key")),
                      name: String(data.get("name")),
                      scope_kind: String(data.get("scope_kind")),
                      defaults,
                    },
                  }),
                "Agent 类型已新建。",
              );
              renderAgentTypes(workspace);
            } catch (error) {
              if (error instanceof SyntaxError)
                notice(state.errors.VALIDATION_ERROR);
            }
          };
          main.querySelectorAll("[data-agent-edit]").forEach(
            (button) =>
              (button.onclick = () => {
                const item = items.find(
                  (entry) => entry.id === button.dataset.agentEdit,
                );
                q("#mainView").innerHTML =
                  `<section class="panel"><h1>编辑 Agent 类型</h1><form data-formal-editor>${fieldInput("name", "类型名称", item.name, "text", "required")}<label class="field">状态<select name="status"><option value="active" ${item.status === "active" ? "selected" : ""}>启用</option><option value="disabled" ${item.status === "disabled" ? "selected" : ""}>停用</option></select></label><label class="field">默认模型配置<select name="llm_profile_id"><option value="">不指定</option>${state.shell.resources.model.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === item.defaults?.llm_profile_id ? "selected" : ""}>${escapeHtml(profile.preset_name)}</option>`).join("")}</select></label>${agentConfigurationFields(item.defaults)}<p data-formal-status class="small"></p><button class="primary">保存</button></form></section>`;
                const form = q("#mainView [data-formal-editor]");
                form.onsubmit = async (event) => {
                  event.preventDefault();
                  try {
                    const data = new FormData(form);
                    const defaults = {
                      ...(item.defaults || {}),
                      ...buildAgentConfiguration(data, item.defaults),
                      llm_profile_id:
                        String(data.get("llm_profile_id") || "") || null,
                    };
                    await action(
                      event.submitter,
                      () =>
                        client.request(
                          `${root}/${encodeURIComponent(item.id)}`,
                          {
                            method: "PATCH",
                            body: {
                              name: String(data.get("name")),
                              status: String(data.get("status")),
                              defaults,
                            },
                          },
                        ),
                      "Agent 类型已保存。",
                    );
                    renderAgentTypes(workspace);
                  } catch (error) {
                    form.querySelector("[data-formal-status]").textContent =
                      error instanceof SyntaxError
                        ? state.errors.VALIDATION_ERROR
                        : errorText(error);
                  }
                };
              }),
          );
          main.querySelectorAll("[data-agent-toggle]").forEach(
            (button) =>
              (button.onclick = async () => {
                const item = items.find(
                    (entry) => entry.id === button.dataset.agentToggle,
                  ),
                  operation = item.status === "active" ? "disable" : "enable";
                try {
                  await action(
                    button,
                    () =>
                      client.request(
                        `${root}/${encodeURIComponent(item.id)}/${operation}`,
                        { method: "POST", body: {} },
                      ),
                    "Agent 类型状态已更新。",
                  );
                  renderAgentTypes(workspace);
                } catch {
                  return;
                }
              }),
          );
        },
      },
    );
  }

  async function renderAgentBindings(project) {
    const session = selectedSession();
    if (session) {
      try {
        const effective = await client.request(
          `/sessions/${encodeURIComponent(session.id)}/effective-config`,
        );
        if (state.view !== "agent-bindings") return;
        project =
          state.shell.projects.find(
            (item) => item.id === effective.projectId,
          ) || project;
      } catch (error) {
        if (state.view !== "agent-bindings") return;
        q("#mainView").innerHTML =
          `<section class="panel"><p role="alert">${escapeHtml(errorText(error))}</p></section>`;
        return;
      }
    }
    if (!project) {
      q("#mainView").innerHTML =
        '<section class="panel"><p class="empty">请选择项目。</p></section>';
      return;
    }
    let agentTypes;
    try {
      agentTypes = displayItems(
        await client.request(
          `/workspaces/${encodeURIComponent(state.shell.workspaces[0].id)}/agent-types`,
        ),
      );
      if (state.view !== "agent-bindings") return;
    } catch (error) {
      if (state.view !== "agent-bindings") return;
      q("#mainView").innerHTML =
        `<section class="panel"><p role="alert">${escapeHtml(errorText(error))}</p></section>`;
      return;
    }
    const root = `/projects/${encodeURIComponent(project.id)}/agent-bindings`;
    await renderCollectionPage("项目 Agent", () => client.request(root), {
      create: `<label class="field">Agent 类型<select name="agent_type_id">${agentTypes.map((type) => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.name)}</option>`).join("")}</select></label><label class="field">运行作用域<select name="scope_kind"><option value="project">项目</option><option value="session">会话</option><option value="floor">楼层</option><option value="workspace">工作区</option></select></label><label class="field">模型配置<select name="llm_profile_id"><option value="">沿用类型默认值</option>${state.shell.resources.model.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.preset_name)}</option>`).join("")}</select></label>${agentConfigurationFields()}<button class="primary">添加项目 Agent</button>`,
      item: (item) =>
        `<div class="actions"><button data-binding-edit="${escapeHtml(item.id)}">编辑</button><button data-binding-toggle="${escapeHtml(item.id)}">${item.status === "enabled" ? "停用" : "启用"}</button><button data-binding-run="${escapeHtml(item.id)}" ${item.status === "enabled" ? "" : "disabled"}>运行</button></div>`,
      bind(main, items) {
        main.querySelector("[data-create]").onsubmit = async (event) => {
          event.preventDefault();
          try {
            const data = new FormData(event.currentTarget);
            const profileId = String(data.get("llm_profile_id") || "");
            await action(
              event.submitter,
              () =>
                client.request(root, {
                  method: "POST",
                  body: {
                    agent_type_id: String(data.get("agent_type_id")),
                    scope_kind: String(data.get("scope_kind")),
                    llm_profile_id: profileId || null,
                    ...buildAgentConfiguration(data),
                  },
                }),
              "项目 Agent 已添加。",
            );
            renderAgentBindings(project);
          } catch (error) {
            if (error instanceof SyntaxError)
              notice(state.errors.VALIDATION_ERROR);
          }
        };
        main.querySelectorAll("[data-binding-edit]").forEach(
          (button) =>
            (button.onclick = () => {
              const item = items.find(
                (entry) => entry.id === button.dataset.bindingEdit,
              );
              q("#mainView").innerHTML =
                `<section class="panel"><h1>编辑项目 Agent</h1><form data-formal-editor><label class="field">运行作用域<select name="scope_kind">${scopeOptions(item.scope_kind)}</select></label><label class="field">模型配置<select name="llm_profile_id"><option value="">沿用类型默认值</option>${state.shell.resources.model.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === item.llm_profile_id ? "selected" : ""}>${escapeHtml(profile.preset_name)}</option>`).join("")}</select></label>${agentConfigurationFields(item)}<p data-formal-status class="small"></p><button class="primary">保存</button></form></section>`;
              const form = q("#mainView [data-formal-editor]");
              form.onsubmit = async (event) => {
                event.preventDefault();
                try {
                  const data = new FormData(form);
                  const profileId = String(data.get("llm_profile_id") || "");
                  await action(
                    event.submitter,
                    () =>
                      client.request(`${root}/${encodeURIComponent(item.id)}`, {
                        method: "PATCH",
                        body: {
                          scope_kind: String(data.get("scope_kind")),
                          llm_profile_id: profileId || null,
                          ...buildAgentConfiguration(data, item),
                        },
                      }),
                    "项目 Agent 已保存。",
                  );
                  renderAgentBindings(project);
                } catch (error) {
                  form.querySelector("[data-formal-status]").textContent =
                    error instanceof SyntaxError
                      ? state.errors.VALIDATION_ERROR
                      : errorText(error);
                }
              };
            }),
        );
        main.querySelectorAll("[data-binding-toggle]").forEach(
          (button) =>
            (button.onclick = async () => {
              const item = items.find(
                  (entry) => entry.id === button.dataset.bindingToggle,
                ),
                operation = item.status === "enabled" ? "disable" : "enable";
              try {
                await action(
                  button,
                  () =>
                    client.request(
                      `${root}/${encodeURIComponent(item.id)}/${operation}`,
                      { method: "POST", body: {} },
                    ),
                  "项目 Agent 状态已更新。",
                );
                renderAgentBindings(project);
              } catch {
                return;
              }
            }),
        );
        main.querySelectorAll("[data-binding-run]").forEach(
          (button) =>
            (button.onclick = async () => {
              try {
                await action(
                  button,
                  () =>
                    client.request(
                      `${root}/${encodeURIComponent(button.dataset.bindingRun)}/run`,
                      {
                        method: "POST",
                        body: {
                          trigger_reason: "manual",
                          dry_run: false,
                          input_json: {},
                        },
                      },
                    ),
                  "Agent 任务已提交。",
                );
                renderAgentBindings(project);
              } catch {
                return;
              }
            }),
        );
      },
    });
  }

  function renderSessionInspector() {
    const session = selectedSession(),
      container = q("#inspectorContent");
    if (!session) {
      container.innerHTML = '<p class="empty">请选择会话。</p>';
      return;
    }
    container.innerHTML = `<form data-session-form><label class="field">会话标题<input name="title" value="${escapeHtml(session.title || "")}" required></label><label class="field">状态<select name="status"><option value="active" ${session.status === "active" ? "selected" : ""}>进行中</option><option value="archived" ${session.status === "archived" ? "selected" : ""}>已归档</option></select></label><dl><dt>角色</dt><dd>${escapeHtml(session.character_binding?.snapshot_summary?.name || "—")}</dd><dt>人设</dt><dd>${escapeHtml(session.user_binding?.snapshot_summary?.name || "—")}</dd><dt>更新时间</dt><dd>${escapeHtml(formatTime(session.updated_at))}</dd></dl><div class="actions"><button class="primary">保存会话</button><button type="button" class="danger" data-session-delete>删除会话</button></div></form>`;
    container.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const d = new FormData(event.currentTarget);
      try {
        const saved = await action(
          event.submitter,
          () =>
            client.updateSession(session.id, {
              title: String(d.get("title")),
              status: String(d.get("status")),
            }),
          "会话已保存。",
        );
        Object.assign(session, saved);
        renderChrome();
        renderSessionInspector();
      } catch {
        return;
      }
    };
    container.querySelector("[data-session-delete]").onclick = async (
      event,
    ) => {
      if (!globalThis.confirm?.("删除这个会话及其全部演绎记录？")) return;
      try {
        await action(
          event.currentTarget,
          () => client.deleteSession(session.id),
          "会话已删除。",
        );
        await refresh();
        renderSessionInspector();
      } catch {
        return;
      }
    };
  }

  function renderDebugInspector() {
    const session = selectedSession(),
      container = q("#inspectorContent");
    if (!session) {
      container.innerHTML = '<p class="empty">请选择会话。</p>';
      return;
    }
    void mountGenerationDetails({
      container,
      client,
      sessionId: session.id,
      errorText,
      onOpen: (floorId) => {
        locationLike.assign(generationDetailsUrl(session.id, floorId));
      },
    });
  }

  function bindShellEvents() {
    q("#openApp").onclick = renderConversation;
    documentLike.querySelectorAll("[data-r]").forEach((button) => {
      const view = button.dataset.r;
      if (
        [
          "tools",
          "mcp",
          "variables",
          "memory",
          "branches",
          "live-tools",
        ].includes(view)
      )
        button.onclick = () => renderRuntime(view);
    });
    q('[data-action="open-runtime"]').onclick = () => renderRuntime("runtime");
    q('[data-action="agent-types"]').onclick = () =>
      renderRuntime("agent-types");
    q('[data-action="agent-bindings"]').onclick = () =>
      renderRuntime("agent-bindings");
    q('[data-r="toggle-nav"]').onclick = () =>
      q(".sidebar").classList.toggle("drawer-open");
    q('[data-r="toggle-inspector"]').onclick = () =>
      q(".inspector").classList.toggle("drawer-open");
    [
      [q("#leftResize"), "--left-width", 180, 520],
      [q("#rightResize"), "--right-width", 260, 620],
    ].forEach(([handle, property, minimum, maximum]) => {
      handle.addEventListener("pointerdown", (downEvent) => {
        const start = downEvent.clientX;
        const current = Number.parseFloat(
          getComputedStyle(documentLike.documentElement).getPropertyValue(
            property,
          ),
        );
        const onMove = (moveEvent) => {
          const delta = moveEvent.clientX - start;
          const value =
            property === "--right-width" ? current - delta : current + delta;
          documentLike.documentElement.style.setProperty(
            property,
            `${Math.min(maximum, Math.max(minimum, value))}px`,
          );
        };
        const onUp = () => {
          globalThis.removeEventListener("pointermove", onMove);
          globalThis.removeEventListener("pointerup", onUp);
        };
        globalThis.addEventListener("pointermove", onMove);
        globalThis.addEventListener("pointerup", onUp, { once: true });
      });
    });
    documentLike.querySelectorAll("[data-tab]").forEach(
      (button) =>
        (button.onclick = () => {
          documentLike
            .querySelectorAll("[data-tab]")
            .forEach((tab) =>
              tab.setAttribute("aria-selected", String(tab === button)),
            );
          if (button.dataset.tab === "bindings") {
            q("#inspectorContent").innerHTML = "";
            q("#inspectorContent").dispatchEvent(
              new Event("formal-bindings-selected"),
            );
          }
          if (button.dataset.tab === "session") renderSessionInspector();
          if (button.dataset.tab === "debug") renderDebugInspector();
        }),
    );
    documentLike.addEventListener(
      "published-admin:session-select",
      async (event) => {
        const sessionId = event.detail.sessionId;
        if (!state.shell.sessions.some((item) => item.id === sessionId)) {
          try {
            state.shell.sessions.unshift(await client.session(sessionId));
          } catch (error) {
            notice(errorText(error));
            return;
          }
        }
        state.selectedSessionId = sessionId;
        renderChrome();
        renderConversation();
        if (q('[data-tab="session"]').getAttribute("aria-selected") === "true")
          renderSessionInspector();
      },
    );
    q("#deploymentInfo").onclick = () =>
      renderCollectionPage("服务状态", () => client.request("/health"));
  }

  async function refresh(render = true) {
    try {
      state.shell = await client.loadShell();
      if (
        !state.shell.sessions.some(
          (item) => item.id === state.selectedSessionId,
        )
      )
        state.selectedSessionId =
          selectCharacterSession(
            state.shell.sessions,
            new URLSearchParams(locationLike.search).get("character"),
          )?.id || "";
      state.loading = false;
      renderChrome();
      if (render) await renderConversation();
      documentLike.dispatchEvent(
        new CustomEvent("formal-admin:refreshed", { detail: state.shell }),
      );
    } catch (error) {
      state.loading = false;
      q("#mainView").innerHTML =
        `<section class="panel"><p role="alert">${escapeHtml(errorText(error))}</p><button data-retry>重新加载</button></section>`;
      q("#mainView").querySelector("[data-retry]").onclick = refresh;
    }
  }

  async function mount() {
    if (!isFormalAdminMode(locationLike)) return false;
    state.errors = await readErrorMessages(fetchImpl);
    client = createFormalAdminClient({
      fetchImpl,
      errorMessages: state.errors,
    });
    bindShellEvents();
    await refresh();
    return true;
  }
  return { mount, refresh, state, renderConversation, renderRuntime };
}

if (typeof document !== "undefined" && document.querySelector("#inspectorContent") && isFormalAdminMode()) {
  const start = async () => {
    const controller = createFormalAdminController();
    await controller.mount();
    globalThis.formalAdminWorkspacePrototype = controller;
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
