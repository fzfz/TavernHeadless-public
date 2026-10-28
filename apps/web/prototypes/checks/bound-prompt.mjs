import { compileRegexMigration } from "./regex-migration.mjs";
import fs from "node:fs";
import { preparePresetImport } from "./preset-import.mjs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The prototype uses the production assembler; role files only declare bindings.
export async function createBoundPrompt({
  backendRoot,
  app,
  database,
  schema,
  accountId,
  pkg,
  bundle,
}) {
  const backendImport = (file) =>
    import(pathToFileURL(path.join(backendRoot, file)));
  const { assemblePrompt, materializePromptRuntimeMessages } =
    await backendImport("apps/api/src/services/prompt-assembler.ts");
  const { SimpleTokenCounter } = await backendImport(
    "packages/core/src/index.ts",
  );
  const { VariableService } = await backendImport(
    "apps/api/src/services/variables/variable-service.ts",
  );
  const { eq } = await import(
    pathToFileURL(path.join(backendRoot, "node_modules/drizzle-orm/index.js"))
  );
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.resolve(pkg.directory, file), "utf8"));
  const importAsset = async (kind, payload) => {
    const response = await app.inject({
      method: "POST",
      url: `/import/${kind}`,
      payload,
    });
    if (response.statusCode !== 201)
      throw new Error(
        `BOUND_${kind.toUpperCase()}_IMPORT_FAILED: ${response.body}`,
      );
    return response.json().data.id;
  };
  const { resolveAssistantPrefillStrategy } = await backendImport(
    "apps/api/src/lib/llm-provider-discovery.ts",
  );
  const assistantPrefillStrategy =
    resolveAssistantPrefillStrategy("openai-compatible");
  const { data: presetData, conversions: presetConversions } =
    preparePresetImport(read(bundle.presetFile), bundle.presetImport);
  const presetId = await importAsset("preset", {
    name: bundle.presetName,
    data: presetData,
  });
  const presetVersion = database
    .select()
    .from(schema.presetVersions)
    .where(eq(schema.presetVersions.presetId, presetId))
    .get();
  const regexSources = [
    { kind: "character", scripts: pkg.snapshot.extensions.regex_scripts || [] },
    { kind: "preset", scripts: presetData.extensions?.regex_scripts || [] },
  ];
  const { scripts: regexScripts, audit: regexConversions } =
    compileRegexMigration([
      {
        key: path.basename(pkg.directory),
        kind: "character",
        name: pkg.name,
        scripts: regexSources[0].scripts,
      },
      {
        key: "preset",
        kind: "preset",
        name: bundle.presetName,
        resourceId: presetId,
        versionId: presetVersion.id,
        scripts: regexSources[1].scripts,
      },
    ]);
  const regexId = await importAsset("regex", {
    name: `${pkg.name} · 演绎正则`,
    data: regexScripts,
  });
  const regexVersion = database
    .select()
    .from(schema.regexProfileVersions)
    .where(eq(schema.regexProfileVersions.regexProfileId, regexId))
    .get();
  const controller = bundle.controllerModule
    ? (
        await import(
          pathToFileURL(path.resolve(pkg.directory, bundle.controllerModule))
        )
      ).renderController
    : null;
  const service = new VariableService(database);
  const initialized = new Set();
  return async ({ state, input, history }) => {
    const snapshot = structuredClone(pkg.snapshot);
    const controllers = [];
    for (const entry of snapshot.characterBook.entries) {
      if (bundle.updaterEntryIds.includes(entry.id)) entry.enabled = false;
      if (bundle.controllerEntryIds.includes(entry.id)) {
        const rendered = await controller({
          entryId: entry.id,
          variables: state.current.variables,
          characterBook: pkg.snapshot.characterBook,
        });
        entry.content = rendered.text;
        controllers.push({
          entryId: entry.id,
          referencedEntryIds: rendered.referencedEntryIds,
        });
      }
      for (const mapping of bundle.variableMacros) {
        entry.content = entry.content
          .split(mapping.source)
          .join(mapping.target);
      }
    }
    const info = {
      presetId,
      presetVersionId: presetVersion.id,
      regexProfileId: regexId,
      regexProfileVersionId: regexVersion.id,
      worldbookProfileId: null,
      worldbookVersionId: null,
      deepBinding: true,
      promptMode: bundle.promptMode,
      metadataJson: "{}",
      characterId: pkg.id,
      characterVersionId: state.current.versionId,
      characterSnapshotJson: JSON.stringify(snapshot),
      userSnapshotJson: JSON.stringify(bundle.performer),
    };
    if (!initialized.has(state.sessionId)) {
      const now = Date.now();
      database
        .insert(schema.sessions)
        .values({
          id: state.sessionId,
          accountId,
          ...info,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      database
        .insert(schema.sessionBranches)
        .values({
          id: randomUUID(),
          accountId,
          sessionId: state.sessionId,
          branchId: state.branchId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      initialized.add(state.sessionId);
    }
    await service.upsert({
      accountId,
      scope: "chat",
      scopeId: state.sessionId,
      key: bundle.variableRoot,
      value: state.current.variables,
    });
    const assembled = await assemblePrompt(
      database,
      accountId,
      info,
      history,
      input,
      new SimpleTokenCounter(),
      undefined,
      {
        includeDebug: true,
        includeWorldbookMatchTrace: true,
        runKind: "respond",
        intent: "normal",
        assistantPrefillStrategy,
        variableContext: {
          sessionId: state.sessionId,
          branchId: state.branchId,
        },
      },
    );
    if (!assembled.promptSnapshot.preset)
      throw new Error("BOUND_PRESET_NOT_LOADED");
    const prepared = assembled.preProcess
      ? assembled.preProcess(assembled.messages)
      : assembled.messages;
    const delivery = materializePromptRuntimeMessages({
      messages: prepared,
      sendDirectives: assembled.sendDirectives,
      assistantPrefillStrategy,
    });
    const preset = assembled.promptSnapshot.preset.preset;
    return {
      messages: delivery.messages,
      maxTokens: preset.maxTokens,
      postProcess: assembled.postProcess,
      sampling: {
        temperature: preset.temperature,
        top_p: preset.topP,
        top_k: preset.topK,
        min_p: preset.minP,
        frequency_penalty: preset.frequencyPenalty,
        presence_penalty: preset.presencePenalty,
        repetition_penalty: preset.repetitionPenalty,
      },
      trace: {
        presetId,
        presetVersionId: presetVersion.id,
        presetName: bundle.presetName,
        presetConversions,
        regexConversions,
        regexSources: regexSources.map((source) => ({
          kind: source.kind,
          count: source.scripts.length,
        })),
        regexProfileId: regexId,
        regexProfileVersionId: regexVersion.id,
        characterVersionId: state.current.versionId,
        performer: bundle.performer,
        sampling: {
          maxContext: preset.maxContext,
          maxTokens: preset.maxTokens,
          effectiveMaxTokens: preset.maxTokens,
          temperature: preset.temperature,
        },
        runtimeTraceSeed: assembled.runtimeTraceSeed,
        worldbookActivatedEntries:
          assembled.promptSnapshot.worldbookActivatedEntries,
        controllers,
        updaterEntryIds: bundle.updaterEntryIds,
        debug: assembled.debug,
        delivery: delivery.deliveryTrace,
        messages: delivery.messages,
      },
    };
  };
}
