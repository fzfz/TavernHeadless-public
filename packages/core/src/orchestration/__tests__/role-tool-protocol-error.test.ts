import { describe, expect, it } from "vitest";
import { APICallError, RetryError } from "ai";
import { GenerationPipelineError } from "../../generation/generation-pipeline.js";
import { LLMServiceError } from "../../llm/llm-service.js";
import { isRoleToolProtocolRejection } from "../role-tool-protocol-error.js";

function providerError(
  code = "invalid_function_parameters",
  param = "tools[0].function.parameters",
  statusCode = 400,
  data: unknown = { error: { code, param, message: "oneOf is not supported" } },
) {
  return new APICallError({
    message: "Provider rejected request",
    url: "https://test.invalid/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    data,
  });
}

function llmFailure(error: unknown) {
  return new GenerationPipelineError(
    "LLM failed",
    "llm",
    new LLMServiceError("Request failed", error),
  );
}

describe("formal native provider tool schema errors", () => {
  it.each([
    ["invalid_function_parameters", "tools[0].function.parameters", 400],
    ["unsupported_tool_schema", "tools.1.input_schema.$defs.expression", 422],
    ["unsupported_parameter", "tools", 400],
  ])("recognizes %s for %s with status %s", (code, param, status) => {
    const original = providerError(code, param, status);
    expect(isRoleToolProtocolRejection(llmFailure(original))).toBe(true);
    expect(original.data).toMatchObject({ error: { code, param } });
  });

  it.each([
    ["invalid_request_error", "tools[0].function.parameters", 400],
    ["invalid_function_parameters", "response_format", 400],
    ["invalid_function_parameters", "tools[0].function.arguments", 400],
    ["unsupported_parameter", "tool_choice", 400],
    ["unsupported_parameter", "tools_extra", 400],
    ["unsupported_parameter", "tools", 429],
    ["unsupported_parameter", "tools", 500],
  ])("keeps unrelated %s for %s with status %s", (code, param, status) => {
    expect(
      isRoleToolProtocolRejection(
        llmFailure(providerError(code, param, status)),
      ),
    ).toBe(false);
  });

  it.each([
    null,
    "oneOf unsupported",
    { error: { code: "unsupported_parameter", param: null } },
    { error: { message: "tools schema unsupported" } },
  ])("requires structured error code and parameter: %j", (data) => {
    expect(
      isRoleToolProtocolRejection(
        llmFailure(providerError(undefined, undefined, 400, data)),
      ),
    ).toBe(false);
  });

  it("checks only the last failed retry request", () => {
    const schemaError = providerError();
    const rateLimit = providerError("unsupported_parameter", "tools", 429);
    const retry = (errors: Error[]) =>
      new RetryError({
        message: "Retries failed",
        reason: "maxRetriesExceeded",
        errors,
      });
    expect(
      isRoleToolProtocolRejection(llmFailure(retry([rateLimit, schemaError]))),
    ).toBe(true);
    expect(
      isRoleToolProtocolRejection(llmFailure(retry([schemaError, rateLimit]))),
    ).toBe(false);
  });

  it("keeps preprocess, postprocess, direct provider and textual errors unchanged", () => {
    for (const phase of ["preprocess", "postprocess"] as const) {
      expect(
        isRoleToolProtocolRejection(
          new GenerationPipelineError(
            "Pipeline failed",
            phase,
            providerError(),
          ),
        ),
      ).toBe(false);
    }
    expect(isRoleToolProtocolRejection(providerError())).toBe(false);
    expect(
      isRoleToolProtocolRejection(
        llmFailure(new Error("400 tools oneOf unsupported")),
      ),
    ).toBe(false);
  });

  it("terminates cyclic cause traversal", () => {
    const cyclic = new Error("Cyclic cause");
    cyclic.cause = cyclic;
    expect(isRoleToolProtocolRejection(llmFailure(cyclic))).toBe(false);
  });
});
