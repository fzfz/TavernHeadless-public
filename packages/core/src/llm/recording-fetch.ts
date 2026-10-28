import { nanoid } from "nanoid";
import { apiErrorMessages } from "@tavern/shared";
import type { ModelCallRecord, ModelCallResult } from "@tavern/shared";

import {
  ModelCallPersistenceError,
  modelCallErrorEvidence,
  type ModelCallRecording,
} from "./model-call-recorder.js";

function businessEndpoint(url: string): string {
  const endpoint = new URL(url);
  endpoint.username = "";
  endpoint.password = "";
  for (const name of [...endpoint.searchParams.keys()]) {
    if (
      ["key", "api_key", "apikey", "access_token", "token"].includes(
        name.toLowerCase(),
      )
    )
      endpoint.searchParams.delete(name);
  }
  return endpoint.toString();
}

export function createRecordingFetch(
  recording: ModelCallRecording,
  provider: string,
  model: string,
  network: typeof fetch = globalThis.fetch,
) {
  const controller = new AbortController();
  let invocationId = nanoid();
  let requestAttemptNo = 0;
  let stepIndex = recording.context.stepIndex;
  let active: ModelCallRecord | undefined;
  let persistenceFailure: ModelCallPersistenceError | undefined;

  async function save(record: ModelCallRecord, modelError?: unknown) {
    if (persistenceFailure) throw persistenceFailure;
    try {
      await recording.recorder.save(structuredClone(record));
    } catch (error) {
      const cause =
        modelError === undefined
          ? error
          : new AggregateError(
              [modelError, error],
              "Model request and call evidence persistence both failed. Inspect the original request error and database availability before retrying.",
              { cause: modelError },
            );
      persistenceFailure = new ModelCallPersistenceError(
        record.callId,
        record.status,
        cause,
      );
      controller.abort(persistenceFailure);
      throw persistenceFailure;
    }
  }

  async function fail(error: unknown, interrupted = false) {
    if (persistenceFailure) throw persistenceFailure;
    if (
      !active ||
      ["succeeded", "failed", "interrupted"].includes(active.status)
    )
      return;
    active.status = interrupted ? "interrupted" : "failed";
    active.endedAt = Date.now();
    active.error = modelCallErrorEvidence(error);
    await save(active, error);
  }

  const recordedFetch: typeof fetch = async (input, init) => {
    if (persistenceFailure) throw persistenceFailure;
    const request = new Request(input, init);
    active = {
      ...recording.context,
      stepIndex,
      invocationId,
      requestAttemptNo: ++requestAttemptNo,
      callId: nanoid(),
      provider,
      model,
      endpoint: businessEndpoint(request.url),
      requestBody: await request.clone().text(),
      responseBody: null,
      httpStatus: null,
      status: "prepared",
      preparedAt: Date.now(),
      sentAt: null,
      firstResponseAt: null,
      endedAt: null,
      text: null,
      reasoning: null,
      toolData: null,
      usage: null,
      finishReason: null,
      error: null,
      outputPageId: null,
      outputMessageId: null,
    };
    const record = active;
    await save(record);
    record.status = "in_flight";
    record.sentAt = Date.now();
    await save(record);
    let response: Response;
    try {
      response = await network(request, {
        signal: AbortSignal.any([request.signal, controller.signal]),
      });
    } catch (error) {
      await fail(error, request.signal.aborted);
      throw error;
    }
    record.httpStatus = response.status;
    record.responseBody = "";
    const httpError = response.ok
      ? undefined
      : Object.assign(
          new Error(
            `Provider returned HTTP ${response.status}. Read the saved response body and correct the provider error before retrying.`,
          ),
          { code: `HTTP_${response.status}` },
        );
    async function finishBody() {
      if (httpError) {
        record.status = "failed";
        record.endedAt = Date.now();
        record.error = modelCallErrorEvidence(httpError);
      }
      await save(record, httpError);
    }
    if (!response.body) {
      await finishBody();
      return response;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lastSaved = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const chunk = reader
            ? await reader.read()
            : { done: true, value: undefined };
          if (chunk.done) {
            record.responseBody += decoder.decode();
            await finishBody();
            stream.close();
            reader?.releaseLock();
            return;
          }
          const now = Date.now();
          record.firstResponseAt ??= now;
          record.responseBody += decoder.decode(chunk.value, { stream: true });
          if (now - lastSaved >= recording.streamSaveIntervalMs) {
            await save(record);
            lastSaved = now;
          }
          stream.enqueue(chunk.value);
        } catch (error) {
          try {
            await fail(error, request.signal.aborted);
          } catch (saveError) {
            stream.error(saveError);
            return;
          }
          stream.error(error);
        }
      },
      async cancel(reason) {
        await reader?.cancel(reason);
        await fail(
          reason ??
            new Error(
              "Provider response consumption was cancelled. Check the cancellation reason before starting another generation.",
            ),
          true,
        );
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return {
    fetch: recordedFetch,
    signal: controller.signal,
    beginStep(index: number) {
      stepIndex = recording.context.stepIndex + index;
      invocationId = nanoid();
      requestAttemptNo = 0;
      active = undefined;
    },
    async complete(result: ModelCallResult) {
      if (persistenceFailure) throw persistenceFailure;
      if (!active)
        throw new Error(
          "No provider request was recorded for this model step. Configure a provider with the recording transport.",
        );
      if (active.status === "failed" || active.status === "interrupted") return;
      if (result.finishReason === "error") {
        Object.assign(active, result);
        const error = Object.assign(
          new Error(apiErrorMessages.MODEL_PROVIDER_RESPONSE_ERROR),
          {
            code: "MODEL_PROVIDER_RESPONSE_ERROR",
          },
        );
        await fail(error);
        throw error;
      }
      Object.assign(active, result, {
        status: "succeeded",
        endedAt: Date.now(),
      });
      await save(active);
    },
    fail,
  };
}
