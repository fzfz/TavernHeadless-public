import assert from "node:assert/strict";
const origin = process.argv[2] || "http://127.0.0.1:43872";
const read = async (path) => (await fetch(origin + path)).json();
const create = async (body) => {
  const response = await fetch(origin + "/script-api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const seed = await read("/script-api/sessions/script-gushengman");
const params = {
  characterId: seed.characterId,
  versionId: seed.versionId,
  openingId: "alternate-1",
};
const story = seed.openings.items.find((item) => item.id === "alternate-1");
assert.equal(story.kind, "story");
const a = await create(params),
  b = await create(params);
assert.equal(a.status, 201);
assert.equal(b.status, 201);
assert.notEqual(a.body.sessionId, b.body.sessionId);
assert.notEqual(a.body.branchId, b.body.branchId);
assert.equal(a.body.opening.id, "alternate-1");
assert.equal(a.body.delivery.data.opening, story.displayText);
assert.deepEqual(a.body.initial.variables, story.variables);
assert.equal(a.body.current.floorId, null);
assert.deepEqual(
  await read("/script-api/sessions/" + a.body.sessionId),
  a.body,
);
for (const [patch, status, code] of [
  [{ openingId: "missing" }, 400, "OPENING_NOT_FOUND"],
  [{ versionId: "missing" }, 404, "VERSION_NOT_FOUND"],
  [{ characterId: "missing" }, 404, "VERSION_NOT_FOUND"],
  [{ extra: true }, 400, "INVALID_REQUEST"],
]) {
  const result = await create({ ...params, ...patch });
  assert.equal(result.status, status);
  assert.equal(result.body.error.code, code);
}
const intro = await create({ ...params, openingId: "first" });
assert.equal(intro.status, 201);
assert.equal(intro.body.opening.kind, "introduction");
assert.equal(
  intro.body.delivery.data.opening,
  seed.openings.items.find((item) => item.id === "first").displayText,
);
assert.deepEqual(
  await read("/script-api/sessions/" + intro.body.sessionId),
  intro.body,
);
assert.notEqual(intro.body.sessionId, a.body.sessionId);
const versions = await read("/characters/gushengman/versions");
assert.deepEqual(
  versions.data.find((v) => v.id === seed.versionId).snapshot.extensions
    .tavern_headless.openings,
  seed.openings,
);
assert.deepEqual(await read("/script-api/sessions/script-gushengman"), seed);
console.log(
  "System opening selection: creation, isolation, reload, version persistence and four rejection cases passed",
);

for (const name of ["linqian", "gushengman"]) {
  const session = await read("/script-api/sessions/script-" + name);
  const versions = await read("/characters/" + name + "/versions");
  const source = versions.data.find((v) => v.id === session.versionId).snapshot;
  const originals = [source.greeting, ...source.alternateGreetings];
  assert.deepEqual(
    session.openings.items.map((item) => item.text),
    originals,
  );
  for (const item of session.openings.items) {
    const created = await create({
      characterId: name,
      versionId: session.versionId,
      openingId: item.id,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.delivery.data.opening, item.displayText);
  }
}
console.log(
  "Every main and alternate opening from both original cards is selectable",
);

const lin = await read("/script-api/sessions/script-linqian");
const alternate = await create({
  characterId: lin.characterId,
  versionId: lin.versionId,
  openingId: "alternate-1",
});
assert.equal(alternate.body.initial.variables.世界.日期, "2025-04-04");
assert.equal(alternate.body.initial.variables.世界.地点, "局子街55号401画室");
assert.equal(alternate.body.initial.variables.林茜.感情, 694);
assert(!alternate.body.delivery.data.opening.includes("<UpdateVariable>"));
assert(alternate.body.initial.variables.行动选项[0].includes("401画室"));
