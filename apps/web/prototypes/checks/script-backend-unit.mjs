import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const backendRoot = path.resolve(
  process.argv[2] || "/srv/tavern/TavernHeadless",
);
const sqlitePackage = path.resolve(
  process.argv[3] ||
    "/srv/tavern/TavernHeadless-inspect-20260914/node_modules/.pnpm/better-sqlite3@12.8.0/node_modules/better-sqlite3",
);
const tsx = path.join(backendRoot, "node_modules/.bin/tsx");
const serverScript = path.join(
  repositoryRoot,
  "apps/web/prototypes/checks/serve-script-prototype.mjs",
);
const ajvPackage =
  "/srv/tavern/TavernHeadless/node_modules/.pnpm/ajv@8.17.1/node_modules/ajv";
const requireAjv = createRequire(path.join(ajvPackage, "package.json"));
const Ajv = requireAjv("./dist/ajv.js");
const transportSchema = JSON.parse(
  fs.readFileSync(
    path.join(
      repositoryRoot,
      "apps/web/prototypes/shared/script-transport.schema.json",
    ),
    "utf8",
  ),
);
const runtimeSchema = JSON.parse(
  fs.readFileSync(
    path.join(
      repositoryRoot,
      "docs/character-authoring/script-runtime.schema.json",
    ),
    "utf8",
  ),
);
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(runtimeSchema);
const validateEnvelope = ajv.compile(transportSchema);
const compileTransport = (definition) =>
  ajv.compile({
    $schema: transportSchema.$schema,
    definitions: transportSchema.definitions,
    $ref: `#/definitions/${definition}`,
  });
const validateCatalog = compileTransport("catalog");
const validateSession = compileTransport("session");
const validateFloorPage = compileTransport("floorPage");
const validateMessages = compileTransport("messageList");
const validateRegistry = compileTransport("characterRegistry");
const validateScenario = compileTransport("scenario");

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function startServer(extraEnv = {}) {
  const child = spawn(tsx, [serverScript, backendRoot, "0", sqlitePackage], {
    cwd: repositoryRoot,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value) => {
    stdout += value;
  });
  child.stderr.on("data", (value) => {
    stderr += value;
  });
  const started = await Promise.race([
    new Promise((resolve, reject) => {
      const inspect = () => {
        const line = stdout
          .split(/\r?\n/)
          .find((value) => value.startsWith("{"));
        if (line) {
          try {
            resolve(JSON.parse(line));
          } catch (error) {
            reject(error);
          }
        }
      };
      child.stdout.on("data", inspect);
      child.once("exit", (code) => {
        reject(
          new Error(
            `Server exited before startup (${code})\n${stdout}\n${stderr}`,
          ),
        );
      });
    }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Server startup timed out\n${stderr}`)),
        20000,
      ),
    ),
  ]);
  return {
    child,
    origin: started.url,
    output: () => ({ stdout, stderr }),
  };
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  const exited = waitForExit(server.child);
  server.child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Server did not stop")), 5000),
    ),
  ]);
}

async function json(origin, pathname, options) {
  const response = await fetch(origin + pathname, options);
  const body = await response.json();
  return { response, body };
}

async function send(origin, sessionId, text, scenario = "normal") {
  const response = await fetch(
    `${origin}/script-api/sessions/${encodeURIComponent(sessionId)}/send`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-prototype-scenario": scenario,
      },
      body: JSON.stringify({ text }),
    },
  );
  if (response.status !== 200) {
    assert.fail(
      `Expected send status 200, received ${response.status}: ${await response.text()}`,
    );
  }
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/x-ndjson/,
  );
  const envelopes = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const envelope of envelopes) {
    assert(validateEnvelope(envelope), JSON.stringify(validateEnvelope.errors));
  }
  return envelopes;
}

async function readUntilEnvelope(response, type) {
  assert(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const envelopes = [];
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const envelope = JSON.parse(line);
      assert(
        validateEnvelope(envelope),
        JSON.stringify(validateEnvelope.errors),
      );
      envelopes.push(envelope);
      if (envelope.type === type) return { reader, decoder, buffer, envelopes };
    }
    if (done) throw new Error(`Stream ended before ${type}`);
  }
}

async function drainEnvelopeReader(state) {
  const envelopes = [...state.envelopes];
  let buffer = state.buffer;
  while (true) {
    const { done, value } = await state.reader.read();
    buffer += state.decoder.decode(value, { stream: !done });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const envelope = JSON.parse(line);
      assert(
        validateEnvelope(envelope),
        JSON.stringify(validateEnvelope.errors),
      );
      envelopes.push(envelope);
    }
    if (done) return envelopes;
  }
}

async function waitForSession(origin, sessionId, predicate) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const result = await json(
      origin,
      `/script-api/sessions/${encodeURIComponent(sessionId)}`,
    );
    if (result.response.status === 200 && predicate(result.body)) {
      return result.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Session ${sessionId} did not reach the expected state`);
}

function createInvalidFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "script-backend-invalid-"),
  );
  const character = path.join(root, "characters/bad");
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  fs.mkdirSync(character, { recursive: true });
  fs.writeFileSync(
    path.join(root, "shared/script-characters.json"),
    JSON.stringify([{ id: "bad", name: "Bad", directory: "characters/bad" }]),
  );
  fs.writeFileSync(
    path.join(character, "manifest.json"),
    JSON.stringify({
      apiVersion: 1,
      html: "../escape.html",
      css: "view.css",
      script: "main.js",
      assets: {},
      data: {},
    }),
  );
  fs.writeFileSync(
    path.join(character, "scenario.json"),
    JSON.stringify({
      initial: {},
      turns: [{ text: "x", variables: {} }],
      failureText: "fail",
    }),
  );
  fs.writeFileSync(path.join(character, "view.css"), "");
  fs.writeFileSync(
    path.join(character, "main.js"),
    "export function mount() {}\n",
  );
  return root;
}

const server = await startServer();
try {
  const registry = JSON.parse(
    fs.readFileSync(
      path.join(
        repositoryRoot,
        "apps/web/prototypes/shared/script-characters.json",
      ),
      "utf8",
    ),
  );
  assert(validateRegistry(registry), JSON.stringify(validateRegistry.errors));
  for (const item of registry) {
    const scenario = JSON.parse(
      fs.readFileSync(
        path.join(
          repositoryRoot,
          "apps/web/prototypes",
          item.directory,
          "scenario.json",
        ),
        "utf8",
      ),
    );
    assert(validateScenario(scenario), JSON.stringify(validateScenario.errors));
  }
  const catalogResult = await json(server.origin, "/script-api/catalog");
  assert.equal(catalogResult.response.status, 200);
  assert(
    validateCatalog(catalogResult.body),
    JSON.stringify(validateCatalog.errors),
  );
  assert.deepEqual(
    catalogResult.body.map((item) => item.id),
    ["harbor", "novel", "expedition", "cinema", "linqian", "gushengman"],
  );

  for (const item of catalogResult.body) {
    const result = await json(
      server.origin,
      `/script-api/sessions/${encodeURIComponent(item.sessionId)}`,
    );
    assert.equal(result.response.status, 200);
    assert(
      validateSession(result.body),
      JSON.stringify(validateSession.errors),
    );
    assert.equal(result.body.sessionId, item.sessionId);
    assert.equal(result.body.versionId, item.versionId);
    assert.equal(result.body.initial.versionId, item.versionId);
    assert.equal(result.body.current.versionId, item.versionId);
    assert.equal(result.body.delivery.data.characterName.length > 0, true);
    assert.match(
      result.body.delivery.scriptUrl,
      new RegExp(`/versions/${item.versionId}/files/`),
    );
    assert.equal(
      result.body.capabilities.customFloors,
      ["harbor", "novel", "expedition"].includes(item.id),
    );
    const versionedScript = await fetch(
      server.origin + result.body.delivery.scriptUrl,
    );
    assert.equal(versionedScript.status, 200);
    assert.match(
      versionedScript.headers.get("cache-control") ?? "",
      /immutable/,
    );
    assert.deepEqual(result.body.messages, []);
    if (["linqian", "gushengman"].includes(item.id)) {
      const stored = await json(
        server.origin,
        `/characters/${item.id}/versions`,
      );
      assert.equal(stored.response.status, 200);
      const original = JSON.parse(
        fs.readFileSync(
          path.join(
            repositoryRoot,
            "apps/web/prototypes/characters",
            item.id,
            "source-card.json",
          ),
          "utf8",
        ),
      ).data;
      assert.equal(
        stored.body.data.find((version) => version.id === item.versionId)
          .snapshot.description,
        original.description,
      );
      assert.deepEqual(
        stored.body.data.find((version) => version.id === item.versionId)
          .snapshot.characterBook,
        original.character_book,
      );
      assert.deepEqual(
        stored.body.data.find((version) => version.id === item.versionId)
          .snapshot.extensions.regex_scripts,
        original.extensions.regex_scripts,
      );
    }
  }

  const moduleResponse = await fetch(
    server.origin +
      "/prototype/apps/web/prototypes/checks/serve-script-prototype.mjs",
  );
  assert.equal(moduleResponse.status, 200);
  assert.match(
    moduleResponse.headers.get("content-type") ?? "",
    /text\/javascript/,
  );

  const invalidBody = await json(
    server.origin,
    "/script-api/sessions/script-harbor/send",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "", extra: true }),
    },
  );
  assert.equal(invalidBody.response.status, 400);
  assert.equal(invalidBody.body.error.code, "INVALID_REQUEST");

  const overlappingFirst = await fetch(
    server.origin + "/script-api/sessions/script-novel/send",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-prototype-scenario": "interleaved",
      },
      body: JSON.stringify({ text: "overlap first" }),
    },
  );
  assert.equal(overlappingFirst.status, 200);
  const firstThroughCompleted = await readUntilEnvelope(
    overlappingFirst,
    "completed",
  );
  const overlappingSecond = await fetch(
    server.origin + "/script-api/sessions/script-novel/send",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "overlap second" }),
    },
  );
  assert.equal(overlappingSecond.status, 200);
  const firstOverlapEvents = await drainEnvelopeReader(firstThroughCompleted);
  const overlappingThird = await json(
    server.origin,
    "/script-api/sessions/script-novel/send",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "must remain busy" }),
    },
  );
  assert.equal(overlappingThird.response.status, 409);
  assert.equal(overlappingThird.body.error.code, "SEND_BUSY");
  const secondOverlapEvents = (await overlappingSecond.text())
    .trim()
    .split("\n")
    .map(JSON.parse);
  const firstOverlapCommit = firstOverlapEvents.find(
    (event) => event.type === "commit",
  );
  const secondOverlapCommit = secondOverlapEvents.find(
    (event) => event.type === "commit",
  );
  const firstOverlapCurrent = firstOverlapEvents.find(
    (event) => event.type === "current",
  );
  assert.notEqual(
    firstOverlapCommit.data.after.floorId,
    secondOverlapCommit.data.after.floorId,
  );
  assert.equal(
    secondOverlapCommit.data.before.snapshotId,
    firstOverlapCommit.data.after.snapshotId,
  );
  assert.equal(
    secondOverlapCommit.data.previousCurrentSnapshotId,
    firstOverlapCurrent.data.snapshotId,
  );
  const novelAfterOverlap = await json(
    server.origin,
    "/script-api/sessions/script-novel",
  );
  assert.equal(
    novelAfterOverlap.body.current.snapshotId,
    secondOverlapCommit.data.after.snapshotId,
  );

  const disconnectedMain = await fetch(
    server.origin + "/script-api/sessions/script-expedition/send",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-prototype-scenario": "disconnect-main",
      },
      body: JSON.stringify({ text: "disconnect before commit" }),
    },
  );
  assert.equal(disconnectedMain.status, 200);
  await assert.rejects(disconnectedMain.text());
  const recoveredMain = await waitForSession(
    server.origin,
    "script-expedition",
    (session) => session.current.floorId !== null,
  );
  assert.equal(recoveredMain.current.source.kind, "floor");
  const afterMainDisconnect = await send(
    server.origin,
    "script-expedition",
    "send after main disconnect",
  );
  assert.equal(afterMainDisconnect.at(-1).type, "completed");

  const disconnectedJob = await fetch(
    server.origin + "/script-api/sessions/script-expedition/send",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-prototype-scenario": "disconnect-job",
      },
      body: JSON.stringify({ text: "disconnect after completed" }),
    },
  );
  assert.equal(disconnectedJob.status, 200);
  const jobThroughCompleted = await readUntilEnvelope(
    disconnectedJob,
    "completed",
  );
  await assert.rejects(drainEnvelopeReader(jobThroughCompleted));
  const recoveredJob = await waitForSession(
    server.origin,
    "script-expedition",
    (session) => session.current.source.kind === "job",
  );
  const recoveredJobMessages = await json(
    server.origin,
    `/script-api/sessions/script-expedition/messages?branchId=branch-expedition&floorId=${encodeURIComponent(recoveredJob.current.floorId)}&attemptId=${encodeURIComponent(recoveredJob.current.attemptId)}`,
  );
  assert.equal(recoveredJobMessages.response.status, 200);
  assert.equal(
    recoveredJobMessages.body.some((message) => message.role === "agent"),
    true,
  );

  const activeResponse = await fetch(
    server.origin + "/script-api/sessions/script-harbor/send",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "busy gate" }),
    },
  );
  assert.equal(activeResponse.status, 200);
  const busy = await json(
    server.origin,
    "/script-api/sessions/script-harbor/send",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "must wait" }),
    },
  );
  assert.equal(busy.response.status, 409);
  assert.equal(busy.body.error.code, "SEND_BUSY");
  const activeEnvelopes = (await activeResponse.text())
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    activeEnvelopes.map((event) => event.type),
    ["text", "text", "text", "commit", "completed"],
  );

  const interleaved = await send(
    server.origin,
    "script-harbor",
    "background work",
    "interleaved",
  );
  const completedIndex = interleaved.findIndex(
    (event) => event.type === "completed",
  );
  const currentIndex = interleaved.findIndex(
    (event) => event.type === "current",
  );
  assert(completedIndex >= 0 && currentIndex > completedIndex);
  assert.equal(interleaved[currentIndex].data.source.kind, "job");
  const firstCommit = activeEnvelopes.find(
    (event) => event.type === "commit",
  ).data;
  const firstSnapshot = structuredClone(firstCommit.after);

  const floorMessages = await json(
    server.origin,
    `/script-api/sessions/script-harbor/messages?branchId=branch-harbor&floorId=${encodeURIComponent(firstCommit.after.floorId)}&attemptId=${encodeURIComponent(firstCommit.after.attemptId)}`,
  );
  assert.equal(floorMessages.response.status, 200);
  assert(
    validateMessages(floorMessages.body),
    JSON.stringify(validateMessages.errors),
  );
  assert.deepEqual(
    floorMessages.body.map((message) => message.role),
    ["user", "assistant"],
  );
  const uncommittedMessages = await json(
    server.origin,
    `/script-api/sessions/script-harbor/messages?branchId=branch-harbor&floorId=${encodeURIComponent(firstCommit.after.floorId)}&attemptId=missing`,
  );
  assert.equal(uncommittedMessages.response.status, 409);
  assert.equal(uncommittedMessages.body.error.code, "VARIABLES_NOT_COMMITTED");

  const floorVariables = await json(
    server.origin,
    `/script-api/sessions/script-harbor/floor/${encodeURIComponent(firstCommit.after.floorId)}?branchId=branch-harbor&attemptId=${encodeURIComponent(firstCommit.after.attemptId)}`,
  );
  assert.equal(floorVariables.response.status, 200);
  assert.deepEqual(floorVariables.body.after, firstSnapshot);
  const uncommitted = await json(
    server.origin,
    `/script-api/sessions/script-harbor/floor/${encodeURIComponent(firstCommit.after.floorId)}?branchId=branch-harbor&attemptId=missing`,
  );
  assert.equal(uncommitted.response.status, 409);
  assert.equal(uncommitted.body.error.code, "VARIABLES_NOT_COMMITTED");

  for (let index = 0; index < 100; index += 1) {
    const events = await send(
      server.origin,
      "script-harbor",
      `turn ${index + 1}`,
    );
    assert.equal(events.at(-1).type, "completed");
  }

  const immutable = await json(
    server.origin,
    `/script-api/sessions/script-harbor/snapshots/${encodeURIComponent(firstSnapshot.snapshotId)}`,
  );
  assert.equal(immutable.response.status, 200);
  assert.deepEqual(immutable.body, firstSnapshot);

  const firstPage = await json(
    server.origin,
    "/script-api/sessions/script-harbor/floors?branchId=branch-harbor&limit=1",
  );
  assert.equal(firstPage.response.status, 200);
  assert(
    validateFloorPage(firstPage.body),
    JSON.stringify(validateFloorPage.errors),
  );
  assert(firstPage.body.nextCursor);
  const fixedCutoff = 102;
  await send(server.origin, "script-harbor", "newer than cursor");
  const cursorItems = [...firstPage.body.items];
  let cursor = firstPage.body.nextCursor;
  while (cursor) {
    const page = await json(
      server.origin,
      `/script-api/sessions/script-harbor/floors?branchId=branch-harbor&limit=100&cursor=${encodeURIComponent(cursor)}`,
    );
    assert.equal(page.response.status, 200);
    assert(
      validateFloorPage(page.body),
      JSON.stringify(validateFloorPage.errors),
    );
    cursorItems.push(...page.body.items);
    cursor = page.body.nextCursor;
  }
  assert.equal(cursorItems.length, fixedCutoff);

  for (const limit of [0, 101]) {
    const invalidLimit = await json(
      server.origin,
      `/script-api/sessions/script-harbor/floors?branchId=branch-harbor&limit=${limit}`,
    );
    assert.equal(invalidLimit.response.status, 400);
  }
  const invalidCursor = await json(
    server.origin,
    "/script-api/sessions/script-harbor/floors?branchId=branch-harbor&cursor=bad",
  );
  assert.equal(invalidCursor.response.status, 400);
  assert.equal(invalidCursor.body.error.code, "INVALID_CURSOR");

  const beforeFailure = await json(
    server.origin,
    "/script-api/sessions/script-harbor",
  );
  const floorsBeforeFailure = await json(
    server.origin,
    "/script-api/sessions/script-harbor/floors?branchId=branch-harbor&limit=100",
  );
  const failed = await send(
    server.origin,
    "script-harbor",
    "forced failure",
    "fail",
  );
  assert.equal(
    failed.some((event) => event.type === "commit"),
    false,
  );
  assert.equal(
    failed.some((event) => event.type === "completed"),
    false,
  );
  assert.equal(failed.at(-1).data.code, "GENERATION_FAILED");
  const afterFailure = await json(
    server.origin,
    "/script-api/sessions/script-harbor",
  );
  const floorsAfterFailure = await json(
    server.origin,
    "/script-api/sessions/script-harbor/floors?branchId=branch-harbor&limit=100",
  );
  assert.deepEqual(afterFailure.body.current, beforeFailure.body.current);
  assert.deepEqual(floorsAfterFailure.body, floorsBeforeFailure.body);

  const cancelled = await send(
    server.origin,
    "script-harbor",
    "forced cancellation",
    "cancel",
  );
  assert.equal(
    cancelled.some((event) => event.type === "commit"),
    false,
  );
  assert.equal(cancelled.at(-1).data.code, "GENERATION_CANCELLED");

  const missingSnapshot = await json(
    server.origin,
    "/script-api/sessions/script-harbor/snapshots/missing",
  );
  assert.equal(missingSnapshot.response.status, 404);
  assert.equal(missingSnapshot.body.error.code, "SNAPSHOT_NOT_FOUND");
} finally {
  await stopServer(server);
}

const invalidRoot = createInvalidFixture();
try {
  const child = spawn(tsx, [serverScript, backendRoot, "0", sqlitePackage], {
    cwd: repositoryRoot,
    env: { ...process.env, SCRIPT_PROTOTYPE_ROOT: invalidRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value) => {
    output += value;
  });
  child.stderr.on("data", (value) => {
    output += value;
  });
  const exited = await Promise.race([
    waitForExit(child),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Invalid package server did not exit")),
        20000,
      ),
    ),
  ]);
  assert.notEqual(exited.code, 0);
  assert.match(output, /html leaves/);
} finally {
  fs.rmSync(invalidRoot, { recursive: true, force: true });
}

console.log(
  "Script backend passed package, identity, busy, stream, 100-turn, history, pagination, failure, cancellation, and invalid-package checks",
);
