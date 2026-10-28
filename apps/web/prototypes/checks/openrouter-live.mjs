import fs from "node:fs";

export function loadCredentials(filename) {
  const config = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (!config.apiKey?.trim()) throw new Error("OPENROUTER_KEY_MISSING");
  if (config.baseUrl !== "https://openrouter.ai/api/v1")
    throw new Error("OPENROUTER_URL_INVALID");
  for (const slot of ["narratorModel", "updaterModel"]) {
    if (config[slot] !== "openrouter/free" && !config[slot]?.endsWith(":free"))
      throw new Error("FREE_MODEL_REQUIRED");
  }
  return config;
}

export function providerSchema(schema) {
  if (Array.isArray(schema)) return schema.map(providerSchema);
  if (!schema || typeof schema !== "object") return schema;
  const result = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, providerSchema(value)]),
  );
  if (Array.isArray(schema.items)) {
    result.prefixItems = schema.items.map(providerSchema);
    result.items =
      schema.additionalItems === undefined
        ? true
        : providerSchema(schema.additionalItems);
    delete result.additionalItems;
  }
  return result;
}

export async function* streamCompletion(
  config,
  model,
  messages,
  signal,
  fetcher = fetch,
  responseFormat,
) {
  const response = await fetcher(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...config.sampling,
      ...(config.reasoning ? { reasoning: config.reasoning } : {}),
      ...(config.maxTokens === undefined
        ? {}
        : { max_tokens: config.maxTokens }),
      ...(responseFormat
        ? {
            response_format: {
              ...responseFormat,
              json_schema: {
                ...responseFormat.json_schema,
                schema: providerSchema(responseFormat.json_schema.schema),
              },
            },
            provider: { require_parameters: true },
          }
        : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error(`OPENROUTER_HTTP_${response.status}`), {
      providerError: detail,
      updaterModel: model,
    });
  }
  let buffer = "";
  let incomplete;
  let usage = null;
  let generationId = null;
  const decoder = new TextDecoder();
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        if (incomplete) {
          incomplete.providerError.usage = usage;
          incomplete.providerError.generationId = generationId;
          throw incomplete;
        }
        return;
      }
      const chunk = JSON.parse(data);
      if (chunk.usage) usage = chunk.usage;
      if (chunk.id) generationId = chunk.id;
      if (chunk.error)
        throw Object.assign(new Error("OPENROUTER_STREAM_ERROR"), {
          providerError: chunk.error,
          updaterModel: chunk.model || model,
        });
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason && choice.finish_reason !== "stop")
        incomplete = Object.assign(new Error("OPENROUTER_INCOMPLETE"), {
          providerError: {
            finishReason: choice.finish_reason,
            usage,
            generationId,
            requestedMaxTokens: config.maxTokens ?? null,
            reasoning: config.reasoning ?? null,
          },
          updaterModel: chunk.model || model,
        });
      yield { text: choice?.delta?.content || "", model: chunk.model || model };
    }
  }
  if (incomplete) {
    incomplete.providerError.usage = usage;
    incomplete.providerError.generationId = generationId;
    throw incomplete;
  }
  throw new Error("OPENROUTER_STREAM_INTERRUPTED");
}

export function applyProposal(
  before,
  output,
  profile,
  validateOutput,
  validateState,
  evidenceIds,
  sourceMessages = [],
  priorFacts = [],
  floorBefore = before,
) {
  if (!validateOutput(output))
    throw Object.assign(new Error("STATE_OUTPUT_INVALID"), {
      issues: structuredClone(validateOutput.errors || []),
    });
  if (profile.factsSchema) {
    if (!profile.validateFacts?.(output.facts))
      throw Object.assign(new Error("STATE_FACTS_INVALID"), {
        issues: structuredClone(profile.validateFacts?.errors || []),
      });
  } else if (output.facts !== undefined)
    throw new Error("STATE_FACTS_UNDECLARED");
  if (
    (output.changes.length || profile.factsSchema) &&
    !output.evidenceMessageIds.length
  )
    throw new Error("STATE_EVIDENCE_REQUIRED");
  if (output.evidenceMessageIds.some((id) => !evidenceIds.includes(id)))
    throw new Error("STATE_EVIDENCE_INVALID");
  let candidate = structuredClone(before);
  const paths = output.changes.map((change) => change.path);
  for (let i = 0; i < paths.length; i++) {
    if (
      paths
        .slice(i + 1)
        .some(
          (other) =>
            other === paths[i] ||
            other.startsWith(paths[i] + "/") ||
            paths[i].startsWith(other + "/"),
        )
    )
      throw new Error("STATE_PATH_OVERLAP");
    if (
      (profile.derivedPaths || []).some(
        (derived) =>
          derived === paths[i] ||
          derived.startsWith(paths[i] + "/") ||
          paths[i].startsWith(derived + "/"),
      )
    )
      throw new Error("STATE_DERIVED_WRITE");
  }
  for (const change of output.changes) {
    if (!profile.writablePaths.includes(change.path))
      throw new Error("STATE_PATH_FORBIDDEN");
    const parts = change.path
      .slice(1)
      .split("/")
      .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    let parent = candidate;
    for (const part of parts.slice(0, -1)) {
      if (!parent || !Object.hasOwn(parent, part))
        throw new Error("STATE_PATH_MISSING");
      parent = parent[part];
    }
    const key = parts.at(-1);
    if (!parent || !Object.hasOwn(parent, key))
      throw new Error("STATE_PATH_MISSING");
    if (change.op === "remove") delete parent[key];
    else parent[key] = structuredClone(change.value);
  }
  const context = {
    before: structuredClone(before),
    candidate,
    sourceMessages: structuredClone(sourceMessages),
    priorFacts: structuredClone(priorFacts),
    floorBefore: structuredClone(floorBefore),
    facts: output.facts || {},
  };
  const freeze = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  if (profile.derive)
    candidate = profile.derive(freeze(structuredClone(context)));
  if (!validateState(candidate)) throw new Error("STATE_SCHEMA_INVALID");
  if (profile.validate) {
    const result = profile.validate(freeze({ ...context, candidate }));
    if (!result || !Array.isArray(result.issues))
      throw new Error("STATE_VALIDATOR_INVALID");
    if (result.issues.length)
      throw Object.assign(new Error("STATE_RULE_INVALID"), {
        issues: result.issues,
      });
  }
  return candidate;
}

export async function generateLiveTurn({
  config,
  profile,
  before,
  history,
  input,
  messageIds,
  onText,
  validateOutput,
  validateState,
  signal,
  resume,
  onNarrative,
  narrative,
}) {
  let text = "",
    narratorModel;
  const messages = narrative
    ? narrative.messages
    : [
        { role: "system", content: profile.narratorPrompt },
        { role: "system", content: JSON.stringify({ variables: before }) },
        ...history.map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.text,
        })),
        { role: "user", content: input },
      ];
  if (!resume) {
    if (profile.promptBundleFile && !narrative)
      throw new Error("BOUND_PROMPT_REQUIRED");
    for await (const chunk of streamCompletion(
      {
        ...config,
        maxTokens: narrative?.maxTokens ?? profile.maxTokens,
        sampling: narrative?.sampling,
        reasoning: profile.narratorReasoning,
      },
      config.narratorModel,
      messages,
      signal,
    )) {
      narratorModel = chunk.model;
      text += chunk.text;
      if (chunk.text)
        onText(
          narrative?.postProcess ? narrative.postProcess(text) : text,
          false,
        );
    }
    if (!text.trim()) throw new Error("NARRATIVE_EMPTY");
    if (narrative?.postProcess) text = narrative.postProcess(text);
    onText(text, true);
  } else {
    text = resume.text;
    narratorModel = resume.narratorModel;
    onText(text, true);
  }
  const promptTrace = resume?.promptTrace || narrative?.trace;
  onNarrative?.({ text, narratorModel, promptTrace });
  const sources = [
    { messageId: messageIds.user, revision: 0, role: "user", text: input },
    { messageId: messageIds.assistant, revision: 0, role: "assistant", text },
  ];
  const update = await updateLiveState({
    config,
    profile,
    before,
    sources,
    validateOutput,
    validateState,
    signal,
  });
  return {
    text,
    variables: update.variables,
    output: update.output,
    models: { narrator: narratorModel, updater: update.updaterModel },
    promptTrace,
  };
}

export async function updateLiveState({
  config,
  profile,
  before,
  sources,
  validateOutput,
  validateState,
  signal,
  priorFacts = [],
  floorBefore = before,
  consumedSources = [],
}) {
  const outputSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "changes",
      "evidenceMessageIds",
      ...(profile.factsSchema ? ["facts"] : []),
    ],
    properties: {
      ...(profile.factsSchema ? { facts: profile.factsSchema } : {}),
      changes: {
        type: "array",
        items: {
          anyOf: profile.writablePaths.map((pointer) => {
            const leaf = pointer
              .slice(1)
              .split("/")
              .reduce(
                (node, part) =>
                  node.properties[part.replace(/~1/g, "/").replace(/~0/g, "~")],
                profile.stateSchema,
              );
            return {
              type: "object",
              additionalProperties: false,
              required: ["op", "path", "value"],
              properties: {
                op: { const: "set" },
                path: { const: pointer },
                value: leaf,
              },
            };
          }),
        },
      },
      evidenceMessageIds: {
        type: "array",
        items: {
          type: "string",
          enum: sources.map((source) => source.messageId),
        },
      },
    },
  };
  let raw = "",
    updaterModel;
  for await (const chunk of streamCompletion(
    {
      ...config,
      maxTokens: profile.maxTokens,
      reasoning: profile.updaterReasoning,
    },
    config.updaterModel,
    [
      {
        role: "system",
        content:
          profile.updaterPrompt +
          (profile.rulesText ? "\n" + profile.rulesText : ""),
      },
      {
        role: "user",
        content: JSON.stringify({
          before,
          sources,
          consumedSources,
          priorFacts,
          floorBefore,
          writablePaths: profile.writablePaths,
          stateSchema: profile.stateSchema,
          outputSchema,
          ...(profile.factsSchema ? { factsSchema: profile.factsSchema } : {}),
        }),
      },
    ],
    signal,
    fetch,
    {
      type: "json_schema",
      json_schema: {
        name: "state_update",
        strict: true,
        schema: outputSchema,
      },
    },
  )) {
    raw += chunk.text;
    updaterModel = chunk.model;
  }
  let output;
  try {
    output = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("STATE_OUTPUT_INVALID_JSON"), {
      rawOutput: raw,
      updaterModel,
    });
  }
  let variables;
  try {
    variables = applyProposal(
      before,
      output,
      profile,
      validateOutput,
      validateState,
      sources.map((source) => source.messageId),
      sources,
      priorFacts,
      floorBefore,
    );
  } catch (error) {
    throw Object.assign(error, { rawOutput: raw, updaterModel });
  }
  return {
    variables,
    output,
    updaterModel,
  };
}
