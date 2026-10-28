import fs from "node:fs";
import { createBoundPrompt } from "./bound-prompt.mjs";
import { runFollowups } from "./live-followups.mjs";
import { loadCredentials, generateLiveTurn } from "./openrouter-live.mjs";
import { importOpenings } from "../shared/import-openings.js";
import path from "node:path";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const backendRoot = path.resolve(process.argv[2] || process.cwd());
const port = Number(process.argv[3] || 0);
const sqlitePackage = process.argv[4];
const backendWorkspaceModules = {
  "@tavern/core": "packages/core/src/index.ts",
  "@tavern/shared": "packages/shared/src/index.ts",
  "@tavern/shared/types/backup-file":
    "packages/shared/src/types/backup-file.ts",
  "@tavern/adapters-sillytavern": "packages/adapters-sillytavern/src/index.ts",
};

registerHooks({
  resolve(specifier, context, next) {
    if (backendWorkspaceModules[specifier]) {
      return {
        url: pathToFileURL(
          path.join(backendRoot, backendWorkspaceModules[specifier]),
        ).href,
        shortCircuit: true,
      };
    }
    if (specifier === "better-sqlite3" && sqlitePackage) {
      return {
        url: pathToFileURL(path.join(sqlitePackage, "lib/index.js")).href,
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});

const repositoryRoot = path.resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const prototypeRoot = path.resolve(
  process.env.SCRIPT_PROTOTYPE_ROOT ||
    path.join(repositoryRoot, "apps/web/prototypes"),
);
const registryPath = path.resolve(
  process.env.SCRIPT_PROTOTYPE_REGISTRY ||
    path.join(prototypeRoot, "shared/script-characters.json"),
);
const ajvPackage =
  "/srv/tavern/TavernHeadless/node_modules/.pnpm/ajv@8.17.1/node_modules/ajv";
const parseYaml = createRequire(
  path.join(
    backendRoot,
    "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/package.json",
  ),
)("./dist/index.js").parse;
const requireAjv = createRequire(path.join(ajvPackage, "package.json"));
const Ajv = requireAjv("./dist/ajv.js");
const { buildTestApp: buildApp } = await import(
  pathToFileURL(path.join(backendRoot, "apps/api/test/helpers/create-test-db.ts"))
);
const schema = await import(
  pathToFileURL(path.join(backendRoot, "apps/api/src/db/schema.ts"))
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
const transportSchema = JSON.parse(
  fs.readFileSync(
    path.join(
      repositoryRoot,
      "apps/web/prototypes/shared/script-transport.schema.json",
    ),
    "utf8",
  ),
);
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(runtimeSchema);
const definitionValidator = (source, definition) =>
  ajv.compile({
    $schema: source.$schema,
    definitions: source.definitions,
    $ref: `#/definitions/${definition}`,
  });
const validatePackage = definitionValidator(runtimeSchema, "package");
const validateSend = definitionValidator(runtimeSchema, "chatSendParams");
const validateRecord = definitionValidator(runtimeSchema, "record");
const validateTextStreamEvent = definitionValidator(
  runtimeSchema,
  "textStreamEvent",
);
const validateTurnCommit = definitionValidator(runtimeSchema, "turnCommit");
const validateFloorPage = definitionValidator(runtimeSchema, "floorPage");
const validateMessagesGetFloorParams = definitionValidator(
  runtimeSchema,
  "messagesGetFloorParams",
);
const validateMessagesGetFloorResult = definitionValidator(
  runtimeSchema,
  "messagesGetFloorResult",
);
const validateEnvelope = ajv.compile(transportSchema);
const validateCatalog = definitionValidator(transportSchema, "catalog");
const validateOpeningImport = definitionValidator(
  transportSchema,
  "openingImport",
);
const validateOpenings = definitionValidator(transportSchema, "openings");
const validateSessionCreate = definitionValidator(
  transportSchema,
  "sessionCreate",
);
const validateSession = definitionValidator(transportSchema, "session");
const validateMessageList = definitionValidator(transportSchema, "messageList");

const validateRegistry = definitionValidator(
  transportSchema,
  "characterRegistry",
);
const validateScenario = definitionValidator(transportSchema, "scenario");
const liveConfig = process.env.OPENROUTER_CONFIG
  ? loadCredentials(process.env.OPENROUTER_CONFIG)
  : null;
const liveSchema = JSON.parse(
  fs.readFileSync(
    new URL("./openrouter-live.schema.json", import.meta.url),
    "utf8",
  ),
);
const validateLiveProfile = ajv.compile(liveSchema);
const validatePromptBundle = ajv.compile(
  JSON.parse(
    fs.readFileSync(
      new URL("./bound-prompt.schema.json", import.meta.url),
      "utf8",
    ),
  ),
);

const liveErrors = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, "apps/web/prototypes/shared/card-errors.json"),
    "utf8",
  ),
);
const stateUpdateSchema = JSON.parse(
  fs.readFileSync(
    path.join(
      repositoryRoot,
      "docs/character-authoring/state-update.schema.json",
    ),
    "utf8",
  ),
);
const validateAgentOutput = definitionValidator(
  stateUpdateSchema,
  "agentOutput",
);

function explainValidation(validate) {
  return ajv.errorsText(validate.errors, { separator: "; " });
}

function assertValid(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`${label}: ${explainValidation(validate)}`);
  }
}

function clone(value) {
  return structuredClone(value);
}

function resolveInside(base, relative, label) {
  if (typeof relative !== "string" || relative.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (path.isAbsolute(relative)) {
    throw new Error(`${label} must be relative to ${base}`);
  }
  const resolved = path.resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`${label} leaves ${base}`);
  }
  return resolved;
}

function readJson(filename, label) {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function readRequiredFile(directory, relative, label) {
  const filename = resolveInside(directory, relative, label);
  const stat = fs.statSync(filename);
  if (!stat.isFile()) throw new Error(`${label} is not a file`);
  const body = fs.readFileSync(filename);
  return { filename, body, content: body.toString("utf8") };
}

function encodePackagePath(relative) {
  return relative
    .split(/[\\/]/)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function versionFileUrl(versionId, relative) {
  return `/script-api/versions/${encodeURIComponent(versionId)}/files/${encodePackagePath(relative)}`;
}

function contentType(filename) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".wav": "audio/wav",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
  };
  return types[path.extname(filename)] || "application/octet-stream";
}

function loadPackages() {
  const registry = readJson(registryPath, "script character registry");
  assertValid(validateRegistry, registry, "script character registry");
  const seen = new Set();
  return registry.map((entry) => {
    if (seen.has(entry.id))
      throw new Error(`Duplicate character id ${entry.id}`);
    seen.add(entry.id);
    const directory = resolveInside(
      prototypeRoot,
      entry.directory,
      `${entry.id} directory`,
    );
    const manifest = readJson(
      path.join(directory, "manifest.json"),
      `${entry.id} manifest`,
    );
    assertValid(validatePackage, manifest, `${entry.id} manifest`);
    const scenario = readJson(
      path.join(directory, "scenario.json"),
      `${entry.id} scenario`,
    );
    assertValid(validateScenario, scenario, `${entry.id} scenario`);

    const html = readRequiredFile(directory, manifest.html, `${entry.id} html`);
    const css = readRequiredFile(directory, manifest.css, `${entry.id} css`);
    const script = readRequiredFile(
      directory,
      manifest.script,
      `${entry.id} script`,
    );
    const floorHtml = manifest.floorHtml
      ? readRequiredFile(directory, manifest.floorHtml, `${entry.id} floorHtml`)
      : null;
    const assets = {};
    const versionFiles = new Map([
      [
        manifest.script,
        { body: script.body, contentType: contentType(script.filename) },
      ],
    ]);
    for (const [assetId, asset] of Object.entries(manifest.assets)) {
      const filename = resolveInside(
        directory,
        asset.file,
        `${entry.id} asset ${assetId}`,
      );
      const stat = fs.statSync(filename);
      if (!stat.isFile())
        throw new Error(`${entry.id} asset ${assetId} is not a file`);
      versionFiles.set(asset.file, {
        body: fs.readFileSync(filename),
        contentType: contentType(filename),
      });
      assets[assetId] = {
        kind: asset.kind,
        url: "pending-version-url",
        label: asset.label,
        tags: clone(asset.tags),
      };
    }
    const snapshot = entry.snapshot
      ? readJson(
          resolveInside(directory, entry.snapshot, `${entry.id} snapshot`),
          `${entry.id} snapshot`,
        )
      : { name: entry.name };
    const metadata = entry.openings
      ? readJson(
          resolveInside(directory, entry.openings, "opening metadata"),
          "opening metadata",
        )
      : null;
    if (metadata)
      assertValid(validateOpeningImport, metadata, "opening metadata");
    const openings = entry.snapshot
      ? importOpenings(
          snapshot,
          metadata ?? { defaultOpeningId: "first", entries: {} },
          scenario.initial,
          { parseYaml, performerName: manifest.data.performerName },
        )
      : null;
    if (openings) {
      assertValid(validateOpenings, openings, "openings");
      if (Object.hasOwn(manifest.data, "opening"))
        throw new Error(
          "System opening content must be declared in openings, not manifest data",
        );
      if (
        new Set(openings.items.map((item) => item.id)).size !==
          openings.items.length ||
        !openings.items.some((item) => item.id === openings.defaultOpeningId)
      )
        throw new Error("Invalid opening identities or default story");
    }
    const livePath = path.join(directory, "live-model.json");
    const liveProfile = fs.existsSync(livePath)
      ? readJson(livePath, "live model profile")
      : null;
    if (liveProfile)
      assertValid(validateLiveProfile, liveProfile, "live model profile");
    return {
      ...entry,
      liveProfile,
      openings,
      directory,
      manifest: clone(manifest),
      snapshot,
      scenario: clone(scenario),
      versionFiles,
      delivery: {
        html: html.content,
        css: css.content,
        scriptUrl: "pending-version-url",
        floorHtml: floorHtml?.content ?? null,
        assets,
        data: clone(manifest.data),
      },
    };
  });
}

const packages = loadPackages();
for (const pkg of packages) {
  const profile = pkg.liveProfile;
  if (!profile) continue;
  pkg.stateUpdateBundle = { profile: clone(profile), files: {} };
  const readRoleFile = (file) => {
    const data = fs.readFileSync(
      resolveInside(pkg.directory, file, "state update file"),
      "utf8",
    );
    pkg.stateUpdateBundle.files[file] = data;
    return data;
  };
  if (profile.promptBundleFile) {
    const bundle = JSON.parse(readRoleFile(profile.promptBundleFile));
    assertValid(validatePromptBundle, bundle, "prompt bundle");
    if (bundle.controllerModule) readRoleFile(bundle.controllerModule);
    pkg.promptBundle = bundle;
  }
  if (profile.stateSchemaFile)
    profile.stateSchema = JSON.parse(readRoleFile(profile.stateSchemaFile));
  profile.rulesText = (profile.ruleFiles || [])
    .map((file) => readRoleFile(file))
    .join("\n");
  for (const file of profile.moduleFiles || []) readRoleFile(file);
  if (profile.factsSchema)
    profile.validateFacts = ajv.compile(profile.factsSchema);
  for (const [field, exportName] of [
    ["deriveScript", "derive"],
    ["validateScript", "validate"],
  ]) {
    if (!profile[field]) continue;
    readRoleFile(profile[field]);
    profile[exportName] = (
      await import(
        pathToFileURL(resolveInside(pkg.directory, profile[field], field))
      )
    )[exportName];
    if (typeof profile[exportName] !== "function")
      throw new Error("STATE_MODULE_INVALID");
  }
  const ids = (profile.followupAgents || []).map((agent) => agent.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !(profile.sourceAgentBindingIds || []).includes(id))
  )
    throw new Error("STATE_AGENT_UNBOUND");
}
const { app, database } = await buildApp({
  databasePath: ":memory:",
  logger: false,
  enableWebSocket: false,
  enableMemory: false,
  enableSseChat: false,
  enableAgentRuntimeWorker: false,
  enableNodeGraphWorker: false,
});

const account = database.select().from(schema.accounts).all()[0];
if (!account) throw new Error("Default account was not created");
const sessions = new Map();
const catalog = [];
const versionFiles = new Map();

function initialRecord(sessionId, branchId, versionId, variables) {
  const record = {
    sessionId,
    branchId,
    floorId: null,
    attemptId: null,
    versionId,
    snapshotId: `${sessionId}:snapshot:0`,
    parentSnapshotId: null,
    variables: clone(variables),
    source: { kind: "initial", runId: null, jobId: null },
  };
  assertValid(validateRecord, record, "initial record");
  return record;
}

async function seedPackages() {
  for (const characterPackage of packages) {
    const now = Date.now();
    database
      .insert(schema.characters)
      .values({
        id: characterPackage.id,
        name: characterPackage.name,
        accountId: account.id,
        source: "native",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const snapshot = clone(characterPackage.snapshot);
    snapshot.extensions = {
      ...snapshot.extensions,
      tavern_headless: {
        ...snapshot.extensions?.tavern_headless,
        frontend: clone(characterPackage.manifest),
        ...(characterPackage.stateUpdateBundle
          ? { stateUpdate: clone(characterPackage.stateUpdateBundle) }
          : {}),
        ...(characterPackage.openings
          ? { openings: clone(characterPackage.openings) }
          : {}),
      },
    };
    const response = await app.inject({
      method: "POST",
      url: `/characters/${encodeURIComponent(characterPackage.id)}/versions`,
      payload: { snapshot },
    });
    if (response.statusCode !== 201) {
      throw new Error(
        `Could not store ${characterPackage.id}: ${response.body}`,
      );
    }
    const versionId = response.json().data.id;
    characterPackage.delivery.scriptUrl = versionFileUrl(
      versionId,
      characterPackage.manifest.script,
    );
    for (const [assetId, asset] of Object.entries(
      characterPackage.manifest.assets,
    )) {
      characterPackage.delivery.assets[assetId].url = versionFileUrl(
        versionId,
        asset.file,
      );
    }
    versionFiles.set(versionId, characterPackage.versionFiles);
    const sessionId = `script-${characterPackage.id}`;
    const branchId = `branch-${characterPackage.id}`;
    const selectedOpening =
      characterPackage.openings?.items.find(
        (item) => item.id === characterPackage.openings.defaultOpeningId,
      ) ?? null;
    const initial = initialRecord(
      sessionId,
      branchId,
      versionId,
      selectedOpening
        ? selectedOpening.variables
        : characterPackage.scenario.initial,
    );
    const state = {
      characterId: characterPackage.id,
      name: characterPackage.name,
      sessionId,
      branchId,
      versionId,
      characterPackage,
      opening:
        characterPackage.openings?.items.find(
          (item) => item.id === characterPackage.openings.defaultOpeningId,
        ) ?? null,
      initial,
      current: initial,
      messages: [],
      floors: [],
      floorRecords: new Map(),
      snapshots: new Map([[initial.snapshotId, initial]]),
      nextFloor: 1,
      nextAttempt: 1,
      failedAttemptsForNextFloor: 0,
      successfulTurns: 0,
      activeMainRun: null,
    };
    sessions.set(sessionId, state);
    catalog.push({
      id: characterPackage.id,
      name: characterPackage.name,
      sessionId,
      versionId,
    });
  }
  assertValid(validateCatalog, catalog, "catalog");
}

function getState(request, reply) {
  const state = sessions.get(request.params.id);
  if (!state) {
    reply.code(404).send({
      error: { code: "SESSION_NOT_FOUND", message: "Script session not found" },
    });
    return null;
  }
  return state;
}

function storedPackage(state) {
  const version = database
    .select()
    .from(schema.characterVersions)
    .all()
    .find(
      (candidate) =>
        candidate.id === state.versionId &&
        candidate.characterId === state.characterId,
    );
  if (!version) return null;
  const frontend = JSON.parse(version.dataJson).extensions?.tavern_headless
    ?.frontend;
  if (!validatePackage(frontend)) return null;
  return frontend;
}

function sessionResponse(state) {
  if (!storedPackage(state)) return null;
  const response = {
    characterId: state.characterId,
    opening: clone(state.opening),
    openings: clone(state.characterPackage.openings),
    sessionId: state.sessionId,
    branchId: state.branchId,
    versionId: state.versionId,
    name: state.name,
    initial: clone(state.initial),
    current: clone(state.current),
    messages: [],
    processing: {
      pendingMain: state.pendingNarrative
        ? {
            input: state.pendingNarrative.input,
            text: state.pendingNarrative.text,
          }
        : null,
      pendingFollowups: Boolean(state.pendingChain),
    },
    delivery: clone(state.characterPackage.delivery),
    capabilities: {
      send: true,
      history: true,
      customFloors: state.characterPackage.manifest.floorHtml !== undefined,
    },
  };
  if (state.opening) response.delivery.data.opening = state.opening.displayText;
  assertValid(validateSession, response, "session response");
  return response;
}

function parseBranch(state, query, reply) {
  if (query.branchId !== state.branchId) {
    reply.code(404).send({
      error: { code: "SESSION_NOT_FOUND", message: "Session branch not found" },
    });
    return false;
  }
  return true;
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Number.isInteger(parsed.offset) ||
      parsed.offset < 0 ||
      !Number.isInteger(parsed.cutoff) ||
      parsed.cutoff < 0 ||
      typeof parsed.branchId !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function textEvent(base, update) {
  const event = { ...base, ...update };
  assertValid(validateTextStreamEvent, event, "text stream event");
  return { type: "text", data: event };
}

function assertEnvelope(envelope) {
  assertValid(validateEnvelope, envelope, "stream envelope");
  if (envelope.type === "commit") {
    assertValid(validateTurnCommit, envelope.data, "turn commit");
  }
  if (envelope.type === "current") {
    assertValid(validateRecord, envelope.data, "current record");
  }
  return envelope;
}

app.get("/script-api/catalog", async () => clone(catalog));

app.post("/script-api/sessions", async (request, reply) => {
  if (!validateSessionCreate(request.body))
    return reply.code(400).send({ error: { code: "INVALID_REQUEST" } });
  const { characterId, versionId, openingId } = request.body;
  const seed = sessions.get(`script-${characterId}`);
  if (!seed || seed.versionId !== versionId)
    return reply.code(404).send({ error: { code: "VERSION_NOT_FOUND" } });
  const opening = seed.characterPackage.openings?.items.find(
    (item) => item.id === openingId,
  );
  if (!opening)
    return reply.code(400).send({ error: { code: "OPENING_NOT_FOUND" } });
  const sessionId = `script-${characterId}-${crypto.randomUUID()}`;
  const branchId = `branch-${crypto.randomUUID()}`;
  const initial = initialRecord(
    sessionId,
    branchId,
    versionId,
    opening.variables,
  );
  const state = {
    ...seed,
    sessionId,
    branchId,
    opening: clone(opening),
    initial,
    current: initial,
    messages: [],
    floors: [],
    floorRecords: new Map(),
    snapshots: new Map([[initial.snapshotId, initial]]),
    nextFloor: 1,
    nextAttempt: 1,
    failedAttemptsForNextFloor: 0,
    successfulTurns: 0,
    activeMainRun: null,
    pendingNarrative: null,
    pendingChain: null,
    completedChains: [],
    liveEvidence: [],
    liveFailure: null,
  };
  sessions.set(sessionId, state);
  return reply.code(201).send(sessionResponse(state));
});

app.get("/script-api/sessions/:id", async (request, reply) => {
  const state = getState(request, reply);
  if (!state) return;
  const response = sessionResponse(state);
  if (!response) {
    return reply.code(409).send({
      error: {
        code: "VERSION_NOT_FOUND",
        message: "Stored character version is unavailable or invalid",
      },
    });
  }
  return response;
});

app.get(
  "/script-api/sessions/:id/snapshots/:snapshotId",
  async (request, reply) => {
    const state = getState(request, reply);
    if (!state) return;
    const record = state.snapshots.get(request.params.snapshotId);
    if (!record) {
      return reply.code(404).send({
        error: {
          code: "SNAPSHOT_NOT_FOUND",
          message: "Display snapshot not found",
        },
      });
    }
    return clone(record);
  },
);

app.get("/script-api/sessions/:id/floors", async (request, reply) => {
  const state = getState(request, reply);
  if (!state) return;
  const query = request.query ?? {};
  if (!parseBranch(state, query, reply)) return;
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return reply.code(400).send({
      error: {
        code: "INVALID_REQUEST",
        message: "limit must be an integer from 1 to 100",
      },
    });
  }
  let cursor = {
    offset: 0,
    cutoff: state.floors.length,
    branchId: state.branchId,
  };
  if (query.cursor !== undefined) {
    cursor = decodeCursor(query.cursor);
    if (
      !cursor ||
      cursor.branchId !== state.branchId ||
      cursor.cutoff > state.floors.length ||
      cursor.offset > cursor.cutoff
    ) {
      return reply.code(400).send({
        error: { code: "INVALID_CURSOR", message: "Floor cursor is invalid" },
      });
    }
  }
  const end = Math.min(cursor.offset + limit, cursor.cutoff);
  const page = {
    items: clone(state.floors.slice(cursor.offset, end)),
    nextCursor:
      end < cursor.cutoff ? encodeCursor({ ...cursor, offset: end }) : null,
  };
  assertValid(validateFloorPage, page, "floor page");
  return page;
});

app.get("/script-api/sessions/:id/floor/:floorId", async (request, reply) => {
  const state = getState(request, reply);
  if (!state) return;
  const query = request.query ?? {};
  if (!parseBranch(state, query, reply)) return;
  const value = state.floorRecords.get(request.params.floorId);
  if (!value) {
    return reply.code(404).send({
      error: {
        code: "SNAPSHOT_NOT_FOUND",
        message: "Committed floor not found",
      },
    });
  }
  if (
    query.attemptId !== undefined &&
    query.attemptId !== value.after.attemptId
  ) {
    return reply.code(409).send({
      error: {
        code: "VARIABLES_NOT_COMMITTED",
        message: "The requested floor attempt has no committed variables",
      },
    });
  }
  return clone(value);
});

app.get("/script-api/sessions/:id/messages", async (request, reply) => {
  const state = getState(request, reply);
  if (!state) return;
  const query = request.query ?? {};
  if (!validateMessagesGetFloorParams(query)) {
    return reply.code(400).send({
      error: {
        code: "INVALID_REQUEST",
        message:
          "Message query requires branchId, floorId, and an optional attemptId",
      },
    });
  }
  if (!parseBranch(state, query, reply)) return;
  const floor = state.floorRecords.get(query.floorId);
  if (!floor) {
    return reply.code(404).send({
      error: {
        code: "SNAPSHOT_NOT_FOUND",
        message: "Committed floor not found",
      },
    });
  }
  if (
    query.attemptId !== undefined &&
    query.attemptId !== floor.after.attemptId
  ) {
    return reply.code(409).send({
      error: {
        code: "VARIABLES_NOT_COMMITTED",
        message: "The requested floor attempt has no committed messages",
      },
    });
  }
  const messages = state.messages.filter(
    (message) => message.floorId === query.floorId,
  );
  assertValid(validateMessagesGetFloorResult, messages, "floor message result");
  assertValid(validateMessageList, messages, "floor messages");
  return clone(messages);
});

app.post("/script-api/sessions/:id/prompt-preview", async (request, reply) => {
  const state = getState(request, reply);
  if (!state) return;
  if (!validateSend(request.body))
    return reply.code(400).send({ error: { code: "INVALID_REQUEST" } });
  const prepare = state.characterPackage.liveProfile?.preparePrompt;
  if (!prepare)
    return reply.code(409).send({ error: { code: "BOUND_PROMPT_REQUIRED" } });
  const history = [
    ...(state.opening
      ? [{ role: "assistant", content: state.opening.displayText }]
      : []),
    ...state.messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    })),
  ];
  const result = await prepare({ state, input: request.body.text, history });
  return result.trace;
});

app.get("/script-api/sessions/:id/live-evidence", async (request, reply) => {
  const state = getState(request, reply);
  if (!state) return;
  return {
    mode: liveConfig ? "openrouter" : "fixture",
    turns: state.liveEvidence || [],
    failure: state.liveFailure || null,
    pendingChain: state.pendingChain
      ? {
          floorId: state.pendingChain.floorId,
          index: state.pendingChain.index,
          jobs: state.pendingChain.jobs,
        }
      : null,
    completedChains: state.completedChains || [],
  };
});

app.post("/script-api/sessions/:id/followups/retry", async (request, reply) => {
  const state = getState(request, reply);
  if (!state) return;
  if (state.activeMainRun !== null)
    return reply.code(409).send({ error: { code: "SEND_BUSY" } });
  if (!state.pendingChain)
    return {
      type: "completed",
      data: { snapshotId: state.current.snapshotId },
    };
  state.activeMainRun = Symbol("followup-retry");
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
  });
  const controller = new AbortController();
  const close = () => controller.abort();
  reply.raw.on("close", close);
  const write = (envelope) => {
    assertEnvelope(envelope);
    if (!reply.raw.destroyed) reply.raw.write(JSON.stringify(envelope) + "\n");
  };
  try {
    const profile = state.characterPackage.liveProfile;
    await runFollowups({
      state,
      profile,
      config: liveConfig,
      write,
      textEvent,
      validateOutput: validateAgentOutput,
      validateState: ajv.compile(profile.stateSchema),
      signal: controller.signal,
    });
    write({
      type: "completed",
      data: { snapshotId: state.current.snapshotId },
    });
  } catch (error) {
    state.liveFailure = {
      code: error.message,
      rawOutput: error.rawOutput ?? null,
      updaterModel: error.updaterModel ?? null,
      issues: error.issues ?? [],
      providerError: error.providerError ?? null,
    };
    write({
      type: "error",
      data: {
        code: "STATE_FOLLOWUP_FAILED",
        message: liveErrors.STATE_FOLLOWUP_FAILED,
      },
    });
  } finally {
    state.activeMainRun = null;
    reply.raw.off("close", close);
    if (!reply.raw.destroyed) reply.raw.end();
  }
});

app.post("/script-api/sessions/:id/send", async (request, reply) => {
  const state = getState(request, reply);
  if (!state) return;
  if (!storedPackage(state)) {
    return reply.code(409).send({
      error: {
        code: "VERSION_NOT_FOUND",
        message: "Stored character version is unavailable or invalid",
      },
    });
  }
  if (!validateSend(request.body)) {
    return reply.code(400).send({
      error: {
        code: "INVALID_REQUEST",
        message: "Send body must contain one non-empty text field",
      },
    });
  }
  const scenarioMode = request.headers["x-prototype-scenario"] ?? "normal";
  if (
    ![
      "normal",
      "fail",
      "cancel",
      "interleaved",
      "disconnect-main",
      "disconnect-job",
    ].includes(scenarioMode)
  ) {
    return reply.code(400).send({
      error: { code: "INVALID_REQUEST", message: "Unknown prototype scenario" },
    });
  }
  if (state.pendingChain)
    return reply.code(409).send({ error: { code: "STATE_FOLLOWUPS_PENDING" } });
  if (state.activeMainRun !== null) {
    return reply.code(409).send({
      error: {
        code: "SEND_BUSY",
        message: "The session already has an active main run",
      },
    });
  }
  const mainRunToken = Symbol("prototype-main-run");
  state.activeMainRun = mainRunToken;
  const releaseMainRun = () => {
    if (state.activeMainRun === mainRunToken) state.activeMainRun = null;
  };

  const ordinal = state.nextFloor;
  const floorId = `${state.sessionId}:floor:${ordinal}`;
  const attemptOrdinal = state.nextAttempt;
  state.nextAttempt += 1;
  const attemptId = `${floorId}:attempt:${attemptOrdinal}`;
  const runId = `${floorId}:run:${attemptOrdinal}`;
  const streamId = `${runId}:stream`;
  const inputMessageId = `${floorId}:user`;
  const assistantMessageId = `${floorId}:assistant`;
  const base = {
    sessionId: state.sessionId,
    branchId: state.branchId,
    floorId,
    attemptId,
    streamId,
    runId,
    jobId: null,
    messageId: null,
    revision: 0,
    type: "start",
    status: "streaming",
    text: "",
    error: null,
  };
  if (liveConfig) {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    });
    const write = (envelope) => {
      assertEnvelope(envelope);
      if (!reply.raw.destroyed)
        reply.raw.write(`${JSON.stringify(envelope)}\n`);
    };
    const controller = new AbortController();
    const disconnected = () => controller.abort();
    reply.raw.on("close", disconnected);
    let revision = 0;
    try {
      const profile = state.characterPackage.liveProfile;
      if (!profile) throw new Error("LIVE_PROFILE_MISSING");
      if (
        request.headers["x-state-update-retry"] === "true" &&
        (!state.pendingNarrative ||
          state.pendingNarrative.input !== request.body.text ||
          state.pendingNarrative.baseSnapshotId !== state.current.snapshotId)
      )
        throw new Error("STATE_RETRY_INVALID");
      write(textEvent(base, {}));
      const before = clone(state.current);
      const history = [
        ...(state.opening
          ? [{ role: "assistant", content: state.opening.displayText }]
          : []),
        ...state.messages.map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.text,
        })),
      ];
      const narrative =
        profile.preparePrompt &&
        request.headers["x-state-update-retry"] !== "true"
          ? await profile.preparePrompt({
              state,
              input: request.body.text,
              history,
            })
          : undefined;
      const result = await generateLiveTurn({
        narrative,
        config: liveConfig,
        profile: {
          ...profile,
          ...(profile.promptBundleFile
            ? {}
            : {
                narratorPrompt:
                  profile.narratorPrompt +
                  "\n可用资源索引：" +
                  JSON.stringify(
                    state.characterPackage.manifest.data.assetIndex ||
                      state.characterPackage.manifest.data,
                  ),
              }),
        },
        before: before.variables,
        history: [
          ...(state.opening
            ? [{ role: "assistant", text: state.opening.displayText }]
            : []),
          ...state.messages,
        ],
        resume:
          request.headers["x-state-update-retry"] === "true"
            ? state.pendingNarrative
            : null,
        onNarrative(narrative) {
          state.pendingNarrative = {
            ...narrative,
            input: request.body.text,
            baseSnapshotId: before.snapshotId,
          };
        },
        input: request.body.text,
        messageIds: { user: inputMessageId, assistant: assistantMessageId },
        signal: controller.signal,
        validateOutput: validateAgentOutput,
        validateState: ajv.compile(profile.stateSchema),
        onText(text, ended) {
          write(
            textEvent(base, {
              revision: ++revision,
              text,
              type: ended ? "end" : "update",
              status: ended ? "completed" : "streaming",
              messageId: ended ? assistantMessageId : null,
            }),
          );
        },
      });
      if (state.current.snapshotId !== before.snapshotId)
        throw new Error("STATE_BASE_STALE");
      const after = {
        ...before,
        floorId,
        attemptId,
        snapshotId: `${attemptId}:snapshot`,
        parentSnapshotId: before.snapshotId,
        variables: result.variables,
        source: { kind: "floor", runId, jobId: null },
      };
      const commit = {
        eventId: `${attemptId}:committed`,
        sessionId: state.sessionId,
        branchId: state.branchId,
        kind:
          request.headers["x-state-update-retry"] === "true"
            ? "retried"
            : "generated",
        previousCurrentSnapshotId: before.snapshotId,
        before,
        after,
      };
      assertValid(validateRecord, after, "live record");
      assertValid(validateTurnCommit, commit, "live commit");
      const messages = [
        {
          id: inputMessageId,
          role: "user",
          text: request.body.text,
          floorId,
          attemptId,
          streamId: `${floorId}:input`,
          status: "completed",
        },
        {
          id: assistantMessageId,
          role: "assistant",
          text: result.text,
          floorId,
          attemptId,
          streamId,
          status: "completed",
        },
      ];
      assertValid(validateMessageList, messages, "live messages");
      state.current = after;
      state.snapshots.set(after.snapshotId, clone(after));
      state.floorRecords.set(floorId, { before, after });
      state.floors.push({ floorId, attemptId, snapshotId: after.snapshotId });
      state.messages.push(...messages);
      state.nextFloor++;
      state.successfulTurns++;
      state.failedAttemptsForNextFloor = 0;
      state.pendingNarrative = null;
      state.liveEvidence ??= [];
      state.liveEvidence.push({
        floorId,
        attemptId,
        models: result.models,
        promptTrace: result.promptTrace,
        proposal: result.output,
        beforeSnapshotId: before.snapshotId,
        afterSnapshotId: after.snapshotId,
      });
      write({ type: "commit", data: commit });
      state.pendingChain = {
        floorId,
        attemptId,
        runId,
        floorBefore: before.variables,
        facts: result.output.facts ? [result.output.facts] : [],
        index: 0,
        agents: profile.followupAgents || [],
        jobs: {},
        assertRecord: (record) =>
          assertValid(validateRecord, record, "job record"),
      };
      await runFollowups({
        state,
        profile,
        config: liveConfig,
        write,
        textEvent,
        validateOutput: validateAgentOutput,
        validateState: ajv.compile(profile.stateSchema),
        signal: controller.signal,
      });
      write({
        type: "completed",
        data: { snapshotId: state.current.snapshotId },
      });
    } catch (error) {
      state.failedAttemptsForNextFloor++;
      state.liveFailure = {
        floorId,
        attemptId,
        code: error.message,
        rawOutput: error.rawOutput ?? null,
        updaterModel: error.updaterModel ?? null,
        issues: error.issues ?? [],
        providerError: error.providerError ?? null,
      };
      const code = state.pendingChain ? "STATE_FOLLOWUP_FAILED" : error.message;
      const message = liveErrors[code] || liveErrors.LIVE_FAILED;
      write({ type: "error", data: { code, message } });
    } finally {
      releaseMainRun();
      reply.raw.off("close", disconnected);
      if (!reply.raw.destroyed) reply.raw.end();
    }
    return;
  }
  const events = [{ envelope: textEvent(base, {}) }];
  const explicitFailure =
    request.body.text === state.characterPackage.scenario.failureText;

  if (scenarioMode === "fail" || explicitFailure) {
    state.failedAttemptsForNextFloor += 1;
    const error = {
      code: "GENERATION_FAILED",
      message: state.characterPackage.scenario.failureText,
    };
    events.push(
      {
        envelope: textEvent(base, {
          revision: 1,
          type: "error",
          status: "failed",
          error,
        }),
      },
      {
        envelope: assertEnvelope({ type: "error", data: error }),
        releaseBusy: true,
      },
    );
  } else if (scenarioMode === "cancel") {
    state.failedAttemptsForNextFloor += 1;
    const error = {
      code: "GENERATION_CANCELLED",
      message: "Generation was cancelled",
    };
    events.push(
      {
        envelope: textEvent(base, {
          revision: 1,
          type: "cancelled",
          status: "cancelled",
        }),
      },
      {
        envelope: assertEnvelope({ type: "error", data: error }),
        releaseBusy: true,
      },
    );
  } else {
    const turn =
      state.characterPackage.scenario.turns.find(
        (entry) => entry.input === request.body.text,
      ) ??
      state.characterPackage.scenario.turns[
        state.successfulTurns % state.characterPackage.scenario.turns.length
      ];
    const before = clone(state.current);
    const mainRecord = {
      sessionId: state.sessionId,
      branchId: state.branchId,
      floorId,
      attemptId,
      versionId: state.versionId,
      snapshotId: `${floorId}:snapshot:main`,
      parentSnapshotId: before.snapshotId,
      variables: clone(turn.variables),
      source: { kind: "floor", runId, jobId: null },
    };
    assertValid(validateRecord, mainRecord, "main record");
    const commit = {
      eventId: `${floorId}:committed`,
      sessionId: state.sessionId,
      branchId: state.branchId,
      kind: state.failedAttemptsForNextFloor > 0 ? "retried" : "generated",
      previousCurrentSnapshotId: before.snapshotId,
      before,
      after: mainRecord,
    };
    assertValid(validateTurnCommit, commit, "turn commit");
    const inputMessage = {
      id: inputMessageId,
      role: "user",
      text: request.body.text,
      floorId,
      attemptId,
      streamId: `${floorId}:input`,
      status: "completed",
    };
    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      text: turn.text,
      floorId,
      attemptId,
      streamId,
      status: "completed",
    };
    events.push(
      {
        envelope: textEvent(base, {
          revision: 1,
          type: "update",
          text: turn.text,
        }),
      },
      {
        envelope: textEvent(base, {
          messageId: assistantMessageId,
          revision: 2,
          type: "end",
          status: "completed",
          text: turn.text,
        }),
      },
      {
        envelope: assertEnvelope({ type: "commit", data: commit }),
        apply() {
          commit.previousCurrentSnapshotId = state.current.snapshotId;
          state.current = mainRecord;
          state.snapshots.set(mainRecord.snapshotId, clone(mainRecord));
          state.floorRecords.set(floorId, { before, after: mainRecord });
          state.floors.push({
            floorId,
            attemptId,
            snapshotId: mainRecord.snapshotId,
          });
          state.messages.push(inputMessage, assistantMessage);
          state.nextFloor += 1;
          state.failedAttemptsForNextFloor = 0;
          state.successfulTurns += 1;
        },
      },
      {
        envelope: assertEnvelope({
          type: "completed",
          data: { snapshotId: mainRecord.snapshotId },
        }),
        releaseBusy: true,
      },
    );

    if (
      ["interleaved", "disconnect-job"].includes(scenarioMode) &&
      turn.agentText !== undefined &&
      turn.jobVariables !== undefined
    ) {
      const jobId = `${floorId}:job:1`;
      const jobStreamId = `${jobId}:stream`;
      const agentMessageId = `${floorId}:agent`;
      const jobBase = {
        sessionId: state.sessionId,
        branchId: state.branchId,
        floorId,
        attemptId,
        streamId: jobStreamId,
        runId,
        jobId,
        messageId: null,
        revision: 0,
        type: "start",
        status: "streaming",
        text: "",
        error: null,
      };
      const jobRecord = {
        sessionId: state.sessionId,
        branchId: state.branchId,
        floorId,
        attemptId,
        versionId: state.versionId,
        snapshotId: `${floorId}:snapshot:job:1`,
        parentSnapshotId: mainRecord.snapshotId,
        variables: clone(turn.jobVariables),
        source: { kind: "job", runId, jobId },
      };
      assertValid(validateRecord, jobRecord, "job record");
      const agentMessage = {
        id: agentMessageId,
        role: "agent",
        text: turn.agentText,
        floorId,
        attemptId,
        streamId: jobStreamId,
        status: "completed",
      };
      events.splice(
        2,
        0,
        {
          envelope: textEvent(jobBase, {}),
        },
        {
          envelope: textEvent(jobBase, {
            revision: 1,
            type: "update",
            text: turn.agentText,
          }),
        },
      );
      events.push(
        {
          envelope: textEvent(jobBase, {
            messageId: agentMessageId,
            revision: 2,
            type: "end",
            status: "completed",
            text: turn.agentText,
          }),
          apply() {
            state.snapshots.set(jobRecord.snapshotId, clone(jobRecord));
            state.messages.push(agentMessage);
          },
        },
        {
          envelope: assertEnvelope({ type: "current", data: jobRecord }),
          shouldWrite() {
            return state.current.snapshotId === mainRecord.snapshotId;
          },
          apply() {
            state.current = jobRecord;
          },
        },
      );
    }
  }

  if (scenarioMode === "disconnect-main") {
    const update = events.find(
      (item) =>
        item.envelope.type === "text" &&
        item.envelope.data.type === "update" &&
        item.envelope.data.jobId === null,
    );
    if (update) update.disconnectAfter = true;
  }
  if (scenarioMode === "disconnect-job") {
    const completed = events.find((item) => item.envelope.type === "completed");
    if (completed) completed.disconnectAfter = true;
  }

  for (const item of events) assertEnvelope(item.envelope);
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  try {
    for (const item of events) {
      if (item.shouldWrite && !item.shouldWrite()) continue;
      item.apply?.();
      if (!reply.raw.destroyed) {
        reply.raw.write(`${JSON.stringify(item.envelope)}\n`);
      }
      if (item.releaseBusy) releaseMainRun();
      if (item.disconnectAfter && !reply.raw.destroyed) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        reply.raw.destroy();
      }
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
  } finally {
    releaseMainRun();
    if (!reply.raw.destroyed) reply.raw.end();
  }
});

app.get("/script-api/versions/:versionId/files/*", async (request, reply) => {
  const files = versionFiles.get(request.params.versionId);
  const file = files?.get(request.params["*"]);
  if (!file) {
    return reply.code(404).send({
      error: {
        code: "VERSION_NOT_FOUND",
        message: "Stored frontend version file not found",
      },
    });
  }
  reply.header("cache-control", "public, max-age=31536000, immutable");
  reply.type(file.contentType);
  return file.body;
});

app.get("/prototype/*", async (request, reply) => {
  let filename;
  try {
    filename = resolveInside(
      repositoryRoot,
      request.params["*"],
      "prototype resource",
    );
  } catch {
    return reply.code(403).send();
  }
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    return reply.code(404).send();
  }
  reply.type(contentType(filename));
  return fs.readFileSync(filename);
});

await seedPackages();
for (const pkg of packages) {
  if (!pkg.liveProfile?.promptBundleFile) continue;
  const bundle = pkg.promptBundle;
  pkg.liveProfile.preparePrompt = await createBoundPrompt({
    backendRoot,
    app,
    database,
    schema,
    accountId: account.id,
    pkg,
    bundle,
  });
}
const origin = await app.listen({ host: "127.0.0.1", port });
console.log(
  JSON.stringify({
    url: origin,
    mode: "real-character-api-isolated-memory-database",
    generation: liveConfig
      ? "openrouter-live"
      : "deterministic-fixtures-no-llm",
    characters: catalog.length,
  }),
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
