import assert from "node:assert/strict";

import {
  buildRoleReleasePayload,
  createPublishedAdminClient,
  createPublishedAdminDraft,
  filterReleasesByCharacter,
  isPublishedBackendMode,
  loadPublishedAdminCatalog,
  publishedTrialUrl,
} from "../shared/published-admin.prototype.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function page(data, hasMore = false) {
  return {
    data,
    meta: {
      total: data.length,
      limit: 100,
      offset: 0,
      has_more: hasMore,
      sort_by: "name",
      sort_order: "asc",
    },
  };
}

assert.equal(
  isPublishedBackendMode(
    { search: "?source=backend" },
    { documentElement: { dataset: {} }, body: { dataset: {} } },
  ),
  true,
);
assert.equal(
  isPublishedBackendMode(
    { search: "" },
    {
      documentElement: { dataset: { backendMode: "published" } },
      body: { dataset: {} },
    },
  ),
  true,
);
assert.equal(
  isPublishedBackendMode(
    { search: "" },
    { documentElement: { dataset: {} }, body: { dataset: {} } },
  ),
  false,
);

const calls = [];
const fetchImpl = async (url, options = {}) => {
  const value = String(url);
  calls.push({ url: value, options });
  if (value.startsWith("/characters?")) {
    return value.includes("offset=0")
      ? json(page([{ id: "character-1", name: "角色一" }], true))
      : json(page([{ id: "character-2", name: "角色二" }]));
  }
  if (value.startsWith("/characters/character-1/versions?")) {
    return json(
      page([
        {
          id: "character-version-2",
          character_id: "character-1",
          version_no: 2,
        },
        {
          id: "character-version-1",
          character_id: "character-1",
          version_no: 1,
        },
      ]),
    );
  }
  if (value.startsWith("/characters/character-2/versions?")) {
    return json(
      page([
        {
          id: "character-version-3",
          character_id: "character-2",
          version_no: 1,
        },
      ]),
    );
  }
  if (value === "/presets")
    return json({ data: [{ id: "preset-1", name: "预设一" }] });
  if (value === "/presets/preset-1")
    return json({
      data: {
        id: "preset-1",
        name: "预设一",
        data: { openai_max_tokens: 8192 },
      },
    });
  if (value === "/presets/preset-1/versions")
    return json({
      data: [{ id: "preset-version-1", asset_id: "preset-1", version_no: 1 }],
    });
  if (value === "/regex-profiles")
    return json({ data: [{ id: "regex-1", name: "正则一" }] });
  if (value === "/regex-profiles/regex-1/versions")
    return json({
      data: [{ id: "regex-version-1", asset_id: "regex-1", version_no: 1 }],
    });
  if (value === "/worldbooks")
    return json({ data: [{ id: "worldbook-1", name: "世界书一" }] });
  if (value === "/worldbooks/worldbook-1/versions")
    return json({
      data: [
        {
          id: "worldbook-version-1",
          asset_id: "worldbook-1",
          version_no: 1,
        },
      ],
    });
  if (value.startsWith("/users?"))
    return json(page([{ id: "user-1", name: "演绎者" }]));
  if (value === "/llm-profiles?status=active")
    return json({
      data: [
        {
          id: "profile-1",
          preset_name: "正文模型",
          model_id: "model-1",
          status: "active",
        },
      ],
    });
  if (value === "/role-releases" && !options.method) return json({ data: [] });
  if (value === "/role-releases" && options.method === "POST")
    return json(
      { data: { id: "release-1", ...JSON.parse(options.body) } },
      201,
    );
  if (value === "/role-releases/release-1/sessions")
    return json(
      {
        data: {
          release: { id: "release-1" },
          session: { id: "session-1" },
          opening_id: "first",
        },
      },
      201,
    );
  throw new Error(`Unexpected request: ${value}`);
};

const client = createPublishedAdminClient({
  fetchImpl,
  errorMessages: {
    NETWORK_ERROR: "网络错误",
    ROLE_RELEASE_NOT_FOUND: "发布不存在",
  },
});
const catalog = await loadPublishedAdminCatalog(client);
assert.deepEqual(
  catalog.characters[0].versions.map((version) => version.id),
  ["character-version-1", "character-version-2"],
);
assert.equal(catalog.characters[1].versions[0].id, "character-version-3");
assert.equal(catalog.presets[0].versions[0].id, "preset-version-1");
assert.equal(catalog.regexProfiles[0].versions[0].id, "regex-version-1");
assert.equal(catalog.worldbooks[0].versions[0].id, "worldbook-version-1");
assert.equal(catalog.users[0].id, "user-1");
assert.equal(catalog.profiles[0].id, "profile-1");
assert.deepEqual(
  filterReleasesByCharacter(
    [
      { id: "release-character-1", character_id: "character-1" },
      { id: "release-character-2", character_id: "character-2" },
    ],
    "character-2",
  ).map((item) => item.id),
  ["release-character-2"],
);

const draft = createPublishedAdminDraft(catalog);
assert.equal(draft.characterVersionId, "character-version-2");
assert.equal(draft.worldbookId, "");
assert.equal(draft.slots.narrator.enabled, true);
assert.equal(draft.slots.verifier.enabled, false);

const payload = buildRoleReleasePayload(draft);
assert.deepEqual(payload, {
  name: "角色一",
  character_id: "character-1",
  character_version_id: "character-version-2",
  preset_id: "preset-1",
  preset_version_id: "preset-version-1",
  regex_profile_id: "regex-1",
  regex_profile_version_id: "regex-version-1",
  worldbook_id: null,
  worldbook_version_id: null,
  prompt_mode: "compat_strict",
  model_slots: [
    {
      slot: "narrator",
      profile_id: "profile-1",
      params: { reasoning_effort: "none", max_output_tokens: 8192 },
    },
  ],
  default_user_id: "user-1",
});

const release = await client.publish(payload);
assert.equal(release.id, "release-1");
const publishCall = calls.find(
  (call) => call.url === "/role-releases" && call.options.method === "POST",
);
assert.deepEqual(JSON.parse(publishCall.options.body), payload);

const trial = await client.createTrial({
  releaseId: "release-1",
  userId: "user-1",
  openingId: "first",
});
assert.equal(trial.session.id, "session-1");
assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
  user_id: "user-1",
  opening_id: "first",
});
assert.equal(
  publishedTrialUrl("session-1", { origin: "http://localhost:43876" }),
  "http://localhost:43876/prototype/apps/user-web/prototypes/script-roleplay.prototype.html?source=backend&session=session-1",
);

assert.throws(
  () =>
    buildRoleReleasePayload({
      ...draft,
      slots: Object.fromEntries(
        Object.entries(draft.slots).map(([slot, value]) => [
          slot,
          { ...value, enabled: false },
        ]),
      ),
    }),
  (error) => error.code === "PUBLISH_SLOT_REQUIRED",
);
assert.throws(
  () =>
    buildRoleReleasePayload({
      ...draft,
      slots: {
        ...draft.slots,
        narrator: { ...draft.slots.narrator, paramsText: "[]" },
      },
    }),
  (error) => error.code === "PUBLISH_PARAMS_OBJECT_REQUIRED",
);

const failingClient = createPublishedAdminClient({
  fetchImpl: async () =>
    json(
      {
        error: {
          code: "role_release_not_found",
          message: "backend detail",
        },
      },
      404,
    ),
  errorMessages: {
    NETWORK_ERROR: "网络错误",
    ROLE_RELEASE_NOT_FOUND: "发布不存在",
  },
});
await assert.rejects(
  () => failingClient.listReleases(),
  (error) =>
    error.code === "ROLE_RELEASE_NOT_FOUND" &&
    error.message === "发布不存在" &&
    error.backendMessage === "backend detail",
);

console.log("published-admin-unit: ok");

assert.throws(
  () => buildRoleReleasePayload({ ...draft, name: "" }),
  (error) =>
    error.code === "PUBLISH_FIELD_REQUIRED" && error.field === "发布名称",
);
assert.throws(
  () =>
    buildRoleReleasePayload({
      ...draft,
      slots: {
        ...draft.slots,
        narrator: { ...draft.slots.narrator, paramsText: "{" },
      },
    }),
  (error) =>
    error.code === "PUBLISH_PARAMS_JSON_INVALID" &&
    error.field === "演绎角色 槽位",
);

const historyRequests = [];
const historyClient = createPublishedAdminClient({
  fetchImpl: async (url) => {
    historyRequests.push(url);
    const query = new URL(url, "http://localhost").searchParams;
    const offset = Number(query.get("offset"));
    return json(
      page(
        offset === 0 ? [{ id: "session-first" }] : [{ id: "session-second" }],
        offset === 0,
      ),
    );
  },
});
assert.deepEqual(
  (await historyClient.listSessions("archived")).map((item) => item.id),
  ["session-first", "session-second"],
);
assert.ok(
  historyRequests.every(
    (url) =>
      url.startsWith("/sessions?") &&
      url.includes("status=archived") &&
      url.includes("limit=100"),
  ),
);
assert.ok(historyRequests[1].includes("offset=1"));
const emptyHistory = createPublishedAdminClient({
  fetchImpl: async () => json(page([])),
});
assert.deepEqual(await emptyHistory.listSessions(), []);
const failedHistory = createPublishedAdminClient({
  fetchImpl: async () => json({ error: { code: "NOT_FOUND" } }, 404),
  errorMessages: { NOT_FOUND: "missing" },
});
await assert.rejects(failedHistory.listSessions());
