import type { LanguageModelMiddleware } from "ai";
import type { ModelCallResult } from "@tavern/shared";

import type { createRecordingFetch } from "./recording-fetch.js";

export function recordingMiddleware(
  recording: ReturnType<typeof createRecordingFetch>,
): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    async wrapGenerate({ doGenerate }) {
      const result = await doGenerate();
      await recording.complete({
        text: result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(""),
        reasoning:
          result.content
            .filter((part) => part.type === "reasoning")
            .map((part) => part.text)
            .join("") || null,
        toolData: result.content.filter((part) => part.type === "tool-call"),
        usage: {
          inputTokens: result.usage.inputTokens.total ?? null,
          outputTokens: result.usage.outputTokens.total ?? null,
          totalTokens:
            result.usage.inputTokens.total === undefined ||
            result.usage.outputTokens.total === undefined
              ? null
              : result.usage.inputTokens.total +
                result.usage.outputTokens.total,
        },
        finishReason: result.finishReason.raw ?? result.finishReason.unified,
      });
      return result;
    },
    async wrapStream({ doStream }) {
      const result = await doStream();
      const summary: ModelCallResult = {
        text: "",
        reasoning: null,
        toolData: [],
        usage: null,
        finishReason: null,
      };
      let finished = false;
      let streamError: unknown;
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              if (part.type === "text-delta") summary.text += part.delta;
              if (part.type === "reasoning-delta")
                summary.reasoning = (summary.reasoning ?? "") + part.delta;
              if (part.type === "tool-call") summary.toolData!.push(part);
              if (part.type === "error") streamError = part.error;
              if (part.type === "finish") {
                finished = true;
                summary.finishReason =
                  part.finishReason.raw ?? part.finishReason.unified;
                summary.usage = {
                  inputTokens: part.usage.inputTokens.total ?? null,
                  outputTokens: part.usage.outputTokens.total ?? null,
                  totalTokens:
                    part.usage.inputTokens.total === undefined ||
                    part.usage.outputTokens.total === undefined
                      ? null
                      : part.usage.inputTokens.total +
                        part.usage.outputTokens.total,
                };
              }
              controller.enqueue(part);
            },
            async flush() {
              if (streamError !== undefined) {
                await recording.fail(streamError);
                throw streamError;
              }
              if (!finished) {
                const error = new Error(
                  "Provider stream ended before its finish event. Read the saved partial response before retrying.",
                );
                await recording.fail(error, true);
                throw error;
              }
              await recording.complete(summary);
            },
          }),
        ),
      };
    },
  };
}
