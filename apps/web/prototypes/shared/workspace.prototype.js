// Bundled from packages/adapters-sillytavern/src/regex/regex-engine.ts at f0d12bf.
const SUBSTITUTE_REGEX = { NONE: 0, RAW: 1, ESCAPED: 2 };
const DEFAULT_CHANNEL = "persist";
function parseRegexString(regexStr) {
  if (!regexStr) return null;
  const match = regexStr.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (match) {
    try {
      return new RegExp(match[1], match[2]);
    } catch {
      return null;
    }
  }
  try {
    return new RegExp(regexStr, "g");
  } catch {
    return null;
  }
}
function substituteRegexPattern(findRegex, mode, substituteParams) {
  if (mode === SUBSTITUTE_REGEX.NONE || !substituteParams) {
    return findRegex;
  }
  if (mode === SUBSTITUTE_REGEX.ESCAPED) {
    return findRegex.replace(/\{\{[^}]+\}\}/g, (match) => {
      const replaced = substituteParams(match);
      return replaced.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
  }
  return substituteParams(findRegex);
}
function resolveChannel(context) {
  return context?.channel ?? DEFAULT_CHANNEL;
}
function shouldRunForChannel(script, channel) {
  if (channel === "display") {
    return script.markdownOnly;
  }
  if (channel === "prompt") {
    return script.promptOnly;
  }
  if (channel === "edit") {
    return !script.markdownOnly && !script.promptOnly && script.runOnEdit;
  }
  return !script.markdownOnly && !script.promptOnly;
}
function shouldRunForDepth(script, depth) {
  if (typeof depth !== "number" || Number.isNaN(depth)) {
    return true;
  }
  if (
    typeof script.minDepth === "number" &&
    !Number.isNaN(script.minDepth) &&
    script.minDepth >= -1 &&
    depth < script.minDepth
  ) {
    return false;
  }
  if (
    typeof script.maxDepth === "number" &&
    !Number.isNaN(script.maxDepth) &&
    script.maxDepth >= 0 &&
    depth > script.maxDepth
  ) {
    return false;
  }
  return true;
}
function applyTrimStrings(text, trimStrings, substituteReplaceParams) {
  let result = text;
  for (const trim of trimStrings) {
    if (!trim) continue;
    const resolvedTrim = substituteReplaceParams
      ? substituteReplaceParams(trim)
      : trim;
    if (!resolvedTrim) continue;
    result = result.split(resolvedTrim).join("");
  }
  return result;
}
function getNamedGroups(args) {
  const candidate = args.at(-1);
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return candidate;
  }
  return undefined;
}
function stringifyReplacementValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}
function buildReplacementString(script, args, substituteReplaceParams) {
  const namedGroups = getNamedGroups(args);
  const replacementTemplate = script.replaceString.replace(
    /\{\{match\}\}/gi,
    "$0",
  );
  const replacementWithGroups = replacementTemplate.replace(
    /\$(\d+)|\$<([^>]+)>/g,
    (_token, num, groupName) => {
      const resolvedValue =
        num !== undefined ? args[Number(num)] : namedGroups?.[groupName ?? ""];
      const stringValue = stringifyReplacementValue(resolvedValue);
      if (!stringValue) {
        return "";
      }
      return applyTrimStrings(
        stringValue,
        script.trimStrings,
        substituteReplaceParams,
      );
    },
  );
  return substituteReplaceParams
    ? substituteReplaceParams(replacementWithGroups)
    : replacementWithGroups;
}
function resolveRegexTraceRuleName(script) {
  const trimmedScriptName = script.scriptName.trim();
  return trimmedScriptName.length > 0
    ? trimmedScriptName
    : script.id.trim() || "unnamed_regex_rule";
}
function applyRegexScripts(text, scripts, placement, context) {
  return executeRegexScripts(text, scripts, placement, context).text;
}
function applyRegexScriptsWithTrace(text, scripts, placement, context) {
  const result = executeRegexScripts(text, scripts, placement, context);
  return {
    text: result.text,
    candidateRuleNames: result.candidateRuleNames,
    matchedRuleNames: result.matchedRuleNames,
    skippedRules: result.skippedRules,
  };
}
function executeRegexScripts(text, scripts, placement, context) {
  let result = text;
  const channel = resolveChannel(context);
  const candidateRuleNames = [];
  const matchedRuleNames = [];
  const skippedRules = [];
  for (const script of scripts) {
    if (script.disabled) continue;
    if (!script.placement.includes(placement)) continue;
    const ruleName = resolveRegexTraceRuleName(script);
    candidateRuleNames.push(ruleName);
    if (!shouldRunForChannel(script, channel)) {
      skippedRules.push({ ruleName, reason: "channel_filtered" });
      continue;
    }
    if (!shouldRunForDepth(script, context?.depth)) {
      skippedRules.push({ ruleName, reason: "depth_filtered" });
      continue;
    }
    const processedFind = substituteRegexPattern(
      script.findRegex,
      script.substituteRegex,
      context?.substituteFindParams,
    );
    const regex = parseRegexString(processedFind);
    if (!regex) {
      skippedRules.push({ ruleName, reason: "invalid_regex" });
      continue;
    }
    const nextResult = result.replace(regex, (...args) =>
      buildReplacementString(script, args, context?.substituteReplaceParams),
    );
    if (nextResult === result) {
      skippedRules.push({ ruleName, reason: "no_match" });
      continue;
    }
    matchedRuleNames.push(ruleName);
    result = nextResult;
  }
  return {
    text: result,
    candidateRuleNames,
    matchedRuleNames,
    skippedRules,
  };
}

// Throwaway, isolated in-memory interaction model. API mappings are in the companion plan.
const $ = (id) => document.getElementById(id),
  clone = (v) => structuredClone(v);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
let failNext = false;
const labels = {
  character: "角色卡",
  preset: "提示词预设",
  worldbook: "世界书",
  regex: "正则",
  model: "LLM Profile",
  persona: "演绎人设",
};
// Shared field descriptions govern editor labels and initial documents in this standalone artifact.
const fields = {
  character: [
    ["description", "角色描述", "area"],
    ["personality", "性格", "area"],
    ["scenario", "场景", "area"],
    ["first_mes", "开场白", "area"],
    ["mes_example", "示例对话", "area"],
    ["alternate_greetings", "备选开场白（JSON 数组）", "json"],
    ["group_only_greetings", "群聊开场白（JSON 数组）", "json"],
    ["system_prompt", "角色系统提示词", "area"],
    ["post_history_instructions", "历史后指令", "area"],
    ["creator_notes", "作者备注", "area"],
    ["tags", "标签（JSON 数组）", "json"],
    ["creator", "作者", "text"],
    ["character_version", "角色版本标记", "text"],
    ["nickname", "昵称", "text"],
    ["source", "来源（JSON 数组）", "json"],
    ["character_book", "内嵌世界书（JSON）", "json"],
    ["extensions", "扩展字段（JSON 对象）", "json"],
    ["assets", "资源附件（JSON 数组）", "json"],
  ],
  persona: [
    ["description", "人设描述", "area"],
    ["status", "状态", "status"],
  ],
  model: [
    ["provider", "Provider", "provider"],
    ["base_url", "API 地址（留空使用提供商默认地址）", "url"],
    ["model_id", "模型标识", "text"],
    ["api_key_name", "凭证名称（可选）", "text"],
    ["api_key", "API Key（已有凭证留空保持不变）", "password"],
    ["status", "状态", "status"],
  ],
  preset: [
    ["identifier", "条目标识", "text"],
    ["name", "条目名称", "text"],
    ["role", "消息角色", "role"],
    ["content", "正文", "area"],
    ["enabled", "启用", "check"],
    ["system_prompt", "系统提示词条目", "check"],
    ["marker", "标记条目", "check"],
    ["injection_position", "注入位置", "position"],
    ["injection_depth", "注入深度", "number"],
    ["injection_order", "注入顺序", "number"],
    ["forbid_overrides", "禁止覆盖", "check"],
    ["injection_trigger", "注入触发条件（JSON 数组）", "json"],
    ["extra", "扩展字段（JSON 对象）", "json"],
  ],
  worldbook: [
    ["comment", "条目名称", "text"],
    ["key", "主关键词（以逗号分隔）", "text"],
    ["keysecondary", "辅助关键词（以逗号分隔）", "text"],
    ["selective", "使用辅助关键词", "check"],
    ["selectiveLogic", "辅助关键词匹配逻辑", "wiLogic"],
    ["content", "正文", "area"],
    ["constant", "始终启用", "check"],
    ["disable", "停用", "check"],
    ["position", "插入位置", "wiPosition"],
    ["depth", "指定深度（插入位置为指定深度时生效）", "number"],
    ["role", "注入消息角色（指定深度）", "wiRole"],
    ["outletName", "Outlet 名称（插入位置为 Outlet 时生效）", "text"],
    ["order", "插入优先级（越大越优先）", "number"],
    ["scanDepth", "独立扫描深度（留空跟随全局）", "nullableNumber"],
    ["caseSensitive", "大小写敏感", "tri"],
    ["matchWholeWords", "全词匹配", "tri"],
    ["excludeRecursion", "仅初始轮触发", "check"],
    ["preventRecursion", "内容不进入递归缓冲区", "check"],
    ["delayUntilRecursion", "递归触发起始层级（留空关闭）", "nullableNumber"],
  ],
  regex: [
    ["scriptName", "规则名称", "text"],
    ["findRegex", "查找表达式", "text"],
    ["replaceString", "替换文本", "area"],
    ["trimStrings", "捕获内容裁剪文本（JSON 数组）", "json"],
    ["placement", "执行位置", "placements"],
    ["disabled", "停用", "check"],
    ["markdownOnly", "仅显示通道执行", "check"],
    ["promptOnly", "仅发送给模型的提示词通道执行", "check"],
    ["runOnEdit", "编辑后执行", "check"],
    ["substituteRegex", "表达式宏替换", "substitute"],
    ["minDepth", "最小消息深度（-1 表示不限）", "number"],
    ["maxDepth", "最大消息深度（-1 表示不限）", "number"],
  ],
};
const entryKinds = ["preset", "worldbook", "regex"];
const enums = {
  provider: [
    ["openai", "OpenAI"],
    ["anthropic", "Anthropic"],
    ["google", "Google"],
    ["deepseek", "DeepSeek"],
    ["xai", "xAI"],
    ["openai-compatible", "OpenAI 兼容"],
  ],
  status: [
    ["active", "启用"],
    ["disabled", "停用"],
  ],
  wiPosition: [
    [0, "角色定义之前"],
    [1, "角色定义之后"],
    [2, "作者注释之前"],
    [3, "作者注释之后"],
    [4, "指定深度"],
    [5, "示例消息之前"],
    [6, "示例消息之后"],
    [7, "Outlet 宏槽位"],
  ],
  wiLogic: [
    [0, "至少一个辅助词命中"],
    [1, "辅助词未全部命中"],
    [2, "辅助词均未命中"],
    [3, "全部辅助词命中"],
  ],
  wiRole: [
    [0, "system"],
    [1, "user"],
    [2, "assistant"],
  ],
  substitute: [
    [0, "不替换宏"],
    [1, "原样替换"],
    [2, "转义后替换"],
  ],
  tri: [
    ["", "跟随全局"],
    ["true", "启用"],
    ["false", "关闭"],
  ],
};
const defaults = {
  worldbook: {
    position: 0,
    depth: 4,
    role: 0,
    order: 100,
    selectiveLogic: 0,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    delayUntilRecursion: null,
  },
  regex: {
    placement: "2",
    trimStrings: [],
    minDepth: -1,
    maxDepth: -1,
    substituteRegex: 0,
  },
  preset: {
    role: "system",
    injection_position: 0,
    injection_trigger: [],
    extra: {},
  },
  model: { provider: "openai", status: "active" },
  persona: { status: "active" },
  character: {
    alternate_greetings: [],
    group_only_greetings: [],
    tags: [],
    source: [],
    extensions: {},
    assets: [],
    character_book: null,
  },
};
let nextEntryId = 1;
const initialEntry = (kind) => ({
  ...Object.fromEntries(
    fields[kind].map(([k, , t]) => [
      k,
      t === "check"
        ? k === "enabled"
        : t === "json"
          ? null
          : t === "number"
            ? 0
            : t === "nullableNumber" || t === "tri"
              ? null
              : "",
    ]),
  ),
  ...clone(defaults[kind] || {}),
  ...(kind === "preset" ? { identifier: `entry-${nextEntryId++}` } : {}),
});
const bookDefaults = {
  scanDepth: 2,
  caseSensitive: false,
  matchWholeWords: false,
  recursive: false,
  maxRecursionSteps: 0,
};
const makeDoc = (kind) =>
  entryKinds.includes(kind)
    ? {
        ...(kind === "worldbook" ? clone(bookDefaults) : {}),
        entries: [initialEntry(kind)],
      }
    : initialEntry(kind);
let resources = [
  {
    id: "character-1",
    kind: "character",
    name: "林岚",
    versions: [
      {
        description: "港口书店的店主，习惯在雨夜为迟归的人留一盏灯。",
        personality: "沉静，耐心，说话简短；先倾听，再回应。",
        scenario: "雨夜，码头尽头的书店。",
        first_mes: "雨下得很大。先进来吧，把伞放在门边就好。",
        mes_example: "",
      },
    ],
  },
  {
    id: "preset-1",
    kind: "preset",
    name: "港口叙事",
    versions: [
      {
        entries: [
          {
            ...initialEntry("preset"),
            name: "角色演绎",
            content: "保持角色身份，以动作和对白推进场景。",
            identifier: "roleplay",
          },
          {
            ...initialEntry("preset"),
            name: "对话风格",
            content: "每次回应给访客留下继续说话的空间。",
            identifier: "style",
          },
        ],
      },
    ],
  },
  {
    id: "worldbook-1",
    kind: "worldbook",
    name: "港口",
    versions: [
      {
        entries: [
          {
            ...initialEntry("worldbook"),
            comment: "书店营业时间",
            key: "书店,营业",
            content: "港口书店营业到午夜。",
          },
        ],
      },
    ],
  },
  {
    id: "regex-1",
    kind: "regex",
    name: "清理旁白标记",
    versions: [
      {
        entries: [
          {
            ...initialEntry("regex"),
            scriptName: "移除标记",
            findRegex: "/\\[/?旁白\\]/g",
            replaceString: "",
          },
        ],
      },
    ],
  },
  {
    id: "model-1",
    kind: "model",
    name: "港口对话模型",
    versions: [
      {
        provider: "openai",
        base_url: "https://api.example.com/v1",
        model_id: "harbor-chat",
        status: "active",
        api_key_name: "港口服务凭证",
        api_key_masked: "••••demo",
        credentialConfigured: true,
        temperature: 0.8,
      },
    ],
  },
  {
    id: "persona-1",
    kind: "persona",
    name: "访客",
    versions: [{ description: "在雨夜路过港口的旅人。" }],
  },
];
resources.forEach(
  (r) =>
    (r.versions = r.versions.map((doc) =>
      entryKinds.includes(r.kind)
        ? {
            ...(r.kind === "worldbook" ? clone(bookDefaults) : {}),
            ...doc,
            entries: doc.entries.map((x) => ({
              ...initialEntry(r.kind),
              ...x,
            })),
          }
        : { ...initialEntry(r.kind), ...doc },
    )),
);
let saved = Object.fromEntries(
    resources.map((r) => [r.kind, { id: r.id, version: 1 }]),
  ),
  draft = clone(saved),
  revision = 1;
function snapshotSlots(slots) {
  return Object.fromEntries(
    Object.entries(slots).map(([key, slot]) => {
      const source = slot.preset_id ? "slot" : "default_slot",
        profileId = slot.preset_id || slots["*"].preset_id;
      const r = resources.find((r) => r.id === profileId),
        doc = r?.versions.at(-1);
      return [
        key,
        {
          profile_id: profileId,
          source,
          provider: doc?.provider,
          base_url: doc?.base_url,
          model_id: slot.model_id_override || doc?.model_id,
          params: clone(slot.params),
        },
      ];
    }),
  );
}
function runtimeMissing(runtime) {
  const needed = [
    "narrator",
    ...(runtime.turn.enableDirector ? ["director"] : []),
    ...(runtime.turn.enableVerifier ? ["verifier"] : []),
    ...(runtime.turn.enableMemoryConsolidation ? ["memory"] : []),
  ];
  return needed
    .filter((key) => {
      const slot = runtime.slots[key],
        id = slot.preset_id || runtime.slots["*"].preset_id;
      const profile = resources.find((r) => r.id === id)?.versions.at(-1);
      return (
        !slot.enabled ||
        (!slot.preset_id && !runtime.slots["*"].enabled) ||
        !profile ||
        profile.status !== "active" ||
        !profile.credentialConfigured
      );
    })
    .map((key) => `${key} 的可用模型槽位`);
}
saved.instance = { temperature: 0.8 };
saved.runtime = {
  turn: {
    enableTools: false,
    enableDirector: true,
    enableVerifier: false,
    enableMemoryConsolidation: false,
    toolMode: "inline",
    verifierFailStrategy: "warn",
    maxRetries: 1,
  },
  slots: Object.fromEntries(
    ["*", "narrator", "director", "verifier", "memory"].map((slot) => [
      slot,
      {
        enabled: ["*", "narrator", "director"].includes(slot),
        preset_id: slot === "*" ? "model-1" : null,
        model_id_override: null,
        params: { temperature: 0.8 },
        capabilities: {},
      },
    ]),
  ),
};
saved.runtime.resolved = snapshotSlots(saved.runtime.slots);
draft = clone(saved);
let releases = [{ version: 1, revision: 1, config: clone(saved) }],
  activeRelease = 1,
  sessions = [],
  selected = null,
  nextId = 1,
  tab = "bindings",
  editor = null,
  libraryKind = "preset",
  libraryMode = "manage",
  confirmAction = null;
const getResource = (id) => resources.find((r) => r.id === id),
  getSession = () => sessions.find((s) => s.id === selected);
const valueOf = (config, kind) => {
  const ref = config[kind];
  return ref ? getResource(ref.id)?.versions[ref.version - 1] : null;
};
const versionLabel = (kind, v) =>
  ["model", "persona"].includes(kind) ? `配置快照 ${v}` : `v${v}`;
const referenceName = (ref) =>
  ref
    ? `${getResource(ref.id)?.name ?? "资源已删除"} · ${versionLabel(getResource(ref.id)?.kind, ref.version)}`
    : "停用";
const dirty = () => JSON.stringify(draft) !== JSON.stringify(saved);
let notify = (text) => {
  $("notice").textContent = text;
};
const configSummary = (config) =>
  Object.keys(labels)
    .map(
      (k) =>
        `<div class="version"><span class="small">${labels[k]}</span><br>${esc(referenceName(config[k]))}</div>`,
    )
    .join("") +
  `<div class="version"><span class="small">narrator · 实例参数</span><br>${esc(config.runtime.resolved?.narrator?.model_id || "未配置")} · Temperature ${esc(config.runtime.resolved?.narrator?.params?.temperature ?? "未覆盖")}</div>` +
  `<details><summary>回合流程与模型槽位</summary><p class="small">导演：${config.runtime.turn.enableDirector ? "启用" : "关闭"} · 校验：${config.runtime.turn.enableVerifier ? "启用" : "关闭"} · 记忆整理：${config.runtime.turn.enableMemoryConsolidation ? "启用" : "关闭"} · 工具：${config.runtime.turn.enableTools ? "启用" : "关闭"}</p>${Object.entries(
    config.runtime.slots,
  )
    .map(
      ([k, v]) =>
        `<p class="small">${esc(k)}：${v.enabled ? "启用" : "停用"} · ${esc(v.preset_id ? getResource(v.preset_id)?.name : "沿用默认槽位")} · ${esc(config.runtime.resolved?.[k]?.model_id || v.model_id_override || "未解析模型")}<br>参数：${esc(JSON.stringify(v.params))}</p>`,
    )
    .join("")}</details>`;
const invalid = () =>
  ["character", "preset", "model", "persona"]
    .filter((k) => !draft[k])
    .map((k) => labels[k])
    .concat(
      draft.instance.temperature !== null &&
        (!Number.isFinite(draft.instance.temperature) ||
          draft.instance.temperature < 0 ||
          draft.instance.temperature > 2)
        ? ["Temperature（0 到 2）"]
        : [],
    );
function ask(title, text, action, input) {
  confirmAction = action;
  $("confirmTitle").textContent = title;
  $("confirmText").textContent = text;
  $("confirmField").hidden = input === undefined;
  $("confirmInput").value = input ?? "";
  $("dialogError").textContent = "";
  $("confirmAccept").textContent = input === undefined ? "确认" : "保存名称";
  $("confirmDialog").showModal();
}
$("confirmCancel").onclick = () => $("confirmDialog").close();
$("confirmAccept").onclick = () => {
  if (!$("confirmField").hidden && !$("confirmInput").value.trim()) {
    $("dialogError").textContent = "请输入名称后保存。";
    return;
  }
  const action = confirmAction;
  $("confirmDialog").close();
  action($("confirmInput").value.trim());
};
function leaveEditor(action) {
  if (editor && editor.kind !== "agent-list" && editor.kind !== "debug")
    ask(
      "放弃未保存的编辑？",
      "返回后，本次尚未保存的资源内容将被丢弃。",
      () => {
        editor = null;
        action();
      },
    );
  else {
    editor = null;
    action();
  }
}
function render() {
  renderNav();
  renderInspector();
  if (!editor) renderConversation();
  else if (editor.kind === "debug") renderDebugger();
}
function renderNav() {
  $("navVersion").textContent = activeRelease ? `v${activeRelease}` : "已停止";
  $("sessionCount").textContent = `${sessions.length} 条`;
  $("newTrial").textContent = sessions.length ? "新建独立试聊" : "开始试聊";
  const list = sessions.filter((s) => s.status === $("sessionFilter").value);
  $("sessionList").innerHTML = list.length
    ? list
        .map(
          (s) =>
            `<button class="navitem ${s.id === selected ? "active" : ""}" data-session="${s.id}">${esc(s.name)}<br><span class="small">修订 ${s.revision} · ${s.running ? "正在生成" : s.messages.length > 1 ? "已有回复" : "等待输入"}</span></button>`,
        )
        .join("")
    : '<p class="small">此列表没有试聊。</p>';
  $("resourceNav").innerHTML = Object.entries(labels)
    .map(
      ([k, label]) =>
        `<button class="navitem" data-library="${k}">${label} <span class="small">${resources.filter((r) => r.kind === k && !r.deleted).length}</span></button>`,
    )
    .join("");
}
function renderConversation() {
  const s = getSession();
  if (!s) {
    $("mainView").innerHTML =
      `<div class="empty-state"><span class="tag">林岚 · 港口书店</span><h1 style="margin-top:22px">准备好配置，再开始试聊</h1><button class="primary" data-action="start">开始试聊</button></div>`;
    return;
  }
  $("mainView").innerHTML =
    `<div class="session-head"><div class="toolbar"><h1>${esc(s.name)}</h1><button data-action="rename">改名</button><button data-action="archive">${s.status === "archived" ? "恢复" : "归档"}</button><button class="danger" data-action="delete">删除</button></div><p class="small">试聊修订 ${s.revision} · 当前草稿修订 ${revision} · ${s.status === "archived" ? "已归档" : "进行中"}</p><div class="chips"><span>${esc(referenceName(s.config.character))}</span><span>${esc(referenceName(s.config.model))}</span></div></div><div class="messages" id="messages">${s.messages.map((m) => `<article class="message"><div class="speaker"><span class="avatar">${m.me ? "访" : "岚"}</span><strong>${m.me ? "访客" : "林岚"}</strong>${m.opening ? '<span class="small">开场白</span>' : ""}</div><p>${esc(m.text)}</p>${m.floorId ? `<button data-debug-floor="${m.floorId}">查看生成详情</button>` : ""}</article>`).join("")}${s.running ? '<p class="small" role="status">林岚正在回应…</p>' : s.failed ? '<p class="small">回复生成失败。' + (s.status === "archived" ? "恢复试聊后可以重试。" : '<button data-action="retry">重试回复</button>') + "</p>" : ""}</div><form class="composer" id="composer"><label class="small" for="prompt">发送消息</label><textarea id="prompt" placeholder="对林岚说些什么…" ${s.status === "archived" || s.running || s.failed ? "disabled" : ""}>${esc(s.input || "")}</textarea><div class="row"><span class="small">${s.status === "archived" ? "恢复试聊后可以继续发送。" : `使用修订 ${s.revision}；修改草稿不会改变此对话。`}</span><button class="primary" ${s.status === "archived" || s.running || s.failed ? "disabled" : ""}>${s.running ? "正在生成" : "发送消息"}</button></div></form>`;
  $("prompt").oninput = (e) => (s.input = e.target.value);
  $("composer").onsubmit = (e) => {
    e.preventDefault();
    send(s);
  };
}
const debugTabs = {
  overview: "运行概览",
  prompt: "历史提示词",
  stages: "各阶段模型与执行结果",
  tools: "工具调用",
  processing: "正则与显示结果",
  state: "变量与记忆",
  history: "分支与日志",
  raw: "接口原始响应",
};
function createFloorRecord(s, text) {
  const floor = {
    id: `floor-${nextId++}`,
    no: s.rounds.length + 1,
    branch_id: "main",
    session_id: s.id,
    revision: s.revision,
    config: clone(s.config),
    input: text,
    state: "generating",
    created_at: Date.now(),
    attempts: [],
    result: null,
    events: [],
    snapshot: {
      character: clone(valueOf(s.config, "character")),
      preset: clone(valueOf(s.config, "preset")),
      worldbook: clone(valueOf(s.config, "worldbook")),
      regex: clone(valueOf(s.config, "regex")),
    },
  };
  s.rounds.push(floor);
  s.debugFloor = floor.id;
  return floor;
}
function selectedFloor(s) {
  return s?.rounds.find((f) => f.id === s.debugFloor) || s?.rounds.at(-1);
}
function openDebug(floorId) {
  const s = getSession(),
    detailTab = editor?.kind === "debug" ? editor.tab : "overview";
  leaveEditor(() => {
    if (floorId && s) s.debugFloor = floorId;
    editor = { kind: "debug", tab: detailTab };
    renderDebugger();
    tab = "debug";
    renderInspector();
  });
}
function renderDebugSummary() {
  const s = getSession(),
    f = selectedFloor(s);
  return `<h2>生成详情</h2>${s ? `<label class="field">生成轮次<select data-debug-select>${s.rounds.map((r) => `<option value="${r.id}" ${r.id === f?.id ? "selected" : ""}>第 ${r.no} 轮 · ${r.state === "committed" ? "已提交" : r.state === "failed" ? "失败" : "生成中"}</option>`).join("")}</select></label>${f ? `<p class="mono">${esc(f.id)}<br>${f.branch_id} · 修订 ${f.revision}</p><p class="small">${f.attempts.length} 次执行 · ${f.result ? "结果已提交" : "尚无已提交结果"}</p><button class="primary" data-debug-floor="${f.id}">打开生成详情</button>` : '<p class="empty">暂无生成记录。</p>'}` : '<p class="empty">先选择一条试聊。</p>'}`;
}
function renderDebugger() {
  const s = getSession(),
    f = selectedFloor(s);
  if (!s) {
    editor = null;
    render();
    return;
  }
  const active = editor.tab;
  let body = "";
  if (!f)
    body = '<p class="empty">此试聊尚无生成轮次。返回试聊后发送消息。</p>';
  else {
    const run = f.attempts.at(-1),
      previous = s.rounds[s.rounds.indexOf(f) - 1];
    if (active === "overview")
      body = `<div class="chips"><span>分支 ${f.branch_id}</span><span>配置修订 ${f.revision}</span><span>${f.attempts.length} 次执行</span></div><h2 style="margin-top:22px">用户输入</h2><p class="readonly">${esc(f.input)}</p><h2>执行与提交</h2><p class="small">状态：${f.state} · 开始：${new Date(f.created_at).toLocaleTimeString()}<br>本次耗时：${run?.ended_at ? run.ended_at - run.started_at + " ms" : "尚未结束"} · Token 用量：未记录</p>${run?.error ? `<div class="box danger">${esc(run.error.code)}<p>${esc(run.error.message)}</p>${s.failed && s.status === "active" && f === s.rounds.at(-1) ? '<button data-action="retry">重试本轮回复</button>' : ""}</div>` : ""}<h2>提交结果</h2>${f.result ? `<p class="readonly">${esc(f.result.generated_text)}</p><p class="mono">message: ${f.result.assistant_message_id}</p>` : '<p class="small">暂无回复。</p>'}<h2>执行尝试</h2>${f.attempts.map((a, i) => `<details class="version"><summary>第 ${i + 1} 次 · ${a.state}</summary><pre class="readonly">${esc(JSON.stringify(a, null, 2))}</pre></details>`).join("")}`;
    if (active === "prompt")
      body = `<h2>本轮配置与输入快照</h2><p class="small">记录时间：${new Date(f.created_at).toLocaleTimeString()}</p>${configSummary(f.config)}<details open><summary>角色内容</summary><pre class="readonly">${esc(JSON.stringify(f.snapshot.character, null, 2))}</pre></details><details open><summary>预设条目</summary>${(f.snapshot.preset?.entries || []).map((x) => `<div class="version"><strong>${esc(x.name)}</strong> · ${x.enabled ? "启用" : "停用"}<p class="readonly">${esc(x.content)}</p></div>`).join("")}</details><details><summary>世界书候选内容</summary><pre class="readonly">${esc(JSON.stringify(f.snapshot.worldbook, null, 2))}</pre></details><details><summary>正则配置</summary><pre class="readonly">${esc(JSON.stringify(f.snapshot.regex, null, 2))}</pre></details>`;
    if (active === "stages")
      body = `<h2>阶段配置与观测结果</h2>${[
        "director",
        "narrator",
        "verifier",
        "memory",
      ]
        .map((k) => {
          const enabled =
              k === "narrator" ||
              f.config.runtime.turn[
                {
                  director: "enableDirector",
                  verifier: "enableVerifier",
                  memory: "enableMemoryConsolidation",
                }[k]
              ],
            resolved = f.config.runtime.resolved[k];
          return `<div class="resource-card"><h2>${slotLabels[k]} · ${enabled ? "配置启用" : "配置关闭"}</h2><p class="small">模型：${esc(resolved?.model_id || "未解析")}<br>参数：${esc(JSON.stringify(resolved?.params || {}))}</p><p class="small">${!enabled ? "本轮关闭此阶段。" : k === "narrator" ? `回复状态：${f.state}` : "请在生成详情中查看该阶段的工具调用、校验结果或记忆任务。"}</p></div>`;
        })
        .join("")}`;
    if (active === "tools")
      body = `<h2>本轮工具执行</h2><p class="small">${f.config.runtime.turn.enableTools ? "暂无工具调用记录。" : "本轮未启用工具。"}</p><h2>调用详情</h2><p class="empty">暂无工具调用记录。</p>`;
    if (active === "state")
      body = `<h2>本轮变量写入</h2><h2>记忆读取与维护</h2><p class="small">${f.config.runtime.turn.enableMemoryConsolidation ? "本轮启用记忆整理，尚无关联作业结果。" : "本轮未启用记忆整理。"}</p>`;
    if (active === "history")
      body = `<h2>分支 main</h2><p class="small">共 ${s.rounds.length} 轮；当前选中第 ${f.no} 轮。</p>${previous ? `<button data-debug-floor="${previous.id}">查看上一轮记录</button>` : ""}<h2 style="margin-top:22px">本轮事件</h2>${f.events.map((ev) => `<div class="version"><span class="mono">${new Date(ev.at).toLocaleTimeString()}</span><p>${esc(ev.message)}</p></div>`).join("")}`;
    if (active === "raw")
      body = `<h2>本轮记录详情</h2><details open><summary>身份与状态</summary><pre class="readonly">${esc(JSON.stringify({ session_id: s.id, floor_id: f.id, floor_no: f.no, branch_id: f.branch_id, state: f.state, revision: f.revision }, null, 2))}</pre></details><details><summary>运行记录</summary><pre class="readonly">${esc(JSON.stringify(f.attempts, null, 2))}</pre></details><details><summary>提交结果</summary><pre class="readonly">${esc(JSON.stringify(f.result, null, 2))}</pre></details>`;
  }
  $("mainView").innerHTML =
    `<section class="editor-shell"><div class="toolbar"><h1>${f ? "第 " + f.no + " 轮 · 调试记录" : "轮次调试"}</h1><button data-action="back-trial">返回试聊</button><button data-action="refresh-debug">刷新记录</button></div><label class="field" style="margin-top:16px">轮次<select data-debug-select>${s.rounds.map((r) => `<option value="${r.id}" ${r.id === f?.id ? "selected" : ""}>第 ${r.no} 轮 · ${r.state}</option>`).join("")}</select></label><div class="actions">${Object.entries(
      debugTabs,
    )
      .map(
        ([key, label]) =>
          `<button data-debug-tab="${key}" class="${active === key ? "active" : ""}">${label}</button>`,
      )
      .join("")}</div>${body}</section>`;
}

function renderInspector() {
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  if (tab === "debug") {
    $("inspectorContent").innerHTML = renderDebugSummary();
    return;
  }
  if (tab === "bindings") {
    $("inspectorContent").innerHTML =
      `<div class="row"><h2>角色配置</h2><span class="tag">${dirty() ? "有未保存的修改" : "已保存"}</span></div>${Object.entries(
        labels,
      )
        .map(([kind, label]) => renderResourceBinding(kind, label))
        .join(
          "",
        )}<div class="actions"><button data-action="open-runtime">配置模型槽位与回合流程</button></div><div class="actions"><button class="primary" data-action="save-draft" ${dirty() ? "" : "disabled"}>保存角色配置</button><button data-action="reset-draft" ${dirty() ? "" : "disabled"}>撤销修改</button></div><button data-action="start" ${dirty() || invalid().length || runtimeMissing(saved.runtime).length ? "disabled" : ""}>用此配置开始试聊</button><section class="box" style="margin-top:24px">${renderPublication()}</section>`;
  } else if (tab === "session") {
    const s = getSession();
    $("inspectorContent").innerHTML = s
      ? `<h2>试聊配置 · 修订 ${s.revision}</h2><p class="mono">${s.id}</p>${configSummary(s.config)}<h2 style="margin-top:24px">运行状态</h2><p class="small">${s.running ? "正在生成回复。" : s.failed ? "回复生成失败，请重试。" : s.messages.length > 1 ? "本轮回复已完成。" : "暂无回复。"}</p><h2>变量与记忆</h2><p class="small">自定义变量未启用。${s.config.runtime.turn.enableMemoryConsolidation ? "记忆整理已启用，尚无作业执行结果。" : "记忆整理未启用。"}</p>`
      : '<p class="empty">选择试聊后可查看配置与运行状态。</p>';
  }
}
function publicationState() {
  const matching = releases.findLast(
    (r) => JSON.stringify(r.config) === JSON.stringify(saved),
  );
  const unchanged = !!matching && matching.version === activeRelease;
  return {
    matching,
    unchanged,
    blocked:
      dirty() ||
      invalid().length > 0 ||
      runtimeMissing(saved.runtime).length > 0,
  };
}
function renderResourceBinding(kind, label) {
  const ref = draft[kind],
    resource = ref && getResource(ref.id);
  const options = resources.filter(
    (r) => r.kind === kind && !r.deleted && !r.disabled,
  );
  return `<div class="binding"><div class="row"><label for="binding-${kind}">使用的${label}</label><button data-library="${kind}" data-mode="manage">管理${label}</button></div><select id="binding-${kind}" data-binding="${kind}"><option value="">${["worldbook", "regex"].includes(kind) ? "不使用" : `选择${label}`}</option>${options.map((r) => `<option value="${r.id}" ${ref?.id === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>${resource ? `<label class="field">${label}版本<select data-binding-version="${kind}">${resource.versions.map((v, i) => `<option value="${i + 1}" ${ref.version === i + 1 ? "selected" : ""}>${versionLabel(kind, i + 1)}${i === resource.versions.length - 1 ? " · 最新" : ""}</option>`).join("")}</select></label><div class="actions"><button data-edit="${resource.id}" data-version="${ref.version}">编辑${label}</button></div>` : ""}</div>`;
}
function selectConfigurationResource(kind, id, version) {
  const resource = id ? getResource(id) : null;
  draft[kind] = resource
    ? { id: resource.id, version: version ?? resource.versions.length }
    : null;
  if (kind === "model")
    draft.runtime.slots.narrator.preset_id = resource?.id || null;
  renderInspector();
  notify(
    resource
      ? `角色配置已选择“${referenceName(draft[kind])}”。保存后可用于新试聊和发布。`
      : ["worldbook", "regex"].includes(kind)
        ? `已取消选择${labels[kind]}。请保存角色配置以应用修改。`
        : `尚未选择${labels[kind]}。请选择后保存角色配置。`,
  );
}
function renderPublication() {
  const state = publicationState();
  const label = dirty()
    ? "请先保存草稿"
    : state.unchanged
      ? "已发布"
      : state.matching
        ? `新对话使用 v${state.matching.version}`
        : activeRelease
          ? "发布更新"
          : "发布角色";
  const active = releases.find((r) => r.version === activeRelease);
  return `<h2>发布角色</h2><div class="version"><span class="small">草稿绑定的角色卡</span><br>${esc(referenceName(draft.character))}</div><span class="tag">${dirty() ? "有未保存的配置" : state.unchanged ? "当前配置已发布" : "有待发布的配置"}</span>${active ? `<p>新对话使用：${esc(referenceName(active.config.character))} · 发布版本 v${active.version}</p>` : "<p>角色已停止发布。</p>"}<p class="small">新对话使用当前发布版本，已有对话保持原配置。</p><div class="actions"><button class="primary" data-action="publish" ${state.blocked || state.unchanged ? "disabled" : ""}>${label}</button><button data-action="stop" ${activeRelease ? "" : "disabled"}>停止发布</button></div><h2>发布记录</h2>${releases
    .slice()
    .reverse()
    .map(
      (r) =>
        `<div class="version"><div class="row"><strong>发布版本 v${r.version}</strong>${activeRelease !== r.version ? `<button data-restore="${r.version}">新对话使用此版本</button>` : '<span class="small">当前发布</span>'}</div><p>${esc(referenceName(r.config.character))}</p><details><summary class="small">查看发布配置</summary>${configSummary(r.config)}</details></div>`,
    )
    .join("")}`;
}
function createTrial() {
  if (dirty()) {
    notify("配置尚未保存。请先保存草稿，再开始试聊。");
    tab = "bindings";
    renderInspector();
    return;
  }
  if (invalid().length || runtimeMissing(saved.runtime).length) {
    notify(
      `缺少${[...invalid(), ...runtimeMissing(saved.runtime)].join("、")}。请选择并保存配置。`,
    );
    return;
  }
  leaveEditor(() =>
    ask(
      "开始独立试聊",
      `使用“${referenceName(saved.character)}”及当前已保存配置创建新试聊。`,
      () => {
        const id = `trial-${nextId++}`;
        sessions.push({
          id,
          name: `${getResource(saved.character.id).name} · 试聊 ${nextId - 1}`,
          revision,
          config: clone(saved),
          status: "active",
          messages: [
            {
              text: valueOf(saved, "character").first_mes || "你走进了书店。",
              opening: true,
            },
          ],
          input: "",
          running: false,
          rounds: [],
          debugFloor: null,
        });
        selected = id;
        $("sessionFilter").value = "active";
        render();
        notify("试聊已创建。");
        getSession().purpose = "preview";
        navigatePrototype("user");
      },
    ),
  );
}
function send(s) {
  if (s.running || s.failed || s.status === "archived") return;
  const text = s.input.trim();
  if (!text) {
    notify("请输入消息后再发送。");
    return;
  }
  const floor = createFloorRecord(s, text);
  s.messages.push({ me: true, text, floorId: floor.id });
  s.input = "";
  generate(s);
}
function generate(s) {
  if (s.running || s.status === "archived") return;
  s.failed = false;
  const floor = s.rounds.at(-1),
    attempt = {
      id: `run-${nextId++}`,
      started_at: Date.now(),
      ended_at: null,
      state: "running",
      error: null,
    };
  floor.attempts.push(attempt);
  floor.state = "generating";
  floor.events.push({
    at: Date.now(),
    message: `第 ${floor.attempts.length} 次执行开始`,
  });
  s.running = true;
  render();
  notify("消息已提交，正在等待回复。");
  setTimeout(() => {
    if (failNext) {
      failNext = false;
      attempt.state = "failed";
      attempt.ended_at = Date.now();
      attempt.error = {
        code: "generation_failed",
        message: "回复生成失败，请检查本轮运行记录后重试。",
      };
      floor.state = "failed";
      floor.events.push({
        at: Date.now(),
        message: "生成失败，尚未提交回复",
      });
      s.running = false;
      s.failed = true;
      render();
      notify("回复生成失败，请重试。");
      return;
    }
    s.messages.push({
      floorId: floor.id,
      text: "林岚放下手里的书，朝窗边的空椅子示意。\n“坐一会儿吧。你想从哪里说起？”",
    });
    attempt.state = "completed";
    attempt.ended_at = Date.now();
    floor.state = "committed";
    floor.result = {
      floor_id: floor.id,
      assistant_message_id: `message-${nextId++}`,
      generated_text: s.messages.at(-1).text,
      committed_at: Date.now(),
      usage: null,
    };
    floor.events.push({ at: Date.now(), message: "回复已提交" });
    s.running = false;
    render();
    notify("回复已完成。");
  }, 1200);
}
function library(kind, mode = "manage") {
  libraryKind = kind;
  libraryMode = mode;
  $("libraryTitle").textContent =
    `${mode === "pick" ? "选择" : "管理"}${labels[kind]}`;
  $("libraryActions").innerHTML =
    mode === "manage"
      ? `<button class="primary" data-new="${kind}">新建${labels[kind]}</button>${!["model", "persona"].includes(kind) ? '<button data-action="import">导入 JSON</button>' : ""}`
      : '<p class="small">选择后请保存角色配置。</p>';
  $("libraryItems").innerHTML =
    resources
      .filter((r) => r.kind === kind)
      .map(
        (r) =>
          `<div class="resource-card"><div class="row"><strong>${esc(r.name)}</strong><span class="tag">${versionLabel(r.kind, r.versions.length)}</span></div><p class="small">${entryKinds.includes(kind) ? `${r.versions.at(-1).entries.length} 条内容` : "独立资源"} · ${references(r.id).length ? "已有引用" : "尚未绑定"}</p><div class="actions">${mode === "pick" ? `<button class="primary" data-pick="${r.id}">选择${versionLabel(r.kind, r.versions.length)}</button>` : `<button data-edit="${r.id}">编辑</button><button data-copy="${r.id}">复制</button>${!["model", "persona"].includes(kind) ? `<button data-export="${r.id}">导出</button>` : ""}<button class="danger" data-remove="${r.id}">删除</button>`}</div></div>`,
      )
      .join("") || '<p class="empty">暂无资源。</p>';
  if (!$("library").open) $("library").showModal();
}
function references(id) {
  return [
    ...Object.entries(draft)
      .filter(([, r]) => r?.id === id)
      .map(() => "当前绑定草稿"),
    ...Object.entries(saved)
      .filter(([, r]) => r?.id === id)
      .map(() => "已保存的角色配置"),
    ...releases
      .filter((r) => Object.values(r.config).some((ref) => ref?.id === id))
      .map((r) => `发布 v${r.version}`),
    ...sessions
      .filter((s) => Object.values(s.config).some((ref) => ref?.id === id))
      .map((s) => s.name),
  ];
}
function openEditor(kind, id, copy = false, version) {
  const r = getResource(id),
    base = version ? Number(version) : r?.versions.length;
  const begin = () => {
    editor = {
      kind,
      id: copy ? null : id,
      name: r ? r.name + (copy ? " 副本" : "") : "",
      doc: r ? clone(r.versions[base - 1]) : makeDoc(kind),
      base: r?.versions.length,
      sourceVersion: base,
      index: 0,
    };
    if (kind === "model") {
      editor.doc.api_key = "";
      if (copy) {
        editor.doc.credentialConfigured = false;
        editor.doc.api_key_masked = "";
      }
    }
    $("library").close();
    renderEditor();
  };
  leaveEditor(begin);
}
const placements = [
  [1, "用户输入"],
  [2, "角色回复"],
  [5, "世界书内容"],
  [0, "Markdown 显示（保留字段）"],
  [3, "斜杠命令（保留字段）"],
  [6, "推理内容（保留字段）"],
];
function fieldHtml([key, label, type], data) {
  if (type === "placements")
    return `<fieldset style="border:1px solid var(--line);margin-bottom:16px"><legend>${label}</legend>${placements.map(([v, l]) => `<label style="display:block;padding:7px"><input type="checkbox" data-placement="${v}" ${String(data.placement).split(",").includes(String(v)) ? "checked" : ""}> ${l}</label>`).join("")}</fieldset>`;
  const value = data[key];
  if (enums[type])
    return `<label class="field">${label}<select data-field="${key}" data-kind="${type}">${enums[type].map(([v, l]) => `<option value="${v}" ${String(value ?? "") === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
  if (type === "json")
    return `<label class="field">${label}<textarea data-field="${key}" data-kind="json">${esc(JSON.stringify(value ?? null, null, 2))}</textarea></label>`;
  if (type === "nullableNumber")
    return `<label class="field">${label}<input type="number" data-field="${key}" data-kind="nullableNumber" value="${value ?? ""}"></label>`;
  if (type === "password")
    return `<label class="field">${label}<input type="password" maxlength="2048" data-field="${key}" autocomplete="new-password" value="" placeholder="${data.credentialConfigured ? "已保存凭证，输入新密钥可替换" : "新建 Profile 必填"}"></label>`;
  return `<label class="field">${label}${
    type === "area"
      ? `<textarea data-field="${key}">${esc(value)}</textarea>`
      : type === "check"
        ? `<input type="checkbox" data-field="${key}" ${value ? "checked" : ""}>`
        : ["role", "position", "placement"].includes(type)
          ? `<select data-field="${key}">${(type === "role"
              ? [
                  ["system", "system"],
                  ["user", "user"],
                  ["assistant", "assistant"],
                ]
              : type === "position"
                ? [
                    [0, "相对顺序"],
                    [1, "指定深度"],
                  ]
                : [
                    [1, "用户输入"],
                    [2, "角色回复"],
                  ]
            )
              .map(
                ([v, l]) =>
                  `<option value="${v}" ${String(value) === String(v) ? "selected" : ""}>${l}</option>`,
              )
              .join("")}</select>`
          : `<input data-field="${key}" type="${type === "number" ? "number" : type === "url" ? "url" : "text"}" ${type === "number" ? 'step="any"' : ""} value="${esc(value)}">`
  }</label>`;
}
const regexReasons = {
  channel_filtered: "执行通道不匹配",
  depth_filtered: "消息深度不匹配",
  invalid_regex: "表达式无效，请修改规则",
  no_match: "未改变文本",
};
function regexTestPanel() {
  return `<section class="box" style="margin-top:24px"><h2>测试正则</h2><p class="small">测试当前编辑的规则。</p><label class="field">样本文本<textarea id="regexSample">[旁白]林岚走到门边。[/旁白]\n\n[scene_state]</textarea></label><div class="toolbar"><label class="field">执行位置<select id="regexPlacement">${placements.map(([v, l]) => `<option value="${v}" ${v === 2 ? "selected" : ""}>${l}</option>`).join("")}</select></label><label class="field">通道<select id="regexChannel"><option value="persist">持久化文本</option><option value="prompt">提示词</option><option value="display">显示</option><option value="edit">编辑后</option></select></label><label class="field">消息深度<input id="regexDepth" type="number" min="0" value="0"></label></div><label class="field">宏变量（JSON 对象）<textarea id="regexMacros">{"char":"林岚","user":"访客","scene.location":"港口书店","scene.time":"22:12","relationship.trust":35,"story.clue":"无署名的信"}</textarea></label><button class="primary" data-action="test-regex">测试当前规则</button><h2 style="margin-top:20px">处理结果</h2><div class="readonly" id="regexResult">输入样本后开始测试。</div></section>`;
}
function testRegex() {
  if (editor.errors && Object.keys(editor.errors).length) {
    notify("请先修正规则中的 JSON 格式。");
    return;
  }
  try {
    const macros = JSON.parse($("regexMacros").value);
    if (!macros || Array.isArray(macros) || typeof macros !== "object")
      throw Error("宏变量须为 JSON 对象。");
    const substitute = (text) =>
      text.replace(/\{\{([^}]+)\}\}/g, (token, key) =>
        Object.hasOwn(macros, key) ? String(macros[key]) : token,
      );
    const scripts = editor.doc.entries.map((x, i) => ({
      ...initialEntry("regex"),
      ...x,
      id: x.id || `rule-${i}`,
      trimStrings: x.trimStrings || [],
      placement: String(x.placement).split(",").filter(Boolean).map(Number),
    }));
    if (
      scripts.some(
        (x) =>
          !Array.isArray(x.trimStrings) ||
          x.trimStrings.some((v) => typeof v !== "string"),
      )
    )
      throw Error("裁剪文本须为字符串数组。");
    const result = applyRegexScriptsWithTrace(
      $("regexSample").value,
      scripts,
      Number($("regexPlacement").value),
      {
        channel: $("regexChannel").value,
        depth: Number($("regexDepth").value),
        substituteFindParams: substitute,
        substituteReplaceParams: substitute,
      },
    );
    $("regexResult").innerHTML =
      `<div class="markdown-block">${mdText(result.text)}</div><pre style="white-space:pre-wrap">${esc(result.text)}</pre><p class="small">参与规则：${esc(result.candidateRuleNames.join("、") || "无；请检查启停和执行位置")}<br>改变文本的规则：${esc(result.matchedRuleNames.join("、") || "无")}</p>${result.skippedRules.map((r) => `<p class="small">${esc(r.ruleName)}：${regexReasons[r.reason]}</p>`).join("")}`;
  } catch (error) {
    $("regexResult").textContent =
      error.message || "测试未完成，请检查样本和规则。";
  }
}
function testProfile(discover) {
  const e = editor;
  if (
    !e.doc.provider ||
    (!e.doc.api_key?.trim() && !e.doc.credentialConfigured) ||
    (!discover && !e.doc.model_id)
  ) {
    $("modelResult").textContent =
      "请填写 Provider、凭证和所需的模型标识后重试。";
    return;
  }
  $("modelResult").textContent = discover
    ? "正在获取模型列表…"
    : "正在向模型发送 Hello…";
  setTimeout(() => {
    if (editor !== e) return;
    if (false) {
      $("modelResult").textContent =
        "模型连接失败。请检查 API 地址、凭证与模型访问权限后重试。";
      return;
    }
    if (discover) {
      const models = ["harbor-chat", "harbor-reasoning"];
      $("modelResult").innerHTML = models
        .map((id) => `<button data-model-choice="${id}">${id}</button>`)
        .join(" ");
    } else
      $("modelResult").textContent =
        "请求：Hello\n回复：Hello! How can I help you today?";
  }, 600);
}

const slotLabels = {
  "*": "默认模型",
  narrator: "演绎角色",
  director: "导演",
  verifier: "校验",
  memory: "记忆整理",
};
const runtimeParamSchema = {
  type: "object",
  properties: {
    max_context_tokens: { type: ["integer", "null"], minimum: 1 },
    max_output_tokens: { type: ["integer", "null"], minimum: 1 },
    temperature: { type: ["number", "null"], minimum: 0, maximum: 2 },
    top_p: { type: ["number", "null"], minimum: 0, maximum: 1 },
    top_k: { type: ["integer", "null"], minimum: 0 },
    frequency_penalty: {
      type: ["number", "null"],
      minimum: -2,
      maximum: 2,
    },
    presence_penalty: {
      type: ["number", "null"],
      minimum: -2,
      maximum: 2,
    },
    stop_sequences: {
      type: ["array", "null"],
      items: { type: "string", minLength: 1 },
      maxItems: 16,
    },
    seed: { type: ["integer", "null"] },
    repetition_penalty: {
      type: ["number", "null"],
      exclusiveMinimum: 0,
      maximum: 2,
    },
    min_p: { type: ["number", "null"], minimum: 0, maximum: 1 },
    logit_bias: {
      anyOf: [
        {
          type: "object",
          additionalProperties: {
            type: "number",
            minimum: -100,
            maximum: 100,
          },
          maxProperties: 256,
        },
        { type: "null" },
      ],
    },
    response_format: {
      anyOf: [
        {
          type: "object",
          required: ["type"],
          properties: {
            type: {
              type: "string",
              enum: ["text", "json_object", "json_schema"],
            },
            json_schema: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    stream: { type: ["boolean", "null"] },
    timeout_ms: { type: ["integer", "null"], minimum: 1 },
    max_retries: { type: ["integer", "null"], minimum: 0, maximum: 10 },
    reasoning_effort: {
      type: ["string", "null"],
      enum: ["low", "medium", "high", null],
    },
  },
  additionalProperties: false,
};
function schemaAccepts(value, schema) {
  if (schema.anyOf) return schema.anyOf.some((s) => schemaAccepts(value, s));
  if (schema.enum && !schema.enum.includes(value)) return false;
  const type =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      !allowed.includes(type) &&
      !(
        type === "number" &&
        Number.isInteger(value) &&
        allowed.includes("integer")
      )
    )
      return false;
  }
  if (type === "number") {
    if (
      !Number.isFinite(value) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum) ||
      (schema.exclusiveMinimum !== undefined &&
        value <= schema.exclusiveMinimum)
    )
      return false;
  }
  if (
    type === "string" &&
    schema.minLength !== undefined &&
    value.length < schema.minLength
  )
    return false;
  if (type === "array") {
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      return false;
    if (schema.items && !value.every((v) => schemaAccepts(v, schema.items)))
      return false;
  }
  if (type === "object") {
    if (
      schema.maxProperties !== undefined &&
      Object.keys(value).length > schema.maxProperties
    )
      return false;
    if (schema.required?.some((k) => !Object.hasOwn(value, k))) return false;
    for (const [k, v] of Object.entries(value)) {
      const field = schema.properties?.[k];
      if (field && !schemaAccepts(v, field)) return false;
      if (!field && schema.additionalProperties === false) return false;
      if (
        !field &&
        typeof schema.additionalProperties === "object" &&
        !schemaAccepts(v, schema.additionalProperties)
      )
        return false;
    }
  }
  return true;
}

const runtimeParamFields = [
  ["max_context_tokens", "上下文上限", "nullableNumber"],
  ["max_output_tokens", "输出上限", "nullableNumber"],
  ["temperature", "Temperature", "nullableNumber"],
  ["top_p", "Top P", "nullableNumber"],
  ["top_k", "Top K", "nullableNumber"],
  ["frequency_penalty", "频率惩罚", "nullableNumber"],
  ["presence_penalty", "存在惩罚", "nullableNumber"],
  ["stop_sequences", "停止序列（JSON 数组或 null）", "json"],
  ["seed", "随机种子", "nullableNumber"],
  ["repetition_penalty", "重复惩罚", "nullableNumber"],
  ["min_p", "Min P", "nullableNumber"],
  ["logit_bias", "Token 偏置（JSON 对象或 null）", "json"],
  ["response_format", "响应格式（JSON 对象或 null）", "json"],
  ["stream", "流式响应", "tri"],
  ["timeout_ms", "超时（毫秒）", "nullableNumber"],
  ["max_retries", "模型请求重试次数", "nullableNumber"],
  ["reasoning_effort", "推理强度", "reasoning"],
];
const turnFields = [
  ["enableTools", "启用工具", "check"],
  ["enableDirector", "启用导演", "check"],
  ["enableVerifier", "启用校验", "check"],
  ["enableMemoryConsolidation", "启用记忆整理", "check"],
  ["toolMode", "工具执行方式", "toolMode"],
  ["verifierFailStrategy", "校验失败处理", "verifyStrategy"],
  ["maxRetries", "校验重试上限（0–5）", "number"],
];
Object.assign(enums, {
  reasoning: [
    ["", "使用默认值"],
    ["low", "低"],
    ["medium", "中"],
    ["high", "高"],
  ],
  toolMode: [
    ["inline", "内联"],
    ["standalone", "独立"],
    ["both", "两者"],
  ],
  verifyStrategy: [
    ["warn", "记录警告"],
    ["block", "阻止提交"],
    ["retry", "重试"],
  ],
});
function openRuntime() {
  leaveEditor(() => {
    editor = {
      kind: "runtime",
      doc: clone(draft.runtime),
      slot: "narrator",
      errors: {},
    };
    renderRuntime();
  });
}
function runtimeRead(input, target) {
  const key = input.dataset.field,
    kind = input.dataset.kind;
  if (kind === "json") {
    try {
      target[key] = JSON.parse(input.value);
      delete editor.errors[key];
      $("editorError").textContent = "";
    } catch {
      editor.errors[key] = true;
      $("editorError").textContent = "JSON 格式不正确，请修正后应用。";
    }
    return;
  }
  target[key] =
    input.type === "checkbox"
      ? input.checked
      : kind === "tri"
        ? input.value === ""
          ? null
          : input.value === "true"
        : input.type === "number"
          ? input.value === ""
            ? null
            : Number(input.value)
          : input.value || null;
}
function renderRuntime() {
  const e = editor,
    slot = e.doc.slots[e.slot];
  $("mainView").innerHTML =
    `<section class="editor-shell"><div class="toolbar"><h1>演绎运行配置</h1><button data-action="cancel-editor">取消编辑</button><button class="primary" data-action="save-runtime">应用到角色草稿</button></div><p class="small">调整后请保存角色配置。</p><h2>回合流程</h2><div id="turnFields">${turnFields.map((f) => fieldHtml(f, e.doc.turn)).join("")}</div><h2>LLM 实例槽位</h2><div class="actions">${Object.entries(
      slotLabels,
    )
      .map(
        ([id, name]) =>
          `<button data-slot="${id}" class="${id === e.slot ? "active" : ""}">${name}</button>`,
      )
      .join(
        "",
      )}</div><div class="box"><h2>${slotLabels[e.slot]} · ${e.slot}</h2><div id="slotFields">${fieldHtml(["enabled", "启用此槽位", "check"], slot)}<label class="field">LLM Profile<select id="slotProfile"><option value="">${e.slot === "*" ? "未选择" : "沿用默认槽位"}</option>${resources
      .filter((r) => r.kind === "model")
      .map(
        (r) =>
          `<option value="${r.id}" ${slot.preset_id === r.id ? "selected" : ""}>${esc(r.name)}</option>`,
      )
      .join(
        "",
      )}</select></label>${fieldHtml(["model_id_override", "覆盖模型标识（留空沿用 Profile）", "text"], slot)}</div><details open><summary>生成参数</summary><div id="slotParams">${runtimeParamFields.map((f) => fieldHtml(f, slot.params)).join("")}</div></details><details><summary>工具调用能力</summary><div id="slotCapabilities">${[
      ["supports_function_call", "支持函数调用", "tri"],
      ["supports_tool_choice", "支持工具选择", "tri"],
      ["supports_streaming_tool_call", "支持流式工具调用", "tri"],
      [
        "unsupported_generation_params",
        "不支持的生成参数（JSON 数组）",
        "json",
      ],
    ]
      .map((f) => fieldHtml(f, slot.capabilities))
      .join(
        "",
      )}</div></details></div><p id="editorError" class="danger" role="alert"></p></section>`;
  for (const [id, target] of [
    ["turnFields", e.doc.turn],
    ["slotFields", slot],
    ["slotParams", slot.params],
    ["slotCapabilities", slot.capabilities],
  ])
    document
      .querySelectorAll(`#${id} [data-field]`)
      .forEach((input) => (input.oninput = () => runtimeRead(input, target)));
  $("slotProfile").onchange = (ev) =>
    (slot.preset_id = ev.target.value || null);
}

Object.assign(enums, {
  scopeKind: [
    ["floor", "楼层"],
    ["session", "会话"],
    ["project", "项目"],
    ["workspace", "工作区"],
  ],
});
let agentTypes = [
    {
      id: "agent-type-1",
      key: "story-review",
      name: "剧情审阅",
      scope_kind: "session",
      status: "active",
      defaults: {
        llm_profile_id: "model-1",
        tool_policy_id: null,
        mcp_bindings: [],
        event_subscriptions: [],
        grants: {},
        metadata: {},
      },
    },
  ],
  agentBindings = [],
  agentJobs = [];
const agentDefaultFields = [
  ["tool_policy_id", "工具策略 ID（可选）", "text"],
  ["mcp_bindings", "MCP 绑定（JSON 数组）", "json"],
  ["event_subscriptions", "事件订阅（JSON 数组）", "json"],
  ["grants", "授权配置（JSON 对象）", "json"],
  ["metadata", "元数据（JSON 对象）", "json"],
];
function agentList(mode) {
  leaveEditor(() => {
    editor = { kind: "agent-list", mode };
    renderAgentList();
  });
}
function renderAgentList() {
  const mode = editor.mode,
    types = mode === "types",
    items = types ? agentTypes : agentBindings;
  $("mainView").innerHTML =
    `<section class="editor-shell"><div class="toolbar"><h1>${types ? "工作区 Agent 类型" : "项目 Agent"}</h1><button data-action="back-trial">返回试聊</button><button class="primary" data-agent-new="${mode}">${types ? "新建类型" : "添加项目绑定"}</button></div><p class="small">${types ? `工作区 ${esc(management.account)}` : "项目：港口书店"}</p>${items.map((x) => `<div class="resource-card"><div class="row"><strong>${esc(types ? x.name : agentTypes.find((t) => t.id === x.agent_type_id)?.name)}</strong><span class="tag">${esc(x.status)}</span></div><p class="small">作用域：${esc(x.scope_kind)} · ${esc(x.id)}</p><div class="actions"><button data-agent-edit="${x.id}" data-agent-mode="${mode}">编辑</button><button data-agent-toggle="${x.id}" data-agent-mode="${mode}">${["active", "enabled"].includes(x.status) ? "停用" : "启用"}</button>${types ? "" : `<button data-agent-run="${x.id}" ${x.status !== "enabled" ? "disabled" : ""}>运行任务</button><details><summary>查看绑定配置</summary><pre class="readonly">${esc(JSON.stringify(x, null, 2))}</pre></details>`}</div></div>`).join("") || '<p class="empty">暂无记录。</p>'}${types ? "" : `<h2 style="margin-top:24px">任务记录</h2>${agentJobs.map((j) => `<div class="version"><strong>${esc(j.id)}</strong> · ${j.status}<p class="small">${j.dry_run ? "预演" : "执行"} · ${esc(j.trigger_reason || "手动触发")}</p><details><summary>查看输入与结果</summary><pre class="readonly">${esc(JSON.stringify(j, null, 2))}</pre></details>${j.status === "queued" ? `<button data-agent-cancel="${j.id}">取消任务</button>` : ""}</div>`).join("") || '<p class="empty">尚未运行任务。</p>'}`}</section>`;
}
function editAgent(mode, id) {
  const existing = (mode === "types" ? agentTypes : agentBindings).find(
    (x) => x.id === id,
  );
  editor = {
    kind: "agent-edit",
    mode,
    id,
    errors: {},
    doc: existing
      ? clone(existing)
      : mode === "types"
        ? {
            key: "",
            name: "",
            scope_kind: "session",
            status: "active",
            defaults: {
              llm_profile_id: null,
              tool_policy_id: null,
              mcp_bindings: [],
              event_subscriptions: [],
              grants: {},
              metadata: {},
            },
          }
        : {
            agent_type_id: agentTypes[0]?.id || "",
            scope_kind: "session",
            status: "enabled",
            llm_profile_id: null,
            tool_policy_id: null,
            mcp_bindings: [],
            event_subscriptions: [],
            grants: {},
            metadata: {},
          },
  };
  renderAgentEditor();
}
function renderAgentEditor() {
  const e = editor,
    types = e.mode === "types",
    defaults = types ? e.doc.defaults : e.doc;
  $("mainView").innerHTML =
    `<section class="editor-shell"><div class="toolbar"><h1>${e.id ? "编辑" : "新建"}${types ? " Agent 类型" : "项目绑定"}</h1><button data-action="cancel-agent">取消</button><button class="primary" data-action="save-agent">保存${types ? "类型" : "项目绑定"}</button></div><div id="agentBasics">${types ? fieldHtml(["key", "类型 Key（创建后固定）", "text"], e.doc) + fieldHtml(["name", "Agent 类型名称", "text"], e.doc) : `<label class="field">Agent 类型<select id="agentTypeChoice" ${e.id ? "disabled" : ""}>${agentTypes.map((t) => `<option value="${t.id}" ${t.id === e.doc.agent_type_id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>`}${fieldHtml(["scope_kind", "Agent 运行作用域", "scopeKind"], e.doc)}</div><h2>${types ? "Agent 类型默认配置" : "当前项目的 Agent 配置"}</h2><label class="field">LLM Profile<select id="agentProfile"><option value="">${types ? "未指定" : "沿用类型默认值"}</option>${resources
      .filter((r) => r.kind === "model")
      .map(
        (r) =>
          `<option value="${r.id}" ${defaults.llm_profile_id === r.id ? "selected" : ""}>${esc(r.name)}</option>`,
      )
      .join(
        "",
      )}</select></label><div id="agentDefaults">${agentDefaultFields.map((f) => fieldHtml(f, defaults)).join("")}</div><details><summary>MCP 与事件订阅字段</summary><p class="small">MCP：mcp_server_id、allowed_tools、config_override_json。事件订阅：type、filter_json。授权和元数据使用后端支持的 JSON 对象。</p></details><p id="editorError" class="danger" role="alert"></p></section>`;
  for (const [parent, data] of [
    ["agentBasics", e.doc],
    ["agentDefaults", defaults],
  ])
    document.querySelectorAll(`#${parent} [data-field]`).forEach((input) => {
      if (types && e.id && ["key", "scope_kind"].includes(input.dataset.field))
        input.disabled = true;
      input.oninput = () => runtimeRead(input, data);
    });
  $("agentProfile").onchange = (ev) =>
    (defaults.llm_profile_id = ev.target.value || null);
  if (!types)
    $("agentTypeChoice").onchange = (ev) =>
      (e.doc.agent_type_id = ev.target.value);
}
function saveAgent() {
  const e = editor;
  if (Object.keys(e.errors).length) {
    notify("请修正 JSON 格式后保存。");
    return;
  }
  if (e.mode === "types" && (!e.doc.key?.trim() || !e.doc.name?.trim())) {
    notify("请填写类型 Key 和名称。");
    return;
  }
  if (e.mode !== "types" && !e.doc.agent_type_id) {
    notify("请先创建并选择 Agent 类型。");
    return;
  }
  const list = e.mode === "types" ? agentTypes : agentBindings,
    id = e.id || `agent-${nextId++}`,
    index = list.findIndex((x) => x.id === id);
  if (index >= 0) list[index] = { ...clone(e.doc), id };
  else list.push({ ...clone(e.doc), id });
  editor = { kind: "agent-list", mode: e.mode };
  renderAgentList();
  notify("配置已保存。");
}
function agentRun(id) {
  editor = {
    kind: "agent-run",
    bindingId: id,
    doc: {
      trigger_reason: "手动检查剧情",
      dry_run: true,
      input_json: {},
    },
    errors: {},
  };
  $("mainView").innerHTML =
    `<section class="editor-shell"><h1>运行 Agent 任务</h1>${[
      ["trigger_reason", "触发原因", "text"],
      ["dry_run", "预演（dry_run）", "check"],
      ["input_json", "任务输入（JSON 对象）", "json"],
    ]
      .map((f) => fieldHtml(f, editor.doc))
      .join(
        "",
      )}<div class="actions"><button data-action="cancel-agent">取消</button><button class="primary" data-action="submit-agent-job">提交任务</button></div><p id="editorError" class="danger" role="alert"></p></section>`;
  document
    .querySelectorAll("[data-field]")
    .forEach((input) => (input.oninput = () => runtimeRead(input, editor.doc)));
}

const bookFields = [
  ["scanDepth", "全局扫描深度", "number"],
  ["caseSensitive", "全局大小写敏感", "check"],
  ["matchWholeWords", "全局全词匹配", "check"],
  ["recursive", "递归扫描", "check"],
  ["maxRecursionSteps", "最大递归步数", "number"],
];
function bookPanel(doc) {
  return `<details class="box"><summary>世界书全局设置</summary>${bookFields.map((f) => fieldHtml(f, doc).replaceAll("data-field=", "data-global=")).join("")}</details>`;
}
function renderEditor() {
  if (editor.kind === "runtime") {
    renderRuntime();
    return;
  }
  const e = editor,
    entries = e.doc.entries,
    data = entries ? entries[e.index] : e.doc;
  $("mainView").innerHTML =
    `<section class="editor-shell"><div class="toolbar"><div><span class="small">资源库 / ${labels[e.kind]}</span><h1>${e.id ? "编辑" : "新建"}${labels[e.kind]}</h1></div><button data-action="cancel-editor">取消编辑</button><button class="primary" data-action="save-resource">保存资源</button></div><p class="small">${e.id ? `从${versionLabel(e.kind, e.sourceVersion)}编辑，保存后形成${versionLabel(e.kind, e.base + 1)}。` : "保存后加入资源库。"}角色应用的版本绑定由右侧单独保存。</p><label class="field">资源名称<input id="resourceName" maxlength="80" value="${esc(e.name)}"></label>${e.kind === "worldbook" ? bookPanel(e.doc) : ""}<div class="${entries ? "editor-grid" : ""}">${entries ? `<div><h2>条目 · ${entries.length}</h2>${entries.map((item, i) => `<div class="entry"><button class="${e.index === i ? "active" : ""}" data-entry="${i}">${esc(item.name || item.comment || item.scriptName || `未命名条目 ${i + 1}`)}</button></div>`).join("")}<button data-action="add-entry">新增条目</button><p class="small">条目增删和排序在保存资源后生效。</p></div>` : ""}<div class="editor-fields">${data ? `${entries ? `<div class="actions"><button data-action="entry-up" ${e.index ? "" : "disabled"}>上移</button><button data-action="entry-down" ${e.index < entries.length - 1 ? "" : "disabled"}>下移</button><button class="danger" data-action="delete-entry">删除此条目</button></div>` : ""}${fields[e.kind].map((f) => fieldHtml(f, data)).join("")}${e.kind === "model" ? `<p class="small">凭证：${esc(e.doc.api_key_masked || "尚未保存")}</p><div class="actions"><button data-action="discover-models">获取模型列表</button><button data-action="test-model">测试模型</button></div><div id="modelResult" class="readonly"></div>` : ""}` : '<p class="empty">暂无条目。</p>'}${e.kind === "regex" ? '<p class="small">按列表顺序执行。</p>' : ""}</div></div>${e.kind === "regex" ? regexTestPanel() : ""}<p id="editorError" role="alert" class="danger"></p></section>`;
  $("resourceName").oninput = (ev) => (e.name = ev.target.value);
  document.querySelectorAll("[data-global]").forEach(
    (input) =>
      (input.oninput = () => {
        e.doc[input.dataset.global] =
          input.type === "checkbox" ? input.checked : Number(input.value);
      }),
  );
  document.querySelectorAll("[data-placement]").forEach(
    (input) =>
      (input.onchange = () => {
        const values = String(data.placement)
          .split(",")
          .filter(Boolean)
          .filter((x) => x !== input.dataset.placement);
        if (input.checked) values.push(input.dataset.placement);
        data.placement = values.join(",");
      }),
  );
  document.querySelectorAll("[data-field]").forEach(
    (input) =>
      (input.oninput = () => {
        const key = input.dataset.field,
          kind = input.dataset.kind;
        editor.errors ??= {};
        if (kind === "json") {
          try {
            data[key] = JSON.parse(input.value);
            delete editor.errors[key];
            $("editorError").textContent = "";
          } catch {
            editor.errors[key] = true;
            $("editorError").textContent = "JSON 格式不正确，请修正后保存。";
          }
          return;
        }
        if (kind === "tri") {
          data[key] = input.value === "" ? null : input.value === "true";
          return;
        }
        if (kind === "nullableNumber") {
          data[key] = input.value === "" ? null : Number(input.value);
          return;
        }
        if (["wiPosition", "wiLogic", "wiRole", "substitute"].includes(kind)) {
          data[key] = Number(input.value);
          return;
        }
        data[input.dataset.field] =
          input.type === "checkbox"
            ? input.checked
            : input.type === "number"
              ? Number(input.value)
              : ["injection_position"].includes(input.dataset.field)
                ? Number(input.value)
                : input.value;
      }),
  );
}
function saveResource() {
  const e = editor;
  if (e.errors && Object.keys(e.errors).length) {
    notify("请修正编辑器中的 JSON 格式后保存。");
    return;
  }
  if (!e.name.trim()) {
    notify("请输入资源名称后保存。");
    $("resourceName").focus();
    return;
  }
  if (e.kind === "model" && (!e.doc.provider || !e.doc.model_id)) {
    notify("请填写 Provider、模型标识和凭证后保存。");
    return;
  }
  if (
    e.kind === "regex" &&
    e.doc.entries.some(
      (x) =>
        !String(x.placement)
          .split(",")
          .every(
            (v) =>
              v.trim() !== "" && Number.isInteger(Number(v)) && Number(v) >= 0,
          ),
    )
  ) {
    notify("请至少选择一个执行位置后保存。");
    return;
  }
  if (
    e.kind === "worldbook" &&
    [e.doc.scanDepth, e.doc.maxRecursionSteps].some(
      (v) => v !== undefined && (!Number.isInteger(v) || v < 0),
    )
  ) {
    notify("全局扫描深度与递归步数必须为非负整数。");
    return;
  }
  if (e.kind === "worldbook") {
    if (
      e.doc.entries.some(
        (x) =>
          ![0, 1, 2, 3, 4, 5, 6, 7].includes(x.position) ||
          ![0, 1, 2].includes(x.role) ||
          ![0, 1, 2, 3].includes(x.selectiveLogic) ||
          !Number.isInteger(x.depth) ||
          x.depth < 0 ||
          !Number.isInteger(x.order) ||
          (x.scanDepth !== null &&
            (!Number.isInteger(x.scanDepth) || x.scanDepth < 0)) ||
          (x.delayUntilRecursion !== null &&
            (!Number.isInteger(x.delayUntilRecursion) ||
              x.delayUntilRecursion < 1)),
      )
    ) {
      notify(
        "请检查插入位置、消息角色、匹配逻辑及深度。扫描深度至少为 0，递归层级至少为 1，或留空使用默认值。",
      );
      return;
    }
  }
  if (
    e.kind === "preset" &&
    e.doc.entries.some(
      (x) =>
        !x.identifier ||
        !Array.isArray(x.injection_trigger) ||
        !x.extra ||
        Array.isArray(x.extra) ||
        typeof x.extra !== "object",
    )
  ) {
    notify("请填写条目标识，触发条件使用 JSON 数组，扩展字段使用 JSON 对象。");
    return;
  }
  if (
    e.kind === "regex" &&
    e.doc.entries.some(
      (x) =>
        !Array.isArray(x.trimStrings) ||
        x.trimStrings.some((t) => typeof t !== "string"),
    )
  ) {
    notify("裁剪文本必须是字符串数组。");
    return;
  }
  if (e.kind === "model") {
    if (!e.doc.api_key?.trim() && !e.doc.credentialConfigured) {
      notify("请输入 API Key 后保存 Profile。");
      return;
    }
    if (e.doc.api_key?.trim()) {
      e.doc.api_key_masked = "••••" + e.doc.api_key.trim().slice(-4);
      e.doc.credentialConfigured = true;
      delete e.doc.api_key;
    }
  }
  let r = getResource(e.id);
  if (r && r.versions.length !== e.base) {
    notify("资源版本已更新，请重新打开编辑器。");
    return;
  }
  if (r) {
    r.name = e.name.trim();
    r.versions.push(clone(e.doc));
  } else {
    r = {
      id: `${e.kind}-${nextId++}`,
      kind: e.kind,
      name: e.name.trim(),
      versions: [clone(e.doc)],
    };
    resources.push(r);
  }
  const updatesBoundCharacter =
    r.kind === "character" &&
    draft.character?.id === r.id &&
    draft.character.version === e.sourceVersion;
  if (updatesBoundCharacter)
    draft.character = { id: r.id, version: r.versions.length };
  editor = null;
  render();
  notify(
    updatesBoundCharacter
      ? `已保存“${r.name}”${versionLabel(r.kind, r.versions.length)}并选入当前草稿。请保存草稿后发布。`
      : `已保存“${r.name}”${versionLabel(r.kind, r.versions.length)}。如需使用，请在右侧选择该版本并保存草稿。`,
  );

  library(r.kind);
}
function toExternal(r) {
  const d = clone(r.versions.at(-1));
  if (r.kind === "preset")
    return {
      ...d,
      entries: undefined,
      prompts: d.entries.map((x, i) => ({
        ...x,
        identifier: x.identifier || `entry-${i + 1}`,
      })),
      prompt_order: [
        ...(d.prompt_order || []).filter((x) => x.character_id !== 100001),
        {
          character_id: 100001,
          order: d.entries.map((x, i) => ({
            identifier: x.identifier || `entry-${i + 1}`,
            enabled: x.enabled,
          })),
        },
      ],
    };
  if (r.kind === "regex")
    return d.entries.map((x) => ({
      ...x,
      placement: String(x.placement).split(",").map(Number),
    }));
  if (r.kind === "worldbook")
    return {
      ...d,
      entries: Object.fromEntries(
        d.entries.map((x, i) => [
          i,
          {
            ...x,
            uid: x.uid ?? i,
            keysecondary: String(x.keysecondary || "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            key: String(x.key)
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          },
        ]),
      ),
    };
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { ...d, name: r.name },
  };
}
$("importFile").onchange = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    let doc,
      name = file.name.replace(/\.json$/i, "");
    if (libraryKind === "preset") {
      if (!Array.isArray(raw.prompts)) throw Error();
      const order = raw.prompt_order?.find(
        (x) => x.character_id === 100001,
      )?.order;
      const prompts = clone(raw.prompts);
      const ordered = order
        ? order
            .map((item) => {
              const prompt = prompts.find(
                (p) => p.identifier === item.identifier,
              );
              return prompt ? { ...prompt, enabled: item.enabled } : null;
            })
            .filter(Boolean)
        : prompts;
      doc = {
        ...raw,
        entries: [
          ...ordered,
          ...prompts.filter(
            (p) => !ordered.some((x) => x.identifier === p.identifier),
          ),
        ],
      };
    } else if (libraryKind === "worldbook") {
      if (!raw.entries || typeof raw.entries !== "object") throw Error();
      doc = {
        ...raw,
        entries: Object.values(raw.entries).map((x) => ({
          ...x,
          key: Array.isArray(x.key) ? x.key.join(",") : x.key || "",
          keysecondary: Array.isArray(x.keysecondary)
            ? x.keysecondary.join(",")
            : x.keysecondary || "",
        })),
      };
    } else if (libraryKind === "regex") {
      if (!Array.isArray(raw)) throw Error();
      doc = {
        entries: raw.map((x) => ({
          ...x,
          placement: Array.isArray(x.placement)
            ? x.placement.join(",")
            : String(x.placement ?? ""),
        })),
      };
    } else {
      const data = raw.data || raw;
      if (typeof data.description !== "string") throw Error();
      doc = data;
      name = data.name || name;
    }
    const kind = libraryKind;
    leaveEditor(() => {
      editor = { kind, id: null, name, doc, index: 0 };
      $("library").close();
      renderEditor();
      notify("文件已读入编辑器。检查内容后保存资源。");
    });
  } catch {
    notify("文件格式不匹配。请选择该资源类型的 JSON 文件重新导入。");
    $("library").close();
  }
  ev.target.value = "";
};
$("sessionFilter").onchange = renderNav;
$("newTrial").onclick = createTrial;
$("openApp").onclick = () =>
  leaveEditor(() => {
    render();
    tab = "bindings";
    renderInspector();
  });
$("closeLibrary").onclick = () => $("library").close();
$("deploymentInfo").onclick = () =>
  ask(
    "服务配置位置",
    "配置项说明位于 .env.example 和 apps/api/src/config.ts。维护者修改部署环境变量后，按部署方式重启服务。",
    () => {},
  );
document.addEventListener("change", (ev) => {
  if (ev.target.matches?.("[data-debug-select]")) {
    const s = getSession();
    if (s) {
      s.debugFloor = ev.target.value;
      if (editor?.kind === "debug") renderDebugger();
      renderInspector();
    }
    return;
  }
  if (ev.target.dataset.instance) {
    draft.instance.temperature = Number(ev.target.value);
    renderInspector();
    return;
  }
  if (ev.target.dataset.binding) {
    selectConfigurationResource(ev.target.dataset.binding, ev.target.value);
  }
  if (ev.target.dataset.bindingVersion) {
    const kind = ev.target.dataset.bindingVersion;
    selectConfigurationResource(kind, draft[kind].id, Number(ev.target.value));
  }
});
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.tab) {
    if (d.tab === "debug") {
      openDebug();
      return;
    }
    tab = d.tab;
    renderInspector();
  }
  if (d.library) library(d.library, d.mode);
  if (d.session)
    leaveEditor(() => {
      selected = d.session;
      render();
    });
  if (d.new) openEditor(d.new);
  if (d.edit) {
    const r = getResource(d.edit);
    openEditor(r.kind, r.id, false, d.version);
  }
  if (d.copy) {
    const r = getResource(d.copy);
    openEditor(r.kind, r.id, true);
  }
  if (d.entry !== undefined) {
    editor.index = Number(d.entry);
    renderEditor();
  }
  if (d.pick) {
    const r = getResource(d.pick);
    selectConfigurationResource(r.kind, r.id);
    $("library").close();
    tab = "bindings";
    renderInspector();
    notify("已选择资源。请保存角色应用草稿。");
  }
  if (d.remove) {
    const refs = references(d.remove);
    if (refs.length) {
      $("library").close();
      ask(
        "此资源仍被引用",
        `引用位置：${refs.join("、")}。解除引用后才能删除。`,
        () => {},
      );
      return;
    }
    const r = getResource(d.remove);
    ask(`删除“${r.name}”？`, "删除后，该资源及其版本将从资源库移除。", () => {
      resources = resources.filter((x) => x.id !== r.id);
      render();
      library(r.kind);
      notify("资源已删除。");
    });
  }
  if (d.export) {
    const r = getResource(d.export),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(toExternal(r), null, 2)], {
          type: "application/json",
        }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = r.name + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  if (d.restore)
    ask(
      `让新对话使用 v${d.restore}？`,
      "新对话将使用这个版本，已有对话保持原配置。",
      () => {
        activeRelease = Number(d.restore);
        render();
        notify(`新对话将使用 v${activeRelease}，已有对话继续使用原版本。`);
      },
    );
  if (d.modelChoice && editor?.kind === "model") {
    editor.doc.model_id = d.modelChoice;
    renderEditor();
  }
  const action = d.action,
    s = getSession();
  if (d.debugFloor) openDebug(d.debugFloor);
  if (d.debugTab && editor?.kind === "debug") {
    editor.tab = d.debugTab;
    renderDebugger();
  }
  if (action === "refresh-debug") {
    renderDebugger();
    notify("已刷新。");
  }
  if (action === "retry" && s?.failed) generate(s);
  if (action === "test-regex") testRegex();
  if (action === "discover-models") testProfile(true);
  if (action === "test-model") testProfile(false);
  if (d.slot && editor?.kind === "runtime") {
    editor.slot = d.slot;
    renderRuntime();
  }
  if (action === "open-runtime") openRuntime();
  if (action === "save-runtime") {
    if (Object.keys(editor.errors).length) {
      notify("请修正 JSON 格式后应用。");
      return;
    }
    if (editor.doc.turn.maxRetries < 0 || editor.doc.turn.maxRetries > 5) {
      notify("校验重试次数应为 0 到 5。");
      return;
    }
    for (const [slot, config] of Object.entries(editor.doc.slots)) {
      if (!schemaAccepts(config.params, runtimeParamSchema)) {
        notify(
          `${slotLabels[slot]}的生成参数不符合接口约束，请检查数值范围与 JSON 结构。`,
        );
        return;
      }
    }
    draft.runtime = clone(editor.doc);
    draft.runtime.resolved = snapshotSlots(draft.runtime.slots);
    const narratorId = draft.runtime.resolved.narrator.profile_id,
      profile = getResource(narratorId);
    draft.model = profile
      ? { id: profile.id, version: profile.versions.length }
      : null;
    draft.instance.temperature =
      editor.doc.slots.narrator.params.temperature ?? null;
    editor = null;
    render();
    notify("运行配置已应用到角色草稿，请保存草稿后试聊或发布。");
  }
  if (action === "agent-types") agentList("types");
  if (action === "agent-bindings") agentList("bindings");
  if (action === "back-trial") {
    editor = null;
    render();
  }
  if (d.agentNew) editAgent(d.agentNew);
  if (d.agentEdit) editAgent(d.agentMode, d.agentEdit);
  if (d.agentToggle) {
    const x = (d.agentMode === "types" ? agentTypes : agentBindings).find(
      (x) => x.id === d.agentToggle,
    );
    x.status = ["active", "enabled"].includes(x.status)
      ? "disabled"
      : d.agentMode === "types"
        ? "active"
        : "enabled";
    renderAgentList();
  }
  if (d.agentRun) {
    const binding = agentBindings.find((x) => x.id === d.agentRun),
      type = agentTypes.find((t) => t.id === binding?.agent_type_id);
    if (binding?.status === "enabled" && type?.status === "active")
      agentRun(d.agentRun);
    else notify("Agent 类型或项目绑定已停用，请启用后运行。");
  }
  if (d.agentCancel) {
    agentJobs.find((j) => j.id === d.agentCancel).status = "cancelled";
    renderAgentList();
  }
  if (action === "save-agent") saveAgent();
  if (action === "cancel-agent") {
    const mode = editor.mode || "bindings";
    leaveEditor(() => {
      editor = { kind: "agent-list", mode };
      renderAgentList();
    });
  }
  if (action === "submit-agent-job") {
    if (Object.keys(editor.errors).length) {
      notify("请修正任务输入 JSON 后提交。");
      return;
    }
    agentJobs.push({
      id: `job-${nextId++}`,
      agent_binding_id: editor.bindingId,
      ...clone(editor.doc),
      status: "queued",
      result: null,
    });
    editor = { kind: "agent-list", mode: "bindings" };
    renderAgentList();
    notify("任务已排队。");
  }

  if (action === "start") createTrial();
  if (action === "save-draft") {
    if (!dirty()) return;
    if (invalid().length || runtimeMissing(draft.runtime).length) {
      notify(
        `请补齐或修正${[...invalid(), ...runtimeMissing(draft.runtime)].join("、")}后保存。`,
      );
      return;
    }
    draft.runtime.resolved = snapshotSlots(draft.runtime.slots);
    saved = clone(draft);
    revision++;
    render();
    notify(`已保存“${referenceName(saved.character)}”的角色配置，可以发布。`);
  }
  if (action === "reset-draft") {
    draft = clone(saved);
    renderInspector();
    notify("已撤销未保存的绑定修改。");
  }
  if (action === "rename" && s)
    ask(
      "重命名试聊",
      "修改列表名称，保持对话内容和配置不变。",
      (name) => {
        s.name = name;
        render();
      },
      s.name,
    );
  if (action === "archive" && s) {
    if (s.running) {
      notify("此试聊仍在生成，请完成后归档。");
      return;
    }
    s.status = s.status === "active" ? "archived" : "active";
    $("sessionFilter").value = s.status;
    render();
    notify(
      s.status === "archived"
        ? "试聊已归档，可从已归档列表恢复。"
        : "试聊已恢复。",
    );
  }
  if (action === "delete" && s) {
    if (s.running) {
      notify("此试聊仍在生成，完成后可以删除。");
      return;
    }
    ask(
      `删除“${s.name}”？`,
      "此试聊及全部对话记录将被删除，角色资源和其他会话保持不变。",
      () => {
        if (s.running) {
          notify("此试聊仍在生成，完成后可以删除。");
          return;
        }
        sessions = sessions.filter((x) => x.id !== s.id);
        selected = null;
        render();
        notify("试聊已删除。");
      },
    );
  }
  if (action === "publish") {
    if (editor) {
      notify("资源仍在编辑。请先保存资源或取消编辑，再检查绑定并发布。");
      return;
    }
    if (dirty() || invalid().length || runtimeMissing(saved.runtime).length) {
      notify("发布未完成。请补齐角色配置并保存草稿。");
      tab = "bindings";
      renderInspector();
      return;
    }
    const state = publicationState();
    if (state.unchanged) return;
    const config = clone(saved),
      draftRevision = revision;
    const version =
      state.matching?.version ??
      Math.max(0, ...releases.map((r) => r.version)) + 1;
    ask(
      state.matching
        ? `让新对话使用 v${version}？`
        : `发布“${referenceName(config.character)}”？`,
      `发布版本 v${version}，角色卡为“${referenceName(config.character)}”。新对话将使用此版本的完整配置，已有对话继续使用原版本。`,
      () => {
        if (!state.matching)
          releases.push({ version, revision: draftRevision, config });
        activeRelease = version;
        render();
        notify(
          `已发布“${referenceName(config.character)}” · 发布版本 v${version}。`,
        );
      },
    );
  }
  if (action === "stop")
    ask("停止发布？", "新的用户对话入口将关闭。已有对话可以继续。", () => {
      activeRelease = null;
      render();
      notify("已停止发布。");
    });
  if (action === "save-resource") saveResource();
  if (action === "cancel-editor")
    leaveEditor(() => {
      render();
      notify("已放弃未保存的资源编辑。");
    });
  if (action === "add-entry") {
    editor.doc.entries.push({
      ...initialEntry(editor.kind),
      ...(editor.kind === "preset" ? { identifier: `prompt-${nextId++}` } : {}),
    });
    editor.index = editor.doc.entries.length - 1;
    renderEditor();
  }
  if (action === "delete-entry") {
    editor.doc.entries.splice(editor.index, 1);
    editor.index = Math.max(0, editor.index - 1);
    renderEditor();
  }
  if (action === "entry-up" || action === "entry-down") {
    const arr = editor.doc.entries,
      i = editor.index,
      j = i + (action === "entry-up" ? -1 : 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
    editor.index = j;
    renderEditor();
  }
  if (action === "import") $("importFile").click();
});

const AssetImport = (() => {
  const exports = {};
  ("use strict");
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.validateAssetImportFile = validateAssetImportFile;
  async function validateAssetImportFile(kind, file) {
    try {
      if (kind !== "character") {
        if (!isJsonFile(file)) {
          return {
            fileName: file.name,
            ok: false,
            reason: "errorUnsupportedFormat",
            detail: `Only JSON is allowed for ${kind} imports`,
          };
        }
        const payload = await parseJsonObjectFile(file);
        if (!payload) {
          return {
            fileName: file.name,
            ok: false,
            reason: "errorJsonObjectExpected",
            detail: "Top-level JSON value must be an object",
          };
        }
        return {
          fileName: file.name,
          ok: true,
          payload,
          reason: "okJson",
        };
      }
      if (isJsonFile(file)) {
        const payload = await parseJsonObjectFile(file);
        if (!payload) {
          return {
            fileName: file.name,
            ok: false,
            reason: "errorJsonObjectExpected",
            detail: "Top-level JSON value must be an object",
          };
        }
        return {
          fileName: file.name,
          ok: true,
          payload,
          reason: "okJson",
        };
      }
      if (!isPngFile(file) && !isWebpFile(file)) {
        return {
          fileName: file.name,
          ok: false,
          reason: "errorCharacterImageUnsupported",
          detail: "Character import accepts JSON, PNG, and WebP files",
        };
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const encoded = isPngFile(file)
        ? extractCharaFromPng(bytes)
        : extractCharaFromWebp(bytes);
      if (!encoded) {
        return {
          fileName: file.name,
          ok: false,
          reason: "errorCharacterMetadataMissing",
          detail: "No chara metadata payload found in this image",
        };
      }
      const payload = parseCharacterPayload(encoded);
      if (!payload) {
        return {
          fileName: file.name,
          ok: false,
          reason: "errorCharacterMetadataParse",
          detail: "Chara metadata exists but does not decode to a JSON object",
        };
      }
      return {
        fileName: file.name,
        ok: true,
        payload,
        reason: "okCharacterImage",
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        return {
          fileName: file.name,
          ok: false,
          reason: "errorJsonParse",
          detail: error.message,
        };
      }
      const detail =
        error instanceof Error ? error.message : "Unknown read failure";
      return {
        fileName: file.name,
        ok: false,
        reason: "errorFileRead",
        detail,
      };
    }
  }
  async function parseJsonObjectFile(file) {
    const content = await file.text();
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  }
  function parseCharacterPayload(encoded) {
    const trimmed = encoded.trim();
    const direct = parseJsonObject(trimmed);
    if (direct) {
      return direct;
    }
    const maybeDecoded = tryDecodeURIComponent(trimmed);
    const decodedJson = parseJsonObject(maybeDecoded);
    if (decodedJson) {
      return decodedJson;
    }
    const base64Decoded = decodeBase64Utf8(maybeDecoded);
    if (!base64Decoded) {
      return null;
    }
    return parseJsonObject(base64Decoded);
  }
  function parseJsonObject(input) {
    try {
      const parsed = JSON.parse(input);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
  function decodeBase64Utf8(input) {
    const compact = input
      .replace(/\s+/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    if (!compact) {
      return null;
    }
    const padded =
      compact.length % 4 === 0
        ? compact
        : compact + "=".repeat(4 - (compact.length % 4));
    try {
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }
  function extractCharaFromPng(bytes) {
    if (!isPngSignature(bytes)) {
      return null;
    }
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const chunkLength = readUint32BE(bytes, offset);
      const chunkType = ascii(bytes, offset + 4, 4);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkLength;
      if (chunkEnd + 4 > bytes.length) {
        break;
      }
      if (chunkType === "tEXt") {
        const text = extractCharaFromPngTextChunk(bytes, chunkStart, chunkEnd);
        if (text) {
          return text;
        }
      } else if (chunkType === "iTXt") {
        const text = extractCharaFromPngInternationalTextChunk(
          bytes,
          chunkStart,
          chunkEnd,
        );
        if (text) {
          return text;
        }
      }
      if (chunkType === "IEND") {
        break;
      }
      offset = chunkEnd + 4;
    }
    return extractCharaFromTextBlob(bytes);
  }
  function extractCharaFromPngTextChunk(bytes, start, end) {
    const separator = findNullByte(bytes, start, end);
    if (separator < 0) {
      return null;
    }
    const keyword = latin1(bytes, start, separator);
    if (keyword !== "chara") {
      return null;
    }
    return latin1(bytes, separator + 1, end);
  }
  function extractCharaFromPngInternationalTextChunk(bytes, start, end) {
    const keyEnd = findNullByte(bytes, start, end);
    if (keyEnd < 0) {
      return null;
    }
    const keyword = latin1(bytes, start, keyEnd);
    if (keyword !== "chara") {
      return null;
    }
    if (keyEnd + 2 >= end) {
      return null;
    }
    const compressionFlag = bytes[keyEnd + 1] ?? 0;
    let cursor = keyEnd + 3;
    const languageEnd = findNullByte(bytes, cursor, end);
    if (languageEnd < 0) {
      return null;
    }
    cursor = languageEnd + 1;
    const translatedEnd = findNullByte(bytes, cursor, end);
    if (translatedEnd < 0) {
      return null;
    }
    cursor = translatedEnd + 1;
    if (compressionFlag === 1) {
      return null;
    }
    return new TextDecoder().decode(bytes.subarray(cursor, end));
  }
  function extractCharaFromWebp(bytes) {
    if (!isWebpSignature(bytes)) {
      return null;
    }
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunkType = ascii(bytes, offset, 4);
      const chunkSize = readUint32LE(bytes, offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkSize;
      if (chunkEnd > bytes.length) {
        break;
      }
      if (
        chunkType === "EXIF" ||
        chunkType === "XMP " ||
        chunkType === "META"
      ) {
        const encoded = extractCharaFromTextBlob(
          bytes.subarray(chunkStart, chunkEnd),
        );
        if (encoded) {
          return encoded;
        }
      }
      offset = chunkEnd + (chunkSize % 2);
    }
    return extractCharaFromTextBlob(bytes);
  }
  function extractCharaFromTextBlob(bytes) {
    const source = latin1(bytes, 0, bytes.length);
    const patterns = [
      /chara\u0000([A-Za-z0-9%+/_=-]{32,})/,
      /"chara"\s*[:=]\s*"([^"]{32,})"/,
      /<chara>([^<]{32,})<\/chara>/i,
      /chara=([A-Za-z0-9%+/_=-]{32,})/,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  }
  function findNullByte(bytes, start, end) {
    for (let cursor = start; cursor < end; cursor += 1) {
      if (bytes[cursor] === 0) {
        return cursor;
      }
    }
    return -1;
  }
  function latin1(bytes, start, end) {
    return new TextDecoder("latin1").decode(bytes.subarray(start, end));
  }
  function ascii(bytes, start, length) {
    return String.fromCharCode(...bytes.subarray(start, start + length));
  }
  function readUint32BE(bytes, offset) {
    return new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(offset, false);
  }
  function readUint32LE(bytes, offset) {
    return new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(offset, true);
  }
  function isPngSignature(bytes) {
    if (bytes.length < 8) {
      return false;
    }
    return (
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71 &&
      bytes[4] === 13 &&
      bytes[5] === 10 &&
      bytes[6] === 26 &&
      bytes[7] === 10
    );
  }
  function isWebpSignature(bytes) {
    if (bytes.length < 12) {
      return false;
    }
    return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  }
  function isJsonFile(file) {
    return (
      file.type === "application/json" ||
      file.name.toLowerCase().endsWith(".json")
    );
  }
  function isPngFile(file) {
    return (
      file.type === "image/png" || file.name.toLowerCase().endsWith(".png")
    );
  }
  function isWebpFile(file) {
    return (
      file.type === "image/webp" || file.name.toLowerCase().endsWith(".webp")
    );
  }
  function tryDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return exports;
})();
const PresetParams = (() => {
  const exports = {};
  ("use strict");
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.extractPresetGenerationParams = extractPresetGenerationParams;
  const workspaceLlmGenerationParamKeys = [
    "max_context_tokens",
    "max_output_tokens",
    "temperature",
    "top_p",
    "top_k",
    "frequency_penalty",
    "presence_penalty",
    "stream",
    "timeout_ms",
    "max_retries",
  ];
  function createSlotParamsDraft(params) {
    return Object.fromEntries(
      workspaceLlmGenerationParamKeys
        .map((key) => [key, params?.[key]])
        .filter(([, value]) => value !== undefined),
    );
  }
  function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value;
  }
  function createPresetParamCandidates(data) {
    const candidates = [];
    const append = (value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }
      if (!candidates.includes(record)) {
        candidates.push(record);
      }
    };
    append(data);
    append(data.data);
    append(data.top_level);
    const editor = asRecord(data.editor);
    if (editor) {
      append(editor);
      append(editor.top_level);
    }
    return candidates;
  }
  function parseNumericPresetParam(records, aliases) {
    for (const record of records) {
      for (const key of aliases) {
        const value = record[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          return value;
        }
        if (
          typeof value === "string" &&
          value.trim().length > 0 &&
          Number.isFinite(Number(value))
        ) {
          return Number(value);
        }
      }
    }
    return undefined;
  }
  function parseBooleanPresetParam(records, aliases) {
    for (const record of records) {
      for (const key of aliases) {
        const value = record[key];
        if (typeof value === "boolean") {
          return value;
        }
        if (typeof value === "number") {
          if (value === 1) {
            return true;
          }
          if (value === 0) {
            return false;
          }
        }
        if (typeof value === "string") {
          if (value === "true" || value === "1") return true;
          if (value === "false" || value === "0") return false;
        }
      }
    }
    return undefined;
  }
  function extractPresetGenerationParams(data) {
    const candidates = createPresetParamCandidates(data);
    const mapped = {
      frequency_penalty: parseNumericPresetParam(candidates, [
        "frequency_penalty",
        "frequencyPenalty",
      ]),
      max_context_tokens: parseNumericPresetParam(candidates, [
        "openai_max_context",
        "maxContext",
        "max_context_tokens",
      ]),
      max_output_tokens: parseNumericPresetParam(candidates, [
        "openai_max_tokens",
        "maxTokens",
        "max_output_tokens",
      ]),
      presence_penalty: parseNumericPresetParam(candidates, [
        "presence_penalty",
        "presencePenalty",
      ]),
      stream: parseBooleanPresetParam(candidates, ["stream_openai", "stream"]),
      temperature: parseNumericPresetParam(candidates, ["temperature"]),
      top_k: parseNumericPresetParam(candidates, ["top_k", "topK"]),
      top_p: parseNumericPresetParam(candidates, ["top_p", "topP"]),
    };
    return createSlotParamsDraft(mapped);
  }

  return exports;
})();
const ExistingTranslations = (() => {
  const exports = {};
  ("use strict");
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.messages = void 0;
  exports.messages = {
    "zh-CN": {
      "status.accountMode": "ACCOUNT_MODE=multi",
      "status.engineOnline": "引擎在线",
      "header.users": "用户",
      "header.openRuntime": "运行区",
      "header.openInspector": "检查器",
      "nav.runtime": "运行区",
      "nav.sessions": "会话",
      "nav.sessionList": "会话列表",
      "nav.sessionHint": "右键会话以执行 CRUD",
      "nav.currentBindings": "当前绑定",
      "nav.currentPreset": "当前预设",
      "nav.currentPresetEmpty": "未选择预设",
      "nav.currentPresetHint": "在这里快速编辑、切换或导出当前预设。",
      "nav.presetCreateTip":
        "提示：Preset Create 不是当前项目主线，优先使用导入与已有预设编辑。",
      "nav.library": "资产库",
      "nav.characters": "角色卡(模板)",
      "nav.worldbooks": "世界书(资产)",
      "nav.users": "用户卡(账号资产)",
      "nav.presets": "预设库(采样配置)",
      "nav.assetBrowser": "资产浏览器",
      "nav.assetFilterAll": "全部",
      "nav.assetSortUpdated": "按更新时间",
      "nav.assetSortName": "按名称",
      "nav.assetSearchPlaceholder": "搜索资产名 / 标签 / 描述",
      "nav.assetEmpty": "当前筛选下没有资产",
      "nav.assetBrowserHint":
        "Ctrl+F 搜索 | J/K 上下选择 | Enter 打开 | A 应用 | I 导入",
      "nav.newSession": "新建会话",
      "nav.activeModel": "当前模型",
      "nav.activeModelUnavailable": "未获取到模型信息",
      "nav.llmManager": "LLM",
      "nav.toolManager": "工具",
      "nav.mcpManager": "MCP",
      "layout.resizeLeft": "拖动调整左栏宽度",
      "layout.resizeRight": "拖动调整右栏宽度",
      "session.create": "新建",
      "session.open": "打开",
      "session.rename": "重命名",
      "session.archive": "归档",
      "session.delete": "删除",
      "assetMenu.edit": "编辑资产",
      "assetMenu.update": "更新资产（覆盖）",
      "assetMenu.duplicate": "复制资产",
      "assetMenu.export": "导出资产",
      "assetMenu.bindWorldbook": "绑定到当前会话",
      "assetMenu.unbindWorldbook": "取消绑定当前会话",
      "assetMenu.delete": "删除资产",
      "main.attach": "绑定",
      "main.replaceUser": "替换用户",
      "main.detachAsset": "解除绑定",
      "main.inputPlaceholder": "输入消息... (Ctrl+Enter 发送)",
      "main.sending": "生成中...",
      "main.send": "发送",
      "main.editPrompt": "编辑消息内容",
      "main.deleteConfirm": "确认删除这条消息？此操作不可撤销。",
      "chat.user": "用户",
      "chat.narrator": "旁白",
      "chat.system": "系统",
      "dialogs.editTitle": "编辑消息",
      "dialogs.editDescription":
        "修改 {role} 内容后可直接保存，或在用户消息上触发重新生成。",
      "dialogs.cancel": "取消",
      "dialogs.saveEdit": "保存编辑",
      "dialogs.editRegenerate": "编辑并重新生成",
      "dialogs.deleteTitle": "删除消息",
      "dialogs.deleteDescription": "确认删除这条 {role} 消息？",
      "dialogs.confirmDelete": "确认删除",
      "dialogs.retryTitle": "重试楼层",
      "dialogs.retryDescription": "重试该 {role} 所在楼层并重新生成回复。",
      "dialogs.confirmRetry": "执行重试",
      "dialogs.toolReplayConfirmTitle": "确认工具重放",
      "dialogs.toolReplayConfirmDescription":
        "该次重试依赖 {count} 个历史工具执行。继续前，需要明确确认允许重放这些执行。",
      "dialogs.toolReplayConfirmEmpty": "当前没有可确认的工具执行。",
      "dialogs.toolReplayConfirmBusy": "确认中...",
      "dialogs.toolReplayConfirmAction": "确认并继续重试",
      "dialogs.toolReplayExecutionId": "执行 ID",
      "dialogs.toolReplayProvider": "Provider",
      "dialogs.toolReplayStatus": "状态",
      "dialogs.toolReplayReplaySafety": "重放安全",
      "dialogs.toolReplaySideEffectLevel": "副作用等级",
      "dialogs.toolReplayReason": "原因",
      "dialogs.assetImportTitle": "导入资产",
      "dialogs.assetImportDescription":
        "选择资产类型后可批量导入；角色资产支持 JSON / PNG / WebP 卡面。",
      "dialogs.assetBrowserTitle": "资产浏览器",
      "dialogs.assetBrowserDescription": "在更大视图中浏览、筛选并应用资产。",
      "dialogs.assetImportKind": "资产类型",
      "dialogs.assetImportDropHint": "拖动文件到这里，或点击按钮打开资源管理器",
      "dialogs.assetImportJsonOnly": "目前支持 JSON 文件导入",
      "dialogs.assetImportDuplicatePolicy": "重复处理",
      "dialogs.assetImportDuplicateSkip": "跳过重复资产",
      "dialogs.assetImportDuplicateAllow": "允许重复并继续导入",
      "dialogs.assetImportCharacterFormats":
        "角色导入支持 JSON、PNG、WebP（自动提取卡面 metadata）",
      "dialogs.assetImportChoose": "选择文件",
      "dialogs.assetImportQueued": "待导入文件 {count} 个",
      "dialogs.assetImportSubmit": "开始导入",
      "dialogs.assetImporting": "导入中...",
      "dialogs.assetImportFailure": "导入失败",
      "dialogs.assetImportFailureName": "资产名: {name}",
      "dialogs.assetImportFailureReason.api": "请求失败",
      "dialogs.assetImportFailureReason.duplicateExisting": "库中已有同名资产",
      "dialogs.assetImportFailureReason.duplicateBatch": "批量队列中重复",
      "dialogs.assetImportRetryFailed": "仅重试失败项",
      "dialogs.assetImportProgressTitle": "导入进度",
      "dialogs.assetImportProgressCounter": "{processed}/{total}",
      "dialogs.assetImportProgressStats":
        "成功 {imported} / 失败 {failed} / 跳过 {skipped}",
      "dialogs.assetImportProgressPhase.preparing": "预处理",
      "dialogs.assetImportProgressPhase.importing": "导入中",
      "dialogs.assetImportProgressPhase.hydrating": "同步资产库",
      "dialogs.assetImportProgressPhase.done": "完成",
      "dialogs.assetImportDiagnosticsTitle": "导入诊断",
      "dialogs.assetImportDiagnosticsCount": "失败 {count} 项",
      "dialogs.assetPrecheckTitle": "预检",
      "dialogs.assetPrecheckStats": "通过 {valid} / 失败 {invalid}",
      "dialogs.showDetail": "详情",
      "dialogs.hideDetail": "收起",
      "dialogs.assetPrecheckRunning": "正在分析文件...",
      "dialogs.assetPrecheckNone": "暂无待检文件",
      "dialogs.assetPrecheckValid": "可导入",
      "dialogs.assetPrecheckInvalid": "失败",
      "dialogs.assetPrecheckReason.okJson": "JSON 结构通过",
      "dialogs.assetPrecheckReason.okCharacterImage": "已提取角色卡 metadata",
      "dialogs.assetPrecheckReason.errorUnsupportedFormat": "仅支持 JSON 文件",
      "dialogs.assetPrecheckReason.errorCharacterImageUnsupported":
        "角色仅支持 JSON / PNG / WebP",
      "dialogs.assetPrecheckReason.errorCharacterMetadataMissing":
        "未发现角色卡 metadata",
      "dialogs.assetPrecheckReason.errorCharacterMetadataParse":
        "角色卡 metadata 解析失败",
      "dialogs.assetPrecheckReason.errorJsonObjectExpected":
        "JSON 顶层必须为对象",
      "dialogs.assetPrecheckReason.errorJsonParse": "JSON 格式错误",
      "dialogs.presetManagerEditTitle": "编辑预设资产",
      "dialogs.presetManagerEditDescription":
        "编辑预设资产 {asset} 并直接覆盖。",
      "dialogs.presetManagerUpdateTitle": "更新预设资产",
      "dialogs.presetManagerUpdateDescription":
        "将修改内容覆盖到预设资产 {asset}。",
      "dialogs.presetManagerDuplicateTitle": "复制预设资产",
      "dialogs.presetManagerDuplicateDescription":
        "基于预设资产 {asset} 创建副本。",
      "dialogs.presetManagerDeleteTitle": "删除预设资产",
      "dialogs.presetManagerDeleteDescription": "确认删除预设资产 {asset}？",
      "dialogs.presetManagerName": "预设名称",
      "dialogs.presetManagerEditConfirm": "保存编辑",
      "dialogs.presetManagerUpdateConfirm": "覆盖更新",
      "dialogs.presetManagerDuplicateConfirm": "创建副本",
      "dialogs.presetManagerDeleteConfirm": "确认删除",
      "dialogs.presetManagerLoading": "正在加载预设详情...",
      "dialogs.presetManagerSaving": "处理中...",
      "dialogs.presetManagerErrorName": "预设名称不能为空",
      "dialogs.presetManagerErrorJson": "JSON 格式错误，请修正后再试",
      "dialogs.presetManagerErrorObject": "JSON 顶层必须为对象",
      "dialogs.presetManagerEntryCount": "条目 {count} 个",
      "dialogs.presetManagerAddEntry": "新增条目",
      "dialogs.presetManagerEnabled": "启用",
      "dialogs.presetManagerBackOverview": "返回列表",
      "dialogs.presetManagerEntryName": "条目名称",
      "dialogs.presetManagerEntryRole": "角色",
      "dialogs.presetManagerSystemPrompt": "System Prompt",
      "dialogs.presetManagerMarker": "Marker",
      "dialogs.presetManagerInjectionPosition": "Injection Position",
      "dialogs.presetManagerInjectionDepth": "Injection Depth",
      "dialogs.presetManagerInjectionOrder": "Injection Order",
      "dialogs.presetManagerForbidOverrides": "Forbid Overrides",
      "dialogs.presetManagerEntryMissing": "当前未选中可编辑条目",
      "dialogs.presetManagerConflict": "预设已更新，请重新加载。",
      "dialogs.presetManagerBusy": "预设正在处理其他操作，请稍后重试。",
      "dialogs.assetPrecheckReason.errorFileRead": "文件读取失败",
      "dialogs.characterManagerEditTitle": "编辑角色资产",
      "dialogs.characterManagerEditDescription":
        "查看并编辑角色资产 {asset} 的关键字段。",
      "dialogs.characterManagerUpdateTitle": "更新角色资产",
      "dialogs.characterManagerUpdateDescription":
        "将修改以新版本写入角色资产 {asset}。",
      "dialogs.characterManagerDeleteTitle": "删除角色资产",
      "dialogs.characterManagerDeleteDescription":
        "确认软删除角色资产 {asset}？",
      "dialogs.characterManagerRestoreTitle": "恢复角色资产",
      "dialogs.characterManagerRestoreDescription":
        "恢复角色资产 {asset} 并重新允许绑定与更新。",
      "dialogs.characterManagerName": "角色名称",
      "dialogs.characterManagerDescription": "描述",
      "dialogs.characterManagerPersonality": "性格",
      "dialogs.characterManagerFirstMessage": "首条消息",
      "dialogs.characterManagerScenario": "场景",
      "dialogs.characterManagerEditConfirm": "保存编辑",
      "dialogs.characterManagerUpdateConfirm": "创建新版本",
      "dialogs.characterManagerDeleteConfirm": "确认删除",
      "dialogs.characterManagerRestoreConfirm": "确认恢复",
      "dialogs.characterManagerSwitchDelete": "转到删除",
      "dialogs.characterManagerSwitchRestore": "转到恢复",
      "dialogs.characterManagerStatus": "状态",
      "dialogs.characterManagerStatusActive": "可用",
      "dialogs.characterManagerStatusDeleted": "已删除",
      "dialogs.characterManagerVersion": "最新版本",
      "dialogs.characterManagerFieldTip": "",
      "dialogs.characterManagerDeletedReadonlyTip":
        "该角色已删除，需先恢复后才能继续更新版本。",
      "dialogs.characterManagerLoading": "正在加载角色详情...",
      "dialogs.characterManagerSaving": "处理中...",
      "dialogs.characterManagerErrorName": "角色名称不能为空",
      "dialogs.worldbookManagerEditTitle": "编辑世界书资产",
      "dialogs.worldbookManagerEditDescription":
        "编辑世界书资产 {asset} 并直接覆盖。",
      "dialogs.worldbookManagerUpdateTitle": "更新世界书资产",
      "dialogs.worldbookManagerUpdateDescription":
        "将修改内容覆盖到世界书资产 {asset}。",
      "dialogs.worldbookManagerDuplicateTitle": "复制世界书资产",
      "dialogs.worldbookManagerDuplicateDescription":
        "基于世界书资产 {asset} 创建副本。",
      "dialogs.worldbookManagerDeleteTitle": "删除世界书资产",
      "dialogs.worldbookManagerDeleteDescription":
        "确认删除世界书资产 {asset}？",
      "dialogs.worldbookManagerName": "世界书名称",
      "dialogs.worldbookManagerJson": "世界书 JSON",
      "dialogs.worldbookManagerEditConfirm": "保存编辑",
      "dialogs.worldbookManagerUpdateConfirm": "覆盖更新",
      "dialogs.worldbookManagerDuplicateConfirm": "创建副本",
      "dialogs.worldbookManagerDeleteConfirm": "确认删除",
      "dialogs.worldbookManagerLoading": "正在加载世界书详情...",
      "dialogs.worldbookManagerSaving": "处理中...",
      "dialogs.worldbookManagerErrorName": "世界书名称不能为空",
      "dialogs.worldbookManagerErrorJson": "JSON 格式错误，请修正后再试",
      "dialogs.worldbookManagerConflict": "世界书已更新，请重新加载。",
      "dialogs.worldbookManagerBusy": "世界书正在处理其他操作，请稍后重试。",
      "dialogs.llmManagerTitle": "LLM 实例管理",
      "dialogs.llmManagerDescription":
        "按实例槽位绑定 Profile。解析优先级遵循 session > global > 通配 fallback。",
      "dialogs.llmManagerScope": "作用域",
      "dialogs.llmManagerScopeGlobal": "全局",
      "dialogs.llmManagerScopeSession": "当前会话",
      "dialogs.llmManagerRefresh": "刷新",
      "dialogs.llmManagerLoading": "正在加载 LLM 配置...",
      "dialogs.llmManagerNoProfiles":
        "当前账号暂无可用 Profile，请先通过 API 创建 Profile。",
      "dialogs.llmManagerNoRuntime": "未解析到运行时模型",
      "dialogs.llmManagerSlotNarrator": "Narrator（叙述者）",
      "dialogs.llmManagerSlotDirector": "Director（导演）",
      "dialogs.llmManagerSlotVerifier": "Verifier（校验员）",
      "dialogs.llmManagerSlotMemory": "Memory（记忆员）",
      "dialogs.llmManagerSlotWildcard": "通配槽位（*）",
      "dialogs.llmManagerSourceEnv": "环境变量回退",
      "dialogs.llmManagerSourceGlobalProfile": "全局 Profile",
      "dialogs.llmManagerSourceSessionProfile": "会话 Profile",
      "dialogs.llmManagerTabInstances": "实例管理",
      "dialogs.llmManagerTabProfiles": "Profile 管理",
      "dialogs.llmManagerFilterName": "按名称",
      "dialogs.llmManagerFilterNamePlaceholder": "输入 Profile 名称",
      "dialogs.llmManagerFilterProvider": "按 Provider",
      "dialogs.llmManagerFilterStatus": "按状态",
      "dialogs.llmManagerFilterAll": "全部",
      "dialogs.llmManagerSelectProfile": "选择 Profile",
      "dialogs.llmManagerApply": "绑定",
      "dialogs.llmManagerDrawerTitle": "{slot} 设置",
      "dialogs.llmManagerDrawerBindingSection": "绑定设置",
      "dialogs.llmManagerDrawerSamplingSection": "采样参数",
      "dialogs.llmManagerDrawerAdvancedSection": "高级参数",
      "dialogs.llmManagerDrawerReset": "重置",
      "dialogs.llmManagerDrawerSave": "保存",
      "dialogs.llmManagerDrawerSelectSlot": "点击左侧实例槽位开始编辑",
      "dialogs.llmManagerDrawerProfileRequiredHint":
        "请先选择一个 Profile，再保存抽屉设置",
      "dialogs.llmManagerParamStateOverridden": "已覆盖",
      "dialogs.llmManagerParamStateInherited": "继承默认",
      "dialogs.llmManagerApplying": "绑定中...",
      "dialogs.llmManagerPresetSelect": "参数预设",
      "dialogs.llmManagerPresetApplyParams": "应用预设参数",
      "dialogs.llmManagerPresetApplyingParams": "应用中...",
      "dialogs.llmManagerPresetSelectFirst": "请先选择预设",
      "dialogs.llmManagerPresetNoSupportedParams": "该预设不包含可应用的参数",
      "dialogs.llmManagerPresetApplyFailed": "应用预设参数失败",
      "dialogs.llmManagerParamTemperature": "Temperature",
      "dialogs.llmManagerParamMaxOutputTokens": "最大输出 Tokens",
      "dialogs.llmManagerParamMaxContextTokens": "上下文 Tokens 上限",
      "dialogs.llmManagerParamTopP": "Top-P",
      "dialogs.llmManagerParamTopK": "Top-K",
      "dialogs.llmManagerParamFrequencyPenalty": "Frequency Penalty",
      "dialogs.llmManagerParamPresencePenalty": "Presence Penalty",
      "dialogs.llmManagerParamStream": "流式输出",
      "dialogs.llmManagerParamTimeoutMs": "超时（毫秒）",
      "dialogs.llmManagerParamMaxRetries": "最大重试次数",
      "dialogs.llmManagerProfileCreate": "新建 Profile",
      "dialogs.llmManagerProfileEdit": "编辑",
      "dialogs.llmManagerProfileDelete": "删除",
      "dialogs.llmManagerProfileDeleting": "删除中...",
      "dialogs.llmManagerProfileSave": "保存",
      "dialogs.llmManagerProfileSaving": "保存中...",
      "dialogs.llmManagerProfilePresetName": "Profile 名称",
      "dialogs.llmManagerProfileProvider": "Provider",
      "dialogs.llmManagerProfileModelId": "Model ID",
      "dialogs.llmManagerProfileModelFetch": "尝试获取模型",
      "dialogs.llmManagerProfileModelFetching": "获取中...",
      "dialogs.llmManagerProfileModelTest": "测试模型",
      "dialogs.llmManagerProfileModelTesting": "测试中...",
      "dialogs.llmManagerProfileModelCandidates": "可选模型",
      "dialogs.llmManagerProfileModelCandidatesPlaceholder": "选择已发现的模型",
      "dialogs.llmManagerProfileBaseUrl": "Base URL（可选）",
      "dialogs.llmManagerProfileApiKeyName": "API Key 名称（可选）",
      "dialogs.llmManagerProfileApiKey": "API Key",
      "dialogs.llmManagerProfileStatus": "状态",
      "dialogs.llmManagerProfileStatusActive": "启用",
      "dialogs.llmManagerProfileStatusDisabled": "禁用",
      "dialogs.llmManagerProfileStatusDeleted": "已删除",
      "dialogs.llmManagerProfileDeleteConfirmTitle": "删除 Profile",
      "dialogs.llmManagerProfileDeleteConfirmDescription":
        "确认删除 Profile {profile}？",
      "dialogs.llmManagerProfileDeleteConfirm": "确认删除",
      "dialogs.llmManagerProfileRequired": "Profile 名称和 Model ID 不能为空",
      "dialogs.llmManagerProfileApiKeyRequired": "新建 Profile 需要 API Key",
      "dialogs.llmManagerProfileModelFetchApiKeyRequired":
        "请先填写 API Key，再尝试获取模型",
      "dialogs.llmManagerProfileModelTestApiKeyRequired":
        "请先填写 API Key，再进行测试",
      "dialogs.llmManagerProfileModelTestModelRequired":
        "请先填写 Model ID，再进行测试",
      "dialogs.llmManagerProfileModelFetchFailed": "获取模型列表失败",
      "dialogs.llmManagerProfileModelTestFailed": "模型连通测试失败",
      "dialogs.llmManagerProfileMasterKeyRequired":
        "缺少 APP_SECRETS_MASTER_KEY，无法保存 Profile（请先在 API 环境变量中配置并重启）",
      "dialogs.llmManagerProfileSaveFailed": "Profile 保存失败",
      "dialogs.llmManagerProfileDeleteFailed": "Profile 删除失败",
      "dialogs.llmManagerProfilesFilteredEmpty":
        "当前筛选条件下没有匹配的 Profile",
      "dialogs.llmManagerProfileEditorIdle":
        "点击“新建 Profile”或列表中的“编辑”后再填写表单",
      "dialogs.llmManagerEntryHint": "点击卡片或按钮可打开实例管理",
      "dialogs.llmManagerLoadFailed": "LLM 配置加载失败",
      "dialogs.llmManagerSelectProfileFirst": "请先选择要绑定的 Profile",
      "dialogs.llmManagerSessionRequired": "当前无活动会话，无法使用会话作用域",
      "dialogs.llmManagerApplyFailed": "绑定失败",
      "dialogs.llmManagerUnbind": "解绑",
      "dialogs.llmManagerUnbinding": "解绑中...",
      "dialogs.llmManagerUnbindFailed": "解绑失败",
      "dialogs.llmManagerBindingNotFound": "当前作用域下未找到可解绑的绑定",
      "dialogs.llmManagerSessionScopeNotFound":
        "目标会话不存在，无法操作会话级绑定",
      "dialogs.llmManagerNarratorDisabled":
        "当前会话已禁用 Narrator 槽位，无法执行对话生成",
      "dialogs.llmManagerProfileDeleteBlocked":
        "该 Profile 仍被有效绑定，请先解绑后再删除",
      "dialogs.llmManagerParamValidationTemperature":
        "Temperature 必须在 0 到 2 之间",
      "dialogs.llmManagerParamValidationMaxOutputTokens":
        "最大输出 Tokens 必须为大于等于 1 的整数",
      "dialogs.llmManagerParamValidationMaxContextTokens":
        "上下文 Tokens 上限必须为大于等于 1 的整数",
      "dialogs.llmManagerParamValidationTopP": "Top-P 必须在 0 到 1 之间",
      "dialogs.llmManagerParamValidationTopK": "Top-K 必须为大于等于 0 的整数",
      "dialogs.llmManagerParamValidationFrequencyPenalty":
        "Frequency Penalty 必须在 -2 到 2 之间",
      "dialogs.llmManagerParamValidationPresencePenalty":
        "Presence Penalty 必须在 -2 到 2 之间",
      "dialogs.llmManagerParamValidationTimeoutMs":
        "超时时间必须为大于等于 1 的整数",
      "dialogs.llmManagerParamValidationMaxRetries":
        "最大重试次数必须为 0 到 10 的整数",
      "dialogs.llmManagerParamValidationStream": "流式输出参数必须为布尔值",
      "dialogs.worldbookManagerErrorJsonObject": "JSON 顶层必须为对象",
      "dialogs.toolManagerTitle": "工具管理",
      "dialogs.toolManagerDescription":
        "查看会话级工具权限、运行时目录、工具定义和最近执行记录。",
      "dialogs.toolManagerLoading": "正在加载工具管理数据...",
      "dialogs.toolManagerLoadFailed": "工具管理数据加载失败",
      "dialogs.toolManagerSaving": "处理中...",
      "dialogs.toolManagerPermissions": "会话工具权限",
      "dialogs.toolManagerSessionHint":
        "当前表单会直接写入活动会话的工具权限配置。",
      "dialogs.toolManagerSessionRequired":
        "当前没有活动会话，无法保存会话工具权限。",
      "dialogs.toolManagerNoActiveSession":
        "当前没有活动会话。请选择会话后再查看该区域。",
      "dialogs.toolManagerPermissionEnabled": "工具开关",
      "dialogs.toolManagerPermissionAllowIrreversible": "允许不可逆工具",
      "dialogs.toolManagerPermissionMaxCalls": "每轮最大调用数",
      "dialogs.toolManagerPermissionMaxSteps": "每次生成最大步骤数",
      "dialogs.toolManagerPermissionSlotAllow": "槽位允许表（JSON）",
      "dialogs.toolManagerPermissionSlotDeny": "槽位拒绝表（JSON）",
      "dialogs.toolManagerPermissionsSave": "保存会话权限",
      "dialogs.toolManagerRuntimeCatalog": "运行时工具目录",
      "dialogs.toolManagerRuntimeHint":
        "这里展示当前会话可见的工具集合和命名冲突。",
      "dialogs.toolManagerEmptyCatalog": "当前会话没有可展示的运行时工具。",
      "dialogs.toolManagerCatalogAvailability": "可用性",
      "dialogs.toolManagerCatalogReplaySafety": "重放安全",
      "dialogs.toolManagerCatalogSideEffect": "副作用等级",
      "dialogs.toolManagerCatalogAllowedSlots": "允许槽位",
      "dialogs.toolManagerConflicts": "目录冲突",
      "dialogs.toolManagerConflictsEmpty": "当前没有工具目录冲突。",
      "dialogs.toolManagerDefinitions": "工具定义",
      "dialogs.toolManagerDefinitionsHint":
        "可在这里创建、编辑、启停和删除自定义工具定义。",
      "dialogs.toolManagerFilterPlaceholder": "按名称、描述或状态筛选",
      "dialogs.toolManagerCreateDefinition": "新建定义",
      "dialogs.toolManagerEditDefinition": "编辑定义",
      "dialogs.toolManagerEmptyDefinitions": "当前账号还没有工具定义。",
      "dialogs.toolManagerDefinitionName": "名称",
      "dialogs.toolManagerDefinitionDescription": "描述",
      "dialogs.toolManagerDefinitionSource": "来源",
      "dialogs.toolManagerDefinitionSourceId": "来源 ID",
      "dialogs.toolManagerDefinitionHandlerType": "处理器类型",
      "dialogs.toolManagerDefinitionHandler": "处理器配置（JSON）",
      "dialogs.toolManagerDefinitionParameters": "参数 Schema（JSON）",
      "dialogs.toolManagerDefinitionSideEffectLevel": "副作用等级",
      "dialogs.toolManagerDefinitionAllowedSlots": "允许槽位",
      "dialogs.toolManagerDefinitionEnabled": "已启用",
      "dialogs.toolManagerDefinitionSave": "保存定义",
      "dialogs.toolManagerDefinitionDelete": "删除定义",
      "dialogs.toolManagerDefinitionToggleOff": "停用定义",
      "dialogs.toolManagerDefinitionToggleOn": "启用定义",
      "dialogs.toolManagerDefinitionRequired": "工具名称不能为空",
      "dialogs.toolManagerExecutions": "最近执行",
      "dialogs.toolManagerExecutionsHint":
        "按活动会话查看最近记录到 tool_execution_record 的执行结果。",
      "dialogs.toolManagerEmptyExecutions": "当前会话还没有工具执行记录。",
      "dialogs.toolManagerExecutionProvider": "Provider",
      "dialogs.toolManagerExecutionOutcome": "提交结果",
      "dialogs.toolManagerExecutionDuration": "耗时",
      "dialogs.toolManagerExecutionStartedAt": "开始时间",
      "dialogs.toolManagerDraftInherit": "继承",
      "dialogs.toolManagerDraftTrue": "启用",
      "dialogs.toolManagerDraftFalse": "禁用",
      "dialogs.toolManagerValidationPositiveInteger":
        "该字段必须为大于等于 1 的整数",
      "dialogs.toolManagerValidationJsonObject": "JSON 必须是对象",
      "dialogs.toolManagerValidationStringArrayRecord":
        "JSON 必须是 { 槽位: string[] } 结构",
      "dialogs.mcpManagerTitle": "MCP 管理",
      "dialogs.mcpManagerDescription":
        "管理 MCP 服务器配置，检查运行时状态，并执行连接、断开和测试。",
      "dialogs.mcpManagerLoading": "正在加载 MCP 数据...",
      "dialogs.mcpManagerLoadFailed": "MCP 管理数据加载失败",
      "dialogs.mcpManagerSaving": "处理中...",
      "dialogs.mcpManagerServers": "服务器列表",
      "dialogs.mcpManagerServersHint":
        "列表展示当前账号可见的 MCP 服务器和最新连接状态。",
      "dialogs.mcpManagerFilterPlaceholder": "按名称、传输类型或前缀筛选",
      "dialogs.mcpManagerServersEmpty": "当前账号还没有 MCP 服务器配置。",
      "dialogs.mcpManagerCreateServer": "新建服务器",
      "dialogs.mcpManagerEditor": "配置编辑器",
      "dialogs.mcpManagerEditorHint":
        "支持直接创建或更新 stdio/http 两种传输配置。",
      "dialogs.mcpManagerServerName": "服务器名称",
      "dialogs.mcpManagerTransport": "传输方式",
      "dialogs.mcpManagerDefaultSideEffectLevel": "默认副作用等级",
      "dialogs.mcpManagerToolPrefix": "工具前缀",
      "dialogs.mcpManagerConnectTimeoutMs": "连接超时（毫秒）",
      "dialogs.mcpManagerCallTimeoutMs": "调用超时（毫秒）",
      "dialogs.mcpManagerToolRefreshIntervalMs": "工具刷新间隔（毫秒）",
      "dialogs.mcpManagerEnabled": "已启用",
      "dialogs.mcpManagerStdioCommand": "Stdio 命令",
      "dialogs.mcpManagerStdioCwd": "Stdio 工作目录",
      "dialogs.mcpManagerStdioArgs": "Stdio 参数（JSON 数组）",
      "dialogs.mcpManagerStdioEnv": "Stdio 环境变量（JSON 对象）",
      "dialogs.mcpManagerStdioEnvMasked": "已保存的 Stdio 环境变量（掩码）",
      "dialogs.mcpManagerHttpUrl": "HTTP URL",
      "dialogs.mcpManagerHttpHeaders": "HTTP Headers（JSON 对象）",
      "dialogs.mcpManagerHttpHeadersMasked": "已保存的 HTTP Headers（掩码）",
      "dialogs.mcpManagerMaskedSecretHint":
        "留空不修改凭据，填写 JSON 整体替换凭据。",
      "dialogs.mcpManagerSave": "保存配置",
      "dialogs.mcpManagerDelete": "删除服务器",
      "dialogs.mcpManagerToggleOff": "停用服务器",
      "dialogs.mcpManagerToggleOn": "启用服务器",
      "dialogs.mcpManagerStatus": "运行时状态",
      "dialogs.mcpManagerStatusHint":
        "查看选中服务器的连接状态、超时标记和最近工具数量。",
      "dialogs.mcpManagerSelectServerFirst": "请先从左侧选择一个服务器。",
      "dialogs.mcpManagerStatusState": "状态",
      "dialogs.mcpManagerStatusReconnectRequired": "需要重连",
      "dialogs.mcpManagerStatusLastTimeoutAt": "最近超时",
      "dialogs.mcpManagerStatusToolCount": "工具数",
      "dialogs.mcpManagerStatusConnectedAt": "连接时间",
      "dialogs.mcpManagerRuntimeActions": "运行时操作",
      "dialogs.mcpManagerConnect": "连接",
      "dialogs.mcpManagerDisconnect": "断开",
      "dialogs.mcpManagerTest": "测试",
      "dialogs.mcpManagerLastTest": "最近测试",
      "dialogs.mcpManagerLastTestEmpty": "尚未执行测试",
      "dialogs.mcpManagerTools": "服务器工具",
      "dialogs.mcpManagerToolsHint":
        "当服务器已连接并成功刷新工具时，这里会显示暴露的工具列表。",
      "dialogs.mcpManagerToolsEmpty": "当前没有可展示的服务器工具。",
      "dialogs.mcpManagerValidationStringArray": "JSON 必须是字符串数组",
      "dialogs.mcpManagerValidationStringRecord":
        "JSON 必须是 { key: string } 结构",
      "dialogs.mcpManagerValidationPositiveInteger":
        "该字段必须为大于等于 1 的整数",
      "dialogs.mcpManagerHttpUrlRequired": "HTTP 传输必须填写 URL",
      "dialogs.mcpManagerStdioCommandRequired": "Stdio 传输必须填写命令",
      "dialogs.mcpManagerServerNameRequired": "服务器名称不能为空",
      "inspector.tabs.bindings": "绑定",
      "inspector.tabs.tools": "工具",
      "inspector.tabs.memory": "记忆",
      "inspector.tabs.vc": "VC",
      "inspector.tabs.impact": "影响",
      "inspector.tools": "工具执行",
      "inspector.toolsActiveCount": "运行中 {count} 项",
      "inspector.toolsStreamStatus": "流状态",
      "inspector.toolsBranchId": "分支 ID",
      "inspector.toolsFloorId": "楼层 ID",
      "inspector.toolsFloorNo": "楼层编号",
      "inspector.toolsWarnings": "重放警告",
      "inspector.toolsWarningsEmpty": "当前没有重放警告。",
      "inspector.toolsActive": "运行中工具",
      "inspector.toolsActiveEmpty": "当前没有运行中的工具。",
      "inspector.toolsHistory": "最近工具执行",
      "inspector.toolsHistoryEmpty": "当前流中还没有工具执行事件。",
      "inspector.toolsExecutionId": "执行 ID",
      "inspector.toolsProvider": "Provider",
      "inspector.toolsReplaySafety": "重放安全",
      "inspector.toolsDuration": "耗时",
      "inspector.toolsPhases": "阶段序列",
      "inspector.variables": "变量",
      "inspector.bindingState": "绑定状态",
      "inspector.promptMode": "提示词模式",
      "inspector.promptModeNoSession": "当前没有活动会话",
      "inspector.promptModeLoading": "正在加载提示词模式",
      "inspector.promptModeError": "提示词模式加载失败",
      "inspector.promptModeSelection": "Session 显式值",
      "inspector.promptModeInherit": "继承 fallback",
      "inspector.promptModeOptionCompatStrict": "compat_strict",
      "inspector.promptModeOptionCompatPlus": "compat_plus",
      "inspector.promptModeOptionNative": "native",
      "inspector.promptModeExplicit": "session_prompt_mode",
      "inspector.promptModeEffective": "effective_prompt_mode",
      "inspector.promptModeSource": "source",
      "inspector.promptModeLegacyFallback": "legacy_fallback",
      "inspector.promptModeFallbackHint":
        "当前 session 没有显式 mode，运行时正在使用 fallback 结果。",
      "inspector.promptModeSourceSession": "session",
      "inspector.promptModeSourceLegacyMetadata": "legacy_metadata",
      "inspector.promptModeSourceDefault": "default",
      "inspector.promptModeSaving": "提交中...",
      "inspector.variablesLoading": "正在加载变量快照",
      "inspector.variablesEmpty": "当前上下文没有变量",
      "inspector.variablesError": "变量快照加载失败",
      "inspector.variablesNoSession": "当前没有活动会话",
      "inspector.variablesResolvedSurface": "持久化变量真相",
      "inspector.variablesStagedSurface": "页级候选写入",
      "inspector.variablesStagedEmpty": "当前页没有候选变量写入",
      "inspector.variablesPromotionSurface": "变量提升轨迹",
      "inspector.variablesPromotionEmpty": "当前页还没有变量提升轨迹",
      "inspector.variableAttempt": "尝试",
      "inspector.variableIntent": "写入意图",
      "inspector.variableReason": "原因",
      "inspector.variableSource": "来源",
      "inspector.variableEvidence": "证据",
      "inspector.variableDecisionReason": "决策原因",
      "inspector.variableCreated": "创建时间",
      "inspector.variableResolved": "决议时间",
      "inspector.variableFromScopeId": "来源作用域 ID",
      "inspector.variableToScopeId": "目标作用域 ID",
      "inspector.variableStagedWriteId": "候选写入 ID",
      "inspector.variablePromotionCount": "提升 {count} 次",
      "inspector.variableSourceId": "来源作用域 ID",
      "inspector.variableUpdated": "更新时间",
      "inspector.accountScope": "账号作用域",
      "inspector.isolated": "已隔离",
      "inspector.userBinding": "用户绑定(快照)",
      "inspector.applied": "已生效",
      "inspector.userBindingHint": "从下一轮使用所选人设。",
      "inspector.characterBinding": "角色绑定",
      "inspector.worldbooks": "世界书",
      "inspector.worldbookHint": "解除绑定只移除关系，不会删除资产本体。",
      "inspector.memoryOverview": "记忆概览",
      "inspector.memoryLoading": "正在加载记忆状态",
      "inspector.memoryNoSession": "当前没有活动会话",
      "inspector.memoryError": "记忆状态加载失败",
      "inspector.memoryItems": "记忆条目",
      "inspector.memoryEmpty": "当前会话还没有记忆条目",
      "inspector.memoryJobs": "最近记忆作业",
      "inspector.memoryJobsEmpty": "当前会话还没有记忆作业记录",
      "inspector.memoryScopeState": "Scope 状态",
      "inspector.memoryScopeStateEmpty": "当前会话还没有 scope 状态记录",
      "inspector.memoryActiveCount": "活跃条目",
      "inspector.memoryDeprecatedCount": "已废弃条目",
      "inspector.memoryEstimatedTokens": "估算 Token",
      "inspector.memoryFacts": "Facts",
      "inspector.memoryOpenLoops": "Open Loops",
      "inspector.memorySummaries": "Summaries",
      "inspector.memoryRevision": "Revision",
      "inspector.memoryLastProcessedFloorNo": "最后处理楼层",
      "inspector.memoryLastCompactionAt": "最后压缩时间",
      "inspector.memoryLeaseOwner": "Lease Owner",
      "inspector.memoryLeaseUntil": "Lease 到期",
      "inspector.memoryLeaseIdle": "空闲",
      "inspector.memoryItemImportance": "重要度",
      "inspector.memoryItemConfidence": "置信度",
      "inspector.memoryItemFactKey": "Fact Key",
      "inspector.memoryItemSourceFloor": "来源楼层",
      "inspector.memoryItemSourceJob": "来源作业",
      "inspector.memoryItemCoverage": "覆盖楼层",
      "inspector.memoryItemLastUsedAt": "最后使用时间",
      "inspector.memoryJobAttempts": "尝试",
      "inspector.memoryJobCreatedAt": "创建时间",
      "inspector.memoryJobFinishedAt": "完成时间",
      "inspector.memoryJobLastError": "最近错误",
      "inspector.vcOverview": "版本控制概览",
      "inspector.vcNoSession": "当前没有活动会话",
      "inspector.vcLoading": "正在加载版本控制状态",
      "inspector.vcError": "版本控制状态加载失败",
      "inspector.vcBranches": "分支",
      "inspector.vcSnapshots": "快照",
      "inspector.vcOperations": "操作",
      "inspector.vcBranchesEmpty": "当前会话还没有分支记录",
      "inspector.vcMainBranch": "主分支",
      "inspector.vcDiffUnavailable": "暂未取得与 main 的差异",
      "inspector.vcDiffSummary":
        "main 独有 {base} / 共享 {shared} / 当前独有 {target}",
      "inspector.vcFloorCount": "{count} 层",
      "inspector.vcLatestFloor": "最新楼层",
      "inspector.vcForkFloor": "分叉楼层",
      "inspector.vcLatestState": "最新状态",
      "inspector.vcLineage": "楼层血缘",
      "inspector.vcLineageEmpty": "当前没有可展示的楼层血缘",
      "inspector.vcPromptSnapshots": "提示词与 explain 快照",
      "inspector.vcSnapshotsEmpty": "当前没有可展示的提示词快照",
      "inspector.vcSnapshotReady": "已记录",
      "inspector.vcSnapshotMissing": "缺失",
      "inspector.vcPromptDigest": "Prompt Digest",
      "inspector.vcTokenEstimate": "估算 Token",
      "inspector.vcExplainDiagnostics": "诊断",
      "inspector.vcSectionStats": "段落 Token",
      "inspector.vcOperationLogs": "操作日志",
      "inspector.vcOperationLogsEmpty": "当前会话还没有操作日志",
      "inspector.vcCreatedAt": "创建时间",
      "inspector.vcDiff": "差异",
      "inspector.vcDiffChanges": "{count} 项变化",
      "impact.title": "影响预览",
      "impact.deleteHint": "删除用户卡前建议先 Disable。",
      "impact.affectedSessions": "影响会话数",
      "impact.affectedFloors": "影响楼层数",
      "impact.disableFirst": "先禁用再评估删除",
      "impact.tokenUsage": "Token 用量",
      "common.yes": "是",
      "common.no": "否",
      "actions.apply": "应用",
      "actions.replace": "替换",
      "actions.applyAssetUpdate": "将资产更新应用到当前会话",
      "actions.attach": "绑定",
      "actions.refresh": "刷新",
      "actions.importAssets": "导入",
      "actions.openAssetBrowser": "打开资产浏览器",
      "actions.openAsset": "打开资产",
      "actions.applyAsset": "应用资产",
      "actions.editPreset": "编辑预设",
      "actions.switchPreset": "更换预设",
      "actions.exportPreset": "导出预设",
      "events.title": "交互事件",
      "events.empty": "暂无交互事件",
      "events.replaceUser": "已切换用户快照 -> {user}",
      "events.attachWorldbook": "已增加世界书绑定，当前共 {count} 项",
      "events.detachWorldbook": "已解除一个世界书绑定，当前共 {count} 项",
      "events.noWorldbook": "没有可解除的世界书绑定",
      "events.applyUser": "已将用户资产更新应用到当前会话",
      "events.switchAccount": "已切换账号 -> {account}",
      "events.sessionCreate": "已创建会话 -> {title}",
      "events.sessionOpen": "已打开会话 -> {title}",
      "events.sessionRename": "会话已重命名 -> {title}",
      "events.sessionArchive": "会话已归档 -> {title}",
      "events.sessionDelete": "会话已删除 -> {title}",
      "events.sessionNone": "当前没有可操作会话",
      "events.sessionLastGuard": "至少保留 1 个会话",
      "events.streamingGuard": "上一条回复仍在生成中",
      "events.streamFallback": "流式端点不可用，已降级到普通请求",
      "events.apiSyncFailed": "API 同步失败，已使用本地状态回退",
      "events.respondStart": "开始生成回复",
      "events.respondLocalFallback": "聊天 API 不可用，已降级到本地草稿",
      "events.respondDone": "回复完成，用时 {ms}ms，输出 {tokens} tok",
      "events.respondDoneWithSummaries":
        "回复完成，用时 {ms}ms，输出 {tokens} tok，摘要 {summaries} 条",
      "events.respondDonePendingCommit":
        "回复已生成，用时 {ms}ms，输出 {tokens} tok，当前状态 {state}",
      "events.respondDonePendingCommitWithSummaries":
        "回复已生成，用时 {ms}ms，输出 {tokens} tok，摘要 {summaries} 条，当前状态 {state}",
      "events.timelineSyncFailed": "对话记录加载失败，请重试。",
      "events.messageUpdated": "已更新 {role} 消息",
      "events.messageDeleted": "已删除 {role} 消息",
      "events.messageUpdateFailed": "消息更新失败",
      "events.messageDeleteFailed": "消息删除失败",
      "events.messageMissing": "目标消息不存在或已变化",
      "events.messageEmptyGuard": "消息内容不能为空",
      "events.messageRegenerated":
        "已按 {role} 生成新分支回复，输出 {tokens} tok",
      "events.messageRegeneratedWithSummaries":
        "已按 {role} 生成新分支回复，输出 {tokens} tok，摘要 {summaries} 条",
      "events.messageRegeneratedPendingCommit":
        "已按 {role} 生成新分支回复，输出 {tokens} tok，当前状态 {state}",
      "events.messageRegeneratedPendingCommitWithSummaries":
        "已按 {role} 生成新分支回复，输出 {tokens} tok，摘要 {summaries} 条，当前状态 {state}",
      "events.messageRegenerateFailed": "编辑并重新生成失败",
      "events.messageRegenerateUnsupported": "当前消息不支持编辑后再生成",
      "events.messageRetried": "已重试 {role} 所在楼层，输出 {tokens} tok",
      "events.messageRetriedWithSummaries":
        "已重试 {role} 所在楼层，输出 {tokens} tok，摘要 {summaries} 条",
      "events.messageRetriedPendingCommit":
        "已重试 {role} 所在楼层，输出 {tokens} tok，当前状态 {state}",
      "events.messageRetriedPendingCommitWithSummaries":
        "已重试 {role} 所在楼层，输出 {tokens} tok，摘要 {summaries} 条，当前状态 {state}",
      "events.messageRetryFailed": "楼层重试失败",
      "events.messageRetryUnsupported": "当前消息无法触发楼层重试",
      "events.messageRetryConfirmationRequired":
        "楼层重试需要确认 {count} 个工具执行的重放权限",
      "events.messageRetryReplayBlocked":
        "楼层重试被阻止，存在 {count} 个不可自动重放的工具执行",
      "events.accountReset": "工作区上下文已按账号隔离重置",
      "events.assetOpen": "已打开 {kind} 资产 -> {asset}",
      "events.assetApplied": "已将 {kind} 资产应用到当前工作区 -> {asset}",
      "events.assetPinned": "已收藏 {kind} 资产 -> {asset}",
      "events.assetUnpinned": "已取消收藏 {kind} 资产 -> {asset}",
      "events.assetMissing": "目标资产不存在或不可见",
      "events.assetImportDone": "已导入 {kind} 资产 {count} 项",
      "events.assetImportFailed": "{kind} 导入失败 {count} 项",
      "events.assetImportEmpty": "请先选择至少一个文件",
      "events.assetImportSkipped": "已跳过重复 {kind} 资产 {count} 项",
      "events.assetManagePresetOnly": "当前资产管理器仅支持预设资产",
      "events.assetManagePresetCharacterOnly":
        "当前资产管理器仅支持预设与角色资产",
      "events.assetManageWorldbookOnly": "当前资产管理器仅支持世界书资产",
      "events.assetPresetConflict": "预设已被其他客户端修改，请重新加载后再试",
      "events.assetWorldbookConflict":
        "世界书已被其他客户端修改，请重新加载后再试",
      "events.assetResourceBusy": "资源当前正忙，请稍后重试",
      "events.assetManageFailed": "资产管理操作失败",
      "events.assetEdited": "已编辑预设资产 -> {asset}",
      "events.characterUpdated": "已更新角色资产 -> {asset}（v{version}）",
      "events.characterDeleted": "已删除角色资产 -> {asset}",
      "events.characterRestored": "已恢复角色资产 -> {asset}",
      "events.assetOverwritten": "已覆盖更新预设资产 -> {asset}",
      "events.assetDuplicated": "已复制预设资产 -> {asset}",
      "events.assetDeleted": "已删除预设资产 -> {asset}",
      "events.assetOverwriteDeleteSyncFailed":
        "覆盖成功，但旧预设删除失败 -> {asset}",
      "events.librarySyncFailed": "资源库加载失败，请重试。",
      "events.presetMissing": "当前没有可用预设",
      "events.presetSwitchUnavailable": "至少需要 2 个预设才能更换",
      "events.presetExported": "已导出预设 -> {asset}",
      "events.presetExportFailed": "预设导出失败 -> {asset}",
      "events.worldbookBound": "已绑定世界书到当前会话 -> {asset}",
      "events.worldbookUnbound": "已解除当前会话的世界书绑定 -> {asset}",
      "events.worldbookUnbindGuarded": "该世界书尚未绑定到当前会话 -> {asset}",
      "events.worldbookUpdated": "已更新世界书资产 -> {asset}",
      "events.worldbookDuplicated": "已复制世界书资产 -> {asset}",
      "events.worldbookDeleted": "已删除世界书资产 -> {asset}",
      "events.worldbookExported": "已导出世界书 -> {asset}",
      "events.worldbookExportFailed": "世界书导出失败 -> {asset}",
      "events.llmRuntimeSyncFailed": "LLM 运行配置同步失败",
      "events.llmBindingUpdated": "LLM 槽位 {slot} 已绑定 -> {profile}",
      "events.llmBindingFailed": "LLM 槽位 {slot} 绑定失败",
      "events.llmBindingRemoved": "已解除 LLM 槽位 {slot} 绑定",
      "events.llmBindingRemoveFailed": "LLM 槽位 {slot} 解绑失败",
      "events.llmSlotPresetParamsApplied":
        "LLM 槽位 {slot} 已应用预设参数 -> {preset}",
      "events.llmSlotPresetParamsApplyFailed":
        "LLM 槽位 {slot} 预设参数应用失败",
      "events.llmSlotParamsUpdated": "LLM 槽位 {slot} 参数已更新",
      "events.llmSlotParamsFailed": "LLM 槽位 {slot} 参数更新失败",
      "events.llmProfileCreated": "已创建 LLM Profile -> {profile}",
      "events.llmProfileUpdated": "已更新 LLM Profile -> {profile}",
      "events.llmProfileDeleted": "已删除 LLM Profile -> {profile}",
      "events.llmProfileModelsFetched": "已获取模型列表，共 {count} 项",
      "events.llmProfileModelsEmpty": "已尝试获取模型列表，但返回为空",
      "events.llmProfileModelFetchFailed": "获取模型列表失败",
      "events.llmProfileModelTestPassed":
        "模型连通测试成功，收到回复：{response}",
      "events.llmProfileModelTestFailed": "模型连通测试失败",
      "events.llmProfileSaveFailed": "LLM Profile 保存失败",
      "events.llmProfileDeleteFailed": "LLM Profile 删除失败",
      "events.toolManagerLoadFailed": "工具管理数据加载失败",
      "events.toolManagerPermissionsSaved": "会话工具权限已保存 -> {session}",
      "events.toolManagerDefinitionCreated": "已创建工具定义 -> {tool}",
      "events.toolManagerDefinitionUpdated": "已更新工具定义 -> {tool}",
      "events.toolManagerDefinitionDeleted": "已删除工具定义 -> {tool}",
      "events.toolManagerDefinitionToggled":
        "工具定义状态已更新 -> {tool} / {state}",
      "events.mcpManagerLoadFailed": "MCP 管理数据加载失败",
      "events.mcpServerCreated": "已创建 MCP 服务器 -> {server}",
      "events.mcpServerUpdated": "已更新 MCP 服务器 -> {server}",
      "events.mcpServerDeleted": "已删除 MCP 服务器 -> {server}",
      "events.mcpServerToggled": "MCP 服务器状态已更新 -> {server} / {state}",
      "events.mcpServerConnected": "已连接 MCP 服务器 -> {server}",
      "events.mcpServerDisconnected": "已断开 MCP 服务器 -> {server}",
      "events.mcpServerTestPassed":
        "MCP 服务器测试成功，耗时 {duration}ms，工具 {toolCount} 个",
      "events.mcpServerTestFailed":
        "MCP 服务器测试失败，耗时 {duration}ms，工具 {toolCount} 个",
      "dynamic.runtimeUser": "用户: {user} (快照)",
      "dynamic.runtimeWorldbooks": "已绑定世界书 {count} 项",
      "dynamic.sessionTitle": "会话: {title}",
      "dynamic.sessionId": "ID: {id}",
      "dynamic.sessionCount": "{count} 项",
      "dynamic.sessionLabel": "{title}",
      "dynamic.sessionArchived": "已归档",
      "dynamic.sessionAccount": "账号: {account}",
      "dynamic.assetCount": "{count} 项",
      "dynamic.assetUseCount": "使用 {count} 次",
      "dynamic.assetKind.character": "角色",
      "dynamic.assetKind.worldbook": "世界书",
      "dynamic.assetKind.user": "用户",
      "dynamic.assetKind.preset": "预设",
      "dynamic.sessionUser": "用户: {user} (快照)",
      "dynamic.sessionWorldbooks": "世界书: {count}",
    },
    en: {
      "status.accountMode": "ACCOUNT_MODE=multi",
      "status.engineOnline": "ENGINE ONLINE",
      "header.users": "Users",
      "header.openRuntime": "Runtime",
      "header.openInspector": "Inspector",
      "nav.runtime": "Runtime",
      "nav.sessions": "Sessions",
      "nav.sessionList": "Session List",
      "nav.sessionHint": "Right-click a session for CRUD",
      "nav.currentBindings": "Current Bindings",
      "nav.currentPreset": "Current Preset",
      "nav.currentPresetEmpty": "No preset selected",
      "nav.currentPresetHint":
        "Quickly edit, switch, or export the active preset.",
      "nav.presetCreateTip":
        "Tip: Preset Create is not a current project priority; prefer import and editing existing presets.",
      "nav.library": "Library",
      "nav.characters": "Characters (Templates)",
      "nav.worldbooks": "Worldbooks (Assets)",
      "nav.users": "Users (Account Assets)",
      "nav.presets": "Presets (Sampling Profiles)",
      "nav.assetBrowser": "Asset Browser",
      "nav.assetFilterAll": "All",
      "nav.assetSortUpdated": "Sort: Updated",
      "nav.assetSortName": "Sort: Name",
      "nav.assetSearchPlaceholder": "Search by name, tags, or summary",
      "nav.assetEmpty": "No assets match this filter",
      "nav.assetBrowserHint":
        "Ctrl+F search | J/K move | Enter open | A apply | I import",
      "nav.newSession": "New Session",
      "nav.activeModel": "Active Model",
      "nav.activeModelUnavailable": "No runtime model resolved",
      "nav.llmManager": "LLM",
      "nav.toolManager": "Tools",
      "nav.mcpManager": "MCP",
      "layout.resizeLeft": "Drag to resize left pane",
      "layout.resizeRight": "Drag to resize right pane",
      "session.create": "Create",
      "session.open": "Open",
      "session.rename": "Rename",
      "session.archive": "Archive",
      "session.delete": "Delete",
      "assetMenu.edit": "Edit Asset",
      "assetMenu.update": "Update Asset (Overwrite)",
      "assetMenu.duplicate": "Duplicate Asset",
      "assetMenu.export": "Export Asset",
      "assetMenu.bindWorldbook": "Bind to Current Session",
      "assetMenu.unbindWorldbook": "Unbind from Current Session",
      "assetMenu.delete": "Delete Asset",
      "main.attach": "Attach",
      "main.replaceUser": "Replace User",
      "main.detachAsset": "Detach Asset",
      "main.inputPlaceholder": "Type your message... (Ctrl+Enter to send)",
      "main.sending": "Generating...",
      "main.send": "Send",
      "main.editPrompt": "Edit message",
      "main.deleteConfirm": "Delete this message? This cannot be undone.",
      "chat.user": "User",
      "chat.narrator": "Narrator",
      "chat.system": "System",
      "dialogs.editTitle": "Edit Message",
      "dialogs.editDescription":
        "Update {role} content and save, or regenerate when this is a user message.",
      "dialogs.cancel": "Cancel",
      "dialogs.saveEdit": "Save Edit",
      "dialogs.editRegenerate": "Edit + Regenerate",
      "dialogs.deleteTitle": "Delete Message",
      "dialogs.deleteDescription": "Delete this {role} message?",
      "dialogs.confirmDelete": "Delete",
      "dialogs.retryTitle": "Retry Floor",
      "dialogs.retryDescription":
        "Retry generation for the floor bound to this {role} message.",
      "dialogs.confirmRetry": "Retry",
      "dialogs.toolReplayConfirmTitle": "Confirm Tool Replay",
      "dialogs.toolReplayConfirmDescription":
        "This retry depends on {count} prior tool executions. Confirm that these executions may be replayed before continuing.",
      "dialogs.toolReplayConfirmEmpty":
        "No blocking tool execution is available for confirmation.",
      "dialogs.toolReplayConfirmBusy": "Confirming...",
      "dialogs.toolReplayConfirmAction": "Confirm and Retry",
      "dialogs.toolReplayExecutionId": "Execution ID",
      "dialogs.toolReplayProvider": "Provider",
      "dialogs.toolReplayStatus": "Status",
      "dialogs.toolReplayReplaySafety": "Replay Safety",
      "dialogs.toolReplaySideEffectLevel": "Side Effect Level",
      "dialogs.toolReplayReason": "Reason",
      "dialogs.assetImportTitle": "Import Assets",
      "dialogs.assetImportDescription":
        "Choose an asset type and batch import files; character import supports JSON / PNG / WebP cards.",
      "dialogs.assetBrowserTitle": "Asset Browser",
      "dialogs.assetBrowserDescription":
        "Browse, filter, and apply assets in a larger workspace view.",
      "dialogs.assetImportKind": "Asset Type",
      "dialogs.assetImportDropHint": "Drop files here, or open file explorer",
      "dialogs.assetImportJsonOnly":
        "JSON files are supported for this import flow",
      "dialogs.assetImportDuplicatePolicy": "Duplicate Handling",
      "dialogs.assetImportDuplicateSkip": "Skip duplicate assets",
      "dialogs.assetImportDuplicateAllow": "Allow duplicates and continue",
      "dialogs.assetImportCharacterFormats":
        "Character import accepts JSON, PNG, and WebP card files (metadata auto-extract)",
      "dialogs.assetImportChoose": "Choose Files",
      "dialogs.assetImportQueued": "Queued files: {count}",
      "dialogs.assetImportSubmit": "Import",
      "dialogs.assetImporting": "Importing...",
      "dialogs.assetImportFailure": "Import Failed",
      "dialogs.assetImportFailureName": "Asset name: {name}",
      "dialogs.assetImportFailureReason.api": "Request failed",
      "dialogs.assetImportFailureReason.duplicateExisting":
        "Asset with the same name already exists",
      "dialogs.assetImportFailureReason.duplicateBatch":
        "Duplicate name inside this batch",
      "dialogs.assetImportRetryFailed": "Retry Failed Only",
      "dialogs.assetImportProgressTitle": "Import Progress",
      "dialogs.assetImportProgressCounter": "{processed}/{total}",
      "dialogs.assetImportProgressStats":
        "Imported {imported} / Failed {failed} / Skipped {skipped}",
      "dialogs.assetImportProgressPhase.preparing": "Preparing",
      "dialogs.assetImportProgressPhase.importing": "Importing",
      "dialogs.assetImportProgressPhase.hydrating": "Syncing Library",
      "dialogs.assetImportProgressPhase.done": "Done",
      "dialogs.assetImportDiagnosticsTitle": "Import Diagnostics",
      "dialogs.assetImportDiagnosticsCount": "{count} failed",
      "dialogs.assetPrecheckTitle": "Precheck",
      "dialogs.assetPrecheckStats": "Pass {valid} / Fail {invalid}",
      "dialogs.showDetail": "Details",
      "dialogs.hideDetail": "Collapse",
      "dialogs.assetPrecheckRunning": "Analyzing files...",
      "dialogs.assetPrecheckNone": "No files queued",
      "dialogs.assetPrecheckValid": "Ready",
      "dialogs.assetPrecheckInvalid": "Failed",
      "dialogs.assetPrecheckReason.okJson": "JSON structure validated",
      "dialogs.assetPrecheckReason.okCharacterImage":
        "Character metadata extracted",
      "dialogs.assetPrecheckReason.errorUnsupportedFormat": "JSON files only",
      "dialogs.assetPrecheckReason.errorCharacterImageUnsupported":
        "Character import only supports JSON / PNG / WebP",
      "dialogs.assetPrecheckReason.errorCharacterMetadataMissing":
        "Character metadata not found",
      "dialogs.assetPrecheckReason.errorCharacterMetadataParse":
        "Character metadata parse failed",
      "dialogs.assetPrecheckReason.errorJsonObjectExpected":
        "Top-level JSON value must be an object",
      "dialogs.assetPrecheckReason.errorJsonParse": "Invalid JSON format",
      "dialogs.presetManagerEditTitle": "Edit Preset Asset",
      "dialogs.presetManagerEditDescription":
        "Edit preset asset {asset} and overwrite directly.",
      "dialogs.presetManagerUpdateTitle": "Update Preset Asset",
      "dialogs.presetManagerUpdateDescription":
        "Overwrite preset asset {asset} with updated content.",
      "dialogs.presetManagerDuplicateTitle": "Duplicate Preset Asset",
      "dialogs.presetManagerDuplicateDescription":
        "Create a copy from preset asset {asset}.",
      "dialogs.presetManagerDeleteTitle": "Delete Preset Asset",
      "dialogs.presetManagerDeleteDescription": "Delete preset asset {asset}?",
      "dialogs.presetManagerName": "Preset Name",
      "dialogs.presetManagerEditConfirm": "Save Edit",
      "dialogs.presetManagerUpdateConfirm": "Overwrite",
      "dialogs.presetManagerDuplicateConfirm": "Create Copy",
      "dialogs.presetManagerDeleteConfirm": "Delete",
      "dialogs.presetManagerLoading": "Loading preset details...",
      "dialogs.presetManagerSaving": "Processing...",
      "dialogs.presetManagerErrorName": "Preset name cannot be empty",
      "dialogs.presetManagerErrorJson": "Invalid JSON format",
      "dialogs.presetManagerErrorObject":
        "Top-level JSON value must be an object",
      "dialogs.presetManagerEntryCount": "{count} entries",
      "dialogs.presetManagerAddEntry": "Add Entry",
      "dialogs.presetManagerEnabled": "Enabled",
      "dialogs.presetManagerBackOverview": "Back to List",
      "dialogs.presetManagerEntryName": "Entry Name",
      "dialogs.presetManagerEntryRole": "Role",
      "dialogs.presetManagerSystemPrompt": "System Prompt",
      "dialogs.presetManagerMarker": "Marker",
      "dialogs.presetManagerInjectionPosition": "Injection Position",
      "dialogs.presetManagerInjectionDepth": "Injection Depth",
      "dialogs.presetManagerInjectionOrder": "Injection Order",
      "dialogs.presetManagerForbidOverrides": "Forbid Overrides",
      "dialogs.presetManagerEntryMissing": "No editable entry selected",
      "dialogs.presetManagerConflict": "This preset has changed. Reload it.",
      "dialogs.presetManagerBusy": "This preset is busy. Try again shortly.",
      "dialogs.assetPrecheckReason.errorFileRead": "Failed to read file",
      "dialogs.characterManagerEditTitle": "Edit Character Asset",
      "dialogs.characterManagerEditDescription":
        "Review and edit key fields for character asset {asset}.",
      "dialogs.characterManagerUpdateTitle": "Update Character Asset",
      "dialogs.characterManagerUpdateDescription":
        "Write changes to character asset {asset} as a new version.",
      "dialogs.characterManagerDeleteTitle": "Delete Character Asset",
      "dialogs.characterManagerDeleteDescription":
        "Soft-delete character asset {asset}?",
      "dialogs.characterManagerRestoreTitle": "Restore Character Asset",
      "dialogs.characterManagerRestoreDescription":
        "Restore character asset {asset} and allow binding/editing again.",
      "dialogs.characterManagerName": "Character Name",
      "dialogs.characterManagerDescription": "Description",
      "dialogs.characterManagerPersonality": "Personality",
      "dialogs.characterManagerFirstMessage": "First Message",
      "dialogs.characterManagerScenario": "Scenario",
      "dialogs.characterManagerEditConfirm": "Save Edit",
      "dialogs.characterManagerUpdateConfirm": "Create Version",
      "dialogs.characterManagerDeleteConfirm": "Delete",
      "dialogs.characterManagerRestoreConfirm": "Restore",
      "dialogs.characterManagerSwitchDelete": "Switch to Delete",
      "dialogs.characterManagerSwitchRestore": "Switch to Restore",
      "dialogs.characterManagerStatus": "Status",
      "dialogs.characterManagerStatusActive": "Active",
      "dialogs.characterManagerStatusDeleted": "Deleted",
      "dialogs.characterManagerVersion": "Latest Version",
      "dialogs.characterManagerFieldTip": "",
      "dialogs.characterManagerDeletedReadonlyTip":
        "This character is deleted. Restore it first before writing a new version.",
      "dialogs.characterManagerLoading": "Loading character details...",
      "dialogs.characterManagerSaving": "Processing...",
      "dialogs.characterManagerErrorName": "Character name cannot be empty",
      "dialogs.worldbookManagerEditTitle": "Edit Worldbook Asset",
      "dialogs.worldbookManagerEditDescription":
        "Edit worldbook asset {asset} and overwrite directly.",
      "dialogs.worldbookManagerUpdateTitle": "Update Worldbook Asset",
      "dialogs.worldbookManagerUpdateDescription":
        "Overwrite worldbook asset {asset} with updated content.",
      "dialogs.worldbookManagerDuplicateTitle": "Duplicate Worldbook Asset",
      "dialogs.worldbookManagerDuplicateDescription":
        "Create a copy from worldbook asset {asset}.",
      "dialogs.worldbookManagerDeleteTitle": "Delete Worldbook Asset",
      "dialogs.worldbookManagerDeleteDescription":
        "Delete worldbook asset {asset}?",
      "dialogs.worldbookManagerName": "Worldbook Name",
      "dialogs.worldbookManagerJson": "Worldbook JSON",
      "dialogs.worldbookManagerEditConfirm": "Save Edit",
      "dialogs.worldbookManagerUpdateConfirm": "Overwrite",
      "dialogs.worldbookManagerDuplicateConfirm": "Create Copy",
      "dialogs.worldbookManagerDeleteConfirm": "Delete",
      "dialogs.worldbookManagerLoading": "Loading worldbook details...",
      "dialogs.worldbookManagerSaving": "Processing...",
      "dialogs.worldbookManagerErrorName": "Worldbook name cannot be empty",
      "dialogs.worldbookManagerErrorJson": "Invalid JSON format",
      "dialogs.worldbookManagerConflict":
        "This worldbook has changed. Reload it.",
      "dialogs.worldbookManagerBusy":
        "This worldbook is busy. Try again shortly.",
      "dialogs.llmManagerTitle": "LLM Instance Manager",
      "dialogs.llmManagerDescription":
        "Bind profiles per instance slot. Priority follows session > global > wildcard fallback.",
      "dialogs.llmManagerScope": "Scope",
      "dialogs.llmManagerScopeGlobal": "Global",
      "dialogs.llmManagerScopeSession": "Current Session",
      "dialogs.llmManagerRefresh": "Refresh",
      "dialogs.llmManagerLoading": "Loading runtime LLM config...",
      "dialogs.llmManagerNoProfiles":
        "No profile available for this account. Create one through API first.",
      "dialogs.llmManagerNoRuntime": "No runtime model resolved",
      "dialogs.llmManagerSlotNarrator": "Narrator",
      "dialogs.llmManagerSlotDirector": "Director",
      "dialogs.llmManagerSlotVerifier": "Verifier",
      "dialogs.llmManagerSlotMemory": "Memory",
      "dialogs.llmManagerSlotWildcard": "Wildcard (*)",
      "dialogs.llmManagerSourceEnv": "Environment fallback",
      "dialogs.llmManagerSourceGlobalProfile": "Global profile",
      "dialogs.llmManagerSourceSessionProfile": "Session profile",
      "dialogs.llmManagerTabInstances": "Instance Management",
      "dialogs.llmManagerTabProfiles": "Profile Management",
      "dialogs.llmManagerFilterName": "Name",
      "dialogs.llmManagerFilterNamePlaceholder": "Filter by profile name",
      "dialogs.llmManagerFilterProvider": "Provider",
      "dialogs.llmManagerFilterStatus": "Status",
      "dialogs.llmManagerFilterAll": "All",
      "dialogs.llmManagerSelectProfile": "Select profile",
      "dialogs.llmManagerApply": "Bind",
      "dialogs.llmManagerDrawerTitle": "{slot} Settings",
      "dialogs.llmManagerDrawerBindingSection": "Binding",
      "dialogs.llmManagerDrawerSamplingSection": "Sampling",
      "dialogs.llmManagerDrawerAdvancedSection": "Advanced",
      "dialogs.llmManagerDrawerReset": "Reset",
      "dialogs.llmManagerDrawerSave": "Save",
      "dialogs.llmManagerDrawerSelectSlot":
        "Click an instance slot card on the left to edit",
      "dialogs.llmManagerDrawerProfileRequiredHint":
        "Select a profile before saving drawer settings",
      "dialogs.llmManagerParamStateOverridden": "Overridden",
      "dialogs.llmManagerParamStateInherited": "Inherited",
      "dialogs.llmManagerApplying": "Binding...",
      "dialogs.llmManagerPresetSelect": "Preset Params",
      "dialogs.llmManagerPresetApplyParams": "Apply Preset Params",
      "dialogs.llmManagerPresetApplyingParams": "Applying...",
      "dialogs.llmManagerPresetSelectFirst": "Select a preset first",
      "dialogs.llmManagerPresetNoSupportedParams":
        "This preset does not contain supported generation params",
      "dialogs.llmManagerPresetApplyFailed": "Failed to apply preset params",
      "dialogs.llmManagerParamTemperature": "Temperature",
      "dialogs.llmManagerParamMaxOutputTokens": "Max Output Tokens",
      "dialogs.llmManagerParamMaxContextTokens": "Max Context Tokens",
      "dialogs.llmManagerParamTopP": "Top-P",
      "dialogs.llmManagerParamTopK": "Top-K",
      "dialogs.llmManagerParamFrequencyPenalty": "Frequency Penalty",
      "dialogs.llmManagerParamPresencePenalty": "Presence Penalty",
      "dialogs.llmManagerParamStream": "Stream",
      "dialogs.llmManagerParamTimeoutMs": "Timeout (ms)",
      "dialogs.llmManagerParamMaxRetries": "Max Retries",
      "dialogs.llmManagerProfileCreate": "Create Profile",
      "dialogs.llmManagerProfileEdit": "Edit",
      "dialogs.llmManagerProfileDelete": "Delete",
      "dialogs.llmManagerProfileDeleting": "Deleting...",
      "dialogs.llmManagerProfileSave": "Save",
      "dialogs.llmManagerProfileSaving": "Saving...",
      "dialogs.llmManagerProfilePresetName": "Profile Name",
      "dialogs.llmManagerProfileProvider": "Provider",
      "dialogs.llmManagerProfileModelId": "Model ID",
      "dialogs.llmManagerProfileModelFetch": "Fetch Models",
      "dialogs.llmManagerProfileModelFetching": "Fetching...",
      "dialogs.llmManagerProfileModelTest": "Test Model",
      "dialogs.llmManagerProfileModelTesting": "Testing...",
      "dialogs.llmManagerProfileModelCandidates": "Discovered Models",
      "dialogs.llmManagerProfileModelCandidatesPlaceholder":
        "Select a discovered model",
      "dialogs.llmManagerProfileBaseUrl": "Base URL (optional)",
      "dialogs.llmManagerProfileApiKeyName": "API Key Name (optional)",
      "dialogs.llmManagerProfileApiKey": "API Key",
      "dialogs.llmManagerProfileStatus": "Status",
      "dialogs.llmManagerProfileStatusActive": "Active",
      "dialogs.llmManagerProfileStatusDisabled": "Disabled",
      "dialogs.llmManagerProfileStatusDeleted": "Deleted",
      "dialogs.llmManagerProfileDeleteConfirmTitle": "Delete Profile",
      "dialogs.llmManagerProfileDeleteConfirmDescription":
        "Delete profile {profile}?",
      "dialogs.llmManagerProfileDeleteConfirm": "Delete Profile",
      "dialogs.llmManagerProfileRequired":
        "Profile name and model id are required",
      "dialogs.llmManagerProfileApiKeyRequired":
        "API key is required when creating profile",
      "dialogs.llmManagerProfileModelFetchApiKeyRequired":
        "Enter API key before fetching models",
      "dialogs.llmManagerProfileModelTestApiKeyRequired":
        "Enter API key before testing",
      "dialogs.llmManagerProfileModelTestModelRequired":
        "Enter model id before testing",
      "dialogs.llmManagerProfileModelFetchFailed": "Failed to fetch model list",
      "dialogs.llmManagerProfileModelTestFailed":
        "Model connectivity test failed",
      "dialogs.llmManagerProfileMasterKeyRequired":
        "APP_SECRETS_MASTER_KEY is missing; cannot save profile (set it in API env and restart)",
      "dialogs.llmManagerProfileSaveFailed": "Failed to save profile",
      "dialogs.llmManagerProfileDeleteFailed": "Failed to delete profile",
      "dialogs.llmManagerProfilesFilteredEmpty":
        "No profiles match the current filters",
      "dialogs.llmManagerProfileEditorIdle":
        'Click "Create Profile" or "Edit" in the list to open the form',
      "dialogs.llmManagerEntryHint": "Click card or button to open manager",
      "dialogs.llmManagerLoadFailed": "Failed to load LLM config",
      "dialogs.llmManagerSelectProfileFirst": "Select a profile first",
      "dialogs.llmManagerSessionRequired":
        "No active session for session scope binding",
      "dialogs.llmManagerApplyFailed": "Failed to bind profile",
      "dialogs.llmManagerUnbind": "Unbind",
      "dialogs.llmManagerUnbinding": "Unbinding...",
      "dialogs.llmManagerUnbindFailed": "Failed to unbind profile",
      "dialogs.llmManagerBindingNotFound":
        "No binding was found for the selected scope and slot",
      "dialogs.llmManagerSessionScopeNotFound":
        "The target session does not exist for this session-scoped binding",
      "dialogs.llmManagerNarratorDisabled":
        "The narrator slot is disabled for the current session, so chat generation cannot run",
      "dialogs.llmManagerProfileDeleteBlocked":
        "This profile is still bound to an active scope. Unbind it before deleting",
      "dialogs.llmManagerParamValidationTemperature":
        "Temperature must be between 0 and 2",
      "dialogs.llmManagerParamValidationMaxOutputTokens":
        "Max output tokens must be an integer greater than or equal to 1",
      "dialogs.llmManagerParamValidationMaxContextTokens":
        "Max context tokens must be an integer greater than or equal to 1",
      "dialogs.llmManagerParamValidationTopP": "Top-P must be between 0 and 1",
      "dialogs.llmManagerParamValidationTopK":
        "Top-K must be an integer greater than or equal to 0",
      "dialogs.llmManagerParamValidationFrequencyPenalty":
        "Frequency penalty must be between -2 and 2",
      "dialogs.llmManagerParamValidationPresencePenalty":
        "Presence penalty must be between -2 and 2",
      "dialogs.llmManagerParamValidationTimeoutMs":
        "Timeout must be an integer greater than or equal to 1",
      "dialogs.llmManagerParamValidationMaxRetries":
        "Max retries must be an integer between 0 and 10",
      "dialogs.llmManagerParamValidationStream":
        "Stream must be a boolean value",
      "dialogs.worldbookManagerErrorJsonObject":
        "Top-level JSON value must be an object",
      "dialogs.toolManagerTitle": "Tool Manager",
      "dialogs.toolManagerDescription":
        "Review session tool permissions, runtime catalog entries, tool definitions, and recent execution records.",
      "dialogs.toolManagerLoading": "Loading tool manager data...",
      "dialogs.toolManagerLoadFailed": "Failed to load tool manager data",
      "dialogs.toolManagerSaving": "Working...",
      "dialogs.toolManagerPermissions": "Session tool permissions",
      "dialogs.toolManagerSessionHint":
        "This form writes directly to the active session tool permission document.",
      "dialogs.toolManagerSessionRequired":
        "There is no active session, so session tool permissions cannot be saved.",
      "dialogs.toolManagerNoActiveSession":
        "There is no active session. Open a session first to inspect this area.",
      "dialogs.toolManagerPermissionEnabled": "Tool mode",
      "dialogs.toolManagerPermissionAllowIrreversible":
        "Allow irreversible tools",
      "dialogs.toolManagerPermissionMaxCalls": "Max calls per turn",
      "dialogs.toolManagerPermissionMaxSteps": "Max steps per generation",
      "dialogs.toolManagerPermissionSlotAllow": "Slot allow list (JSON)",
      "dialogs.toolManagerPermissionSlotDeny": "Slot deny list (JSON)",
      "dialogs.toolManagerPermissionsSave": "Save session permissions",
      "dialogs.toolManagerRuntimeCatalog": "Runtime tool catalog",
      "dialogs.toolManagerRuntimeHint":
        "This shows the active session tool set and any naming conflicts.",
      "dialogs.toolManagerEmptyCatalog":
        "No runtime tools are available for this session.",
      "dialogs.toolManagerCatalogAvailability": "Availability",
      "dialogs.toolManagerCatalogReplaySafety": "Replay safety",
      "dialogs.toolManagerCatalogSideEffect": "Side effect",
      "dialogs.toolManagerCatalogAllowedSlots": "Allowed slots",
      "dialogs.toolManagerConflicts": "Catalog conflicts",
      "dialogs.toolManagerConflictsEmpty":
        "There are no runtime tool conflicts.",
      "dialogs.toolManagerDefinitions": "Tool definitions",
      "dialogs.toolManagerDefinitionsHint":
        "Create, edit, enable, disable, and delete custom tool definitions here.",
      "dialogs.toolManagerFilterPlaceholder":
        "Filter by name, description, or status",
      "dialogs.toolManagerCreateDefinition": "New definition",
      "dialogs.toolManagerEditDefinition": "Edit definition",
      "dialogs.toolManagerEmptyDefinitions":
        "This account does not have tool definitions yet.",
      "dialogs.toolManagerDefinitionName": "Name",
      "dialogs.toolManagerDefinitionDescription": "Description",
      "dialogs.toolManagerDefinitionSource": "Source",
      "dialogs.toolManagerDefinitionSourceId": "Source ID",
      "dialogs.toolManagerDefinitionHandlerType": "Handler type",
      "dialogs.toolManagerDefinitionHandler": "Handler config (JSON)",
      "dialogs.toolManagerDefinitionParameters": "Parameter schema (JSON)",
      "dialogs.toolManagerDefinitionSideEffectLevel": "Side effect level",
      "dialogs.toolManagerDefinitionAllowedSlots": "Allowed slots",
      "dialogs.toolManagerDefinitionEnabled": "Enabled",
      "dialogs.toolManagerDefinitionSave": "Save definition",
      "dialogs.toolManagerDefinitionDelete": "Delete definition",
      "dialogs.toolManagerDefinitionToggleOff": "Disable definition",
      "dialogs.toolManagerDefinitionToggleOn": "Enable definition",
      "dialogs.toolManagerDefinitionRequired": "Tool name is required",
      "dialogs.toolManagerExecutions": "Recent executions",
      "dialogs.toolManagerExecutionsHint":
        "Review recent tool_execution_record entries for the active session.",
      "dialogs.toolManagerEmptyExecutions":
        "There are no tool execution records for this session yet.",
      "dialogs.toolManagerExecutionProvider": "Provider",
      "dialogs.toolManagerExecutionOutcome": "Commit outcome",
      "dialogs.toolManagerExecutionDuration": "Duration",
      "dialogs.toolManagerExecutionStartedAt": "Started at",
      "dialogs.toolManagerDraftInherit": "Inherited",
      "dialogs.toolManagerDraftTrue": "Enabled",
      "dialogs.toolManagerDraftFalse": "Disabled",
      "dialogs.toolManagerValidationPositiveInteger":
        "This field must be an integer greater than or equal to 1",
      "dialogs.toolManagerValidationJsonObject": "JSON value must be an object",
      "dialogs.toolManagerValidationStringArrayRecord":
        "JSON value must match { slot: string[] }",
      "dialogs.mcpManagerTitle": "MCP Manager",
      "dialogs.mcpManagerDescription":
        "Manage MCP server configs, inspect runtime status, and run connect, disconnect, and test actions.",
      "dialogs.mcpManagerLoading": "Loading MCP data...",
      "dialogs.mcpManagerLoadFailed": "Failed to load MCP manager data",
      "dialogs.mcpManagerSaving": "Working...",
      "dialogs.mcpManagerServers": "Servers",
      "dialogs.mcpManagerServersHint":
        "The list shows MCP servers visible to the current account and their latest runtime state.",
      "dialogs.mcpManagerFilterPlaceholder":
        "Filter by name, transport, or prefix",
      "dialogs.mcpManagerServersEmpty":
        "This account does not have MCP server configs yet.",
      "dialogs.mcpManagerCreateServer": "New server",
      "dialogs.mcpManagerEditor": "Config editor",
      "dialogs.mcpManagerEditorHint":
        "Create or update stdio/http MCP transport configs directly from this dialog.",
      "dialogs.mcpManagerServerName": "Server name",
      "dialogs.mcpManagerTransport": "Transport",
      "dialogs.mcpManagerDefaultSideEffectLevel": "Default side effect level",
      "dialogs.mcpManagerToolPrefix": "Tool prefix",
      "dialogs.mcpManagerConnectTimeoutMs": "Connect timeout (ms)",
      "dialogs.mcpManagerCallTimeoutMs": "Call timeout (ms)",
      "dialogs.mcpManagerToolRefreshIntervalMs": "Tool refresh interval (ms)",
      "dialogs.mcpManagerEnabled": "Enabled",
      "dialogs.mcpManagerStdioCommand": "Stdio command",
      "dialogs.mcpManagerStdioCwd": "Stdio cwd",
      "dialogs.mcpManagerStdioArgs": "Stdio args (JSON array)",
      "dialogs.mcpManagerStdioEnv": "Stdio env (JSON object)",
      "dialogs.mcpManagerStdioEnvMasked": "Stored stdio env (masked)",
      "dialogs.mcpManagerHttpUrl": "HTTP URL",
      "dialogs.mcpManagerHttpHeaders": "HTTP headers (JSON object)",
      "dialogs.mcpManagerHttpHeadersMasked": "Stored HTTP headers (masked)",
      "dialogs.mcpManagerMaskedSecretHint":
        "The management API no longer returns raw secrets. Leave the input empty to keep the current value, or provide new JSON to replace the whole secret map.",
      "dialogs.mcpManagerSave": "Save config",
      "dialogs.mcpManagerDelete": "Delete server",
      "dialogs.mcpManagerToggleOff": "Disable server",
      "dialogs.mcpManagerToggleOn": "Enable server",
      "dialogs.mcpManagerStatus": "Runtime status",
      "dialogs.mcpManagerStatusHint":
        "Inspect connection state, timeout flags, and the latest tool count for the selected server.",
      "dialogs.mcpManagerSelectServerFirst":
        "Select a server from the list first.",
      "dialogs.mcpManagerStatusState": "State",
      "dialogs.mcpManagerStatusReconnectRequired": "Reconnect required",
      "dialogs.mcpManagerStatusLastTimeoutAt": "Last timeout",
      "dialogs.mcpManagerStatusToolCount": "Tool count",
      "dialogs.mcpManagerStatusConnectedAt": "Connected at",
      "dialogs.mcpManagerRuntimeActions": "Runtime actions",
      "dialogs.mcpManagerConnect": "Connect",
      "dialogs.mcpManagerDisconnect": "Disconnect",
      "dialogs.mcpManagerTest": "Test",
      "dialogs.mcpManagerLastTest": "Last test",
      "dialogs.mcpManagerLastTestEmpty": "No test has been run yet",
      "dialogs.mcpManagerTools": "Server tools",
      "dialogs.mcpManagerToolsHint":
        "Connected servers expose their current tool list here after refresh.",
      "dialogs.mcpManagerToolsEmpty":
        "There are no server tools to display right now.",
      "dialogs.mcpManagerValidationStringArray":
        "JSON value must be a string array",
      "dialogs.mcpManagerValidationStringRecord":
        "JSON value must match { key: string }",
      "dialogs.mcpManagerValidationPositiveInteger":
        "This field must be an integer greater than or equal to 1",
      "dialogs.mcpManagerHttpUrlRequired": "HTTP transport requires a URL",
      "dialogs.mcpManagerStdioCommandRequired":
        "Stdio transport requires a command",
      "dialogs.mcpManagerServerNameRequired": "Server name is required",
      "inspector.tabs.bindings": "Bindings",
      "inspector.tabs.tools": "Tools",
      "inspector.tabs.memory": "Memory",
      "inspector.tabs.vc": "VC",
      "inspector.tabs.impact": "Impact",
      "inspector.tools": "Tool Executions",
      "inspector.toolsActiveCount": "Active {count}",
      "inspector.toolsStreamStatus": "Stream Status",
      "inspector.toolsBranchId": "Branch ID",
      "inspector.toolsFloorId": "Floor ID",
      "inspector.toolsFloorNo": "Floor No",
      "inspector.toolsWarnings": "Replay Warnings",
      "inspector.toolsWarningsEmpty": "No replay warnings are present.",
      "inspector.toolsActive": "Active Tools",
      "inspector.toolsActiveEmpty": "No tool is running right now.",
      "inspector.toolsHistory": "Recent Tool Executions",
      "inspector.toolsHistoryEmpty":
        "No tool execution has appeared in the current stream yet.",
      "inspector.toolsExecutionId": "Execution ID",
      "inspector.toolsProvider": "Provider",
      "inspector.toolsReplaySafety": "Replay Safety",
      "inspector.toolsDuration": "Duration",
      "inspector.toolsPhases": "Phase Sequence",
      "inspector.variables": "Variables",
      "inspector.bindingState": "Binding State",
      "inspector.promptMode": "Prompt Mode",
      "inspector.promptModeNoSession": "No active session",
      "inspector.promptModeLoading": "Loading prompt mode",
      "inspector.promptModeError": "Failed to load prompt mode",
      "inspector.promptModeSelection": "Session explicit value",
      "inspector.promptModeInherit": "Inherit fallback",
      "inspector.promptModeOptionCompatStrict": "compat_strict",
      "inspector.promptModeOptionCompatPlus": "compat_plus",
      "inspector.promptModeOptionNative": "native",
      "inspector.promptModeExplicit": "sessionPromptMode",
      "inspector.promptModeEffective": "effectivePromptMode",
      "inspector.promptModeSource": "source",
      "inspector.promptModeLegacyFallback": "legacyFallback",
      "inspector.promptModeFallbackHint":
        "This session has no explicit mode, so runtime is using a fallback result.",
      "inspector.promptModeSourceSession": "session",
      "inspector.promptModeSourceLegacyMetadata": "legacy_metadata",
      "inspector.promptModeSourceDefault": "default",
      "inspector.promptModeSaving": "Saving...",
      "inspector.variablesLoading": "Loading resolved variables",
      "inspector.variablesEmpty":
        "No variables are visible in the current context",
      "inspector.variablesError": "Failed to load variable snapshot",
      "inspector.variablesNoSession": "No active session",
      "inspector.variablesResolvedSurface": "Durable Variable Truth",
      "inspector.variablesStagedSurface": "Page Staged Writes",
      "inspector.variablesStagedEmpty":
        "No staged variable writes exist for the current page",
      "inspector.variablesPromotionSurface": "Variable Promotion Trace",
      "inspector.variablesPromotionEmpty":
        "No variable promotion trace exists for the current page",
      "inspector.variableAttempt": "Attempt",
      "inspector.variableIntent": "Intent",
      "inspector.variableReason": "Reason",
      "inspector.variableSource": "Source",
      "inspector.variableEvidence": "Evidence",
      "inspector.variableDecisionReason": "Decision Reason",
      "inspector.variableCreated": "Created",
      "inspector.variableResolved": "Resolved",
      "inspector.variableFromScopeId": "From Scope ID",
      "inspector.variableToScopeId": "To Scope ID",
      "inspector.variableStagedWriteId": "Staged Write ID",
      "inspector.variablePromotionCount": "{count} promotions",
      "inspector.variableSourceId": "Source Scope ID",
      "inspector.variableUpdated": "Updated",
      "inspector.accountScope": "Account Scope",
      "inspector.isolated": "Isolated",
      "inspector.userBinding": "User Binding (Snapshot)",
      "inspector.applied": "Applied",
      "inspector.userBindingHint":
        "Replacing user will patch upcoming floor user_binding metadata in this session.",
      "inspector.characterBinding": "Character Binding",
      "inspector.worldbooks": "Worldbooks",
      "inspector.worldbookHint":
        "Detach removes relation only, the source asset remains in Library.",
      "inspector.memoryOverview": "Memory Overview",
      "inspector.memoryLoading": "Loading memory state",
      "inspector.memoryNoSession": "No active session",
      "inspector.memoryError": "Failed to load memory state",
      "inspector.memoryItems": "Memory Items",
      "inspector.memoryEmpty": "No memory items exist for the current session",
      "inspector.memoryJobs": "Recent Memory Jobs",
      "inspector.memoryJobsEmpty":
        "No memory jobs exist for the current session",
      "inspector.memoryScopeState": "Scope State",
      "inspector.memoryScopeStateEmpty":
        "No scope state has been recorded for the current session",
      "inspector.memoryActiveCount": "Active Items",
      "inspector.memoryDeprecatedCount": "Deprecated Items",
      "inspector.memoryEstimatedTokens": "Estimated Tokens",
      "inspector.memoryFacts": "Facts",
      "inspector.memoryOpenLoops": "Open Loops",
      "inspector.memorySummaries": "Summaries",
      "inspector.memoryRevision": "Revision",
      "inspector.memoryLastProcessedFloorNo": "Last Processed Floor",
      "inspector.memoryLastCompactionAt": "Last Compaction",
      "inspector.memoryLeaseOwner": "Lease Owner",
      "inspector.memoryLeaseUntil": "Lease Until",
      "inspector.memoryLeaseIdle": "Idle",
      "inspector.memoryItemImportance": "Importance",
      "inspector.memoryItemConfidence": "Confidence",
      "inspector.memoryItemFactKey": "Fact Key",
      "inspector.memoryItemSourceFloor": "Source Floor",
      "inspector.memoryItemSourceJob": "Source Job",
      "inspector.memoryItemCoverage": "Coverage",
      "inspector.memoryItemLastUsedAt": "Last Used",
      "inspector.memoryJobAttempts": "Attempts",
      "inspector.memoryJobCreatedAt": "Created",
      "inspector.memoryJobFinishedAt": "Finished",
      "inspector.memoryJobLastError": "Last Error",
      "inspector.vcOverview": "Version Control Overview",
      "inspector.vcNoSession": "No active session",
      "inspector.vcLoading": "Loading version control state",
      "inspector.vcError": "Failed to load version control state",
      "inspector.vcBranches": "Branches",
      "inspector.vcSnapshots": "Snapshots",
      "inspector.vcOperations": "Operations",
      "inspector.vcBranchesEmpty": "No branch record exists for this session",
      "inspector.vcMainBranch": "Main branch",
      "inspector.vcDiffUnavailable": "Diff against main is unavailable",
      "inspector.vcDiffSummary":
        "main only {base} / shared {shared} / current only {target}",
      "inspector.vcFloorCount": "{count} floors",
      "inspector.vcLatestFloor": "Latest Floor",
      "inspector.vcForkFloor": "Fork Floor",
      "inspector.vcLatestState": "Latest State",
      "inspector.vcLineage": "Floor Lineage",
      "inspector.vcLineageEmpty": "No floor lineage is available",
      "inspector.vcPromptSnapshots": "Prompt and Explain Snapshots",
      "inspector.vcSnapshotsEmpty": "No prompt snapshot is available",
      "inspector.vcSnapshotReady": "Recorded",
      "inspector.vcSnapshotMissing": "Missing",
      "inspector.vcPromptDigest": "Prompt Digest",
      "inspector.vcTokenEstimate": "Token Estimate",
      "inspector.vcExplainDiagnostics": "Diagnostics",
      "inspector.vcSectionStats": "Section Tokens",
      "inspector.vcOperationLogs": "Operation Logs",
      "inspector.vcOperationLogsEmpty":
        "No operation log exists for this session",
      "inspector.vcCreatedAt": "Created",
      "inspector.vcDiff": "Diff",
      "inspector.vcDiffChanges": "{count} changes",
      "impact.title": "Impact Preview",
      "impact.deleteHint": "Disable user card first before hard delete.",
      "impact.affectedSessions": "Affected Sessions",
      "impact.affectedFloors": "Affected Floors",
      "impact.disableFirst": "Disable First, Then Review Delete",
      "impact.tokenUsage": "Token Usage",
      "common.yes": "Yes",
      "common.no": "No",
      "actions.apply": "Apply",
      "actions.replace": "Replace",
      "actions.applyAssetUpdate": "Apply asset update to current session",
      "actions.attach": "Attach",
      "actions.refresh": "Refresh",
      "actions.importAssets": "Import",
      "actions.openAssetBrowser": "Open Asset Browser",
      "actions.openAsset": "Open Asset",
      "actions.applyAsset": "Apply Asset",
      "actions.editPreset": "Edit Preset",
      "actions.switchPreset": "Switch Preset",
      "actions.exportPreset": "Export Preset",
      "events.title": "Interaction Log",
      "events.empty": "No interaction yet",
      "events.replaceUser": "User snapshot switched -> {user}",
      "events.attachWorldbook": "Attached one worldbook, now {count} total",
      "events.detachWorldbook": "Detached one worldbook, now {count} total",
      "events.noWorldbook": "No worldbook binding left to detach",
      "events.applyUser": "Applied user asset update to current session",
      "events.switchAccount": "Switched account -> {account}",
      "events.sessionCreate": "Created session -> {title}",
      "events.sessionOpen": "Opened session -> {title}",
      "events.sessionRename": "Renamed session -> {title}",
      "events.sessionArchive": "Archived session -> {title}",
      "events.sessionDelete": "Deleted session -> {title}",
      "events.sessionNone": "No session available",
      "events.sessionLastGuard": "Keep at least one session",
      "events.streamingGuard": "Previous response is still streaming",
      "events.streamFallback":
        "Streaming endpoint unavailable, downgraded to normal request",
      "events.apiSyncFailed": "API sync failed, local fallback applied",
      "events.respondStart": "Response generation started",
      "events.respondLocalFallback":
        "Chat API unavailable, local draft fallback applied",
      "events.respondDone": "Response finished in {ms}ms with {tokens} tokens",
      "events.respondDoneWithSummaries":
        "Response finished in {ms}ms with {tokens} tokens and {summaries} summaries",
      "events.respondDonePendingCommit":
        "Response generated in {ms}ms with {tokens} tokens, current state {state}",
      "events.respondDonePendingCommitWithSummaries":
        "Response generated in {ms}ms with {tokens} tokens, {summaries} summaries, current state {state}",
      "events.timelineSyncFailed": "Timeline sync failed, keeping local view",
      "events.messageUpdated": "Updated {role} message",
      "events.messageDeleted": "Deleted {role} message",
      "events.messageUpdateFailed": "Message update failed",
      "events.messageDeleteFailed": "Message delete failed",
      "events.messageMissing": "Target message was not found",
      "events.messageEmptyGuard": "Message cannot be empty",
      "events.messageRegenerated":
        "Generated a new branch from {role}, output {tokens} tokens",
      "events.messageRegeneratedWithSummaries":
        "Generated a new branch from {role}, output {tokens} tokens and {summaries} summaries",
      "events.messageRegeneratedPendingCommit":
        "Generated a new branch from {role}, output {tokens} tokens, current state {state}",
      "events.messageRegeneratedPendingCommitWithSummaries":
        "Generated a new branch from {role}, output {tokens} tokens, {summaries} summaries, current state {state}",
      "events.messageRegenerateFailed": "Edit and regenerate failed",
      "events.messageRegenerateUnsupported":
        "This message cannot be edited and regenerated",
      "events.messageRetried":
        "Retried the floor for {role}, output {tokens} tokens",
      "events.messageRetriedWithSummaries":
        "Retried the floor for {role}, output {tokens} tokens and {summaries} summaries",
      "events.messageRetriedPendingCommit":
        "Retried the floor for {role}, output {tokens} tokens, current state {state}",
      "events.messageRetriedPendingCommitWithSummaries":
        "Retried the floor for {role}, output {tokens} tokens, {summaries} summaries, current state {state}",
      "events.messageRetryFailed": "Floor retry failed",
      "events.messageRetryUnsupported":
        "This message cannot trigger floor retry",
      "events.messageRetryConfirmationRequired":
        "Floor retry requires confirmation for {count} tool execution(s)",
      "events.messageRetryReplayBlocked":
        "Floor retry was blocked because {count} tool execution(s) cannot be replayed automatically",
      "events.accountReset": "Workspace context reset for account isolation",
      "events.assetOpen": "Opened {kind} asset -> {asset}",
      "events.assetApplied":
        "Applied {kind} asset to current workspace -> {asset}",
      "events.assetPinned": "Pinned {kind} asset -> {asset}",
      "events.assetUnpinned": "Unpinned {kind} asset -> {asset}",
      "events.assetMissing": "Target asset is missing or not visible",
      "events.assetImportDone": "Imported {count} {kind} assets",
      "events.assetImportFailed": "Failed to import {count} {kind} assets",
      "events.assetImportEmpty": "Choose at least one file to import",
      "events.assetImportSkipped": "Skipped {count} duplicate {kind} assets",
      "events.assetManagePresetOnly":
        "Asset manager currently supports presets only",
      "events.assetManagePresetCharacterOnly":
        "Asset manager currently supports presets and characters only",
      "events.assetManageWorldbookOnly":
        "Asset manager currently supports worldbooks only",
      "events.assetPresetConflict":
        "Preset was changed by another client. Reload it before trying again",
      "events.assetWorldbookConflict":
        "Worldbook was changed by another client. Reload it before trying again",
      "events.assetResourceBusy":
        "Resource is temporarily busy. Please try again shortly",
      "events.assetManageFailed": "Asset manager operation failed",
      "events.assetEdited": "Edited preset asset -> {asset}",
      "events.characterUpdated":
        "Updated character asset -> {asset} (v{version})",
      "events.characterDeleted": "Deleted character asset -> {asset}",
      "events.characterRestored": "Restored character asset -> {asset}",
      "events.assetOverwritten": "Overwrote preset asset -> {asset}",
      "events.assetDuplicated": "Duplicated preset asset -> {asset}",
      "events.assetDeleted": "Deleted preset asset -> {asset}",
      "events.assetOverwriteDeleteSyncFailed":
        "Overwrite succeeded, but old preset cleanup failed -> {asset}",
      "events.librarySyncFailed": "Failed to load resources. Try again.",
      "events.presetMissing": "No preset is currently available",
      "events.presetSwitchUnavailable":
        "At least two presets are required to switch",
      "events.presetExported": "Exported preset -> {asset}",
      "events.presetExportFailed": "Failed to export preset -> {asset}",
      "events.worldbookBound": "Bound worldbook to current session -> {asset}",
      "events.worldbookUnbound":
        "Unbound worldbook from current session -> {asset}",
      "events.worldbookUnbindGuarded":
        "Worldbook is not bound to current session -> {asset}",
      "events.worldbookUpdated": "Updated worldbook asset -> {asset}",
      "events.worldbookDuplicated": "Duplicated worldbook asset -> {asset}",
      "events.worldbookDeleted": "Deleted worldbook asset -> {asset}",
      "events.worldbookExported": "Exported worldbook -> {asset}",
      "events.worldbookExportFailed": "Failed to export worldbook -> {asset}",
      "events.llmRuntimeSyncFailed": "Failed to sync runtime LLM config",
      "events.llmBindingUpdated": "LLM slot {slot} bound -> {profile}",
      "events.llmBindingFailed": "Failed to bind LLM slot {slot}",
      "events.llmBindingRemoved": "Removed binding from LLM slot {slot}",
      "events.llmBindingRemoveFailed":
        "Failed to remove binding from LLM slot {slot}",
      "events.llmSlotPresetParamsApplied":
        "Applied preset params to LLM slot {slot} -> {preset}",
      "events.llmSlotPresetParamsApplyFailed":
        "Failed to apply preset params for LLM slot {slot}",
      "events.llmSlotParamsUpdated": "Updated params for LLM slot {slot}",
      "events.llmSlotParamsFailed":
        "Failed to update params for LLM slot {slot}",
      "events.llmProfileCreated": "Created LLM profile -> {profile}",
      "events.llmProfileUpdated": "Updated LLM profile -> {profile}",
      "events.llmProfileDeleted": "Deleted LLM profile -> {profile}",
      "events.llmProfileModelsFetched": "Fetched model list ({count})",
      "events.llmProfileModelsEmpty":
        "Model list request succeeded but returned empty",
      "events.llmProfileModelFetchFailed": "Failed to fetch model list",
      "events.llmProfileModelTestPassed":
        "Model connectivity test passed, response: {response}",
      "events.llmProfileModelTestFailed": "Model connectivity test failed",
      "events.llmProfileSaveFailed": "Failed to save LLM profile",
      "events.llmProfileDeleteFailed": "Failed to delete LLM profile",
      "events.toolManagerLoadFailed": "Failed to load tool manager data",
      "events.toolManagerPermissionsSaved":
        "Saved session tool permissions -> {session}",
      "events.toolManagerDefinitionCreated":
        "Created tool definition -> {tool}",
      "events.toolManagerDefinitionUpdated":
        "Updated tool definition -> {tool}",
      "events.toolManagerDefinitionDeleted":
        "Deleted tool definition -> {tool}",
      "events.toolManagerDefinitionToggled":
        "Updated tool definition state -> {tool} / {state}",
      "events.mcpManagerLoadFailed": "Failed to load MCP manager data",
      "events.mcpServerCreated": "Created MCP server -> {server}",
      "events.mcpServerUpdated": "Updated MCP server -> {server}",
      "events.mcpServerDeleted": "Deleted MCP server -> {server}",
      "events.mcpServerToggled":
        "Updated MCP server state -> {server} / {state}",
      "events.mcpServerConnected": "Connected MCP server -> {server}",
      "events.mcpServerDisconnected": "Disconnected MCP server -> {server}",
      "events.mcpServerTestPassed":
        "MCP server test passed in {duration}ms with {toolCount} tools",
      "events.mcpServerTestFailed":
        "MCP server test failed in {duration}ms with {toolCount} tools",
      "dynamic.runtimeUser": "User: {user} (snapshot)",
      "dynamic.runtimeWorldbooks": "{count} worldbooks attached",
      "dynamic.sessionTitle": "Session: {title}",
      "dynamic.sessionId": "ID: {id}",
      "dynamic.sessionCount": "{count} items",
      "dynamic.sessionLabel": "{title}",
      "dynamic.sessionArchived": "archived",
      "dynamic.sessionAccount": "Account: {account}",
      "dynamic.assetCount": "{count} items",
      "dynamic.assetUseCount": "{count} uses",
      "dynamic.assetKind.character": "Character",
      "dynamic.assetKind.worldbook": "Worldbook",
      "dynamic.assetKind.user": "User",
      "dynamic.assetKind.preset": "Preset",
      "dynamic.sessionUser": "User: {user} (snapshot)",
      "dynamic.sessionWorldbooks": "Worldbooks: {count}",
    },
  };

  return exports;
})();
const markdownRenderer = window.markdownit({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});
// Restoration of management workspace interactions. State is local to this HTML.
const management = {
  account: "studio-alpha",
  language: "zh-CN",
  events: [],
  tools: [],
  servers: [],
  globalRuntime: clone(saved.runtime),
  accounts: {},
  page: null,
  form: null,
  search: "",
  sort: "updated",
  favoriteOnly: false,
  resourceStatus: "active",
  runtimeScope: "application",
  importRows: [],
  importKind: null,
};
const managementInitial = clone({
  resources,
  saved,
  draft,
  releases,
  agentTypes,
  agentBindings,
  globalRuntime: management.globalRuntime,
});
const originalRender = render,
  originalConversation = renderConversation,
  originalLibrary = library,
  originalRuntime = renderRuntime,
  originalDebugger = renderDebugger,
  originalLeave = leaveEditor;
function logManagement(message, objectId = "workspace", level = "info") {
  management.events.unshift({
    id: `event-${nextId++}`,
    at: Date.now(),
    message,
    objectId,
    level,
  });
  renderEvents();
}
function renderEvents() {
  const node = $("workspaceEvents");
  if (!node) return;
  node.innerHTML = `<h2>管理操作记录</h2><div class="event-list">${
    management.events
      .slice(0, 60)
      .map(
        (e) =>
          `<div class="version"><span class="mono">${new Date(e.at).toLocaleTimeString()} · ${esc(e.objectId)}</span><p>${esc(e.message)}</p></div>`,
      )
      .join("") || '<p class="small">尚无操作记录。</p>'
  }</div>`;
}
const baseNotify = notify;
notify = (text) => {
  baseNotify(text);
  logManagement(text, getSession()?.id || "workspace");
};
leaveEditor = (action) => {
  if (management.form?.dirty) {
    ask("放弃未保存的修改？", "退出后会丢弃当前表单修改。", () => {
      management.form = null;
      management.page = null;
      editor = null;
      action();
    });
    return;
  }
  if (editor?.kind === "management") {
    editor = null;
    management.page = null;
    management.form = null;
    action();
    return;
  }
  originalLeave(() => {
    management.page = null;
    management.form = null;
    action();
  });
};
render = () => {
  document.body.classList.remove("generation-focused");
  originalRender();
  if (editor?.kind === "management") renderManagement();
  renderEvents();
};
function sessionState(s) {
  if (!s) return null;
  s.worldbooks ??= s.config.worldbook ? [clone(s.config.worldbook)] : [];
  s.promptMode ??= null;
  s.runtimeOrigin ??= "application";
  s.permissions ??= {
    enabled: null,
    allowIrreversible: null,
    maxCallsPerTurn: 8,
    maxStepsPerGeneration: 4,
    slotAllowList: {},
    slotDenyList: {},
  };
  s.operationLogs ??= [];
  s.branches ??= [{ id: "main", parent: null, forkFloor: null }];
  s.activeBranch ??= "main";
  s.messages.forEach((m) => {
    m.id ??= `message-${nextId++}`;
    m.at ??= Date.now();
    m.role ??= m.me ? "user" : "assistant";
    m.contentFormat ??= "markdown";
  });
  return s;
}
function operation(s, action, detail) {
  s.operationLogs.push({
    id: `op-${nextId++}`,
    at: Date.now(),
    action,
    detail: clone(detail),
    floor_id: selectedFloor(s)?.id || null,
  });
  logManagement(action, s.id);
}
function mdText(text, format = "markdown") {
  const source = format === "json" ? "```json\n" + text + "\n```" : text;
  return DOMPurify.sanitize(markdownRenderer.render(source));
}
// From packages/adapters-sillytavern/src/worldbook/trigger-engine.ts.
const worldbookTrigger = (() => {
  const constants = (() => {
    const exports = {};
    ("use strict");
    // ── ST WorldBook 精简类型 ──────────────────────────────
    // 原始酒馆世界书条目有较多字段，这里保留当前运行时需要的核心字段，
    // 并额外保留递归 / outlet 对齐所需字段。
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.WI_ROLE = exports.WI_LOGIC = exports.WI_POSITION = void 0;
    /** 世界书条目插入位置 */
    exports.WI_POSITION = {
      /** 角色定义之前 */
      BEFORE: 0,
      /** 角色定义之后 */
      AFTER: 1,
      /** Author's Note 之上 */
      AN_TOP: 2,
      /** Author's Note 之下 */
      AN_BOTTOM: 3,
      /** 指定深度 */
      AT_DEPTH: 4,
      /** 示例消息之上 */
      EM_TOP: 5,
      /** 示例消息之下 */
      EM_BOTTOM: 6,
      /** Outlet 宏展开槽位 */
      OUTLET: 7,
    };
    /** 世界书条目 selective 逻辑 */
    exports.WI_LOGIC = {
      /** 主关键词命中 + 至少一个辅助关键词命中 */
      AND_ANY: 0,
      /** 主关键词命中 + 不是所有辅助关键词都命中 */
      NOT_ALL: 1,
      /** 主关键词命中 + 没有辅助关键词命中 */
      NOT_ANY: 2,
      /** 主关键词命中 + 所有辅助关键词都命中 */
      AND_ALL: 3,
    };
    /** 消息角色 */
    exports.WI_ROLE = {
      SYSTEM: 0,
      USER: 1,
      ASSISTANT: 2,
    };
    return exports;
  })();
  const exports = {};
  const require = () => constants;
  ("use strict");
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.triggerWorldBook = triggerWorldBook;
  const worldbook_js_1 = require("../types/worldbook.js");
  // ── 内部工具 ──────────────────────────────────────────
  /**
   * 解析斜杠分隔的正则表达式字符串。
   * 匹配格式：/pattern/flags
   * @returns 编译好的 RegExp，如果不是合法正则则返回 null
   */
  function parseRegex(input) {
    const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) return null;
    let [, pattern, flags] = match;
    // 检查未转义的斜杠
    if (pattern.match(/(^|[^\\])\//)) return null;
    // 反转义斜杠
    pattern = pattern.replace("\\/", "/");
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }
  function escapeRegExp(input) {
    return input.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\      function messageDisplay(s, m) {",
    );
  }
  function buildExcerpt(text, start, end) {
    const excerptStart = Math.max(0, start - 30);
    const excerptEnd = Math.min(text.length, end + 30);
    return text.slice(excerptStart, excerptEnd);
  }
  function compareMatchTrace(left, right) {
    if (left.segmentIndex !== right.segmentIndex) {
      return left.segmentIndex - right.segmentIndex;
    }
    if (left.charStart !== right.charStart) {
      return left.charStart - right.charStart;
    }
    if (left.charEnd !== right.charEnd) {
      return left.charEnd - right.charEnd;
    }
    return 0;
  }
  function findPlainTextMatch(
    haystack,
    needle,
    caseSensitive,
    matchWholeWords,
  ) {
    if (!needle) {
      return null;
    }
    const escaped = escapeRegExp(needle);
    const flags = caseSensitive ? "" : "i";
    if (matchWholeWords) {
      const words = needle.trim().split(/\s+/);
      if (words.length === 1) {
        const regex = new RegExp(`(^|\\W)(${escaped})(?=$|\\W)`, flags);
        const match = regex.exec(haystack);
        if (!match) {
          return null;
        }
        const prefix = match[1] ?? "";
        const keyword = match[2] ?? "";
        const start = match.index + prefix.length;
        return { start, end: start + keyword.length };
      }
    }
    const regex = new RegExp(escaped, flags);
    const match = regex.exec(haystack);
    if (!match) {
      return null;
    }
    return {
      start: match.index,
      end: match.index + match[0].length,
    };
  }
  /**
   * 检查单个关键词是否在文本中命中。
   */
  function matchKey(haystack, needle, caseSensitive, matchWholeWords) {
    return (
      matchKeyWithTrace(haystack, needle, caseSensitive, matchWholeWords) !==
      null
    );
  }
  function matchKeyWithTrace(haystack, needle, caseSensitive, matchWholeWords) {
    const regex = parseRegex(needle);
    if (regex) {
      regex.lastIndex = 0;
      const match = regex.exec(haystack);
      if (!match) {
        return null;
      }
      return {
        matched: true,
        matchedKeyType: "regex",
        charStart: match.index,
        charEnd: match.index + match[0].length,
      };
    }
    const plainMatch = findPlainTextMatch(
      haystack,
      needle,
      caseSensitive,
      matchWholeWords,
    );
    if (!plainMatch) {
      return null;
    }
    return {
      matched: true,
      matchedKeyType: "plain",
      charStart: plainMatch.start,
      charEnd: plainMatch.end,
    };
  }
  /**
   * 检查一组关键词是否在文本中命中（至少一个命中即返回 true）。
   */
  function matchAnyKey(haystack, keys, caseSensitive, matchWholeWords) {
    return keys.some((key) =>
      matchKey(haystack, key, caseSensitive, matchWholeWords),
    );
  }
  /**
   * 计算辅助关键词命中数。
   */
  function countSecondaryHits(haystack, keys, caseSensitive, matchWholeWords) {
    return keys.filter((key) =>
      matchKey(haystack, key, caseSensitive, matchWholeWords),
    ).length;
  }
  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function getEntryExtensionFlag(entry, key) {
    const extensions = isRecord(entry.extra?.extensions)
      ? entry.extra.extensions
      : undefined;
    return extensions?.[key] === true;
  }
  function buildEntryHaystack(entry, context, scanState, recurseTexts) {
    return buildEntryHaystackSegments(entry, context, scanState, recurseTexts)
      .map((segment) => segment.text)
      .join("\n");
  }
  function buildEntryHaystackSegments(entry, context, scanState, recurseTexts) {
    const depth = Math.max(0, entry.scanDepth ?? context.scanDepth);
    if (depth === 0) {
      return [];
    }
    const segments = context.messages
      .slice(0, depth)
      .map((text, index) => ({
        kind: "message",
        text,
        messageIndexFromLatest: index,
      }))
      .filter((segment) => segment.text.length > 0);
    const scanSources = context.scanSources;
    if (scanSources) {
      if (
        getEntryExtensionFlag(entry, "match_persona_description") &&
        scanSources.personaDescription?.trim()
      ) {
        segments.push({
          kind: "persona_description",
          text: scanSources.personaDescription.trim(),
        });
      }
      if (
        getEntryExtensionFlag(entry, "match_character_description") &&
        scanSources.characterDescription?.trim()
      ) {
        segments.push({
          kind: "character_description",
          text: scanSources.characterDescription.trim(),
        });
      }
      if (
        getEntryExtensionFlag(entry, "match_character_personality") &&
        scanSources.characterPersonality?.trim()
      ) {
        segments.push({
          kind: "character_personality",
          text: scanSources.characterPersonality.trim(),
        });
      }
      if (
        getEntryExtensionFlag(entry, "match_character_depth_prompt") &&
        scanSources.characterDepthPrompt?.trim()
      ) {
        segments.push({
          kind: "character_depth_prompt",
          text: scanSources.characterDepthPrompt.trim(),
        });
      }
      if (
        getEntryExtensionFlag(entry, "match_scenario") &&
        scanSources.scenario?.trim()
      ) {
        segments.push({
          kind: "scenario",
          text: scanSources.scenario.trim(),
        });
      }
      if (
        getEntryExtensionFlag(entry, "match_creator_notes") &&
        scanSources.creatorNotes?.trim()
      ) {
        segments.push({
          kind: "creator_notes",
          text: scanSources.creatorNotes.trim(),
        });
      }
      if (
        Array.isArray(scanSources.injections) &&
        scanSources.injections.length > 0
      ) {
        scanSources.injections.forEach((text, injectionIndex) => {
          const trimmed = text.trim();
          if (!trimmed) {
            return;
          }
          segments.push({
            kind: "injection",
            text: trimmed,
            injectionIndex,
          });
        });
      }
    }
    if (scanState === "RECURSION" && recurseTexts.length > 0) {
      for (const text of recurseTexts) {
        if (!text) {
          continue;
        }
        segments.push({ kind: "recursion_buffer", text });
      }
    }
    return segments;
  }
  function shouldSkipEntryForScanState(entry, scanState, recursionLevel) {
    const requiredLevel = entry.delayUntilRecursion ?? null;
    if (scanState === "INITIAL" && requiredLevel !== null) {
      return true;
    }
    if (scanState === "RECURSION") {
      if (entry.excludeRecursion) {
        return true;
      }
      if (requiredLevel !== null && recursionLevel < requiredLevel) {
        return true;
      }
    }
    return false;
  }
  function getMaxDelayUntilRecursion(entries) {
    return entries.reduce((max, entry) => {
      const value = entry.delayUntilRecursion ?? null;
      return value !== null && value > max ? value : max;
    }, 0);
  }
  function collectKeyMatchTraces(
    segments,
    keys,
    matchedKeyScope,
    caseSensitive,
    matchWholeWords,
  ) {
    const traces = [];
    for (const key of keys) {
      for (
        let segmentIndex = 0;
        segmentIndex < segments.length;
        segmentIndex += 1
      ) {
        const segment = segments[segmentIndex];
        const match = matchKeyWithTrace(
          segment.text,
          key,
          caseSensitive,
          matchWholeWords,
        );
        if (!match) {
          continue;
        }
        traces.push({
          ...match,
          matchedKey: key,
          matchedKeyScope,
          segmentIndex,
        });
        break;
      }
    }
    return traces;
  }
  function selectFirstMatchTrace(traces) {
    if (traces.length === 0) {
      return null;
    }
    return [...traces].sort(compareMatchTrace)[0] ?? null;
  }
  function toTriggerFirstMatch(trace, segment) {
    return {
      sourceKind: segment.kind,
      matchedKey: trace.matchedKey,
      matchedKeyScope: trace.matchedKeyScope,
      matchedKeyType: trace.matchedKeyType,
      charStart: trace.charStart,
      charEnd: trace.charEnd,
      excerpt: buildExcerpt(segment.text, trace.charStart, trace.charEnd),
      ...(segment.messageIndexFromLatest !== undefined
        ? { messageIndexFromLatest: segment.messageIndexFromLatest }
        : {}),
      ...(segment.injectionIndex !== undefined
        ? { injectionIndex: segment.injectionIndex }
        : {}),
    };
  }
  function buildActivationTrace(
    entry,
    context,
    scanState,
    recursionLevel,
    recurseTexts,
  ) {
    if (entry.constant) {
      return {
        mode: "constant",
        recursionLevel,
        firstMatch: null,
      };
    }
    if (entry.key.length === 0) {
      return null;
    }
    const caseSensitive = entry.caseSensitive ?? context.caseSensitive;
    const matchWholeWords = entry.matchWholeWords ?? context.matchWholeWords;
    const segments = buildEntryHaystackSegments(
      entry,
      context,
      scanState,
      recurseTexts,
    );
    const primaryMatchTraces = collectKeyMatchTraces(
      segments,
      entry.key,
      "primary",
      caseSensitive,
      matchWholeWords,
    );
    if (primaryMatchTraces.length === 0) {
      return null;
    }
    if (!entry.selective || entry.keysecondary.length === 0) {
      const firstMatchTrace = selectFirstMatchTrace(primaryMatchTraces);
      return {
        mode: "triggered",
        recursionLevel,
        firstMatch: firstMatchTrace
          ? toTriggerFirstMatch(
              firstMatchTrace,
              segments[firstMatchTrace.segmentIndex],
            )
          : null,
      };
    }
    const secondaryMatchTraces = collectKeyMatchTraces(
      segments,
      entry.keysecondary,
      "secondary",
      caseSensitive,
      matchWholeWords,
    );
    const secondaryHitCount = secondaryMatchTraces.length;
    const secondaryCount = entry.keysecondary.length;
    let triggered = false;
    switch (entry.selectiveLogic) {
      case worldbook_js_1.WI_LOGIC.AND_ANY:
        triggered = secondaryHitCount > 0;
        break;
      case worldbook_js_1.WI_LOGIC.AND_ALL:
        triggered = secondaryHitCount === secondaryCount;
        break;
      case worldbook_js_1.WI_LOGIC.NOT_ANY:
        triggered = secondaryHitCount === 0;
        break;
      case worldbook_js_1.WI_LOGIC.NOT_ALL:
        triggered = secondaryHitCount < secondaryCount;
        break;
      default:
        triggered = true;
        break;
    }
    if (!triggered) {
      return null;
    }
    const firstMatchTrace = selectFirstMatchTrace([
      ...primaryMatchTraces,
      ...secondaryMatchTraces,
    ]);
    return {
      mode: "triggered",
      recursionLevel,
      firstMatch: firstMatchTrace
        ? toTriggerFirstMatch(
            firstMatchTrace,
            segments[firstMatchTrace.segmentIndex],
          )
        : null,
    };
  }
  /**
   * 检查条目是否被触发（综合 selective + selectiveLogic）。
   */
  function isEntryTriggered(
    entry,
    haystack,
    globalCaseSensitive,
    globalMatchWholeWords,
  ) {
    // constant 条目始终激活
    if (entry.constant) return true;
    // 没有主关键词 → 不触发
    if (entry.key.length === 0) return false;
    const caseSensitive = entry.caseSensitive ?? globalCaseSensitive;
    const matchWholeWords = entry.matchWholeWords ?? globalMatchWholeWords;
    // 主关键词：至少一个命中
    const primaryHit = matchAnyKey(
      haystack,
      entry.key,
      caseSensitive,
      matchWholeWords,
    );
    if (!primaryHit) return false;
    // 非 selective 模式 → 只需主关键词
    if (!entry.selective || entry.keysecondary.length === 0) return true;
    // selective 模式 → 按 selectiveLogic 检查辅助关键词
    const secondaryCount = entry.keysecondary.length;
    const secondaryHits = countSecondaryHits(
      haystack,
      entry.keysecondary,
      caseSensitive,
      matchWholeWords,
    );
    switch (entry.selectiveLogic) {
      case worldbook_js_1.WI_LOGIC.AND_ANY:
        // 至少一个辅助关键词命中
        return secondaryHits > 0;
      case worldbook_js_1.WI_LOGIC.AND_ALL:
        // 所有辅助关键词都命中
        return secondaryHits === secondaryCount;
      case worldbook_js_1.WI_LOGIC.NOT_ANY:
        // 没有辅助关键词命中
        return secondaryHits === 0;
      case worldbook_js_1.WI_LOGIC.NOT_ALL:
        // 不是所有辅助关键词都命中
        return secondaryHits < secondaryCount;
      default:
        return true;
    }
  }
  // ── 主函数 ────────────────────────────────────────────
  /**
   * 世界书触发引擎：根据聊天消息扫描世界书条目，返回被触发的条目。
   *
   * @param entries - 世界书条目列表（应包含所有条目，包括 disabled 的）
   * @param context - 扫描上下文
   * @returns 触发结果（按 position 分类）
   */
  function triggerWorldBook(entries, context) {
    const recursive = context.recursive ?? false;
    const maxRecursionSteps = context.maxRecursionSteps ?? 0;
    const maxDelayLevel = getMaxDelayUntilRecursion(entries);
    const traceEnabled = context.traceEnabled === true;
    const activatedMap = new Map();
    const activationTraces = traceEnabled ? new Map() : undefined;
    const recurseTexts = [];
    let loopCount = 0;
    while (true) {
      if (maxRecursionSteps > 0 && loopCount >= maxRecursionSteps) {
        break;
      }
      const scanState = loopCount === 0 ? "INITIAL" : "RECURSION";
      const recursionLevel = scanState === "RECURSION" ? loopCount : 0;
      const newlyActivated = [];
      for (const entry of entries) {
        if (entry.disable) continue;
        if (activatedMap.has(entry.uid)) continue;
        if (shouldSkipEntryForScanState(entry, scanState, recursionLevel))
          continue;
        if (traceEnabled) {
          const activationTrace = buildActivationTrace(
            entry,
            context,
            scanState,
            recursionLevel,
            recurseTexts,
          );
          if (activationTrace) {
            newlyActivated.push(entry);
            activationTraces?.set(entry.uid, activationTrace);
          }
          continue;
        }
        const entryHaystack = buildEntryHaystack(
          entry,
          context,
          scanState,
          recurseTexts,
        );
        if (
          isEntryTriggered(
            entry,
            entryHaystack,
            context.caseSensitive,
            context.matchWholeWords,
          )
        ) {
          newlyActivated.push(entry);
        }
      }
      if (newlyActivated.length === 0) {
        if (!recursive) {
          break;
        }
        const nextRecursionLevel = loopCount === 0 ? 1 : loopCount + 1;
        if (nextRecursionLevel <= maxDelayLevel) {
          loopCount = nextRecursionLevel;
          continue;
        }
        break;
      }
      for (const entry of newlyActivated) {
        activatedMap.set(entry.uid, entry);
      }
      if (!recursive) {
        break;
      }
      const nextRecurseTexts = newlyActivated
        .filter((entry) => !entry.preventRecursion)
        .map((entry) => entry.content)
        .filter(
          (content) => typeof content === "string" && content.trim().length > 0,
        );
      if (nextRecurseTexts.length > 0) {
        recurseTexts.push(...nextRecurseTexts);
      }
      const nextRecursionLevel = loopCount === 0 ? 1 : loopCount + 1;
      if (nextRecurseTexts.length === 0 && nextRecursionLevel > maxDelayLevel) {
        break;
      }
      loopCount = nextRecursionLevel;
    }
    // 按 order 降序排列（高 order = 高优先）
    const activated = [...activatedMap.values()].sort(
      (a, b) => b.order - a.order,
    );
    // 按 position 分类
    const before = [];
    const after = [];
    const atDepth = [];
    const outletEntries = {};
    const anTop = [];
    const anBottom = [];
    const emTop = [];
    const emBottom = [];
    for (const entry of activated) {
      switch (entry.position) {
        case worldbook_js_1.WI_POSITION.BEFORE:
          before.push(entry);
          break;
        case worldbook_js_1.WI_POSITION.AFTER:
          after.push(entry);
          break;
        case worldbook_js_1.WI_POSITION.AT_DEPTH:
          atDepth.push({ entry, depth: entry.depth, role: entry.role });
          break;
        case worldbook_js_1.WI_POSITION.AN_TOP:
          anTop.push(entry);
          break;
        case worldbook_js_1.WI_POSITION.AN_BOTTOM:
          anBottom.push(entry);
          break;
        case worldbook_js_1.WI_POSITION.EM_TOP:
          emTop.push(entry);
          break;
        case worldbook_js_1.WI_POSITION.EM_BOTTOM:
          emBottom.push(entry);
          break;
        case worldbook_js_1.WI_POSITION.OUTLET: {
          const outletName = entry.outletName?.trim();
          if (!outletName) {
            break;
          }
          if (!outletEntries[outletName]) {
            outletEntries[outletName] = [];
          }
          outletEntries[outletName].push(entry);
          break;
        }
      }
    }
    return {
      activated,
      before,
      after,
      atDepth,
      anTop,
      anBottom,
      emTop,
      emBottom,
      outletEntries,
      ...(traceEnabled ? { activationTraces } : {}),
    };
  }
  return exports.triggerWorldBook;
})();
function messageDisplay(s, m) {
  const floor = s.rounds.find((f) => f.id === m.floorId);
  if (m.role !== "assistant" || m.streaming || floor?.state !== "committed")
    return { text: m.text, scripts: [], trace: null, variables: {} };
  const scripts = (floor.snapshot.regex?.entries || []).map((r) => ({
    ...r,
    placement: String(r.placement).split(",").filter(Boolean).map(Number),
  }));
  const variables = Object.fromEntries(
    (floor.debug?.variables || []).map((v) => [v.key, v.value]),
  );
  const substitute = (text) =>
    text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (token, key) =>
      Object.hasOwn(variables, key)
        ? variables[key] == null
          ? ""
          : String(variables[key])
        : token,
    );
  const messages = s.messages.filter(
    (x) => !x.branchId || x.branchId === m.branchId,
  );
  const depth = Math.max(
    0,
    messages.length - 1 - messages.findIndex((x) => x.id === m.id),
  );
  const trace = applyRegexScriptsWithTrace(m.text, scripts, 2, {
    channel: "display",
    depth,
    substituteFindParams: substitute,
    substituteReplaceParams: substitute,
  });
  return { text: trace.text, scripts, trace, variables, depth };
}
function renderMessageBody(s, m) {
  const display = messageDisplay(s, m);
  return mdText(display.text, m.contentFormat);
}
renderConversation = () => {
  originalConversation();
  const s = sessionState(getSession());
  if (!s) return;
  const root = $("messages");
  root.innerHTML =
    s.messages
      .filter(
        (m) =>
          !m.branchId ||
          m.branchId === s.activeBranch ||
          s.branches
            .find((b) => b.id === s.activeBranch)
            ?.inherited?.includes(m.id),
      )
      .map(
        (m) =>
          `<article class="message" data-message-id="${esc(m.id)}"><div class="row"><strong>${esc(m.role === "user" ? referenceName(s.config.persona) : m.role === "narrator" ? "旁白" : m.role === "system" ? "系统" : getResource(s.config.character?.id)?.name || "角色")}</strong><span class="small">${new Date(m.at).toLocaleTimeString()}</span></div><div class="markdown-block">${renderMessageBody(s, m)}</div><div class="actions"><button data-r="message-edit" data-id="${m.id}" ${s.running ? "disabled" : ""}>编辑</button><button data-r="message-delete" data-id="${m.id}" ${s.running ? "disabled" : ""}>删除消息</button>${m.role === "user" ? `<button data-r="message-regenerate-edit" data-id="${m.id}" ${s.running ? "disabled" : ""}>编辑并重新生成</button>` : ""}${m.role === "assistant" && m.floorId ? `<button data-r="message-regenerate" data-id="${m.id}" ${s.running ? "disabled" : ""}>重新生成</button>` : ""}${m.floorId ? `<button data-debug-floor="${m.floorId}">查看生成详情</button>` : ""}</div>${m.floorId ? `<p class="small">${m.streaming ? "正在接收回复…" : `${m.latencyMs ?? "—"} ms · ${m.tokens ?? "—"} Token · ${m.source || "Local"}`} · ${esc(m.branchId || "main")}</p>` : ""}</article>`,
      )
      .join("") +
    (s.failed
      ? '<p class="danger">回复生成失败，请重试。<button data-action="retry">重试回复</button></p>'
      : "");
  const head = document.querySelector(".session-head");
  head.insertAdjacentHTML(
    "beforeend",
    `<div class="actions"><button data-r="session-config">调整本会话配置</button><button data-r="memory">记忆</button><button data-r="variables">变量</button><button data-r="branches">分支与历史</button></div>`,
  );
  $("prompt").onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      send(s);
    }
  };
  $("prompt").placeholder = "输入消息，Ctrl / ⌘ + Enter 发送";
};
const originalFloor = createFloorRecord;
createFloorRecord = (s, text) => {
  sessionState(s);
  if (s.runtimeOrigin === "global")
    s.config.runtime = clone(management.globalRuntime);
  const old = s.debugFloor,
    f = originalFloor(s, text);
  if (editor?.kind === "debug" && old) s.debugFloor = old;
  f.branch_id = s.activeBranch;
  f.promptMode = s.promptMode || "compat_strict";
  f.worldbooks = clone(s.worldbooks);
  f.debug = {
    source: "local",
    tools: [],
    variables: [],
    stagedWrites: [],
    promotions: [],
    memories: [],
    jobs: [],
    scopeState: null,
    explain: null,
  };
  return f;
};
send = (s) => {
  sessionState(s);
  if (s.running || s.failed || s.status === "archived") return;
  if (!s.input.trim()) {
    notify("请输入消息后发送。");
    return;
  }
  const f = createFloorRecord(s, s.input.trim());
  s.messages.push({
    id: `message-${nextId++}`,
    role: "user",
    me: true,
    text: s.input.trim(),
    floorId: f.id,
    branchId: s.activeBranch,
    at: Date.now(),
    source: "Local",
  });
  s.input = "";
  generate(s, f);
};
function updateGenerationResponses(f, a) {
  const committed = f.state === "committed";
  const run = {
    run_id: a.id,
    run_type: a.attempt_no > 1 ? "retry_turn" : "respond",
    status: a.state,
    phase: committed ? "post_commit_scheduled" : "page_generating",
    public_phase: committed ? "post_processing" : "generating",
    phase_seq: committed ? 9 : 4,
    attempt_no: a.attempt_no,
    started_at: a.started_at,
    updated_at: a.ended_at ?? a.started_at,
    completed_at: a.ended_at,
    pending_output: null,
    verifier: null,
    error: a.error,
  };
  const result = committed
    ? {
        data: {
          floor_id: f.id,
          output_page_id: f.debug.pageId,
          assistant_message_id: f.result.assistant_message_id,
          generated_text: f.result.generated_text,
          summaries: [],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
          verifier: null,
          committed_at: f.result.committed_at,
        },
      }
    : {
        error: {
          code: "invalid_state",
          message: `Floor '${f.id}' is not committed`,
        },
      };
  f.apiResponses = [
    {
      method: "GET",
      route: "/floors/{id}/run",
      path: `/floors/${f.id}/run`,
      status: 200,
      body: { data: { floor_id: f.id, state: f.state, run } },
    },
    {
      method: "GET",
      route: "/floors/{id}/result",
      path: `/floors/${f.id}/result`,
      status: committed ? 200 : 409,
      body: result,
    },
  ];
}
function commitSceneDisplayData(s, f, a) {
  const previous = s.rounds.findLast((x) => x !== f && x.state === "committed");
  const before = Object.fromEntries(
    (previous?.debug?.variables || []).map((v) => [v.key, v.value]),
  );
  const values = {
    "scene.location": "港口书店 · 柜台",
    "scene.time": "22:18",
    "relationship.trust": Math.min(
      100,
      Number(before["relationship.trust"] || 20) + 5,
    ),
    "story.clue": "明晚九点 · 旧灯塔",
  };
  const resolved = Object.entries(values).map(([key, value]) => ({
    key,
    value,
    source_scope: "floor",
    source_scope_id: f.id,
    updated_at: a.ended_at,
  }));
  f.debug.variables = resolved.map((v) => ({
    key: v.key,
    value: v.value,
    scope: v.source_scope,
    source: v,
  }));
  f.apiResponses.push({
    method: "GET",
    route: "/variables/resolve",
    path: "/variables/resolve",
    query: { session_id: s.id, floor_id: f.id, page_id: f.debug.pageId },
    status: 200,
    body: {
      data: {
        context: {
          account_id: "default",
          session_id: s.id,
          global_scope_id: "global",
          branch_id: f.branch_id,
          floor_id: f.id,
          page_id: f.debug.pageId,
        },
        resolved,
      },
    },
  });
  const book = f.snapshot.worldbook;
  const entries = (book?.entries || []).map((e) => ({
    ...e,
    key: String(e.key).split(",").filter(Boolean),
    keysecondary: String(e.keysecondary || "")
      .split(",")
      .filter(Boolean),
  }));
  const history = s.messages
    .filter(
      (m) =>
        m.id !== f.result.assistant_message_id &&
        (!m.branchId || m.branchId === f.branch_id),
    )
    .map((m) => m.text)
    .reverse();
  const activation = worldbookTrigger(entries, {
    messages: history,
    scanDepth: book?.scanDepth ?? 2,
    caseSensitive: book?.caseSensitive ?? false,
    matchWholeWords: book?.matchWholeWords ?? false,
    recursive: book?.recursive ?? false,
    maxRecursionSteps: book?.maxRecursionSteps ?? 0,
  });
  const template = clone(
    previewResponses.find(
      (r) =>
        r.route === "/floors/{id}/prompt-runtime/explain" && r.status === 200,
    ).body.data,
  );
  template.floor = {
    id: f.id,
    session_id: s.id,
    floor_no: f.no,
    branch_id: f.branch_id,
    parent_floor_id: previous?.id || null,
    state: "committed",
    prompt_snapshot_created_at: a.started_at,
    committed_at: a.ended_at,
  };
  template.scope = {
    session_id: s.id,
    target_branch_id: f.branch_id,
    branch_exists: true,
    source_floor_id: null,
    history_source_branch_id: f.branch_id,
    history_source_mode: "existing_branch",
  };
  template.result = {
    ...f.apiResponses.find((r) => r.route === "/floors/{id}/result").body.data,
  };
  delete template.result.floor_id;
  template.prompt_snapshot.worldbook_id = f.config.worldbook?.id || null;
  template.prompt_snapshot.worldbook_version =
    f.config.worldbook?.version || null;
  template.prompt_snapshot.regex_profile_id = f.config.regex?.id || null;
  template.prompt_snapshot.regex_profile_version =
    f.config.regex?.version || null;
  template.prompt_snapshot.prompt_digest = `prompt-${f.id}-${a.attempt_no}`;
  template.prompt_snapshot.token_estimate = 0;
  template.section_stats = [];
  template.prompt_snapshot.worldbook_activated_entry_uids =
    activation.activated.map((e) => e.uid);
  template.prompt_snapshot.worldbook_activated_entries =
    activation.activated.map((e) => ({
      uid: e.uid,
      activation_key: `worldbook:${f.config.worldbook.id}:${f.config.worldbook.version}:entry:${e.uid}`,
      source: {
        kind: "session_worldbook",
        worldbook_id: f.config.worldbook.id,
        worldbook_name: getResource(f.config.worldbook.id).name,
        asset_scope_id: `worldbook:${f.config.worldbook.id}:${f.config.worldbook.version}`,
      },
      insertion: {
        position: [
          "before",
          "after",
          "an_top",
          "an_bottom",
          "at_depth",
          "em_top",
          "em_bottom",
          "outlet",
        ][e.position],
        ...(e.position === 4
          ? {
              depth: e.depth,
              role: ["system", "user", "assistant"][e.role],
            }
          : {}),
        ...(e.position === 7 ? { outlet_name: e.outletName } : {}),
      },
    }));
  f.apiResponses.push({
    method: "GET",
    route: "/floors/{id}/prompt-runtime/explain",
    path: `/floors/${f.id}/prompt-runtime/explain`,
    status: 200,
    body: { data: template },
  });
  f.debug.explain = {
    digest: template.prompt_snapshot.prompt_digest,
    tokenEstimate: 0,
    messages: [],
    sections: [],
    diagnostics: [],
    trimReasons: [],
    excludedSources: [],
  };
}
generate = (s, target, resume = false) => {
  sessionState(s);
  if ((s.running && !resume) || s.status === "archived") return;
  const f =
    target || s.rounds.findLast((x) => x.state === "failed") || s.rounds.at(-1);
  if (!f) return;
  const a = resume
    ? f.attempts.at(-1)
    : {
        id: `run-${nextId++}`,
        attempt_no: f.attempts.length + 1,
        started_at: Date.now(),
        ended_at: null,
        state: "running",
        error: null,
      };
  if (!resume) f.attempts.push(a);
  f.state = "generating";
  s.running = true;
  s.failed = false;
  f.events.push({
    at: Date.now(),
    message: `第 ${f.attempts.length} 次执行开始`,
  });
  f.result = null;
  f.debug = {
    pageId: `page-${nextId++}`,
    source: "local",
    tools: [],
    variables: [],
    stagedWrites: [],
    promotions: [],
    memories: [],
    jobs: [],
  };
  updateGenerationResponses(f, a);
  let m = resume
      ? s.messages.findLast((m) => m.floorId === f.id && m.streaming)
      : null,
    index = m?.text.length || 0;
  const output =
    "[旁白]林岚将信纸放到灯下，指尖停在落款处。[/旁白]\n\n“明晚九点，旧灯塔。”她看向你，“我们先把值夜记录找出来。”\n\n[scene_state]";
  const finish = () => {
    a.ended_at = Date.now();
    s.running = false;
    if (failNext) {
      failNext = false;
      a.state = "failed";
      a.error = {
        code: "generation_failed",
        message: "生成失败，请查看运行记录后重试。",
      };
      f.state = "failed";
      s.failed = true;
      f.events.push({
        at: Date.now(),
        message: "生成失败，尚未提交回复",
      });
      notify("回复生成失败，请重试。");
      updateGenerationResponses(f, a);
      render();
      return;
    }
    const scripts = (f.snapshot.regex?.entries || []).map((r) => ({
      ...r,
      placement: String(r.placement).split(",").filter(Boolean).map(Number),
    }));
    m.text = applyRegexScripts(m.text, scripts, 2, {
      channel: "persist",
      depth: 0,
    });
    a.state = "completed";
    f.state = "committed";
    m.streaming = false;
    m.latencyMs = a.ended_at - a.started_at;
    f.result = {
      floor_id: f.id,
      assistant_message_id: m.id,
      generated_text: m.text,
      committed_at: Date.now(),
      usage: null,
    };
    updateGenerationResponses(f, a);
    commitSceneDisplayData(s, f, a);
    f.events.push({ at: Date.now(), message: "回复已提交" });
    operation(s, "回复已提交", { floorId: f.id, runId: a.id });
    render();
  };
  const step = () => {
    if (failNext) {
      finish();
      return;
    }
    if (!m) {
      m = {
        id: `message-${nextId++}`,
        floorId: f.id,
        branchId: f.branch_id,
        role: "assistant",
        text: "",
        at: Date.now(),
        streaming: true,
        source: "Local",
      };
      s.messages.push(m);
    }
    index += 12;
    m.text = output.slice(0, index);
    render();
    if (index < output.length) setTimeout(step, 180);
    else finish();
  };
  render();
  logManagement("开始生成回复", f.id);
  setTimeout(step, 250);
};
function startMessageEdit(id, regenerate = false) {
  const s = sessionState(getSession()),
    m = s.messages.find((x) => x.id === id);
  if (s.running) return;
  openManagement("message", () => {
    management.form = { id, regenerate, text: m.text, dirty: false };
  });
}
function regenerateMessage(id, text) {
  const s = sessionState(getSession()),
    m = s.messages.find((x) => x.id === id);
  if (s.running || s.status === "archived") {
    notify("请在进行中的空闲会话内重新生成。");
    return;
  }
  const source = s.rounds.find((f) => f.id === m.floorId);
  if (!source) {
    notify("此消息没有生成轮次，请发送新消息。");
    return;
  }
  const input = text ?? source.input;
  const branch = {
    id: `branch-${nextId++}`,
    parent: source.branch_id,
    forkFloor: source.id,
    inherited: (typeof userVisibleMessages === "function"
      ? userVisibleMessages(s)
      : s.messages
    )
      .slice(
        0,
        (typeof userVisibleMessages === "function"
          ? userVisibleMessages(s)
          : s.messages
        ).findIndex((x) => x.floorId === source.id),
      )
      .map((x) => x.id),
  };
  s.branches.push(branch);
  s.activeBranch = branch.id;
  s.failed = false;
  s.input = input;
  operation(s, "创建重新生成分支", {
    branchId: branch.id,
    sourceFloor: source.id,
  });
  editor = null;
  management.page = null;
  send(s);
}
function button(action, label, id = "", disabled = false) {
  return `<button data-r="${action}" data-id="${esc(id)}" ${disabled ? "disabled" : ""}>${label}</button>`;
}
function table(headers, rows, empty = "暂无记录。") {
  return `<div class="table-scroll"><table><thead><tr>${headers.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`;
}
function detail(data, label = "查看详情") {
  return `<details><summary>${label}</summary><pre class="readonly">${esc(JSON.stringify(data, null, 2))}</pre></details>`;
}
function field(key, label, value, type = "text", options) {
  if (options)
    return `<label class="field">${label}<select data-mf="${key}">${options
      .map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(l)}</option>`;
      })
      .join("")}</select></label>`;
  if (type === "checkbox")
    return `<label class="field">${label}<input data-mf="${key}" type="checkbox" ${value ? "checked" : ""}></label>`;
  return `<label class="field">${label}${type === "area" || type === "json" ? `<textarea data-mf="${key}" data-value-type="${type}">${esc(type === "json" ? JSON.stringify(value, null, 2) : value)}</textarea>` : `<input data-mf="${key}" type="${type}" value="${esc(value ?? "")}">`}</label>`;
}
function readForm() {
  const result = {};
  for (const e of document.querySelectorAll("[data-mf]")) {
    const key = e.dataset.mf;
    let v =
      e.type === "checkbox"
        ? e.checked
        : e.type === "number"
          ? e.value === ""
            ? null
            : Number(e.value)
          : e.value;
    if (e.dataset.valueType === "json") {
      try {
        v = JSON.parse(v);
      } catch {
        throw Error(`${key} 的 JSON 格式错误，请修正后保存。`);
      }
    }
    result[key] = v;
  }
  return result;
}
function openManagement(page, init = () => {}) {
  leaveEditor(() => {
    management.page = page;
    management.form = null;
    editor = { kind: "management" };
    init();
    renderManagement();
  });
}
function openManagerForm(kind, id) {
  const source = kind === "tool" ? management.tools : management.servers;
  const data = id
    ? clone(source.find((x) => x.id === id))
    : kind === "tool"
      ? {
          name: "",
          description: "",
          enabled: true,
          source: "custom",
          sourceId: "",
          allowedSlots: ["narrator"],
          sideEffectLevel: "none",
          handlerType: "script",
          parameters: { type: "object", properties: {} },
          handler: {},
        }
      : {
          name: "",
          enabled: true,
          transport: "http",
          httpUrl: "",
          httpHeaders: {},
          stdioCommand: "",
          stdioArgs: [],
          stdioCwd: "",
          stdioEnv: {},
          toolPrefix: "",
          defaultSideEffectLevel: "none",
          connectTimeoutMs: 10000,
          callTimeoutMs: 30000,
          toolRefreshIntervalMs: 60000,
        };
  openManagement(
    `${kind}-form`,
    () => (management.form = { kind, id, data, dirty: false }),
  );
}
function renderManagement() {
  const s = sessionState(getSession()),
    p = management.page,
    form = management.form;
  let body = "";
  const titles = {
    tools: "工具管理",
    mcp: "MCP 管理",
    "tool-form": "工具定义",
    "mcp-form": "MCP 服务器",
    "session-config": "当前试聊配置",
    message: "编辑消息",
    variables: "变量调试",
    memory: "记忆调试",
    branches: "分支与历史",
    import: "批量导入资源",
    "live-tools": "实时工具调用",
  };
  if (p === "tools") {
    body =
      `<div class="actions">${button("tool-new", "新建工具")}${button("refresh-management", "刷新")}${button("permissions", "会话工具权限", "", !s)}</div>` +
      table(
        ["工具", "来源 / 槽位", "状态", "操作"],
        management.tools.map((t) => [
          esc(t.name),
          esc(t.source) + " / " + esc(t.allowedSlots.join(", ")),
          t.enabled ? "启用" : "停用",
          button("tool-edit", "编辑", t.id) +
            button("tool-toggle", t.enabled ? "停用" : "启用", t.id) +
            button("tool-delete", "删除", t.id),
        ]),
      );
    const active = availableTools(s);
    body +=
      `<h2>当前会话可用工具</h2>` +
      table(
        ["名称", "允许槽位", "参数"],
        s
          ? active.map((t) => [
              esc(t.name),
              esc(t.allowedSlots.join(", ")),
              detail(t.parameters),
            ])
          : [],
        "请选择一条会话查看可用工具。",
      ) +
      `<h2>工具调用记录</h2>` +
      toolTable(s?.rounds.flatMap((f) => f.debug?.tools || []) || []);
  } else if (p === "mcp") {
    body =
      `<div class="actions">${button("mcp-new", "新建服务器")}${button("refresh-management", "刷新")}</div>` +
      table(
        ["服务器 / 传输", "状态", "工具", "操作"],
        management.servers.map((v) => [
          esc(v.name) + " / " + v.transport,
          esc(v.status || "disconnected") + (v.enabled ? "" : " · 停用"),
          detail(v.tools || [], "工具列表"),
          button("mcp-edit", "编辑", v.id) +
            button("mcp-toggle", v.enabled ? "停用" : "启用", v.id) +
            button(
              "mcp-connect",
              "连接",
              v.id,
              !v.enabled || v.status === "connected",
            ) +
            button("mcp-disconnect", "断开", v.id, v.status !== "connected") +
            button("mcp-test", "测试", v.id) +
            button("mcp-delete", "删除", v.id) +
            (v.test ? detail(v.test, "测试结果") : "") +
            (v.error ? `<p class="danger">${esc(v.error)}</p>` : ""),
        ]),
      );
  } else if (p === "tool-form") {
    const d = form.data;
    body =
      field("name", "工具名称", d.name) +
      field("description", "工具用途", d.description, "area") +
      field("enabled", "启用", d.enabled, "checkbox") +
      field("source", "工具来源", d.source, "text", [
        "custom",
        "preset",
        "character",
      ]) +
      field("sourceId", "来源 ID", d.sourceId) +
      field("allowedSlots", "允许槽位（JSON 数组）", d.allowedSlots, "json") +
      field("sideEffectLevel", "副作用等级", d.sideEffectLevel, "text", [
        "none",
        "sandbox",
        "irreversible",
      ]) +
      field("handlerType", "处理器类型", "script", "text", ["script"]) +
      field("parameters", "工具入参 Schema", d.parameters, "json") +
      field("handler", "处理器配置", d.handler, "json") +
      button("manager-save", "保存工具");
  } else if (p === "mcp-form") {
    const d = form.data;
    body =
      detail(
        {
          httpHeaders: d.httpHeadersMasked || {},
          stdioEnv: d.stdioEnvMasked || {},
        },
        "已保存的凭证（脱敏）",
      ) +
      field("name", "服务器名称", d.name) +
      field("enabled", "启用", d.enabled, "checkbox") +
      field("transport", "连接方式", d.transport, "text", ["http", "stdio"]) +
      `<div data-transport-section="http" ${d.transport === "http" ? "" : "hidden"}>` +
      field("httpUrl", "HTTP 地址", d.httpUrl) +
      field(
        "httpHeaders",
        "HTTP Headers（填写空对象 {} 保留已存凭证）",
        d.httpHeaders,
        "json",
      ) +
      `</div><div data-transport-section="stdio" ${d.transport === "stdio" ? "" : "hidden"}>` +
      field("stdioCommand", "启动命令", d.stdioCommand) +
      field("stdioArgs", "启动参数（JSON 数组）", d.stdioArgs, "json") +
      field("stdioCwd", "工作目录", d.stdioCwd) +
      field(
        "stdioEnv",
        "环境变量（填写空对象 {} 保留已存凭证）",
        d.stdioEnv,
        "json",
      ) +
      "</div>" +
      field("toolPrefix", "工具名前缀", d.toolPrefix) +
      field(
        "defaultSideEffectLevel",
        "默认副作用等级",
        d.defaultSideEffectLevel,
        "text",
        ["none", "sandbox", "irreversible"],
      ) +
      ["connectTimeoutMs", "callTimeoutMs", "toolRefreshIntervalMs"]
        .map((k, i) =>
          field(
            k,
            ["连接超时（ms）", "调用超时（ms）", "工具刷新间隔（ms）"][i],
            d[k],
            "number",
          ),
        )
        .join("") +
      button("manager-save", "保存服务器");
  } else if (p === "permissions") {
    const d = form.data;
    body =
      field(
        "enabled",
        "允许工具",
        d.enabled === null ? "inherit" : String(d.enabled),
        "text",
        [
          ["inherit", "继承"],
          ["true", "允许"],
          ["false", "禁止"],
        ],
      ) +
      field(
        "allowIrreversible",
        "允许不可逆操作",
        d.allowIrreversible === null ? "inherit" : String(d.allowIrreversible),
        "text",
        [
          ["inherit", "继承"],
          ["true", "允许"],
          ["false", "禁止"],
        ],
      ) +
      field("maxCallsPerTurn", "每轮调用上限", d.maxCallsPerTurn, "number") +
      field(
        "maxStepsPerGeneration",
        "每次生成步骤上限",
        d.maxStepsPerGeneration,
        "number",
      ) +
      field("slotAllowList", "槽位允许列表", d.slotAllowList, "json") +
      field("slotDenyList", "槽位禁止列表", d.slotDenyList, "json") +
      button("permissions-save", "保存会话权限");
  } else if (p === "message") {
    body =
      field("text", "消息内容", form.text, "area") +
      button("message-save", form.regenerate ? "保存并重新生成" : "保存消息");
  } else if (p === "session-config") {
    if (!s) body = "<p>请先选择会话。</p>";
    else {
      const d = form.data;
      body =
        `<p>保存后对本会话的下一轮生效。</p>` +
        Object.entries(labels)
          .filter(([k]) => !["model", "worldbook"].includes(k))
          .map(([k, l]) =>
            field(k, l, d[k] ? `${d[k].id}:${d[k].version}` : "", "text", [
              ["", "停用"],
              ...resources
                .filter((r) => r.kind === k && !r.deleted)
                .flatMap((r) =>
                  r.versions.map((v, i) => [
                    `${r.id}:${i + 1}`,
                    `${r.name} · v${i + 1}`,
                  ]),
                ),
            ]),
          )
          .join("") +
        `<h2>世界书绑定</h2>` +
        resources
          .filter((r) => r.kind === "worldbook" && !r.deleted)
          .map(
            (r) =>
              field(
                "wb:" + r.id,
                r.name,
                d.worldbooks.some((w) => w.id === r.id),
                "checkbox",
              ) +
              field(
                "wv:" + r.id,
                "绑定版本",
                d.worldbooks.find((w) => w.id === r.id)?.version ||
                  r.versions.length,
                "text",
                r.versions.map((v, i) => [i + 1, `v${i + 1}`]),
              ),
          )
          .join("") +
        field("promptMode", "提示词模式", s.promptMode || "inherit", "text", [
          ["inherit", "继承默认"],
          "compat_strict",
          "compat_plus",
          "native",
        ]) +
        `<p>生效模式：${esc(s.promptMode || "compat_strict")} · 来源：${s.promptMode ? "session" : "default"}</p>` +
        button("session-save", "保存本会话配置") +
        button("runtime-session", "配置会话模型");
    }
  } else if (p === "variables") body = variablePanel(selectedFloor(s));
  else if (p === "memory") body = memoryPanel(s);
  else if (p === "branches") body = branchPanel(s);
  else if (p === "live-tools")
    body = toolTable(s?.rounds.flatMap((f) => f.debug?.tools || []) || []);
  else if (p === "import") body = importPanel();
  $("mainView").innerHTML =
    `<section class="editor-shell"><div class="toolbar"><h1>${titles[p] || "会话工具权限"}</h1>${button("return", "返回试聊")}</div>${["variables", "memory", "branches", "live-tools"].includes(p) ? `<div class="actions">${button("refresh-management", "刷新")}</div>` : ""}${body}<p class="danger" id="managementError" role="alert"></p></section>`;
  document.querySelectorAll("[data-mf]").forEach(
    (e) =>
      (e.oninput = () => {
        if (management.form) management.form.dirty = true;
        if (e.dataset.mf === "transport")
          document
            .querySelectorAll("[data-transport-section]")
            .forEach(
              (n) => (n.hidden = n.dataset.transportSection !== e.value),
            );
      }),
  );
}
function toolTable(rows) {
  return table(
    ["调用 / 轮次", "工具 / 槽位", "状态 / 时间", "输入与输出"],
    rows.map((t) => [
      esc(t.id) + "<br>" + esc(t.floor_id),
      esc(t.tool_name) + " / " + esc(t.slot),
      esc(t.status) +
        "<br>" +
        esc(t.started_at || "") +
        "<br>" +
        esc(t.error || ""),
      detail({
        arguments: t.arguments,
        result: t.result,
        warnings: t.warnings,
      }),
    ]),
  );
}
function variablePanel(f) {
  const d = f?.debug;
  return (
    `<p>轮次：${esc(f?.id || "未选择")} · 页面：${esc(d?.pageId || "未记录")}</p><h2>解析后的变量</h2>` +
    table(
      ["名称", "值", "作用域", "来源"],
      (d?.variables || []).map((v) => [
        esc(v.key),
        esc(JSON.stringify(v.value)),
        esc(v.scope),
        detail(v.source),
      ]),
    ) +
    `<h2>变量暂存记录</h2>` +
    table(
      ["操作", "变量", "状态", "来源与证据"],
      (d?.stagedWrites || []).map((v) => [
        esc(v.op),
        esc(v.key),
        esc(v.status),
        detail(v),
      ]),
    ) +
    `<h2>变量跨作用域写入记录</h2>` +
    table(
      ["写入记录 ID", "状态", "目标作用域", "写入证据"],
      (d?.promotions || []).map((v) => [
        esc(v.id),
        esc(v.status),
        esc(v.scope),
        detail(v),
      ]),
    )
  );
}
function memoryPanel(s) {
  const rounds = s?.rounds || [],
    items = rounds.flatMap((f) => f.debug?.memories || []),
    jobs = rounds.flatMap((f) => f.debug?.jobs || []),
    scope = rounds.findLast((f) => f.debug?.scopeState)?.debug.scopeState;
  return (
    `<h2>记忆统计</h2>` +
    table(
      ["有效", "已弃用", "摘要", "事实", "未完成事项", "估算 Token"],
      [
        [
          items.filter((v) => v.status === "active").length,
          items.filter((v) => v.status === "deprecated").length,
          ...["summary", "fact", "open_loop"].map(
            (t) => items.filter((v) => v.type === t).length,
          ),
          "—",
        ],
      ],
    ) +
    `<h2>记忆处理进度</h2>` +
    (scope
      ? detail(scope, "查看修订、处理进度与租约")
      : "<p>尚无作用域状态记录。</p>") +
    `<h2>记忆条目</h2>` +
    table(
      ["类型 / 状态", "内容", "重要性 / 置信度", "来源与覆盖"],
      items.map((v) => [
        esc(v.type) + " / " + esc(v.status),
        esc(v.content),
        `${v.importance} / ${v.confidence}`,
        detail(v),
      ]),
    ) +
    `<h2>记忆任务</h2>` +
    table(
      ["任务", "状态", "尝试次数", "错误与时间"],
      jobs.map((j) => [
        esc(j.id),
        esc(j.status),
        `${j.attemptCount}/${j.maxAttempts}`,
        detail(j),
      ]),
    )
  );
}
function branchPanel(s) {
  if (!s) return "<p>请先选择会话。</p>";
  return (
    table(
      ["分支", "谱系 / 分叉轮次", "轮次 / 最新状态", "操作"],
      s.branches.map((b) => {
        const fs = s.rounds.filter((f) => f.branch_id === b.id);
        return [
          esc(b.id),
          esc(b.parent || "根分支") + " / " + esc(b.forkFloor || "—"),
          `${fs.length} / ${esc(fs.at(-1)?.state || "空")}`,
          button(
            "branch-select",
            s.activeBranch === b.id ? "当前分支" : "切换分支",
            b.id,
          ) +
            detail(
              {
                parent: b.parent,
                forkFloor: b.forkFloor,
                addedFloors: fs.map((f) => f.id),
                inheritedMessages: b.inherited || [],
              },
              "查看分支差异",
            ),
        ];
      }),
    ) +
    `<h2>历史提示词组装记录</h2>` +
    table(
      ["轮次 / 分支", "提示词摘要", "Token / 诊断 / 分段", "详情"],
      s.rounds.map((f) => [
        esc(f.id) + " / " + esc(f.branch_id),
        esc(f.debug?.explain?.digest || "未记录"),
        `${f.debug?.explain?.tokenEstimate ?? "—"} / ${f.debug?.explain?.diagnostics?.length ?? 0} / ${f.debug?.explain?.sections?.length ?? 0}`,
        button("explain-open", "查看提示词组装记录", f.id),
      ]),
    ) +
    `<h2>会话操作日志</h2>` +
    table(
      ["时间", "操作", "轮次", "差异"],
      s.operationLogs.map((o) => [
        new Date(o.at).toLocaleTimeString(),
        esc(o.action),
        esc(o.floor_id),
        detail(o.detail),
      ]),
    )
  );
}
const generationView = { expanded: {} };
function generationStatus(value) {
  return (
    {
      committed: "已提交",
      generating: "生成中",
      running: "执行中",
      failed: "失败",
      completed: "已完成",
      success: "成功",
      error: "失败",
      timeout: "超时",
      succeeded: "已完成",
      queued: "排队中",
      cancelled: "已取消",
      canceled: "已取消",
      pending: "等待执行",
    }[value] ?? value
  );
}
function generationFields(rows) {
  return `<dl class="generation-fields">${rows.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value ?? "未记录")}</dd></div>`).join("")}</dl>`;
}
function generationText(value, missing = "") {
  if (!selectedFloor(getSession())) missing = "暂无生成记录。";
  return value == null
    ? missing
      ? `<p class="generation-missing">${missing}</p>`
      : ""
    : `<pre class="generation-text" tabindex="0">${esc(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>`;
}
function generationSection(key, title, content, initial = true) {
  if (!content) return "";
  const f = selectedFloor(getSession()),
    id = `${f?.id || "empty"}:${editor.tab}:${key}`;
  return `<details class="generation-section" data-generation-section="${esc(id)}" ${(generationView.expanded[id] ?? initial) ? "open" : ""}><summary><span>${title}</span><span class="generation-disclosure" aria-hidden="true">⌄</span></summary><div class="generation-section-body">${content}</div></details>`;
}
function generationStageResult(k, f, enabled) {
  if (!f) return generationText(null, "请先选择一条生成记录。");
  if (!enabled) return generationText(null, "本轮未启用此阶段。");
  if (k === "director") {
    const calls = (f.debug?.tools || []).filter((t) => t.slot === "director");
    return (
      generationSection(
        "director-output",
        "导演输出",
        generationText(f.debug?.stages?.director, ""),
      ) +
      generationSection(
        "director-tools",
        `导演工具调用 <small>${calls.length}</small>`,
        calls.length
          ? calls
              .map((t) =>
                generationSection(
                  "director-tool-" + t.id,
                  esc(t.tool_name),
                  generationFields([["执行状态", generationStatus(t.status)]]) +
                    `<div class="generation-pair"><section><h3>调用参数</h3>${generationText(t.arguments)}</section><section><h3>返回结果</h3>${generationText(t.result)}</section></div>`,
                ),
              )
              .join("")
          : generationText(null, "暂无导演工具调用记录。"),
      )
    );
  }
  if (k === "narrator")
    return generationSection(
      "narrator-result",
      "生成回复",
      generationText(
        f.result?.generated_text,
        f.state === "failed"
          ? "生成失败。请在“运行概览”查看错误并重试。"
          : f.state === "generating"
            ? "正在生成回复。"
            : "暂无回复。",
      ),
    );
  if (k === "verifier") {
    const v = f.debug?.stages?.verifier;
    return generationSection(
      "verifier-result",
      "校验结果",
      v
        ? generationFields([
            [
              "校验状态",
              {
                pending: "等待校验",
                passed: "通过",
                warned: "存在警告",
                blocked: "阻止提交",
                skipped: "已跳过",
              }[v.status] ?? v.status,
            ],
          ]) +
            (v.suggestion ? generationText(v.suggestion) : "") +
            (v.issues?.length
              ? table(
                  ["级别", "问题"],
                  v.issues.map((x) => [esc(x.severity), esc(x.description)]),
                )
              : "")
        : generationText(null, ""),
    );
  }
  const jobs = f.debug?.jobs || [];
  return generationSection(
    "memory-result",
    "记忆任务",
    jobs.length
      ? table(
          ["任务 ID", "状态", "尝试次数", "详情"],
          jobs.map((j) => [
            esc(j.id),
            esc(generationStatus(j.status)),
            `${j.attemptCount}/${j.maxAttempts}`,
            detail(j),
          ]),
        )
      : generationText(
          null,
          f.state === "failed" ? "暂无关联记忆任务。" : "暂无关联记忆任务。",
        ),
  );
}
function generationBody(s, f) {
  const active = editor.tab,
    d = f?.debug,
    run = f?.attempts.at(-1),
    explain = d?.explain;
  if (active === "overview")
    return (
      generationSection(
        "input",
        "用户输入",
        generationText(f?.input, "请选择一条已发送的消息。"),
      ) +
      generationSection(
        "result",
        "生成回复",
        generationFields([
          ["提交状态", generationStatus(f?.state)],
          ["回复 ID", f?.result?.assistant_message_id],
        ]) +
          generationText(
            f?.result?.generated_text,
            f?.state === "generating" ? "正在生成回复。" : "暂无回复。",
          ),
      ) +
      generationSection(
        "execution",
        "执行情况",
        generationFields([
          ["开始时间", run ? new Date(run.started_at).toLocaleString() : null],
          [
            "结束时间",
            run?.ended_at ? new Date(run.ended_at).toLocaleString() : null,
          ],
          [
            "耗时",
            run?.ended_at ? `${run.ended_at - run.started_at} ms` : null,
          ],
          ["输入 Token", f?.result?.usage?.input_tokens],
          ["输出 Token", f?.result?.usage?.output_tokens],
        ]) +
          (run?.error
            ? `<div class="generation-error"><strong>${esc(run.error.code)}</strong><p>${esc(run.error.message)}</p>${s?.failed && s.status === "active" && f === s.rounds.at(-1) ? '<button data-action="retry">重试这次生成</button>' : ""}</div>`
            : ""),
      ) +
      generationSection(
        "attempts",
        `执行尝试 <small>${f?.attempts.length ?? 0}</small>`,
        f?.attempts.length
          ? f.attempts
              .map((a, i) =>
                generationSection(
                  "attempt-" + a.id,
                  `第 ${a.attempt_no ?? i + 1} 次 · ${esc(generationStatus(a.state))}`,
                  generationFields([
                    ["执行 ID", a.id],
                    ["开始", new Date(a.started_at).toLocaleString()],
                    [
                      "结束",
                      a.ended_at ? new Date(a.ended_at).toLocaleString() : null,
                    ],
                  ]) +
                    generationText(
                      a.error,
                      a.state === "completed" ? "已完成。" : "",
                    ),
                  false,
                ),
              )
              .join("")
          : '<p class="generation-missing">暂无执行记录。</p>',
      )
    );
  if (active === "prompt")
    return (
      generationSection(
        "assembled",
        "组装后的提示词",
        generationFields([
          ["模式", f?.promptMode],
          ["提示词摘要", explain?.digest],
          ["估算 Token", explain?.tokenEstimate],
        ]) +
          (explain?.messages?.length
            ? explain.messages
                .map((m, i) =>
                  generationSection(
                    "message-" + i,
                    `${i + 1} · ${esc(m.role)}`,
                    generationText(m.content),
                  ),
                )
                .join("")
            : generationText(null, "")),
      ) +
      generationSection(
        "character",
        "角色内容",
        generationFields([
          ["角色", f ? getResource(f.config.character?.id)?.name : null],
          ["版本", f?.config.character?.version],
        ]) + generationText(f?.snapshot.character?.description),
      ) +
      generationSection(
        "preset",
        "预设条目",
        f?.snapshot.preset?.entries?.length
          ? f.snapshot.preset.entries
              .map((p, i) =>
                generationSection(
                  "preset-" + i,
                  `${esc(p.name || p.identifier || "未命名条目")} <small>${p.enabled ? "启用" : "停用"}</small>`,
                  generationFields([
                    ["角色", p.role],
                    ["插入位置", p.injection_position],
                    ["深度", p.injection_depth],
                    ["顺序", p.injection_order],
                  ]) + generationText(p.content),
                  false,
                ),
              )
              .join("")
          : generationText(null, ""),
      ) +
      generationSection(
        "worldbook",
        "世界书条目",
        generationSection(
          "worldbook-activated",
          "本轮已激活条目",
          generationText(
            f?.apiResponses?.find(
              (r) =>
                r.route === "/floors/{id}/prompt-runtime/explain" &&
                r.status === 200,
            )?.body.data.prompt_snapshot.worldbook_activated_entries,
          ),
        ) +
          (f?.snapshot.worldbook?.entries?.length
            ? f.snapshot.worldbook.entries
                .map((w, i) =>
                  generationSection(
                    "worldbook-" + i,
                    esc(w.comment || w.name || `条目 ${i + 1}`),
                    generationFields([
                      ["关键词", w.key],
                      ["插入位置", w.position],
                      ["深度", w.depth],
                      ["排序", w.order],
                    ]) + generationText(w.content),
                    false,
                  ),
                )
                .join("")
            : generationText(null, "")),
        false,
      ) +
      generationSection(
        "explain",
        "组装、来源与裁剪",
        generationSection(
          "sections",
          "分段与来源",
          generationText(explain?.sections),
          false,
        ) +
          generationSection(
            "diagnostics",
            "诊断",
            generationText(explain?.diagnostics),
            false,
          ) +
          generationSection(
            "trim",
            "裁剪原因",
            generationText(explain?.trimReasons),
            false,
          ) +
          generationSection(
            "excluded",
            "排除的来源",
            generationText(explain?.excludedSources),
            false,
          ),
        false,
      ) +
      generationSection(
        "regex",
        "正则配置",
        generationText(f?.snapshot.regex),
        false,
      )
    );
  if (active === "stages")
    return ["director", "narrator", "verifier", "memory"]
      .map((k) => {
        const runtime = f?.config.runtime,
          enabled =
            k === "narrator" ||
            runtime?.turn[
              {
                director: "enableDirector",
                verifier: "enableVerifier",
                memory: "enableMemoryConsolidation",
              }[k]
            ],
          model = runtime?.resolved?.[k];
        return generationSection(
          k,
          `${slotLabels[k]} <small>${f ? (enabled ? "已启用" : "未启用") : "未选择生成记录"}</small>`,
          generationFields([
            ["Profile", model?.profile_id],
            ["Provider", model?.provider],
            ["模型", model?.model_id],
            ["配置来源", model?.source],
          ]) +
            generationSection(
              k + "-params",
              "生成参数",
              generationText(model?.params),
              false,
            ) +
            generationStageResult(k, f, enabled),
        );
      })
      .join("");
  if (active === "processing") {
    const message = s?.messages.find(
      (m) => m.id === f?.result?.assistant_message_id,
    );
    if (!message) return generationText(null, "暂无回复。");
    const display = messageDisplay(s, message);
    return (
      generationSection(
        "stored-text",
        "后端保存的回复",
        generationText(message.text),
      ) +
      generationSection(
        "display-rules",
        "显示正则执行顺序",
        table(
          ["顺序", "规则", "执行结果"],
          display.scripts.map((r, i) => [
            i + 1,
            esc(r.scriptName),
            r.disabled
              ? "已停用"
              : !r.placement.includes(2)
                ? "不用于回复"
                : display.trace.matchedRuleNames.includes(r.scriptName)
                  ? "已替换"
                  : esc(
                      regexReasons[
                        display.trace.skippedRules.find(
                          (x) => x.ruleName === r.scriptName,
                        )?.reason
                      ] || "未执行",
                    ),
          ]),
        ),
      ) +
      generationSection(
        "display-variables",
        "本轮状态变量",
        generationText(display.variables),
      ) +
      generationSection(
        "display-text",
        "正则处理后的 Markdown",
        generationText(display.text),
      ) +
      generationSection(
        "display-rendered",
        "聊天显示效果",
        `<div class="markdown-block">${mdText(display.text)}</div>`,
      )
    );
  }
  if (active === "tools")
    return generationSection(
      "calls",
      `工具调用 <small>${d?.tools?.length ?? 0}</small>`,
      d?.tools?.length
        ? d.tools
            .map((t, i) =>
              generationSection(
                "call-" + (t.id || i),
                `${esc(t.tool_name)} <small>${esc(generationStatus(t.status))}</small>`,
                generationFields([
                  ["调用 ID", t.id],
                  ["执行槽位", t.slot],
                  ["开始时间", t.started_at],
                  ["结束时间", t.ended_at],
                ]) +
                  `<div class="generation-pair"><section><h3>调用参数</h3>${generationText(t.arguments)}</section><section><h3>返回结果</h3>${generationText(t.result)}</section></div>` +
                  generationSection(
                    "call-errors-" + i,
                    "执行错误",
                    generationText(t.error || t.warnings, ""),
                    false,
                  ),
              ),
            )
            .join("")
        : generationFields([
            [
              "工具开关",
              f
                ? f.config.runtime.turn.enableTools
                  ? "已启用"
                  : "未启用"
                : null,
            ],
            ["调用 ID", null],
            ["执行槽位", null],
          ]) +
            `<div class="generation-pair"><section><h3>调用参数</h3>${generationText(null, "无调用参数。")}</section><section><h3>返回结果</h3>${generationText(null, "无执行结果。")}</section></div>`,
    );
  if (active === "state")
    return (
      generationSection("variables", "变量与写入", variablePanel(f)) +
      generationSection(
        "memory",
        "记忆与维护任务",
        memoryPanel(s ? { ...s, rounds: f ? [f] : [] } : null),
      )
    );
  if (active === "history")
    return (
      generationSection(
        "events",
        "本次生成事件",
        f?.events.length
          ? `<ol class="generation-timeline">${f.events.map((e) => `<li><time>${new Date(e.at).toLocaleTimeString()}</time><p>${esc(e.message)}</p></li>`).join("")}</ol>`
          : generationText(null, ""),
      ) + generationSection("branches", "会话分支与操作日志", branchPanel(s))
    );
  return (
    generationSection(
      "identity",
      "记录标识",
      generationFields([
        ["会话 ID", s?.id],
        ["楼层 ID", f?.id],
        ["分支 ID", f?.branch_id],
        ["配置修订", f?.revision],
      ]),
    ) +
    generationSection(
      "raw-run",
      "运行记录",
      generationText(
        f?.apiResponses?.find((r) => r.route === "/floors/{id}/run")?.body ??
          f?.attempts,
      ),
    ) +
    generationSection(
      "raw-result",
      "提交结果",
      generationText(
        f?.apiResponses?.find((r) => r.route === "/floors/{id}/result")?.body ??
          f?.result,
      ),
    ) +
    generationSection(
      "raw-responses",
      "接口响应",
      generationText(f?.apiResponses),
      false,
    )
  );
}
renderDebugger = () => {
  document.body.classList.add("generation-focused");
  const s = sessionState(getSession()),
    f = selectedFloor(s),
    index = s?.rounds.indexOf(f) ?? -1;
  $("mainView").innerHTML =
    `<section class="generation-detail"><header class="generation-header"><div><div class="small">${esc(s?.name || "试聊")} / 生成记录</div><h1>${f ? `第 ${f.no} 轮 · 生成详情` : "生成详情"}</h1></div><button data-action="back-trial">返回试聊</button></header><div class="generation-context"><label class="field">对应消息<select data-debug-select ${f ? "" : "disabled"}>${s?.rounds.length ? s.rounds.map((r) => `<option value="${r.id}" ${r.id === f?.id ? "selected" : ""}>第 ${r.no} 轮 · ${esc(r.input.slice(0, 42))}</option>`).join("") : "<option>尚无已发送消息</option>"}</select></label><div class="actions"><button data-debug-floor="${s?.rounds[index - 1]?.id || ""}" ${index > 0 ? "" : "disabled"}>上一条</button><button data-debug-floor="${s?.rounds[index + 1]?.id || ""}" ${index >= 0 && index < s.rounds.length - 1 ? "" : "disabled"}>下一条</button><button data-action="refresh-debug">刷新记录</button></div></div><div class="generation-status"><span>${f ? esc({ committed: "已提交", generating: "生成中", failed: "生成失败" }[f.state] || f.state) : "等待发送消息"}</span><span>分支 ${esc(f?.branch_id || "—")}</span><span>配置修订 ${f?.revision ?? "—"}</span><span>${f?.attempts.length ?? 0} 次执行</span></div><div class="generation-layout"><nav class="generation-nav" aria-label="生成记录类别">${Object.entries(
      debugTabs,
    )
      .map(
        ([key, label]) =>
          `<button data-debug-tab="${key}" aria-selected="${editor.tab === key}" class="${editor.tab === key ? "active" : ""}">${label}</button>`,
      )
      .join(
        "",
      )}</nav><div class="generation-content"><div class="generation-content-header"><h2>${debugTabs[editor.tab]}</h2><div class="actions"><button data-generation-expand="true">全部展开</button><button data-generation-expand="false">全部收起</button></div></div>${generationBody(s, f)}</div></div></section>`;
  document.querySelectorAll("[data-generation-section]").forEach((node) =>
    node.addEventListener("toggle", () => {
      generationView.expanded[node.dataset.generationSection] = node.open;
    }),
  );
};
document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-generation-expand]");
  if (!button) return;
  document.querySelectorAll("[data-generation-section]").forEach((node) => {
    node.open = button.dataset.generationExpand === "true";
    generationView.expanded[node.dataset.generationSection] = node.open;
  });
});
library = (kind, mode = "manage") => {
  originalLibrary(kind, mode);
  renderLibraryRows();
  $("libraryActions").insertAdjacentHTML(
    "beforeend",
    `<div class="toolbar"><label>搜索资源名称<input id="resourceSearch" value="${esc(management.search)}"></label><label>资源排序<select id="resourceSort"><option value="updated">最近更新</option><option value="name">名称</option></select></label><label>资源状态<select id="resourceStatus"><option value="active">可用</option><option value="disabled">停用</option><option value="deleted">已删除</option><option value="all">全部</option></select></label><label><input type="checkbox" id="resourceFavorites" ${management.favoriteOnly ? "checked" : ""}>仅收藏</label></div>`,
  );
  $("resourceSort").value = management.sort;
  $("resourceStatus").value = management.resourceStatus;
  $("resourceSearch").oninput = (e) => {
    management.search = e.target.value;
    renderLibraryRows();
  };
  $("resourceSort").onchange = (e) => {
    management.sort = e.target.value;
    renderLibraryRows();
  };
  $("resourceStatus").onchange = (e) => {
    management.resourceStatus = e.target.value;
    renderLibraryRows();
  };
  $("resourceFavorites").onchange = (e) => {
    management.favoriteOnly = e.target.checked;
    renderLibraryRows();
  };
};
function renderLibraryRows() {
  const kind = libraryKind,
    mode = libraryMode;
  const rows = resources
    .filter(
      (r) =>
        r.kind === kind &&
        r.name.toLowerCase().includes(management.search.toLowerCase()) &&
        (!management.favoriteOnly || r.favorite) &&
        (management.resourceStatus === "all" ||
          (management.resourceStatus === "deleted"
            ? r.deleted
            : management.resourceStatus === "disabled"
              ? !r.deleted && r.versions.at(-1).status === "disabled"
              : !r.deleted && r.versions.at(-1).status !== "disabled")),
    )
    .sort((a, b) =>
      management.sort === "name"
        ? a.name.localeCompare(b.name)
        : (b.updatedAt || b.versions.length) -
          (a.updatedAt || a.versions.length),
    );
  $("libraryItems").innerHTML =
    rows
      .map(
        (r) =>
          `<div class="resource-card"><div class="row"><strong>${esc(r.name)}</strong><span>${r.deleted ? "已删除" : versionLabel(kind, r.versions.length)}</span></div><div class="actions">${button("favorite", r.favorite ? "取消收藏" : "收藏", r.id)}${r.deleted ? (kind === "character" ? button("resource-restore", "恢复角色卡", r.id) : "<span>已删除</span>") : mode === "pick" ? `<button data-pick="${r.id}">选择</button>` : `<button data-edit="${r.id}">编辑</button><button data-copy="${r.id}">复制</button>${!["model", "persona"].includes(kind) ? `<button data-export="${r.id}">导出</button>` : ""}<button data-remove="${r.id}">删除</button>`}</div></div>`,
      )
      .join("") ||
    '<p class="empty">没有符合条件的资源，请调整搜索和筛选。</p>';
}
function externalToDocument(kind, raw) {
  if (kind === "preset") {
    if (!Array.isArray(raw.prompts)) throw Error("缺少 prompts 数组。");
    const order =
        raw.prompt_order?.find((x) => x.character_id === 100001)?.order || [],
      entries = order
        .map((o) => {
          const p = raw.prompts.find((p) => p.identifier === o.identifier);
          return p ? { ...p, enabled: o.enabled } : null;
        })
        .filter(Boolean);
    return {
      ...raw,
      entries: [
        ...entries,
        ...raw.prompts.filter(
          (p) => !entries.some((x) => x.identifier === p.identifier),
        ),
      ],
    };
  }
  if (kind === "worldbook") {
    if (!raw.entries || typeof raw.entries !== "object")
      throw Error("缺少 entries。");
    return {
      ...raw,
      entries: Object.values(raw.entries).map((x) => ({
        ...x,
        key: Array.isArray(x.key) ? x.key.join(",") : x.key || "",
        keysecondary: Array.isArray(x.keysecondary)
          ? x.keysecondary.join(",")
          : x.keysecondary || "",
      })),
    };
  }
  if (kind === "regex") {
    if (!Array.isArray(raw)) throw Error("正则文件必须是规则数组。");
    return {
      entries: raw.map((x) => ({
        ...x,
        placement: Array.isArray(x.placement)
          ? x.placement.join(",")
          : String(x.placement ?? ""),
      })),
    };
  }
  const data = raw.data || raw;
  if (typeof data.description !== "string")
    throw Error("角色卡缺少 description。");
  return data;
}
async function precheckImport(files, kind) {
  management.importKind = kind;
  management.importRows = [];
  for (const file of files) {
    const row = { fileName: file.name, status: "检查中", selected: true };
    management.importRows.push(row);
    renderManagement();
    try {
      let raw;
      if (kind === "regex") raw = JSON.parse(await file.text());
      else {
        const r = await AssetImport.validateAssetImportFile(kind, file);
        if (!r.ok)
          throw Error(
            importErrorLabels[r.reason] || "文件读取失败，请检查格式。",
          );
        raw = r.payload;
      }
      row.doc = externalToDocument(kind, raw);
      row.name = row.doc.name || file.name.replace(/\.(json|png|webp)$/i, "");
      row.status = "可导入";
    } catch (e) {
      row.status = "失败";
      row.error = e.message;
      row.selected = false;
    }
    renderManagement();
  }
}
const importErrorLabels = {
  errorCharacterImageUnsupported: "角色卡仅支持 JSON、PNG、WebP。",
  errorCharacterMetadataMissing: "图片没有角色卡元数据，请选择角色卡图片。",
  errorCharacterMetadataParse: "角色卡元数据格式错误，请重新导出角色卡后导入。",
  errorFileRead: "文件读取失败，请重新选择。",
  errorJsonObjectExpected: "JSON 顶层必须是对象。",
  errorJsonParse: "JSON 格式错误，请修正后重新选择文件。",
  errorUnsupportedFormat: "此资源仅支持 JSON。",
};
function importPanel() {
  return (
    `<div class="actions">${button("import-files", "选择文件")}${button("import-commit", "导入选中资源", "", !management.importRows.some((r) => r.selected && r.status === "可导入"))}</div>` +
    table(
      ["选择", "文件", "状态", "结果"],
      management.importRows.map((r, i) => [
        `<input type="checkbox" data-import-row="${i}" ${r.selected ? "checked" : ""} ${r.status !== "可导入" ? "disabled" : ""}>`,
        esc(r.fileName),
        esc(r.status),
        esc(r.error || r.resourceId || ""),
      ]),
    ) +
    `<p>已完成 ${management.importRows.filter((r) => r.status === "已导入").length} / ${management.importRows.length} 个文件</p>`
  );
}
function runtimeSource(scope) {
  return scope === "global"
    ? management.globalRuntime
    : scope === "session"
      ? sessionState(getSession())?.runtimeOverride ||
        sessionState(getSession())?.config.runtime ||
        management.globalRuntime
      : draft.runtime;
}
openRuntime = () => openRuntimeScope("application");
function openRuntimeScope(scope) {
  if (scope === "session" && !getSession()) {
    notify("请先选择会话，再调整会话模型。");
    return;
  }
  leaveEditor(() => {
    management.runtimeScope = scope;
    editor = {
      kind: "runtime",
      doc: clone(runtimeSource(scope)),
      slot: "narrator",
      errors: {},
    };
    renderRuntime();
  });
}
renderRuntime = () => {
  originalRuntime();
  const section = $("mainView").querySelector(".editor-shell");
  section.insertAdjacentHTML(
    "afterbegin",
    `<label class="field">配置应用到<select id="runtimeScope"><option value="application">角色应用草稿</option><option value="global">全局默认</option><option value="session">当前会话</option></select></label><p>当前来源：${management.runtimeScope === "session" ? (getSession()?.runtimeOverride ? "会话覆盖" : getSession()?.runtimeOrigin === "global" ? "全局默认" : "角色应用快照") : management.runtimeScope === "global" ? "全局默认" : "角色应用草稿"}</p>`,
  );
  $("runtimeScope").value = management.runtimeScope;
  $("runtimeScope").onchange = (e) => openRuntimeScope(e.target.value);
  section.insertAdjacentHTML(
    "beforeend",
    `<div class="actions">${button("slot-unbind", "解绑当前槽位")}${button("params-reset", "重置参数")}<label>预设参数<select id="runtimePreset">${resources
      .filter((r) => r.kind === "preset" && !r.deleted)
      .map((r) => `<option value="${r.id}">${esc(r.name)}</option>`)
      .join(
        "",
      )}</select></label>${button("params-preset", "从预设导入参数")}${button("runtime-refresh", "重新读取配置")}${management.runtimeScope === "session" ? button("runtime-inherit", "沿用全局默认") : ""}</div>`,
  );
  const save = document.querySelector('[data-action="save-runtime"]');
  save.textContent =
    management.runtimeScope === "application"
      ? "应用到角色草稿"
      : management.runtimeScope === "global"
        ? "保存全局默认"
        : "保存会话覆盖";
  if (management.runtimeScope !== "application") {
    section.querySelector("p.small").textContent =
      "保存后对所选作用域的后续轮次生效。";
  }
};
function saveRuntimeScope() {
  if (
    !Number.isInteger(editor.doc.turn.maxRetries) ||
    editor.doc.turn.maxRetries < 0 ||
    editor.doc.turn.maxRetries > 5
  ) {
    notify("校验重试次数应为 0 到 5 的整数。");
    return;
  }

  if (
    Object.keys(editor.errors).length ||
    Object.values(editor.doc.slots).some(
      (x) => !schemaAccepts(x.params, runtimeParamSchema),
    )
  ) {
    notify("请修正生成参数和 JSON 格式后保存。");
    return;
  }
  const data = clone(editor.doc);
  data.resolved = snapshotSlots(data.slots);
  if (management.runtimeScope === "global") management.globalRuntime = data;
  else {
    const s = sessionState(getSession());
    if (s.running) {
      notify("请等待本轮生成完成后修改会话模型。");
      return;
    }
    s.runtimeOverride = data;
    s.runtimeOrigin = "session";
    s.config.runtime = clone(data);
    const r = getResource(data.resolved.narrator.profile_id);
    s.config.model = r ? { id: r.id, version: r.versions.length } : null;
    operation(s, "保存会话模型", { slots: data.slots });
  }
  editor = null;
  render();
  notify("模型配置已保存。");
}

function availableTools(s) {
  return management.tools
    .filter(
      (t) =>
        t.enabled &&
        (!s || s.permissions.enabled !== false) &&
        (!s ||
          s.permissions.allowIrreversible !== false ||
          t.sideEffectLevel !== "irreversible"),
    )
    .map((t) => ({
      ...t,
      allowedSlots: t.allowedSlots.filter((slot) => {
        const allow = s?.permissions.slotAllowList?.[slot],
          deny = s?.permissions.slotDenyList?.[slot] || [];
        return (!allow || allow.includes(t.name)) && !deny.includes(t.name);
      }),
    }))
    .filter((t) => t.allowedSlots.length);
}
function saveManager() {
  const f = management.form,
    d = readForm();
  if (!d.name.trim()) throw Error("请填写名称。");
  if (f.kind === "tool") {
    if (
      !Array.isArray(d.allowedSlots) ||
      d.allowedSlots.some(
        (x) => !["narrator", "director", "verifier", "memory"].includes(x),
      )
    )
      throw Error(
        "允许槽位必须是 narrator、director、verifier、memory 组成的数组。",
      );
    for (const k of ["parameters", "handler"])
      if (!d[k] || typeof d[k] !== "object" || Array.isArray(d[k]))
        throw Error(`${k} 必须是 JSON 对象。`);
    if (management.tools.some((x) => x.name === d.name && x.id !== f.id))
      throw Error("工具名称已存在，请使用其他名称。");
  } else {
    for (const k of [
      "connectTimeoutMs",
      "callTimeoutMs",
      "toolRefreshIntervalMs",
    ])
      if (!Number.isInteger(d[k]) || d[k] <= 0)
        throw Error("超时与刷新间隔必须是正整数。");
    if (d.transport === "http") {
      let url;
      try {
        url = new URL(d.httpUrl);
      } catch {
        throw Error("请输入有效的 HTTP 地址。");
      }
      if (!["http:", "https:"].includes(url.protocol))
        throw Error("地址必须使用 HTTP 或 HTTPS。");
    }
    if (d.transport === "stdio" && !d.stdioCommand.trim())
      throw Error("请填写 stdio 启动命令。");
    if (
      !Array.isArray(d.stdioArgs) ||
      d.stdioArgs.some((x) => typeof x !== "string")
    )
      throw Error("启动参数必须是字符串数组。");
    for (const key of ["httpHeaders", "stdioEnv"])
      if (
        !d[key] ||
        Array.isArray(d[key]) ||
        typeof d[key] !== "object" ||
        Object.values(d[key]).some((x) => typeof x !== "string")
      )
        throw Error("Headers 和环境变量必须是字符串键值对象。");
    // Retain only masked credentials in the local prototype.
    for (const key of ["httpHeaders", "stdioEnv"]) {
      const mask = key + "Masked";
      d[mask] = Object.keys(d[key]).length
        ? Object.fromEntries(Object.keys(d[key]).map((k) => [k, "••••••"]))
        : f.data[mask] || {};
      d[key] = {};
    }
    d.status = "disconnected";
    d.tools = [];
  }
  const list = f.kind === "tool" ? management.tools : management.servers,
    record = { ...d, id: f.id || `${f.kind}-${nextId++}` };
  const i = list.findIndex((x) => x.id === record.id);
  if (i < 0) list.push(record);
  else list[i] = record;
  management.page = f.kind === "tool" ? "tools" : "mcp";
  management.form = null;
  renderManagement();
  notify("配置已保存。");
}
function accountSwitch(id) {
  if (sessions.some((s) => s.running)) {
    notify("请等待当前账号的生成结束后切换账号。");
    return;
  }
  leaveEditor(() => {
    management.accounts[management.account] = {
      resources,
      saved,
      draft,
      releases,
      activeRelease,
      sessions,
      selected,
      revision,
      agentTypes,
      agentBindings,
      agentJobs,
      tools: management.tools,
      servers: management.servers,
      globalRuntime: management.globalRuntime,
      events: management.events,
    };
    const v = management.accounts[id] || {
      ...clone(managementInitial),
      activeRelease: 1,
      sessions: [],
      selected: null,
      revision: 1,
      agentJobs: [],
      tools: [],
      servers: [],
      events: [],
    };
    ({
      resources,
      saved,
      draft,
      releases,
      activeRelease,
      sessions,
      selected,
      revision,
      agentTypes,
      agentBindings,
      agentJobs,
    } = v);
    management.tools = v.tools;
    management.servers = v.servers;
    management.events = v.events;
    management.globalRuntime = v.globalRuntime;
    management.account = id;
    $("accountSelect").value = id;
    render();
    notify("已切换账号。");
  });
}
// Restored actions are captured before the original prototype handlers.
document.addEventListener(
  "click",
  (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    let action = d.r;
    if (d.action === "import") {
      action = "import";
    }
    if (
      d.action === "save-runtime" &&
      management.runtimeScope !== "application"
    ) {
      e.stopImmediatePropagation();
      saveRuntimeScope();
      return;
    }
    if (d.remove && getResource(d.remove)?.kind === "character") {
      e.stopImmediatePropagation();
      const r = getResource(d.remove);
      ask(`删除“${r.name}”？`, "角色卡将移入已删除列表，可以恢复。", () => {
        r.deleted = true;
        library("character");
        notify("角色卡已移入已删除列表。");
      });
      return;
    }
    if (
      d.remove &&
      getResource(d.remove)?.kind === "model" &&
      !references(d.remove).length
    ) {
      e.stopImmediatePropagation();
      const r = getResource(d.remove);
      ask(
        "删除这个 LLM Profile？",
        "删除后保留在已删除列表，无法用于新绑定。",
        () => {
          r.deleted = true;
          r.versions.at(-1).status = "deleted";
          library("model");
          notify("LLM Profile 已删除。");
        },
      );
      return;
    }
    if (!action) return;
    e.stopImmediatePropagation();
    const s = sessionState(getSession()),
      id = d.id;
    try {
      if (
        [
          "tools",
          "mcp",
          "variables",
          "memory",
          "branches",
          "live-tools",
        ].includes(action)
      )
        openManagement(action);
      if (action === "return") leaveEditor(() => render());
      if (action === "refresh-management") {
        renderManagement();
        notify("已刷新当前记录。");
      }
      if (action === "tool-new") openManagerForm("tool");
      if (action === "mcp-new") openManagerForm("mcp");
      if (action === "tool-edit") openManagerForm("tool", id);
      if (action === "mcp-edit") openManagerForm("mcp", id);
      if (action === "manager-save") saveManager();
      if (action === "permissions" && s)
        openManagement(
          "permissions",
          () =>
            (management.form = {
              data: clone(s.permissions),
              dirty: false,
            }),
        );
      if (action === "permissions-save") {
        if (s.running) throw Error("请等待生成完成后修改工具权限。");
        const values = readForm();
        for (const k of ["maxCallsPerTurn", "maxStepsPerGeneration"])
          if (!Number.isInteger(values[k]) || values[k] < 1)
            throw Error("工具调用与步骤上限必须是正整数。");
        for (const k of ["slotAllowList", "slotDenyList"])
          if (
            !values[k] ||
            Array.isArray(values[k]) ||
            typeof values[k] !== "object" ||
            Object.values(values[k]).some(
              (v) => !Array.isArray(v) || v.some((x) => typeof x !== "string"),
            )
          )
            throw Error("槽位列表必须是字符串数组组成的 JSON 对象。");
        for (const k of ["enabled", "allowIrreversible"])
          values[k] = values[k] === "inherit" ? null : values[k] === "true";
        s.permissions = values;
        management.form = null;
        management.page = "tools";
        operation(s, "保存工具权限", values);
        renderManagement();
      }
      if (action === "tool-toggle") {
        const t = management.tools.find((x) => x.id === id);
        t.enabled = !t.enabled;
        renderManagement();
        notify(t.enabled ? "工具已启用。" : "工具已停用。");
      }
      if (action === "tool-delete" || action === "mcp-delete") {
        const list =
          action === "tool-delete" ? management.tools : management.servers;
        ask("删除此配置？", "确认删除此配置？", () => {
          list.splice(
            list.findIndex((x) => x.id === id),
            1,
          );
          renderManagement();
          notify("配置已删除。");
        });
      }
      if (
        action.startsWith("mcp-") &&
        ["mcp-toggle", "mcp-connect", "mcp-disconnect", "mcp-test"].includes(
          action,
        )
      ) {
        const v = management.servers.find((x) => x.id === id);
        v.error = null;
        if (action === "mcp-toggle") {
          v.enabled = !v.enabled;
          if (!v.enabled) v.status = "disconnected";
        }
        if (action === "mcp-disconnect") v.status = "disconnected";
        if (action === "mcp-connect" || action === "mcp-test") {
          const failed = false;
          v.test = {
            source: "local",
            success: !failed,
            checkedAt: Date.now(),
            tools: [],
            error: failed ? "连接超时，请检查地址或启动命令后重试。" : null,
          };
          if (failed) {
            v.error = v.test.error;
            v.status = "error";
          } else if (action === "mcp-connect") v.status = "connected";
        }
        renderManagement();
        notify("服务器状态已更新。");
      }
      if (action === "message-edit") startMessageEdit(id);
      if (action === "message-regenerate-edit") startMessageEdit(id, true);
      if (action === "message-regenerate")
        ask("重新生成这条回复？", "重新生成将创建新分支。", () => {
          const message = s.messages.find((m) => m.id === id),
            floor = s.rounds.find((f) => f.id === message.floorId),
            blocking = floor?.debug?.blockingExecutions || [];
          if (blocking.length)
            ask(
              "确认重放操作？",
              "本轮有需要确认的操作：" +
                blocking.map((x) => x.toolName).join("、") +
                "。确认后重新生成。",
              () => regenerateMessage(id),
            );
          else regenerateMessage(id);
        });
      if (action === "message-save") {
        const value = readForm().text;
        if (!value.trim()) throw Error("消息内容不能为空。");
        const f = management.form,
          m = s.messages.find((x) => x.id === f.id);
        if (f.regenerate) {
          management.form = null;
          regenerateMessage(m.id, value);
        } else {
          const before = m.text;
          m.text = value;
          const floor = s.rounds.find((floor) => floor.id === m.floorId);
          if (m.role === "user" && floor?.state === "failed")
            floor.input = value;
          operation(s, "编辑消息", {
            messageId: m.id,
            before,
            after: value,
          });
          management.form = null;
          management.page = null;
          editor = null;
          render();
        }
      }
      if (action === "message-delete") {
        if (s.running) return;
        ask("删除这条消息？", "确认删除这条消息？", () => {
          s.messages = s.messages.filter((m) => m.id !== id);
          operation(s, "删除消息", { messageId: id });
          render();
        });
      }
      if (action === "session-config") {
        if (!s) throw Error("请先选择会话。");
        openManagement(
          "session-config",
          () =>
            (management.form = {
              data: {
                ...clone(s.config),
                worldbooks: clone(s.worldbooks),
              },
              dirty: false,
            }),
        );
      }
      if (action === "session-save") {
        if (s.running) throw Error("请等待本轮生成结束后修改配置。");
        const data = readForm(),
          before = clone(s.config);
        for (const k of Object.keys(labels).filter(
          (k) => !["model", "worldbook"].includes(k),
        )) {
          const [id, version] = data[k].split(":");
          s.config[k] = id ? { id, version: Number(version) } : null;
        }
        s.worldbooks = resources
          .filter((r) => r.kind === "worldbook" && data["wb:" + r.id])
          .map((r) => ({
            id: r.id,
            version: Number(data["wv:" + r.id]),
          }));
        s.config.worldbook = s.worldbooks[0] || null;
        s.promptMode = data.promptMode === "inherit" ? null : data.promptMode;
        operation(s, "保存会话配置", {
          before,
          after: s.config,
          worldbooks: s.worldbooks,
          promptMode: s.promptMode,
        });
        management.form = null;
        editor = null;
        management.page = null;
        render();
        notify("本会话配置已保存，后续轮次使用新配置。");
      }
      if (action === "runtime-session") openRuntimeScope("session");
      if (action === "runtime-inherit") {
        if (s.running) throw Error("请等待本轮生成结束后修改会话模型。");
        s.runtimeOverride = null;
        s.runtimeOrigin = "global";
        s.config.runtime = clone(management.globalRuntime);
        operation(s, "会话模型改为沿用全局默认", {});
        editor = null;
        render();
      }

      if (action === "slot-unbind") {
        editor.doc.slots[editor.slot].preset_id = null;
        renderRuntime();
      }
      if (action === "params-reset") {
        editor.doc.slots[editor.slot].params = {};
        renderRuntime();
      }
      if (action === "params-preset") {
        const r = getResource($("runtimePreset").value);
        if (!r) throw Error("请先选择预设。");
        const params = PresetParams.extractPresetGenerationParams(
          r.versions.at(-1),
        );
        if (!Object.keys(params).length)
          throw Error("此预设没有可导入的生成参数，请选择其他预设。");
        editor.doc.slots[editor.slot].params = {
          ...editor.doc.slots[editor.slot].params,
          ...params,
        };
        renderRuntime();
        notify("预设参数已写入表单，请保存配置。");
      }
      if (action === "runtime-refresh")
        openRuntimeScope(management.runtimeScope);
      if (action === "favorite") {
        const r = getResource(id);
        r.favorite = !r.favorite;
        renderLibraryRows();
      }
      if (action === "resource-restore") {
        getResource(id).deleted = false;
        renderLibraryRows();
        notify("角色卡已恢复。");
      }
      if (action === "branch-select") {
        if (s.running) throw Error("请等待本轮生成结束后切换分支。");
        s.activeBranch = id;
        s.debugFloor =
          s.rounds.findLast((f) => f.branch_id === id)?.id || s.debugFloor;
        operation(s, "切换分支", { branchId: id });
        renderManagement();
      }
      if (action === "explain-open") {
        management.page = null;
        openDebug(id);
        editor.tab = "prompt";
        renderDebugger();
      }
      if (action === "import") {
        const k = libraryKind;
        $("library").close();
        openManagement("import", () => {
          management.importKind = k;
          management.importRows = [];
        });
      }
      if (action === "import-files") {
        $("importFile").accept =
          management.importKind === "character" ? ".json,.png,.webp" : ".json";
        $("importFile").click();
      }
      if (action === "import-commit") {
        for (const row of management.importRows.filter(
          (r) => r.selected && r.status === "可导入",
        )) {
          const id = `resource-${nextId++}`;
          resources.push({
            id,
            kind: management.importKind,
            name: row.name,
            versions: [clone(row.doc)],
            updatedAt: Date.now(),
          });
          row.resourceId = id;
          row.status = "已导入";
          row.selected = false;
          logManagement("导入资源 " + row.name, id);
        }
        renderManagement();
        renderNav();
      }
      if (action === "toggle-nav")
        document.querySelector(".sidebar").classList.toggle("drawer-open");
      if (action === "toggle-inspector")
        document.querySelector(".inspector").classList.toggle("drawer-open");
      if (action === "language") switchLanguage();
    } catch (error) {
      if ($("managementError"))
        $("managementError").textContent = error.message;
      notify(error.message);
    }
  },
  true,
);
$("importFile").multiple = true;
$("importFile").onchange = async (e) => {
  await precheckImport(Array.from(e.target.files), management.importKind);
  e.target.value = "";
};
document.addEventListener("change", (e) => {
  if (e.target.dataset.importRow !== undefined) {
    management.importRows[Number(e.target.dataset.importRow)].selected =
      e.target.checked;
    renderManagement();
  }
});
const uiTranslations = {
  搜索资源名称: "Search resource names",
  资源名称: "Resource name",
  资源排序: "Resource order",
  资源状态: "Resource status",
  配置应用到: "Apply configuration to",
  生成轮次: "Generation turn",
  工具调用记录: "Tool call records",
  变量暂存记录: "Staged variable writes",
  变量跨作用域写入记录: "Variable promotion records",
  记忆处理进度: "Memory processing progress",
  历史提示词组装记录: "Historical prompt assembly",
  会话操作日志: "Session operation logs",
  接口原始响应: "Raw API responses",
  各阶段模型与执行结果: "Models and results by stage",
  工具名称: "Tool name",
  工具用途: "Tool purpose",
  工具来源: "Tool source",
  服务器名称: "Server name",
  连接方式: "Connection transport",
  "工具入参 Schema": "Tool input schema",
  "管理 Web 端": "Management Web",
  角色管理: "Role management",
  角色应用: "Role applications",
  试聊: "Trials",
  开始试聊: "Start trial",
  新建独立试聊: "New trial",
  试聊状态: "Trial status",
  进行中的试聊: "Active trials",
  已归档的试聊: "Archived trials",
  资源库: "Library",
  "运行与 Agent": "Runtime & Agents",
  演绎运行配置: "Roleplay runtime",
  "工作区 Agent 类型": "Workspace Agent types",
  "项目 Agent": "Project Agents",
  服务配置: "Service configuration",
  查看配置位置: "Configuration location",
  配置: "Bindings",
  试聊详情: "Trial details",
  轮次调试: "Turn debugger",
  发布: "Publish",
  工具管理: "Tool manager",
  "MCP 管理": "MCP manager",
  记忆调试: "Memory inspector",
  变量调试: "Variable inspector",
  分支与历史: "Branches & history",
  实时工具调用: "Live tool calls",
  管理操作记录: "Management activity",
  返回试聊: "Back to trial",
  刷新: "Refresh",
  新建工具: "New tool",
  新建服务器: "New server",
  编辑: "Edit",
  删除: "Delete",
  停用: "Disable",
  启用: "Enable",
  连接: "Connect",
  断开: "Disconnect",
  测试: "Test",
  工具定义: "Tool definition",
  会话工具权限: "Session tool permissions",
  保存工具: "Save tool",
  保存服务器: "Save server",
  名称: "Name",
  描述: "Description",
  来源: "Source",
  "来源 ID": "Source ID",
  副作用等级: "Side effect level",
  处理器类型: "Handler type",
  "参数 Schema": "Parameter schema",
  处理器配置: "Handler configuration",
  状态: "Status",
  操作: "Actions",
  工具: "Tools",
  工具列表: "Tools",
  测试结果: "Test result",
  查看详情: "Details",
  "暂无记录。": "No records.",
  传输: "Transport",
  "HTTP 地址": "HTTP URL",
  启动命令: "Command",
  "参数（JSON 数组）": "Arguments (JSON array)",
  工作目录: "Working directory",
  工具名前缀: "Tool prefix",
  默认副作用等级: "Default side effect level",
  "连接超时（ms）": "Connection timeout (ms)",
  "调用超时（ms）": "Call timeout (ms)",
  "工具刷新间隔（ms）": "Tool refresh interval (ms)",
  配置作用域: "Scope",
  角色应用草稿: "Application draft",
  全局默认: "Global default",
  当前会话: "Current session",
  保存全局默认: "Save global default",
  保存会话覆盖: "Save session override",
  解绑当前槽位: "Unbind slot",
  重置参数: "Reset parameters",
  预设参数: "Preset parameters",
  从预设导入参数: "Import preset parameters",
  重新读取配置: "Reload configuration",
  调整本会话配置: "Edit session bindings",
  保存本会话配置: "Save session bindings",
  配置会话模型: "Configure session model",
  世界书绑定: "Worldbook bindings",
  绑定版本: "Version",
  提示词模式: "Prompt mode",
  继承默认: "Inherit default",
  会话配置: "Session bindings",
  编辑消息: "Edit message",
  消息内容: "Message content",
  保存消息: "Save message",
  保存并重新生成: "Save and regenerate",
  编辑并重新生成: "Edit and regenerate",
  重新生成: "Regenerate",
  删除消息: "Delete message",
  查看本轮记录: "Inspect turn",
  "正在接收回复…": "Receiving reply…",
  仅收藏: "Favorites only",
  收藏: "Favorite",
  取消收藏: "Unfavorite",
  恢复角色卡: "Restore character",
  可用: "Available",
  全部: "All",
  已删除: "Deleted",
  最近更新: "Recently updated",
  搜索: "Search",
  排序: "Sort",
  批量导入: "Batch import",
  选择文件: "Select files",
  导入选中资源: "Import selected",
  选择: "Select",
  文件: "File",
  结果: "Result",
  解析后的变量: "Resolved variables",
  暂存写入: "Staged writes",
  晋升分组: "Promotion groups",
  作用域: "Scope",
  值: "Value",
  记忆统计: "Memory statistics",
  有效: "Active",
  已弃用: "Deprecated",
  摘要: "Summaries",
  事实: "Facts",
  未完成事项: "Open loops",
  "估算 Token": "Estimated tokens",
  作用域状态: "Scope state",
  记忆条目: "Memory items",
  记忆任务: "Memory jobs",
  任务: "Job",
  尝试次数: "Attempts",
  错误与时间: "Errors and timestamps",
  "历史 Explain": "Historical Explain",
  提示词摘要: "Prompt digest",
  详情: "Details",
  打开历史解释: "Open historical explanation",
  操作日志: "Operation logs",
  时间: "Time",
  轮次: "Turn",
  差异: "Diff",
  切换分支: "Switch branch",
  当前分支: "Current branch",
  允许工具: "Enable tools",
  允许不可逆操作: "Allow irreversible actions",
  继承: "Inherit",
  允许: "Allow",
  禁止: "Deny",
  每轮调用上限: "Calls per turn",
  每次生成步骤上限: "Steps per generation",
  槽位允许列表: "Slot allow lists",
  槽位禁止列表: "Slot deny lists",
  保存会话权限: "Save permissions",
  当前会话可用工具: "Available session tools",
  调用记录: "Call records",
  历史提示词组装: "Historical prompt assembly",
  完整消息: "Complete messages",
  诊断: "Diagnostics",
  裁剪原因: "Trim reasons",
  排除的来源: "Excluded sources",
};
for (const [k, v] of Object.entries(ExistingTranslations.messages["zh-CN"]))
  if (ExistingTranslations.messages.en[k])
    uiTranslations[v] ??= ExistingTranslations.messages.en[k];
const textOrigins = new WeakMap();
function translateUi() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const p = node.parentElement;
    if (
      !p ||
      p.closest("script,style,textarea,pre,.markdown-block,#languageButton")
    )
      continue;
    const prior = textOrigins.get(node);
    const source =
      prior && node.nodeValue === prior.rendered
        ? prior.original
        : node.nodeValue;
    let translated = source;
    if (management.language === "en") {
      const trimmed = source.trim();
      if (uiTranslations[trimmed])
        translated = source.replace(trimmed, uiTranslations[trimmed]);
    }
    textOrigins.set(node, { original: source, rendered: translated });
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }
  document.documentElement.lang = management.language;
  const languageLabel = management.language === "en" ? "中文" : "EN";
  if ($("languageButton").textContent !== languageLabel)
    $("languageButton").textContent = languageLabel;
}
function switchLanguage() {
  management.language = management.language === "en" ? "zh-CN" : "en";
  translateUi();
}
$("accountSelect").onchange = (e) => accountSwitch(e.target.value);
let translationPending = false;
new MutationObserver(() => {
  if (translationPending) return;
  translationPending = true;
  queueMicrotask(() => {
    translateUi();
    translationPending = false;
  });
}).observe(document.body, { subtree: true, childList: true });
for (const side of ["left", "right"]) {
  const grip = $(`${side}Resize`);
  grip.onpointerdown = (e) => {
    if (innerWidth < 1100) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const initial = e.clientX,
      container = document.querySelector(
        side === "left" ? ".sidebar" : ".inspector",
      ),
      width = container.getBoundingClientRect().width;
    grip.onpointermove = (event) => {
      const delta = (event.clientX - initial) * (side === "left" ? 1 : -1);
      document.documentElement.style.setProperty(
        `--${side}-width`,
        `${Math.min(innerWidth * 0.4, Math.max(220, width + delta))}px`,
      );
    };
    grip.onpointerup = () => {
      grip.onpointermove = null;
    };
  };
  grip.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const container = document.querySelector(
        side === "left" ? ".sidebar" : ".inspector",
      ),
      delta = (e.key === "ArrowRight" ? 20 : -20) * (side === "left" ? 1 : -1);
    document.documentElement.style.setProperty(
      `--${side}-width`,
      `${Math.min(innerWidth * 0.4, Math.max(220, container.getBoundingClientRect().width + delta))}px`,
    );
  };
}

const priorReferences = references;
references = (id) => [
  ...priorReferences(id),
  ...sessions.flatMap((s) =>
    s.rounds
      .filter((f) => Object.values(f.config).some((v) => v?.id === id))
      .map((f) => `${s.name} · 第 ${f.no} 轮`),
  ),
];

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelector(".sidebar").classList.remove("drawer-open");
    document.querySelector(".inspector").classList.remove("drawer-open");
    if (editor && !$("confirmDialog").open) leaveEditor(() => render());
    return;
  }
  if (
    !(e.ctrlKey || e.metaKey) ||
    e.target.closest("input,textarea,select,[contenteditable]")
  )
    return;
  if (e.key.toLowerCase() === "n") {
    e.preventDefault();
    createTrial();
  }
  if (e.key === "1") {
    e.preventDefault();
    tab = "bindings";
    renderInspector();
  }
  if (e.key === "2") {
    e.preventDefault();
    openManagement("live-tools");
  }
  if (e.key === "3") {
    e.preventDefault();
    openManagement("memory");
  }
});

// HTTP bodies follow apps/api/openapi/openapi.json. View-only names are mapped below.
const previewResponses = JSON.parse($("generation-preview-data").textContent);
const previewResponse = (route, floorId) =>
  previewResponses.find(
    (r) =>
      r.route === route &&
      (!floorId ||
        r.path.includes("/" + floorId + "/") ||
        r.path.endsWith("/" + floorId) ||
        r.query?.floor_id === floorId ||
        r.query?.scope_id === floorId),
  );
// Resource editor models are converted from the imported HTTP asset payloads.
for (const response of previewResponses.filter((r) =>
  ["/regex-profiles/{id}", "/worldbooks/{id}"].includes(r.route),
)) {
  const asset = response.body.data,
    kind = response.route.startsWith("/regex") ? "regex" : "worldbook";
  const doc =
    kind === "regex"
      ? {
          entries: asset.data.map((rule) => ({
            ...rule,
            placement: rule.placement.join(","),
          })),
        }
      : {
          ...asset.data,
          entries: Object.values(asset.data.entries).map((entry) => ({
            ...entry,
            key: entry.key.join(","),
            keysecondary: entry.keysecondary.join(","),
          })),
        };
  const resource = {
    id: asset.id,
    kind,
    name: asset.name,
    versions: [doc],
  };
  const index = resources.findIndex((r) => r.id === asset.id);
  if (index >= 0) resources[index] = resource;
  else resources.push(resource);
}
const timeline = previewResponse("/sessions/{id}/timeline").body.data;
const previewSession = sessionState({
  id: timeline.session_id,
  name: "港口书店 · 灯塔来信",
  revision,
  config: clone(saved),
  status: "active",
  messages: [],
  rounds: [],
  input: "",
  running: false,
});
Object.assign(previewSession.config.runtime.turn, {
  enableDirector: true,
  enableVerifier: true,
  enableMemoryConsolidation: true,
  enableTools: true,
});
sessions.push(previewSession);
selected = previewSession.id;
for (const row of timeline.floors) {
  const floor = createFloorRecord(
    previewSession,
    row.messages.find((m) => m.role === "user").content,
  );
  Object.assign(floor, previewResponse("/floors/{id}", row.id).body.data);
  const get = (route) => previewResponse(route, floor.id);
  const run = get("/floors/{id}/run").body.data.run;
  const result = get("/floors/{id}/result");
  const explanation = get("/floors/{id}/prompt-runtime/explain");
  const ex = explanation.status === 200 ? explanation.body.data : null;
  // Adapters are presentation state, never raw HTTP responses.
  floor.attempts = [
    {
      id: run.run_id,
      state: run.status,
      attempt_no: run.attempt_no,
      started_at: run.started_at,
      ended_at: run.completed_at,
      error: run.error,
    },
  ];
  floor.result =
    result.status === 200
      ? {
          ...result.body.data,
          usage: {
            input_tokens: result.body.data.usage.prompt_tokens,
            output_tokens: result.body.data.usage.completion_tokens,
          },
        }
      : null;
  const outputPage = row.active_pages.find((p) => p.page_kind === "output");
  const pageRecord = (suffix) =>
    outputPage
      ? previewResponses.find(
          (r) => r.path === `/pages/${outputPage.id}/variables/${suffix}`,
        ).body.data.items
      : [];
  floor.apiResponses = previewResponses.filter(
    (r) =>
      r.path.includes("/" + floor.id + "/") ||
      r.path.endsWith("/" + floor.id) ||
      r.query?.floor_id === floor.id ||
      r.query?.scope_id === floor.id ||
      (outputPage && r.path.includes("/" + outputPage.id + "/")),
  );
  floor.debug = {
    pageId: outputPage?.id,
    source: "saved_snapshot",
    explain: ex
      ? {
          digest: ex.prompt_snapshot.prompt_digest,
          tokenEstimate: ex.prompt_snapshot.token_estimate,
          messages: [],
          sections: ex.section_stats,
          diagnostics: ex.diagnostics,
          trimReasons: ex.trim_reasons,
          excludedSources: ex.excluded_sources,
        }
      : null,
    stages: {
      verifier: run.verifier,
      memory: get("/memory/jobs").body.data,
    },
    tools: get("/floors/{id}/tool-executions").body.data.map((t) => ({
      ...t,
      slot: t.caller_slot,
      arguments: t.args,
      ended_at: t.finished_at,
      error: t.error_message,
    })),
    variables: get("/variables/resolve").body.data.resolved.map((v) => ({
      key: v.key,
      value: v.value,
      scope: v.source_scope,
      source: v,
    })),
    stagedWrites: pageRecord("staged"),
    promotions: pageRecord("promotions").map((v) => ({
      ...v,
      status: "promoted",
      scope: v.to_scope,
    })),
    memories: get("/memories").body.data.map((m) => ({
      ...m,
      content: typeof m.content === "string" ? m.content : m.content.text,
    })),
    jobs: get("/memory/jobs").body.data.map((j) => ({
      ...j,
      attemptCount: j.attempt_count,
      maxAttempts: j.max_attempts,
    })),
    scopeState: get("/memory/scopes").body.data[0] || null,
  };
  floor.events = [];
  for (const message of row.messages)
    previewSession.messages.push({
      id: message.id,
      role: message.role,
      me: message.role === "user",
      text: message.content,
      floorId: floor.id,
      branchId: floor.branch_id,
      at: message.role === "user" ? row.created_at : run.completed_at,
      tokens: message.role === "assistant" ? row.token_out : undefined,
    });
}
previewSession.operationLogs = previewResponse(
  "/sessions/{id}/operation-logs",
).body.data.map((o) => ({
  id: o.id,
  at: o.created_at,
  action: o.action,
  floor_id: o.floor_id,
  detail: o,
}));
previewSession.failed = true;
previewSession.debugFloor = previewSession.rounds[1].id;
tab = "bindings";
editor = null;

render();
