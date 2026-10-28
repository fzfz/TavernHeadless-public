import assert from "node:assert/strict";
import {
  generationDetailsUrl,
  listGenerationFloors,
  loadGenerationDetail,
} from "../shared/formal-generation-details.prototype.js";
const calls = [];
const floor = { id: "a", floor_no: 2, state: "committed" };
const client = {
  async request(path) {
    calls.push(path);
    if (path.startsWith("/floors?"))
      return path.includes("offset=0")
        ? { data: [floor], meta: { has_more: true } }
        : { data: [{ id: "b", floor_no: 1 }], meta: { has_more: false } };
    if (path.endsWith("/run")) return { run: { run_id: "real-run" } };
    if (path.endsWith("/result")) return { generated_text: "reply" };
    if (path.startsWith("/pages?")) return [{ id: "p", page_kind: "input" }];
    if (path.startsWith("/messages?")) return [{ content: "hello" }];
    throw new Error(path);
  },
};
assert.equal((await listGenerationFloors(client, "s"))[0].id, "a");
assert.ok(calls.some((p) => p.includes("offset=100")));
const result = await loadGenerationDetail(client, floor);
assert.equal(result.run.run.run_id, "real-run");
assert.equal(result.pages[0].messages[0].content, "hello");
calls.length = 0;
assert.equal(
  (await loadGenerationDetail(client, { ...floor, state: "failed" })).result,
  null,
);
assert.ok(!calls.some((p) => p.endsWith("/result")));
assert.deepEqual(
  await listGenerationFloors(
    { request: async () => ({ data: [], meta: { has_more: false } }) },
    "s",
  ),
  [],
);
await assert.rejects(
  () =>
    listGenerationFloors(
      {
        request: async () => {
          throw Error("NETWORK_ERROR");
        },
      },
      "s",
    ),
  /NETWORK_ERROR/,
);
await assert.rejects(
  () =>
    loadGenerationDetail(
      {
        request: async () => {
          throw Error("NOT_FOUND");
        },
      },
      floor,
    ),
  /NOT_FOUND/,
);
console.log(
  "generation details: pagination, messages, run, completed/failed/empty/errors passed",
);
const openingCalls = [];
const openingClient = {
  request: async (path) => {
    openingCalls.push(path);
    if (path.endsWith("/run"))
      return { floor_id: "opening", state: "committed", run: null };
    if (path.startsWith("/pages?"))
      return [{ id: "opening-page", page_kind: "output" }];
    if (path.startsWith("/messages?")) return [{ content: "开场内容" }];
    throw new Error("Opening has no generation result");
  },
};
const opening = await loadGenerationDetail(openingClient, {
  id: "opening",
  floor_no: 0,
  state: "committed",
});
assert.equal(opening.result, null);
assert.equal(opening.pages[0].messages[0].content, "开场内容");
assert(!openingCalls.some((path) => path.endsWith("/result")));

const link = new URL(generationDetailsUrl('s /&','floor?x'), 'http://localhost');
assert.equal(link.searchParams.get('session'), 's /&');
assert.equal(link.searchParams.get('floor'), 'floor?x');
assert.equal(link.searchParams.get('source'), 'backend');
assert.equal(new URL(generationDetailsUrl('s'), 'http://localhost').searchParams.has('floor'),false);
