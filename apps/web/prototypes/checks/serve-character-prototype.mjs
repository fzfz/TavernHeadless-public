import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
const backend = process.argv[2];
// Resolve the same installed SQLite package version from an explicit dependency directory.
if (process.argv[4])
  registerHooks({
    resolve(specifier, context, next) {
      return specifier === "better-sqlite3"
        ? {
            url: pathToFileURL(path.join(process.argv[4], "lib/index.js")).href,
            shortCircuit: true,
          }
        : next(specifier, context);
    },
  });
const root = path.resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const { buildTestApp: buildApp } = await import(
  pathToFileURL(path.join(backend, "apps/api/test/helpers/create-test-db.ts"))
);
const schema = await import(
  pathToFileURL(path.join(backend, "apps/api/src/db/schema.ts"))
);
const { app, database } = await buildApp({
  databasePath: ":memory:",
  logger: false,
  enableWebSocket: false,
  enableMemory: false,
  enableSseChat: false,
  enableAgentRuntimeWorker: false,
  enableNodeGraphWorker: false,
});
await import(
  pathToFileURL(
    path.join(root, "apps/web/prototypes/shared/card-contract.prototype.js"),
  )
);
globalThis.CardErrors = JSON.parse(
  fs.readFileSync(
    path.join(root, "apps/web/prototypes/shared/card-errors.json"),
    "utf8",
  ),
);
const cardSchema = JSON.parse(
  fs.readFileSync(
    path.join(root, "apps/web/prototypes/shared/card-contract.schema.json"),
    "utf8",
  ),
);
const fixtureTurns = JSON.parse(
  fs.readFileSync(
    path.join(root, "apps/web/prototypes/shared/card-turns.fixture.json"),
    "utf8",
  ),
);
const displaySessions = new Map();
app.post("/prototype-runtime/respond", async (request, reply) => {
  const b = request.body;
  const fail = (code, message) =>
    reply.code(409).send({ error: { code, message } });
  const requestIssue = CardContract.check(
    b,
    cardSchema.definitions.request,
    cardSchema,
  );
  if (requestIssue || Boolean(b.text) === Boolean(b.actionId))
    return fail("INVALID_REQUEST", CardErrors.INVALID_REQUEST);
  const version = database
    .select()
    .from(schema.characterVersions)
    .all()
    .find((v) => v.id === b.versionId && v.characterId === b.cardId);
  if (!version) return fail("VERSION_NOT_FOUND", CardErrors.VERSION_NOT_FOUND);
  const pkg = JSON.parse(version.dataJson).extensions?.tavern_headless
    ?.card_view;
  const issue = CardContract.validate(pkg, cardSchema);
  if (issue) return fail("INVALID_PACKAGE", CardContract.explain(issue));
  let state = displaySessions.get(b.sessionId);
  if (!state)
    state = {
      versionId: b.versionId,
      cardId: b.cardId,
      branchId: b.branchId,
      snapshotId: "initial",
      variables: structuredClone(pkg.initial),
      index: 0,
    };
  if (
    state.versionId !== b.versionId ||
    state.cardId !== b.cardId ||
    state.branchId !== b.branchId ||
    state.snapshotId !== b.expectedSnapshotId
  )
    return fail("STALE_SNAPSHOT", CardErrors.STALE_SNAPSHOT);
  if (b.actionId) {
    const a = pkg.actions[b.actionId],
      ctx = { current: state.variables };
    if (a?.type !== "chat.send" || !CardContract.condition(a.when, ctx))
      return fail("ACTION_UNAVAILABLE", CardErrors.ACTION_UNAVAILABLE);
    b.text = String(CardContract.value(a.text, ctx));
  }
  const turn = fixtureTurns[b.cardId]?.[state.index];
  if (!turn) return fail("FIXTURE_EXHAUSTED", CardErrors.FIXTURE_EXHAUSTED);
  const invalid = CardContract.variables(pkg, turn.variables);
  if (invalid) return fail("INVALID_VARIABLES", CardContract.explain(invalid));
  const record = {
    snapshotId: b.attemptId + ":display",
    sessionId: b.sessionId,
    branchId: b.branchId,
    floorId: b.floorId,
    attemptId: b.attemptId,
    versionId: b.versionId,
    variables: structuredClone(turn.variables),
    text: turn.text,
    input: b.text,
  };
  state = {
    ...state,
    index: state.index + 1,
    snapshotId: record.snapshotId,
    variables: record.variables,
  };
  displaySessions.set(b.sessionId, state);
  return { data: record };
});
app.get("/prototype/*", async (request, reply) => {
  const filename = path.resolve(root, request.params["*"]);
  if (!filename.startsWith(root + path.sep)) return reply.code(403).send();
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".wav": "audio/wav",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
  };
  reply.type(types[path.extname(filename)] || "application/octet-stream");
  return fs.readFileSync(filename);
});
const account = database.select().from(schema.accounts).all()[0];
const cards = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "apps/web/prototypes/shared/characters.seed.prototype.json",
    ),
    "utf8",
  ),
);
for (const { id, snapshot } of cards) {
  const issue = CardContract.validate(
    snapshot.extensions.tavern_headless.card_view,
    cardSchema,
  );
  if (issue) throw Error(id + ": " + issue);
  database
    .insert(schema.characters)
    .values({
      id,
      name: snapshot.name,
      accountId: account.id,
      source: "native",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  const response = await app.inject({
    method: "POST",
    url: `/characters/${id}/versions`,
    payload: { snapshot },
  });
  if (response.statusCode >= 300) throw Error(response.body);
}
const origin = await app.listen({
  host: "127.0.0.1",
  port: Number(process.argv[3] || 0),
});
console.log(
  JSON.stringify({
    url: origin,
    mode: "real-character-api-isolated-memory-database",
  }),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
