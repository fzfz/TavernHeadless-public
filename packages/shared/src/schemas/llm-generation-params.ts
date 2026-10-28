export type RuntimeResponseFormat = {
  type: "text" | "json_object" | "json_schema";
  json_schema?: Record<string, unknown>;
};

export type RuntimeParamsResponse = {
  max_context_tokens?: number | null;
  max_output_tokens?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  stop_sequences?: string[] | null;
  seed?: number | null;
  repetition_penalty?: number | null;
  min_p?: number | null;
  logit_bias?: Record<string, number> | null;
  response_format?: RuntimeResponseFormat | null;
  stream?: boolean | null;
  timeout_ms?: number | null;
  max_retries?: number | null;
  reasoning_effort?: "none" | "low" | "medium" | "high" | null;
};

export const generationParamsJsonSchemaProperties = {
  max_context_tokens: { type: ["integer", "null"], minimum: 1 },
  max_output_tokens: { type: ["integer", "null"], minimum: 1 },
  temperature: { type: ["number", "null"], minimum: 0, maximum: 2 },
  top_p: { type: ["number", "null"], minimum: 0, maximum: 1 },
  top_k: { type: ["integer", "null"], minimum: 0 },
  frequency_penalty: { type: ["number", "null"], minimum: -2, maximum: 2 },
  presence_penalty: { type: ["number", "null"], minimum: -2, maximum: 2 },
  stop_sequences: {
    type: ["array", "null"],
    items: { type: "string", minLength: 1 },
    maxItems: 16,
  },
  seed: { type: ["integer", "null"] },
  repetition_penalty: {
    type: ["number", "null"],
    exclusiveMinimum: 0,
    maximum: 2,
  },
  min_p: { type: ["number", "null"], minimum: 0, maximum: 1 },
  logit_bias: {
    anyOf: [
      {
        type: "object",
        additionalProperties: { type: "number", minimum: -100, maximum: 100 },
        maxProperties: 256,
      },
      { type: "null" },
    ],
  },
  response_format: {
    anyOf: [
      {
        type: "object",
        required: ["type"],
        properties: {
          type: {
            type: "string",
            enum: ["text", "json_object", "json_schema"],
          },
          json_schema: {
            type: "object",
            additionalProperties: true,
          },
        },
        additionalProperties: false,
      },
      { type: "null" },
    ],
  },
  stream: { type: ["boolean", "null"] },
  timeout_ms: { type: ["integer", "null"], minimum: 1 },
  max_retries: { type: ["integer", "null"], minimum: 0, maximum: 10 },
  reasoning_effort: {
    type: ["string", "null"],
    enum: ["none", "low", "medium", "high", null],
  },
} as const;

export const llmGenerationParamsJsonSchema = {
  type: "object",
  properties: generationParamsJsonSchemaProperties,
  additionalProperties: false,
} as const;
