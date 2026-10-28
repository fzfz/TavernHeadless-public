import assert from "node:assert/strict";

import {
  createFormalTransport,
  createRoleCatalogTransport,
} from "../shared/formal-transport.prototype.js";
import { createSessionHost } from "../shared/script-host.prototype.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const record = (overrides = {}) => ({
  session_id: "session-1",
  branch_id: "main",
  floor_id: null,
  attempt_id: null,
  version_id: "version-1",
  snapshot_id: "snapshot-0",
  parent_snapshot_id: null,
  variables: { trust: 1 },
  source: { kind: "initial", run_id: null, job_id: null },
  ...overrides,
});

const initial = record();
const committed = record({
  floor_id: "floor-1",
  attempt_id: "attempt-1",
  snapshot_id: "snapshot-1",
  parent_snapshot_id: "snapshot-0",
  variables: { trust: 2 },
  source: { kind: "floor", run_id: "run-1", job_id: null },
});

const roleView = (current = initial) => ({
  data: {
    character_id: "character-1",
    character_version_id: "version-1",
    name: "测试角色",
    delivery: {
      html: "<main></main>",
      css: ":host{}",
      script_url: "/role-files/version-1/main.js",
      floor_html: null,
      assets: {},
      data: {},
    },
    initial,
    current,
    snapshots:
      current.floor_id === null
        ? []
        : [
            {
              floor_id: current.floor_id,
              attempt_id: current.attempt_id,
              snapshot_id: current.snapshot_id,
            },
          ],
  },
});

const variables = (trust) => ({
  data: {
    context: {
      account_id: "account-1",
      session_id: "session-1",
      branch_id: "main",
      global_scope_id: "global",
    },
    resolved: [
      {
        key: "stat_data",
        value: { trust },
        source_scope: trust === 1 ? "chat" : "floor",
        source_scope_id: trust === 1 ? "session-1" : "floor-1",
        updated_at: 1,
      },
    ],
  },
});

function sseResponse(events) {
  const encoded = new TextEncoder().encode(
    events
      .map(
        ({ event, data }) =>
          `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`,
      )
      .join(""),
  );
  const cuts = [13, 41, 79, encoded.length];
  let start = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        const end = cuts.shift();
        if (end === undefined) {
          controller.close();
          return;
        }
        controller.enqueue(encoded.slice(start, end));
        start = end;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function createApiFetch({ streamEvents, stateUpdateStatus = 200 } = {}) {
  const requests = [];
  const stateStatuses = Array.isArray(stateUpdateStatus)
    ? [...stateUpdateStatus]
    : [stateUpdateStatus];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url === "/floors/floor-1/run")
      return json({ data: { run: { run_id: "run-1", attempt_no: 1 } } });
    if (url === "/sessions/session-1")
      return json({
        data: {
          id: "session-1",
          title: "测试会话",
          character_binding: {
            character_id: "character-1",
            character_version_id: "version-1",
            snapshot_summary: { name: "测试角色", has_greeting: true },
          },
        },
      });
    if (url === "/sessions/session-1/role-view") return json(roleView());
    if (String(url).startsWith("/variables/resolve?")) {
      const trust = String(url).includes("floor_id=floor-1") ? 2 : 1;
      return json(variables(trust));
    }
    if (String(url).startsWith("/pages?"))
      return json({
        data: String(url).includes("floor_id=floor-1")
          ? [
              {
                id: "page-1",
                floor_id: "floor-1",
                page_no: 0,
                page_kind: "mixed",
                is_active: true,
                version: 1,
                checksum: null,
                created_at: 1,
                updated_at: 1,
              },
            ]
          : [],
        meta: {
          total: 1,
          limit: 100,
          offset: 0,
          has_more: false,
          sort_by: "page_no",
          sort_order: "asc",
        },
      });
    if (String(url).startsWith("/sessions/session-1/role-messages?"))
      return json({
        data: [
          {
            id: "message-user",
            page_id: "page-1",
            seq: 0,
            role: "user",
            content: "继续",
            content_format: "text",
            token_count: 1,
            is_hidden: false,
            source: null,
            created_at: 1,
          },
          {
            id: "message-assistant",
            page_id: "page-1",
            seq: 1,
            role: "assistant",
            content: "第一段第二段",
            content_format: "text",
            token_count: 2,
            is_hidden: false,
            source: "run-1",
            created_at: 2,
          },
        ],
        meta: {
          total: 2,
          limit: 200,
          offset: 0,
          has_more: false,
          sort_by: "seq",
          sort_order: "asc",
        },
      });
    if (url === "/sessions/session-1/respond/stream")
      return sseResponse(streamEvents);
    if (url === "/sessions/session-1/role-state/updates") {
      const status =
        stateStatuses.length > 1 ? stateStatuses.shift() : stateStatuses[0];
      if (status !== 200)
        return json(
          { error: { code: "STATE_RULE_INVALID", message: "invalid state" } },
          status,
        );
      return json({ data: { snapshot_id: "snapshot-1" } });
    }
    if (url === "/sessions/session-1/role-view/floors/floor-1")
      return json({ data: committed });
    throw new Error(`Unexpected request: ${url}`);
  };
  return { fetchImpl, requests };
}

const policy = {
  overscanFloors: 0,
  historyCache: { maxEntries: 8, maxBytes: 16384 },
  settledStreamCache: { maxEntries: 8, maxBytes: 16384 },
  diagnosticsCache: { maxEntries: 8, maxBytes: 16384 },
};
const errors = new Proxy({}, { get: (_target, property) => String(property) });
const streamEvents = [
  {
    event: "start",
    data: { floor_id: "floor-1", floor_no: 1, branch_id: "main" },
  },
  {
    event: "run",
    data: { run_id: "run-1", phase: "page_generating" },
  },
  { event: "chunk", data: { chunk: "原始格式片段" } },
  {event:"role_text",data:{text:"第一段",phase:"streaming"}},
  {
    event: "tool",
    data: { execution_id: "tool-1", phase: "success" },
  },
  {event:"role_text",data:{text:"第一段第二段",phase:"completed"}},
  { event: "summary", data: { summaries: ["摘要"] } },
  {
    event: "done",
    data: {
      floor_id: "floor-1",
      floor_no: 1,
      branch_id: "main",
      generated_text: "第一段第二段",
      summaries: ["摘要"],
      final_state: "committed",
      total_usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    },
  },
];

async function streamAndCommit() {
  const api = createApiFetch({ streamEvents });
  const transport = createFormalTransport({
    sessionId: "session-1",
    fetchImpl: api.fetchImpl,
  });
  const session = await transport.loadSession();
  assert.deepEqual(session.current.variables, { trust: 1 });
  assert.equal(session.delivery.scriptUrl, "/role-files/version-1/main.js");

  const host = createSessionHost({ session, transport, policy, errors });
  const textEvents = [];
  const commits = [];
  host.onTextStream((event) => textEvents.push(event));
  host.onTurnCommitted((event) => commits.push(event));
  const result = await host.send({ text: "继续" });

  assert.deepEqual(result, { snapshotId: "snapshot-1" });
  assert.deepEqual(
    textEvents.map((event) => [event.type, event.text]),
    [
      ["start", ""],
      ["update", "第一段"],
      ["update", "第一段第二段"],
      ["end", "第一段第二段"],
    ],
  );
  assert.equal(textEvents.at(-1).messageId, "message-assistant");
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].after.variables, { trust: 2 });
  assert.equal(host.get("current").snapshotId, "snapshot-1");

  const respondIndex = api.requests.findIndex(
    (request) => request.url === "/sessions/session-1/respond/stream",
  );
  const updateIndex = api.requests.findIndex(
    (request) => request.url === "/sessions/session-1/role-state/updates",
  );
  const snapshotIndex = api.requests.findIndex(
    (request) => request.url === "/sessions/session-1/role-view/floors/floor-1",
  );
  assert.ok(respondIndex < updateIndex && updateIndex < snapshotIndex);
  assert.deepEqual(JSON.parse(api.requests[respondIndex].options.body), {
    message: "继续",
  });
  assert.deepEqual(JSON.parse(api.requests[updateIndex].options.body), {
    floor_id: "floor-1",
  });

  const messages = await transport.getMessages({
    branchId: "main",
    floorId: "floor-1",
    attemptId: "attempt-1",
  });
  assert.deepEqual(
    messages.map(({ id, role, text, attemptId }) => ({
      id,
      role,
      text,
      attemptId,
    })),
    [
      {
        id: "message-user",
        role: "user",
        text: "继续",
        attemptId: "attempt-1",
      },
      {
        id: "message-assistant",
        role: "assistant",
        text: "第一段第二段",
        attemptId: "attempt-1",
      },
    ],
  );
}

async function sseError() {
  const api = createApiFetch({
    streamEvents: [
      {
        event: "error",
        data: { code: "generation_failed", message: "model failed" },
      },
    ],
  });
  const transport = createFormalTransport({
    sessionId: "session-1",
    fetchImpl: api.fetchImpl,
  });
  await assert.rejects(
    transport.send({
      text: "失败",
      current: {
        sessionId: "session-1",
        branchId: "main",
        floorId: null,
        attemptId: null,
        versionId: "version-1",
        snapshotId: "snapshot-0",
        parentSnapshotId: null,
        variables: { trust: 1 },
        source: { kind: "initial", runId: null, jobId: null },
      },
      route: "/send",
      testHeaders: {},
      emit: () => {},
    }),
    (error) => error.code === "generation_failed",
  );
  assert.equal(
    api.requests.some(
      (request) => request.url === "/sessions/session-1/role-state/updates",
    ),
    false,
  );
}

async function retryOnlyUpdatesState() {
  const api = createApiFetch({
    streamEvents,
    stateUpdateStatus: [409, 200],
  });
  const transport = createFormalTransport({
    sessionId: "session-1",
    fetchImpl: api.fetchImpl,
  });
  const session = await transport.loadSession();
  const host = createSessionHost({ session, transport, policy, errors });
  await assert.rejects(
    host.send({ text: "继续" }),
    (error) => error.code === "STATE_RULE_INVALID",
  );
  const result = await host.send(
    { text: "继续" },
    { "x-state-update-retry": "true" },
  );
  assert.deepEqual(result, { snapshotId: "snapshot-1" });
  assert.equal(
    api.requests.filter(
      (request) => request.url === "/sessions/session-1/respond/stream",
    ).length,
    1,
  );
  assert.equal(
    api.requests.filter(
      (request) => request.url === "/sessions/session-1/role-state/updates",
    ).length,
    2,
  );
}

async function floorIndexUsesPersistedSnapshots() {
  const transport = createFormalTransport({
    sessionId: "session-1",
    fetchImpl: async (url) => {
      if (String(url).startsWith("/floors?"))
        return json({
          data: [{ id: "floor-1" }, { id: "floor-without-role-snapshot" }],
          meta: {
            total: 2,
            limit: 100,
            offset: 0,
            has_more: false,
            sort_by: "floor_no",
            sort_order: "asc",
          },
        });
      if (url === "/sessions/session-1/role-view")
        return json(roleView(committed));
      throw new Error(`Unexpected request: ${url}`);
    },
  });
  assert.deepEqual(
    await transport.listFloors({ branchId: "main", limit: 100 }),
    {
      items: [
        {
          floorId: "floor-1",
          attemptId: "attempt-1",
          snapshotId: "snapshot-1",
        },
      ],
      nextCursor: null,
    },
  );
}

async function roleCatalogPersonas() {
  const requests = [];
  const client = createRoleCatalogTransport({
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      const body = options.body ? JSON.parse(options.body) : null;
      return json({
        data: {
          release: { id: "release-1" },
          session: { id: `session-${body.user_id}` },
          opening_id: body.opening_id,
        },
      });
    },
  });
  const first = await client.createSession({
    releaseId: "release-1",
    userId: "user-a",
    openingId: "first",
  });
  const second = await client.createSession({
    releaseId: "release-1",
    userId: "user-b",
    openingId: "alternate-1",
  });
  assert.equal(first.session.id, "session-user-a");
  assert.equal(second.session.id, "session-user-b");
  assert.deepEqual(
    requests.map((request) => JSON.parse(request.options.body)),
    [
      { user_id: "user-a", opening_id: "first" },
      { user_id: "user-b", opening_id: "alternate-1" },
    ],
  );
}

await streamAndCommit();
await sseError();
await retryOnlyUpdatesState();
await floorIndexUsesPersistedSnapshots();
await roleCatalogPersonas();
console.log("formal transport unit passed");

const paginationRequests = [];
const paginationClient = createRoleCatalogTransport({
  fetchImpl: async (url) => {
    paginationRequests.push(url);
    const offset = Number(
      new URL(url, "http://localhost").searchParams.get("offset"),
    );
    return json({
      data:
        offset === 0 ? [{ id: "first" }, { id: "second" }] : [{ id: "last" }],
      meta: { has_more: offset === 0 },
    });
  },
});
assert.deepEqual(
  (await paginationClient.listUsers()).map((user) => user.id),
  ["first", "second", "last"],
);
assert.ok(paginationRequests.every((url) => url.includes("limit=100")));
assert.ok(paginationRequests[1].endsWith("offset=2"));

const messageApi = createApiFetch();
const messageTransport = createFormalTransport({sessionId:'session-1',fetchImpl:messageApi.fetchImpl});
assert.equal((await messageTransport.getMessages({floorId:'floor-1'})).length,2);

const sessionQueries=[];
const sessionCatalog=createRoleCatalogTransport({fetchImpl:async url=>{
  const q=new URL(url,'http://localhost').searchParams;sessionQueries.push(q);
  return json({data:[{id:q.get('offset')==='0'?'one':'two'}],meta:{has_more:q.get('offset')==='0'}});
}});
assert.deepEqual((await sessionCatalog.listSessions('archived')).map(s=>s.id),['one','two']);
assert.ok(sessionQueries.every(q=>q.get('status')==='archived'&&q.get('limit')==='100'));
assert.equal(sessionQueries[1].get('offset'),'1');
assert.deepEqual(await createRoleCatalogTransport({fetchImpl:async()=>json({data:[],meta:{has_more:false}})}).listSessions(),[]);
await assert.rejects(createRoleCatalogTransport({fetchImpl:async()=>json({error:{code:'not_found',message:'missing'}},404)}).listSessions());

const failedStreamApi=createApiFetch({streamEvents:[streamEvents[0],{event:'error',data:{code:'GENERATION_TIMEOUT',message:'Generation timed out'}}]});
const failedTransport=createFormalTransport({sessionId:'session-1',fetchImpl:failedStreamApi.fetchImpl});
const failedSession=await failedTransport.loadSession();
const failedHost=createSessionHost({session:failedSession,transport:failedTransport,policy,errors});
const failedEvents=[];failedHost.onTextStream(e=>failedEvents.push(e));
await assert.rejects(failedHost.send({text:'继续'}));
assert.equal(failedEvents.at(-1).error.code,'GENERATION_TIMEOUT');
