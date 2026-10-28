import fs from "node:fs";
import assert from "node:assert/strict";
const config = JSON.parse(
  fs.readFileSync(
    new URL("./published-prototype.config.json", import.meta.url),
    "utf8",
  ),
);
const api = async (method, url, body) => {
  const r = await fetch(`http://localhost:${config.port}` + url, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const b = await r.json();
  assert(r.ok, `${url}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.data;
};
const evidence = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../docs/plans/evidence/published-backend/bound-worldbook-migration.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const results = [];
for (const e of evidence) {
  const old = await api("GET", `/role-releases/${e.previousReleaseId}`);
  const current = await api("GET", `/role-releases/${e.releaseId}`);
  assert(old.character_snapshot.characterBook);
  assert(!current.character_snapshot.characterBook);
  assert.equal(current.worldbook_id, e.worldbookId);
  const book = await api("GET", `/worldbooks/${e.worldbookId}`);
  assert.equal(Object.keys(book.data.entries).length, e.entryCount);
  const outputs = [];
  for (const releaseId of [e.previousReleaseId, e.releaseId]) {
    const created = await api(
      "POST",
      `/role-releases/${releaseId}/sessions`,
      {},
    );
    try {
      outputs.push(
        await api("POST", `/sessions/${created.session.id}/respond/dry-run`, {
          message: "今天的天气怎么样？",
          debug_options: { include_worldbook_matches: true },
        }),
      );
    } finally {
      await api("DELETE", `/sessions/${created.session.id}`);
    }
  }
  assert.deepEqual(
    outputs[1].messages,
    outputs[0].messages,
    "Published prompt content must be unchanged",
  );
  const trace = JSON.stringify(outputs[1].prompt_snapshot);
  assert(
    trace.includes(e.worldbookId),
    "Prompt snapshot must reference the bound worldbook",
  );
  const delivery =
    current.character_snapshot.extensions.tavern_headless.runtimeDelivery;
  for (const url of [
    delivery.scriptUrl,
    ...Object.values(delivery.assets).map((a) => a.url),
  ]) {
    const r = await fetch(`http://localhost:${config.port}` + url);
    assert(r.ok, `Asset ${url}: ${r.status}`);
    await r.arrayBuffer();
  }
  results.push({
    characterId: e.characterId,
    entryCount: e.entryCount,
    promptMessagesIdentical: true,
    externalBinding: true,
    assets: true,
  });
}
fs.writeFileSync(
  new URL(
    "../../../../docs/plans/evidence/published-backend/bound-worldbook-check.json",
    import.meta.url,
  ),
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results));
