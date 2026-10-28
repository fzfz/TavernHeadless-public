import { APICallError, RetryError } from "ai";
import {
  roleToolProtocolErrorPolicy,
  roleToolProtocolProviderErrorSchema,
} from "@tavern/shared";
import { GenerationPipelineError } from "../generation/generation-pipeline.js";

const rules = roleToolProtocolErrorPolicy.rules.map((rule) => ({
  codes: new Set(rule.codes),
  parameters: rule.parameterPatterns.map((pattern) => new RegExp(pattern)),
}));

/** Recognize explicit schema rejections in the final failed LLM request only. */
export function isRoleToolProtocolRejection(error: unknown): boolean {
  let current = error;
  let isLlmFailure = false;
  const visited = new Set<unknown>();
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (current instanceof GenerationPipelineError) {
      if (current.phase !== "llm") return false;
      isLlmFailure = true;
    }
    if (APICallError.isInstance(current)) {
      if (
        !isLlmFailure ||
        current.statusCode === undefined ||
        !roleToolProtocolErrorPolicy.httpStatuses.includes(current.statusCode)
      )
        return false;
      const parsed = roleToolProtocolProviderErrorSchema.safeParse(
        current.data,
      );
      return (
        parsed.success &&
        rules.some(
          (rule) =>
            rule.codes.has(parsed.data.error.code) &&
            rule.parameters.some((pattern) =>
              pattern.test(parsed.data.error.param),
            ),
        )
      );
    }
    current = RetryError.isInstance(current)
      ? current.lastError
      : current.cause;
  }
  return false;
}
