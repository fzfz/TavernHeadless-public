import { request as httpRequest } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const config = await json(process.argv[2]);
const prior = await json(process.argv[3]);
const output = process.argv[4];
const result =
  process.argv[5] === "resume"
    ? await json(output)
    : { status: "running", dataRoot: config.dataRoot, flows: [] };
result.status = "running";
delete result.error;
const save = () => writeFile(output, JSON.stringify(result, null, 2) + "\n");
const base = `http://127.0.0.1:${config.apiPort}`;
async function request(path, body) {
  const response = await fetch(base + path, {
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, `${path}: ${response.status}`);
  return (await response.json()).data;
}
try {
  for (const flow of prior.flows) {
    if (result.flows.some((done) => done.sessionId === flow.sessionId))
      continue;
    const view = await request(`/sessions/${flow.sessionId}/role-view`);
    const expected = flow.turns.at(-1).snapshot.snapshotId;
    assert.equal(view.current.snapshotId, expected);
    for (const turn of flow.turns) {
      const messages = await request(
        `/sessions/${flow.sessionId}/role-messages?floor_id=${turn.floorId}`,
      );
      assert(messages.some((m) => m.role === "assistant" && m.content.length));
      const calls = await request(`/floors/${turn.floorId}/model-calls`);
      assert(calls.some((c) => c.call.purpose === "narration"));
      assert(calls.some((c) => c.call.purpose === "state_update"));
    }
    let floorId = view.processing.pendingStateFloorId;
    if (!floorId) {
      const body = JSON.stringify({
        message:
          flow.message ??
          (flow.role === "linqian"
            ? "我点点头，继续听林茜说刚才的事情。"
            : "我把乐谱翻回刚才那一页，低声问她下一处应该怎么配合。"),
        generation_params: { max_output_tokens: 32768 },
      });
      const text = await new Promise((resolve, reject) => {
        const req = httpRequest(
          base + `/sessions/${flow.sessionId}/respond/stream`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (text += chunk));
            res.on("end", () =>
              res.statusCode === 200
                ? resolve(text)
                : reject(new Error(`HTTP ${res.statusCode}: ${text}`)),
            );
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end(body);
      });
      const events = text.split(/\r?\n\r?\n/).map((block) => {
        const lines = block.split(/\r?\n/);
        const data = lines
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        return {
          type: lines
            .find((l) => l.startsWith("event:"))
            ?.slice(6)
            .trim(),
          data: data ? JSON.parse(data) : null,
        };
      });
      const done = events.find((e) => e.type === "done");
      assert(done, `Restored generation failed ${flow.role}/${flow.mode}`);
      floorId = done.data.floor_id;
    }
    const completedMessages = await request(
      `/sessions/${flow.sessionId}/role-messages?floor_id=${floorId}`,
    );
    assert(
      completedMessages.some(
        (message) =>
          message.role === "assistant" && message.content.trim().length > 0,
      ),
      `Empty narration ${flow.role}/${flow.mode}/${floorId}`,
    );
    const snapshot = await request(
      `/sessions/${flow.sessionId}/role-state/updates`,
      { floor_id: floorId },
    );
    const calls = await request(`/floors/${floorId}/model-calls`);
    assert.equal(calls.filter((c) => c.call.status === "succeeded").length, 2);
    result.flows.push({
      role: flow.role,
      mode: flow.mode,
      sessionId: flow.sessionId,
      previousSnapshotId: expected,
      floorId,
      snapshotId: snapshot.snapshotId,
      calls: calls.map((c) => ({
        id: c.call.callId,
        status: c.call.status,
        purpose: c.call.purpose,
      })),
    });
    await save();
    console.log(
      JSON.stringify({
        role: flow.role,
        mode: flow.mode,
        floorId,
        status: "passed",
      }),
    );
  }
  result.status = "passed";
  await save();
} catch (error) {
  result.status = "failed";
  result.error = error.message;
  await save();
  throw error;
}
