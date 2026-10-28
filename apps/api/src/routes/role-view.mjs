import { mergeControllerState, stateContractParamsSchema, stateContractResponseSchema } from "../services/role-mvu-migration.mjs";
import { loadSessionOutput, roleMessagesQuerySchema, roleMessagesSchema } from "../services/preset-output.ts";
import { buildBranchVariableScopeId } from "@tavern/shared";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { LLMService, ProviderRegistry } from "@tavern/core";
import { LlmProfileService } from "../services/llm-profile-service.ts";
import { VariableService } from "../services/variables/variable-service.ts";
import { previewPromptMacroText } from "../services/prompt-assembler.ts";
import { applyProposal } from "../services/role-state-proposal.mjs";
import { getRequestAuthContext } from "../plugins/auth.ts";
import { sendError } from "../lib/http.ts";
import { sessions } from "../db/schema.ts";

const Ajv = createRequire(import.meta.url)("ajv");
const RESPOND_ROUTES = new Set([
  "/sessions/:id/respond",
  "/sessions/:id/respond/stream",
]);

export function registerRoleViewRoutes(app, db, options) {
  const {
    moduleDirectory,
    runtimeSchema,
    updateSchema,
    generateStateUpdate = generateStateUpdateWithProfile,
  } = options;
  const sqlite = db.$client;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS role_display_snapshot (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      floor_id TEXT,
      record_json TEXT NOT NULL,
      UNIQUE(session_id, floor_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS role_display_snapshot_initial_uq
      ON role_display_snapshot(session_id) WHERE floor_id IS NULL;
  `);

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateRecord = ajv.compile({
    definitions: runtimeSchema.definitions,
    $ref: "#/definitions/record",
  });
  const validateOutput = ajv.compile({
    definitions: updateSchema.definitions,
    $ref: "#/definitions/agentOutput",
  });
  const variableService = new VariableService(db);
  const running = new Set();

  const getSession = (id, accountId) =>
    db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.accountId, accountId)))
      .get();
  const getSessionById = (id) =>
    db.select().from(sessions).where(eq(sessions.id, id)).get();
  app.get('/sessions/:id/role-messages', async (request, reply) => {
    const {accountId}=getRequestAuthContext(request);
    const session=getSession(request.params.id,accountId);
    if(!session) return sendError(reply,404,'session_not_found','Session not found');
    const parsed=roleMessagesQuerySchema.safeParse(request.query);
    if(!parsed.success) return sendError(reply,400,'invalid_request','floor_id is required');
    const floor=sqlite.prepare('SELECT id FROM floor WHERE id=? AND session_id=?').get(parsed.data.floor_id,session.id);
    if(!floor) return sendError(reply,404,'floor_not_found','Floor not found');
    const processor=loadSessionOutput(db,accountId,session.id);
    const rows=sqlite.prepare('SELECT m.* FROM message m JOIN message_page p ON p.id=m.page_id WHERE p.floor_id=? AND p.is_active=1 AND m.is_hidden=0 ORDER BY p.page_no,m.seq').all(floor.id);
    return {data:roleMessagesSchema.parse(rows.map(m=>({id:m.id,role:m.role,source:m.source,content:m.role==='assistant'?processor.project(m.content,'completed'):m.content})))};
  });
  const snapshotRows = (sessionId, accountId) =>
    sqlite
      .prepare(
        "SELECT * FROM role_display_snapshot WHERE session_id=? AND account_id=? ORDER BY rowid",
      )
      .all(sessionId, accountId);
  const parseRecords = (sessionId, accountId) =>
    snapshotRows(sessionId, accountId).map((row) =>
      JSON.parse(row.record_json),
    );
  const saveSnapshot = (record, accountId) => {
    if (!validateRecord(record)) {
      throw Object.assign(new Error("ROLE_SNAPSHOT_INVALID"), {
        issues: structuredClone(validateRecord.errors || []),
      });
    }
    sqlite
      .prepare(
        `
      INSERT INTO role_display_snapshot(id, account_id, session_id, floor_id, record_json)
      VALUES(?, ?, ?, ?, ?)
    `,
      )
      .run(
        record.snapshotId,
        accountId,
        record.sessionId,
        record.floorId,
        JSON.stringify(record),
      );
  };
  const callApi = async (headers, method, url, payload) => {
    const forwardedHeaders = Object.fromEntries(
      Object.entries(headers).filter(
        ([key]) =>
          !["content-length", "content-type", "transfer-encoding"].includes(
            key,
          ),
      ),
    );
    const response = await app.inject({
      method,
      url,
      headers: forwardedHeaders,
      payload,
    });
    if (response.statusCode >= 400)
      throw new Error(`ROLE_API_${response.statusCode}:${url}`);
    return response.json().data;
  };
  const extension = (session) =>
    JSON.parse(session.characterSnapshotJson).extensions.tavern_headless;

  async function persistRecord({ accountId, record, previousVariables }) {
    if (!validateRecord(record)) {
      throw Object.assign(new Error("ROLE_SNAPSHOT_INVALID"), {
        issues: structuredClone(validateRecord.errors || []),
      });
    }
    const scopeId = buildBranchVariableScopeId(
      record.sessionId,
      record.branchId,
    );
    const previousEntry = variableService
      .listByTargets({ accountId, targets: [{ scope: "branch", scopeId }] })
      .find((item) => item.key === "stat_data");
    const write = await variableService.upsert({
      accountId,
      scope: "branch",
      scopeId,
      key: "stat_data",
      value: record.variables,
    });
    try {
      saveSnapshot(record, accountId);
    } catch (error) {
      if (previousEntry) {
        await variableService.upsert({
          accountId,
          scope: "branch",
          scopeId,
          key: "stat_data",
          value: previousVariables ?? previousEntry.value,
        });
      } else {
        await variableService.remove(write.variable.id, accountId);
      }
      throw error;
    }
  }

  function nextPendingFloor(sessionId, branchId = "main") {
    return sqlite
      .prepare(
        `
      SELECT floor.*
      FROM floor
      LEFT JOIN role_display_snapshot snapshot
        ON snapshot.session_id = floor.session_id AND snapshot.floor_id = floor.id
      WHERE floor.session_id = ?
        AND floor.branch_id = ?
        AND floor.floor_no > 0
        AND floor.state = 'committed'
        AND floor.superseded_at IS NULL
        AND snapshot.id IS NULL
      ORDER BY floor.floor_no ASC
      LIMIT 1
    `,
      )
      .get(sessionId, branchId);
  }

  app.get("/characters/:id/versions/:versionId/state-contract", async (request, reply) => {
    const {id,versionId}=stateContractParamsSchema.parse(request.params);
    let version;
    for(let offset=0;;offset+=100) {
      const response=await app.inject({method:"GET",url:`/characters/${encodeURIComponent(id)}/versions?limit=100&offset=${offset}`,headers:Object.fromEntries(Object.entries(request.headers).filter(([key])=>!["content-length","content-type","transfer-encoding"].includes(key)))});
      if(response.statusCode>=400) return reply.code(response.statusCode).send(response.json());
      const body=response.json();version=body.data.find(item=>item.id===versionId);
      if(version || !body.meta?.has_more) break;
    }
    if(!version) return sendError(reply,404,"role_release_character_version_not_found","Character version not found. Select an existing version.");
    const bundle=version.snapshot?.extensions?.tavern_headless?.stateUpdate;
    if(!bundle) return sendError(reply,404,"role_state_config_missing","This character version has no variable update configuration. Configure variable updates and save a new version.");
    const profile=structuredClone(bundle.profile);
    if(profile.stateSchemaFile) profile.stateSchema=JSON.parse(bundle.files[profile.stateSchemaFile]);
    const outputSchema=buildRestrictedOutputSchema(profile,[]);
    outputSchema.properties.evidenceMessageIds.items={type:"string",minLength:1};
    return {data:stateContractResponseSchema.parse({systemPrompt:buildStateUpdateSystemPrompt(profile,bundle.files),outputSchema})};
  });

  async function initialize({ session, opening }) {
    const response = session.data ?? session;
    const row = getSessionById(response.id);
    if (!row) throw new Error("ROLE_SESSION_NOT_FOUND");
    const existing = parseRecords(row.id, row.accountId)[0];
    if (existing) return existing;

    const ext = extension(row);
    const openingId =
      opening?.id ?? JSON.parse(row.metadataJson ?? "{}").opening_id;
    const selected = ext.openings.items.find((item) => item.id === openingId);
    if (!selected) throw new Error("ROLE_OPENING_NOT_FOUND");
    const rawVariables = structuredClone(selected.variables);
    const variables = expandMacroStrings(
      rawVariables,
      (text) =>
        previewPromptMacroText({
          session: row,
          text,
          chatHistory: [],
          ordinaryVariables: { stat_data: rawVariables },
          localValues: { stat_data: rawVariables },
          globalValues: {},
        }).text,
    );
    if(ext.stateUpdate) {
      const {profile,files}=ext.stateUpdate;
      const schema=profile.stateSchemaFile ? JSON.parse(files[profile.stateSchemaFile]) : profile.stateSchema;
      if(!ajv.compile(schema)(variables)) throw Error("ROLE_INITIAL_STATE_INVALID");
    }
    const record = {
      sessionId: row.id,
      branchId: "main",
      floorId: null,
      attemptId: null,
      versionId: row.characterVersionId,
      snapshotId: randomUUID(),
      parentSnapshotId: null,
      variables,
      source: { kind: "initial", runId: null, jobId: null },
    };
    await persistRecord({ accountId: row.accountId, record });
    return record;
  }

  const requireSession = (request, reply) => {
    const accountId = getRequestAuthContext(request).accountId;
    const session = getSession(request.params.id, accountId);
    if (!session) {
      sendError(
        reply,
        404,
        "not_found",
        "Session not found. Select an existing session or create a new one.",
      );
      return null;
    }
    return { session, accountId };
  };

  app.addHook("preHandler", async (request, reply) => {
    if (
      request.method !== "POST" ||
      !RESPOND_ROUTES.has(request.routeOptions.url)
    )
      return;
    const sessionId = request.params?.id;
    if (typeof sessionId !== "string") return;
    const accountId = getRequestAuthContext(request).accountId;
    const session = getSession(sessionId, accountId);
    if (!session || snapshotRows(sessionId, accountId).length === 0) return;
    const pending = nextPendingFloor(sessionId);
    if (running.has(sessionId) || pending) {
      return sendError(
        reply,
        409,
        "role_state_pending",
        "Complete the pending role state update before sending the next message.",
        { floor_id: pending?.id ?? null },
      );
    }
  });

  app.get("/sessions/:id/role-view", async (request, reply) => {
    const context = requireSession(request, reply);
    if (!context) return;
    const { session, accountId } = context;
    const records = parseRecords(session.id, accountId);
    if (!records.length) {
      return sendError(
        reply,
        409,
        "role_state_uninitialized",
        "This session has no initial role state. Select an opening and create a new session.",
      );
    }

    const ext = extension(session);
    const delivery = structuredClone(ext.runtimeDelivery);
    const persona = JSON.parse(session.userSnapshotJson);
    delivery.scriptUrl = delivery.scriptUrl.replace(
      "{version}",
      session.characterVersionId,
    );
    for (const asset of Object.values(delivery.assets)) {
      asset.url = asset.url.replace("{version}", session.characterVersionId);
    }
    const openingId = JSON.parse(session.metadataJson).opening_id;
    const opening = ext.openings.items.find((item) => item.id === openingId);
    if (!opening) {
      return sendError(
        reply,
        409,
        "role_opening_not_found",
        "The selected opening is unavailable. Create a new session.",
      );
    }
    delivery.data.opening = previewPromptMacroText({
      session,
      text: opening.displayText,
      chatHistory: [],
      ordinaryVariables: { stat_data: records[0].variables },
      localValues: { stat_data: records[0].variables },
      globalValues: {},
    }).text;
    delivery.data.performerName = persona.name;
    if (persona.avatar) {
      delivery.assets[delivery.data.performerAvatar] = {
        kind: "image",
        url: persona.avatar,
        label: persona.name,
        tags: ["avatar"],
      };
    }
    const pending = nextPendingFloor(session.id);
    return {
      data: {
        character_id: session.characterId,
        character_version_id: session.characterVersionId,
        name: session.title,
        delivery,
        initial: records[0],
        current: records.at(-1),
        snapshots: records
          .filter((record) => record.floorId)
          .map((record) => ({
            floorId: record.floorId,
            snapshotId: record.snapshotId,
            attemptId: record.attemptId,
          })),
        processing: {
          pendingMain: null,
          pendingFollowups: false,
          pendingStateFloorId: pending?.id ?? null,
        },
        capabilities: {
          send: !pending && !running.has(session.id),
          history: true,
          customFloors: !!delivery.floorHtml,
        },
      },
    };
  });

  for (const [suffix, column] of [
    ["snapshots/:snapshotId", "id"],
    ["floors/:floorId", "floor_id"],
  ]) {
    app.get(`/sessions/:id/role-view/${suffix}`, async (request, reply) => {
      const context = requireSession(request, reply);
      if (!context) return;
      const row = sqlite
        .prepare(
          `
        SELECT record_json FROM role_display_snapshot
        WHERE session_id=? AND account_id=? AND ${column}=?
      `,
        )
        .get(
          context.session.id,
          context.accountId,
          request.params.snapshotId ?? request.params.floorId,
        );
      if (!row) {
        return sendError(
          reply,
          404,
          "role_snapshot_not_found",
          "This turn has no committed state snapshot. Select a completed turn or retry its state update.",
        );
      }
      return { data: JSON.parse(row.record_json) };
    });
  }

  app.post(
    "/sessions/:id/role-state/updates",
    {
      schema: {
        body: {
          type: "object",
          required: ["floor_id"],
          additionalProperties: false,
          properties: { floor_id: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const context = requireSession(request, reply);
      if (!context) return;
      const { session, accountId } = context;
      const floorId = request.body.floor_id;
      const existingRows = snapshotRows(session.id, accountId);
      const previous = JSON.parse(existingRows.at(-1)?.record_json ?? "null");
      const done = existingRows.find((row) => row.floor_id === floorId);
      if (done) return { data: JSON.parse(done.record_json) };
      if (!previous) {
        return sendError(
          reply,
          409,
          "role_state_uninitialized",
          "This session has no initial role state. Select an opening and create a new session.",
        );
      }
      if (running.has(session.id)) {
        return sendError(
          reply,
          409,
          "role_state_busy",
          "State update is running. Wait for it to finish before retrying.",
        );
      }

      running.add(session.id);
      try {
        const floor = sqlite
          .prepare(
            `
        SELECT * FROM floor WHERE id=? AND session_id=? AND superseded_at IS NULL
      `,
          )
          .get(floorId, session.id);
        if (!floor) {
          return sendError(
            reply,
            404,
            "role_floor_not_found",
            "Floor not found in this session. Select a floor from the current session.",
          );
        }
        if (floor.state !== "committed") {
          return sendError(
            reply,
            409,
            "role_floor_not_committed",
            "The reply has not been committed. Wait for generation to complete before updating state.",
          );
        }
        if (floor.branch_id !== previous.branchId) {
          return sendError(
            reply,
            409,
            "role_state_branch_mismatch",
            "Update the current role branch before changing another branch.",
          );
        }
        const pending = nextPendingFloor(session.id, previous.branchId);
        if (!pending || pending.id !== floorId) {
          return sendError(
            reply,
            409,
            "role_state_out_of_order",
            "Update the earliest pending role floor first.",
            { expected_floor_id: pending?.id ?? null },
          );
        }
        const run = sqlite
          .prepare(
            `
        SELECT * FROM floor_run_state WHERE floor_id=? AND status='completed'
      `,
          )
          .get(floorId);
        if (!run) {
          return sendError(
            reply,
            409,
            "role_floor_run_incomplete",
            "Wait for the reply run to finish before updating state.",
          );
        }

        const pages = await callApi(
          request.headers,
          "GET",
          `/pages?floor_id=${encodeURIComponent(floorId)}&is_active=true&limit=100`,
        );
        const sourceOutput = loadSessionOutput(db, accountId, session.id);
        const sources = [];
        for (const page of pages) {
          const pageMessages = await callApi(
            request.headers,
            "GET",
            `/messages?page_id=${encodeURIComponent(page.id)}&sort_by=seq&sort_order=asc&limit=100`,
          );
          for (const message of pageMessages) {
            if (["user", "assistant"].includes(message.role)) {
              sources.push({
                messageId: message.id,
                revision: page.version,
                role: message.role,
                text: message.role === "assistant" ? sourceOutput.project(message.content, "completed") : message.content,
              });
            }
          }
        }

        const ext = extension(session);
        const bundle = ext.stateUpdate;
        let variables = previous.variables;
        if (bundle) {
          const profile = structuredClone(bundle.profile);
          const files = bundle.files;
          const directory = path.resolve(
            moduleDirectory,
            session.characterVersionId,
          );
          fs.mkdirSync(directory, { recursive: true });
          for (const [name, content] of Object.entries(files)) {
            const destination = path.resolve(directory, name);
            if (!destination.startsWith(directory + path.sep))
              throw new Error("ROLE_MODULE_PATH_INVALID");
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            if (!fs.existsSync(destination))
              fs.writeFileSync(destination, content);
          }
          if (profile.stateSchemaFile)
            profile.stateSchema = JSON.parse(files[profile.stateSchemaFile]);
          for (const [field, exportName] of [
            ["deriveScript", "derive"],
            ["validateScript", "validate"],
          ]) {
            if (profile[field]) {
              profile[exportName] = (
                await import(
                  pathToFileURL(path.resolve(directory, profile[field]))
                )
              )[exportName];
            }
          }
          if (profile.factsSchema)
            profile.validateFacts = ajv.compile(profile.factsSchema);
          let updateBase = previous;
          if (profile.controllerOwnedPaths?.length) {
            const resolved = await callApi(request.headers, "GET", `/variables/resolve?session_id=${encodeURIComponent(session.id)}&branch_id=${encodeURIComponent(previous.branchId)}`);
            const state = resolved.resolved.find(item=>item.key === "stat_data")?.value;
            updateBase = {...previous, variables:mergeControllerState(previous.variables,state,profile.controllerOwnedPaths)};
          }
          const outputSchema = buildRestrictedOutputSchema(
            profile,
            sources.map((message) => message.messageId),
          );
          const output = await generateStateUpdate({
            accountId,
            session,
            profile,
            files,
            previous:updateBase,
            sources,
            outputSchema,
            db,
          });
          variables = applyProposal(
            updateBase.variables,
            output,
            profile,
            validateOutput,
            ajv.compile(profile.stateSchema),
            sources.map((message) => message.messageId),
            sources,
          );
        }

        const attemptId = `${run.run_id}:${run.attempt_no}`;
        const record = {
          ...previous,
          branchId: floor.branch_id,
          floorId,
          attemptId,
          snapshotId: randomUUID(),
          parentSnapshotId: previous.snapshotId,
          variables,
          source: { kind: "floor", runId: run.run_id, jobId: null },
        };
        await persistRecord({
          accountId,
          record,
          previousVariables: previous.variables,
        });
        return { data: record };
      } catch (error) {
        return sendError(
          reply,
          422,
          "role_state_update_failed",
          "State update failed. Retry the state update.",
          { cause: error instanceof Error ? error.message : String(error) },
        );
      } finally {
        running.delete(session.id);
      }
    },
  );

  return { initialize };
}

function expandMacroStrings(value, expand) {
  if (typeof value === "string") return expand(value);
  if (Array.isArray(value))
    return value.map((item) => expandMacroStrings(item, expand));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        expandMacroStrings(item, expand),
      ]),
    );
  }
  return value;
}

export function buildRestrictedOutputSchema(profile, evidenceMessageIds) {
  const changeVariants = profile.writablePaths.flatMap((path) => {
    let valueSchema = profile.stateSchema;
    for (const part of path
      .slice(1)
      .split("/")
      .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      valueSchema = valueSchema?.properties?.[part];
    }
    if (!valueSchema) throw new Error(`ROLE_STATE_PATH_SCHEMA_MISSING:${path}`);
    return [
      {
        type: "object",
        required: ["op", "path", "value"],
        properties: {
          op: { const: "set" },
          path: { const: path },
          value: {
            type: valueSchema.type,
            ...(valueSchema.type === "array"
              ? {
                  items: {},
                  minItems: valueSchema.minItems,
                  maxItems: valueSchema.maxItems,
                }
              : {}),
          },
        },
        additionalProperties: false,
      },
      {
        type: "object",
        required: ["op", "path"],
        properties: { op: { const: "remove" }, path: { const: path } },
        additionalProperties: false,
      },
    ];
  });
  return {
    type: "object",
    required: [
      "changes",
      "evidenceMessageIds",
      ...(profile.factsSchema ? ["facts"] : []),
    ],
    additionalProperties: false,
    properties: {
      changes: {
        type: "array",
        description:
          "Write each path at most once. For an array path, set the complete array in one operation.",
        maxItems: profile.writablePaths.length,
        items: changeVariants.length ? { oneOf: changeVariants } : false,
      },
      evidenceMessageIds: {
        type: "array",
        items: { enum: evidenceMessageIds },
        uniqueItems: true,
        ...(profile.factsSchema ? { minItems: 1 } : {}),
        description: profile.factsSchema
          ? "Include at least one exact messageId from sources because this update includes facts."
          : "When changes is non-empty, include at least one exact messageId from sources.",
      },
      ...(profile.factsSchema ? { facts: profile.factsSchema } : {}),
    },
  };
}

export function buildStateUpdateSystemPrompt(profile, files) {
  const evidenceRequirement = profile.factsSchema
    ? "The required facts object must be supported by evidenceMessageIds, so evidenceMessageIds must contain at least one exact sources[].messageId."
    : "When changes is non-empty, evidenceMessageIds must contain at least one exact sources[].messageId.";
  return [
    profile.updaterPrompt,
    ...(profile.ruleFiles || []).map((file) => files[file]),
    "Return one JSON object that matches outputSchema exactly.",
    "Write each path at most once. Set an array as one complete array value, never as repeated writes to the same path.",
    "Copy evidence IDs only from sources[].messageId. Do not invent, transform, or omit a required ID.",
    evidenceRequirement,
  ]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join("\n");
}

export function buildStateUpdateGenerationParams(profile, outputSchema) {
  return {
    maxOutputTokens: profile.maxTokens,
    reasoningEffort: profile.updaterReasoning?.effort,
    responseFormat: { type: "json_schema", jsonSchema: outputSchema },
  };
}

async function generateStateUpdateWithProfile({
  accountId,
  session,
  profile,
  files,
  previous,
  sources,
  outputSchema,
  db,
}) {
  const profiles = await new LlmProfileService(db, {
    masterKey: process.env.APP_SECRETS_MASTER_KEY,
  }).resolveActiveProfiles(session.id, accountId);
  const model = profiles[profile.modelSlot || "verifier"];
  if (!model) throw new Error("ROLE_UPDATER_PROFILE_MISSING");
  const registry = new ProviderRegistry();
  registry.register({
    id: "role-state",
    type: model.provider,
    apiKey: model.apiKey,
    baseURL: model.baseUrl,
    apiMode: "chat",
  });
  const service = new LLMService(registry, {
    providerId: "role-state",
    modelId: model.modelId,
  });
  const prompt = buildStateUpdateSystemPrompt(profile, files);
  const expanded = previewPromptMacroText({
    session,
    text: prompt,
    chatHistory: [],
    ordinaryVariables: { stat_data: previous.variables },
    localValues: { stat_data: previous.variables },
    globalValues: {},
  }).text;
  const result = await service.generate({
    messages: [
      { role: "system", content: expanded },
      {
        role: "user",
        content: JSON.stringify({
          before: previous.variables,
          sources,
          consumedSources: [],
          priorFacts: [],
          floorBefore: previous.variables,
          writablePaths: profile.writablePaths,
          stateSchema: profile.stateSchema,
          outputSchema,
          factsSchema: profile.factsSchema,
        }),
      },
    ],
    params: buildStateUpdateGenerationParams(profile, outputSchema),
  });
  if (result.finishReason !== "stop")
    throw new Error("ROLE_STATE_OUTPUT_INCOMPLETE");
  return JSON.parse(result.text);
}
