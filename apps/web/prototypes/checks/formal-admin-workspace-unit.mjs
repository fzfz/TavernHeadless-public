import assert from "node:assert/strict";
import fs from "node:fs";

import {
  regexSourceLabel,
  buildFormalResourceUpdate,
  buildAgentConfiguration,
  createFormalAdminClient,
  flattenFormalTimeline,
  formalMessageRoleLabel,
  formalResourceStatusLabel,
  formalSessionStatusLabel,
  isFormalAdminMode,
  mergeOrderedEntryValues,
  mergeWorldbookEntryPairs,
  setCharacterBookAlias,
  setCharacterFieldAlias,
  synchronizeWorldbookEntry,
  worldbookEntryKeywordLists,
} from "../shared/formal-admin-workspace.prototype.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

assert.equal(isFormalAdminMode({ search: "?source=backend" }), true);
assert.equal(isFormalAdminMode({ search: "?source=fixture" }), false);
assert.equal(formalSessionStatusLabel("active"), "进行中");
assert.equal(formalSessionStatusLabel("archived"), "已归档");
assert.equal(formalMessageRoleLabel("user"), "演绎者");
assert.equal(formalMessageRoleLabel("assistant"), "角色");
assert.equal(formalResourceStatusLabel("active"), "启用");
assert.equal(formalResourceStatusLabel("disabled"), "停用");
const normalizedCharacter = { exampleDialogue: "旧内容" };
setCharacterFieldAlias(
  normalizedCharacter,
  normalizedCharacter,
  "exampleDialogue",
  "mes_example",
  "新内容",
);
assert.deepEqual(normalizedCharacter, { exampleDialogue: "新内容" });
const importedCharacter = { mes_example: "旧内容" };
setCharacterFieldAlias(
  importedCharacter,
  importedCharacter,
  "exampleDialogue",
  "mes_example",
  "新内容",
);
assert.deepEqual(importedCharacter, { mes_example: "新内容" });
assert.deepEqual(
  worldbookEntryKeywordLists({
    keys: ["灯塔"],
    secondary_keys: ["港口"],
  }),
  { primary: ["灯塔"], secondary: ["港口"] },
);
const normalizedBookCharacter = { characterBook: { entries: [] } };
setCharacterBookAlias(normalizedBookCharacter, normalizedBookCharacter, {
  name: "新世界书",
  entries: [],
});
assert.deepEqual(normalizedBookCharacter, {
  characterBook: { name: "新世界书", entries: [] },
});
const importedBookCharacter = { first_mes: "开场", character_book: null };
setCharacterBookAlias(importedBookCharacter, importedBookCharacter, {
  name: "导入世界书",
  entries: [],
});
assert.deepEqual(importedBookCharacter, {
  first_mes: "开场",
  character_book: { name: "导入世界书", entries: [] },
});

assert.deepEqual(
  flattenFormalTimeline({
    data: {
      floors: [
        {
          id: "floor-1",
          floor_no: 1,
          active_page: {
            id: "page-1",
            messages: [{ id: "message-1", role: "assistant", content: "正文" }],
          },
        },
      ],
    },
  }),
  [
    {
      id: "message-1",
      role: "assistant",
      content: "正文",
      floor_id: "floor-1",
      floor_no: 1,
      page_id: "page-1",
      page_no: undefined,
      page_kind: undefined,
    },
  ],
);
assert.deepEqual(
  synchronizeWorldbookEntry(
    { unknown: "kept", extensions: { vendor: true, depth: 3 } },
    {
      position: 4,
      depth: 5,
      role: 2,
      order: 80,
      selectiveLogic: 3,
      scanDepth: 6,
      caseSensitive: true,
      matchWholeWords: false,
      excludeRecursion: true,
      preventRecursion: false,
      delayUntilRecursion: 2,
      disable: false,
    },
  ),
  {
    unknown: "kept",
    position: 4,
    depth: 5,
    role: 2,
    order: 80,
    selectiveLogic: 3,
    scanDepth: 6,
    caseSensitive: true,
    matchWholeWords: false,
    excludeRecursion: true,
    preventRecursion: false,
    delayUntilRecursion: 2,
    disable: false,
    insertion_order: 80,
    enabled: true,
    extensions: {
      vendor: true,
      position: 4,
      depth: 5,
      role: 2,
      selectiveLogic: 3,
      scan_depth: 6,
      case_sensitive: true,
      match_whole_words: false,
      exclude_recursion: true,
      prevent_recursion: false,
      delay_until_recursion: 2,
    },
  },
);
const stPositionEntry = synchronizeWorldbookEntry(
  { id: 1, position: "before_char", extensions: { custom_note: "preserve" } },
  {
    position: 4,
    rootPosition: "after_char",
    depth: 5,
    role: 0,
    order: 1,
    selectiveLogic: 0,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: null,
    disable: false,
  },
);
assert.equal(stPositionEntry.position, "after_char");
assert.equal(stPositionEntry.extensions.position, 4);
assert.equal(stPositionEntry.extensions.depth, 5);
assert.equal(stPositionEntry.extensions.custom_note, "preserve");
assert.equal(Object.hasOwn(stPositionEntry, "rootPosition"), false);
const mergedCharacterBookEntries = mergeWorldbookEntryPairs(
  [
    { uid: 10, comment: "第一条", unknown: "保留一" },
    { uid: 11, comment: "删除条目", unknown: "删除" },
    {
      uid: 12,
      comment: "第三条",
      extensions: { custom_note: "preserve", position: 4, depth: 3 },
    },
  ],
  [
    [
      "2",
      {
        uid: 12,
        comment: "第三条",
        key: ["灯塔"],
        keysecondary: ["港口"],
        selective: true,
        selectiveLogic: 0,
        content: "更新内容",
        position: 4,
        depth: 5,
        role: 0,
        order: 80,
        outletName: "",
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: null,
        constant: false,
        disable: false,
      },
    ],
    [
      "new",
      {
        uid: "new",
        comment: "新增条目",
        key: ["新词"],
        keysecondary: [],
        selective: false,
        selectiveLogic: 0,
        content: "新增内容",
        position: 0,
        depth: 4,
        role: 0,
        order: 100,
        outletName: "",
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: null,
        constant: false,
        disable: false,
      },
    ],
    [
      "0",
      {
        uid: 10,
        comment: "第一条",
        key: ["旧词"],
        keysecondary: [],
        selective: false,
        selectiveLogic: 0,
        content: "第一条内容",
        position: 0,
        depth: 4,
        role: 0,
        order: 100,
        outletName: "",
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: null,
        constant: false,
        disable: false,
      },
    ],
  ],
);
assert.deepEqual(
  mergedCharacterBookEntries.map((entry) => entry.comment),
  ["第三条", "新增条目", "第一条"],
);
assert.equal(
  mergedCharacterBookEntries.some((entry) => entry.uid === 11),
  false,
);
assert.equal(mergedCharacterBookEntries[0].extensions.custom_note, "preserve");
assert.equal(mergedCharacterBookEntries[0].extensions.depth, 5);
assert.deepEqual(mergedCharacterBookEntries[0].keys, ["灯塔"]);
assert.deepEqual(mergedCharacterBookEntries[0].secondary_keys, ["港口"]);

const agentFields = new Map([
  ["mcp_server_ids", "mcp-2,mcp-1"],
  ["event_types", "floor.committed"],
  ["grant_outputs", "memory,variables"],
  ["grant_reads", "session"],
  ["agent_metadata", '{"priority":2}'],
]);
assert.deepEqual(
  buildAgentConfiguration(agentFields, {
    mcp_bindings: [
      { mcp_server_id: "mcp-1", allowed_tools: ["lookup"] },
      { mcp_server_id: "mcp-2", config_override_json: { mode: "safe" } },
    ],
    event_subscriptions: [
      { type: "floor.committed", filter_json: { branch: "main" } },
    ],
    grants: { retained: true },
  }),
  {
    mcp_bindings: [
      { mcp_server_id: "mcp-2", config_override_json: { mode: "safe" } },
      { mcp_server_id: "mcp-1", allowed_tools: ["lookup"] },
    ],
    event_subscriptions: [
      { type: "floor.committed", filter_json: { branch: "main" } },
    ],
    grants: {
      retained: true,
      allowed_output_targets: ["memory", "variables"],
      reads: ["session"],
    },
    metadata: { priority: 2 },
  },
);

assert.deepEqual(
  flattenFormalTimeline({
    data: {
      floors: [
        {
          id: "floor-2",
          floor_no: 2,
          active_pages: [
            {
              id: "page-output",
              page_no: 2,
              page_kind: "output",
              messages: [
                { id: "assistant", seq: 0, role: "assistant", content: "答" },
              ],
            },
            {
              id: "page-input",
              page_no: 1,
              page_kind: "input",
              messages: [{ id: "user", seq: 0, role: "user", content: "问" }],
            },
          ],
        },
      ],
    },
  }).map(({ id, page_id, page_kind }) => ({ id, page_id, page_kind })),
  [
    { id: "user", page_id: "page-input", page_kind: "input" },
    { id: "assistant", page_id: "page-output", page_kind: "output" },
  ],
);

assert.deepEqual(
  mergeOrderedEntryValues(
    ["2", "0"],
    [
      { id: "a", unknown: "keep-a" },
      { id: "b", unknown: "deleted" },
      { id: "c", unknown: "keep-c" },
    ],
    { 0: { name: "A" }, 2: { name: "C" } },
  ),
  [
    { id: "c", unknown: "keep-c", name: "C" },
    { id: "a", unknown: "keep-a", name: "A" },
  ],
);

assert.deepEqual(
  buildFormalResourceUpdate(
    "persona",
    { id: "user-1", revision: 4 },
    "",
    '{"name":"演绎者"}',
  ),
  {
    method: "PATCH",
    path: "/users/user-1",
    body: { snapshot: { name: "演绎者" }, expected_revision: 4 },
  },
);
assert.deepEqual(
  buildFormalResourceUpdate("persona", { id: "user-1", revision: 4 }, "", {
    name: "演绎者",
    status: "disabled",
  }),
  {
    method: "PATCH",
    path: "/users/user-1",
    body: {
      snapshot: { name: "演绎者" },
      status: "disabled",
      expected_revision: 4,
    },
  },
);
assert.deepEqual(
  buildFormalResourceUpdate(
    "preset",
    { id: "preset-1", version: 2 },
    "预设",
    '{"entries":[],"order_contexts":[],"top_level":{},"default_character_id":100001}',
  ),
  {
    method: "PUT",
    path: "/presets/preset-1",
    body: {
      name: "预设",
      expected_version: 2,
      editor: {
        entries: [],
        order_contexts: [],
        top_level: {},
        default_character_id: 100001,
      },
    },
  },
);

const calls = [];
let characterVersion = {
  name: "内嵌世界书接口验收",
  characterBook: {
    name: "内嵌世界书",
    entries: [
      {
        uid: 1,
        key: ["港口"],
        content: "原内容",
        extensions: { position: 4, depth: 3, custom_note: "preserve" },
      },
    ],
  },
};
const fetchImpl = async (url, options = {}) => {
  const path = String(url);
  calls.push({ path, options });
  if (path.startsWith("/workspaces?"))
    return json({
      items: [{ id: "workspace-1", account_id: "account-1", name: "工作区" }],
    });
  if (path.startsWith("/projects?"))
    return json({ items: [{ id: "project-1", name: "项目" }] });
  if (path.startsWith("/sessions?"))
    return json({
      data: [{ id: "session-1", title: "会话" }],
      meta: { has_more: false },
    });
  if (path.startsWith("/characters?"))
    return json({
      data: [{ id: "character-1", name: "角色" }],
      meta: { has_more: false },
    });
  if (path === "/characters/character-book-1" && options.method !== "POST")
    return json({
      data: {
        id: "character-book-1",
        revision: 2,
        latest_version: { id: "version-2", snapshot: characterVersion },
      },
    });
  if (
    path === "/characters/character-book-1/versions" &&
    options.method === "POST"
  ) {
    characterVersion = JSON.parse(options.body).snapshot;
    return json({
      data: {
        id: "version-3",
        revision: 3,
        snapshot: characterVersion,
      },
    });
  }
  if (path === "/presets")
    return json({ data: [{ id: "preset-1", name: "预设" }] });
  if (path === "/worldbooks") return json({ data: [] });
  if (path === "/regex-profiles")
    return json({ data: [{ id: "regex-1", name: "正则" }] });
  if (path.startsWith("/users?"))
    return json({
      data: [{ id: "user-1", name: "人设" }],
      meta: { has_more: false },
    });
  if (path === "/llm-profiles?status=active")
    return json({ data: [{ id: "profile-1", preset_name: "模型" }] });
  if (path === "/sessions/session-1/respond/dry-run")
    return json({ data: { messages: [] } });
  if (path === "/regex-profiles/preview")
    return json({
      data: {
        text: "处理后",
        candidate_rule_names: ["规则"],
        matched_rule_names: ["规则"],
        skipped_rules: [],
      },
    });
  if (path === "/users/user-1")
    return json({
      data: {
        id: "user-1",
        revision: 5,
        snapshot: JSON.parse(options.body).snapshot,
      },
    });
  if (path === "/sessions/session-1" && options.method === "DELETE")
    return json({ data: { id: "session-1", deleted: true } });
  throw new Error(`Unexpected request ${path}`);
};

const client = createFormalAdminClient({
  fetchImpl,
  errorMessages: { NETWORK_ERROR: "网络错误" },
});
const shell = await client.loadShell();
assert.equal(shell.workspaces[0].account_id, "account-1");
assert.equal(shell.sessions[0].id, "session-1");
assert.equal(shell.resources.character[0].name, "角色");
assert.equal(shell.resources.model[0].preset_name, "模型");

await client.dryRun("session-1", "继续");
assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
  message: "继续",
  debug_options: { include_worldbook_matches: true },
});
const regexPreview = await client.request("/regex-profiles/preview", {
  method: "POST",
  body: {
    text: "原文",
    scripts: [{ scriptName: "规则", placement: [2] }],
    placement: 2,
    channel: "persist",
    depth: 0,
    variables: { char: "角色" },
  },
});
assert.equal(regexPreview.text, "处理后");
assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
  text: "原文",
  scripts: [{ scriptName: "规则", placement: [2] }],
  placement: 2,
  channel: "persist",
  depth: 0,
  variables: { char: "角色" },
});
await client.saveResource(
  "persona",
  { id: "user-1", revision: 4 },
  "",
  '{"name":"演绎者"}',
);
assert.equal(calls.at(-1).options.method, "PATCH");
assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
  snapshot: { name: "演绎者" },
  expected_revision: 4,
});
const editedCharacterVersion = structuredClone(characterVersion);
editedCharacterVersion.characterBook.entries = mergedCharacterBookEntries;
await client.saveResource(
  "character",
  { id: "character-book-1", revision: 2 },
  "",
  editedCharacterVersion,
);
const rereadCharacter = await client.resourceDetail(
  "character",
  "character-book-1",
);
assert.deepEqual(
  rereadCharacter.latest_version.snapshot.characterBook.entries.map(
    (entry) => entry.comment,
  ),
  ["第三条", "新增条目", "第一条"],
);
assert.equal(
  rereadCharacter.latest_version.snapshot.characterBook.entries[0].extensions
    .custom_note,
  "preserve",
);
assert.equal(
  rereadCharacter.latest_version.snapshot.characterBook.entries[0].extensions
    .depth,
  5,
);
await client.deleteSession("session-1");
assert.equal(calls.at(-1).options.method, "DELETE");

const html = fs.readFileSync(
  new URL("../admin-workspace.prototype.html", import.meta.url),
  "utf8",
);
assert.match(html, /get\("source"\) !== "backend"/);
assert.match(html, /formal-admin-workspace\.prototype\.js/);
assert.doesNotMatch(html, /<option>studio-alpha<\/option>/);
assert.doesNotMatch(html, /林岚 · 港口书店/);
const controllerSource = fs.readFileSync(
  new URL("../shared/formal-admin-workspace.prototype.js", import.meta.url),
  "utf8",
);
assert.doesNotMatch(controllerSource, /\/respond["`]/);
assert.doesNotMatch(controllerSource, /\/regenerate/);
assert.match(controllerSource, /script-roleplay\.prototype\.html/);
assert.match(controllerSource, /\/regex-profiles\/preview/);
assert.doesNotMatch(controllerSource, /new RegExp/);
assert.match(controllerSource, /角色定义之前/);
assert.match(controllerSource, /data-entry-up/);
assert.match(controllerSource, /data-character-book-entry-add/);
assert.match(controllerSource, /characterBook/);
assert.match(controllerSource, /data-session-delete/);
assert.match(controllerSource, /mountGenerationDetails/);
assert.match(controllerSource, /method: "PATCH", body: \{ enabled:/);

const loader = html.match(
  /<script>\s*(if \(new URLSearchParams[\s\S]*?documentElement\.dataset\.backendMode = "published";\s*}\s*)<\/script>/,
)?.[1];
assert.ok(loader);
function runLoader(search) {
  const writes = [];
  const document = {
    documentElement: { dataset: {} },
    write(value) {
      writes.push(value);
    },
  };
  new Function("location", "document", "URLSearchParams", loader)(
    { search },
    document,
    URLSearchParams,
  );
  return { writes, mode: document.documentElement.dataset.backendMode };
}
assert.deepEqual(runLoader("?source=backend"), {
  writes: [],
  mode: "published",
});
const fixtureLoader = runLoader("?source=fixture");
assert.equal(fixtureLoader.writes.length, 7);
assert.ok(
  fixtureLoader.writes.some((value) =>
    value.includes("workspace.prototype.js"),
  ),
);

console.log("formal admin workspace checks passed");

const { selectCharacterSession } =
  await import("../shared/formal-admin-workspace.prototype.js");
const roleSessions = [
  { id: "a", character_binding: { character_id: "role-a" } },
  { id: "b", character_binding: { character_id: "role-b" } },
];
assert.equal(selectCharacterSession(roleSessions, "role-b").id, "b");
assert.equal(selectCharacterSession(roleSessions, "no-session"), null);
assert.equal(selectCharacterSession([], null), null);
assert.equal(selectCharacterSession(roleSessions, null).id, "a");

assert.equal(
  regexSourceLabel({ kind: "preset", name: "P", index: 0 }),
  "预设：P · 原顺序 1",
);
assert.equal(
  regexSourceLabel({ kind: "character", name: "C", index: 2 }),
  "角色卡：C · 原顺序 3",
);
assert.equal(regexSourceLabel(null), "");

const {roleStateConfigurationFields, applyRoleStateConfiguration} = await import('../shared/formal-admin-workspace.prototype.js');
const originalState={extensions:{tavern_headless:{stateUpdate:{profile:{ruleFiles:['rule.json']},files:{'rule.json':'{}'}},openings:{items:[{id:'first',variables:{score:0}}]}}}};
assert(roleStateConfigurationFields(originalState).includes('state_file_0'));
assert(roleStateConfigurationFields(originalState).includes('opening_variables_0'));
assert.equal(roleStateConfigurationFields({}), '');
const stateData=new FormData();stateData.set('state_update_profile','{"ruleFiles":["rule.json"],"maxTokens":8192}');stateData.set('state_file_0','{"rule":"updated"}');stateData.set('opening_variables_0','{"score":5}');
const changedState=structuredClone(originalState);applyRoleStateConfiguration(changedState,originalState,stateData);
assert.equal(changedState.extensions.tavern_headless.stateUpdate.profile.maxTokens,8192);
assert.equal(changedState.extensions.tavern_headless.openings.items[0].variables.score,5);
assert.equal(originalState.extensions.tavern_headless.openings.items[0].variables.score,0);
stateData.set('opening_variables_0','invalid');assert.throws(()=>applyRoleStateConfiguration(structuredClone(originalState),originalState,stateData),SyntaxError);
console.log('PASS: variable configuration fields and serialization');
