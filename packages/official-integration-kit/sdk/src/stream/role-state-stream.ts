import {
  apiErrorMessages,
  roleSnapshotSchema,
  roleStateRepairEventSchema,
  type RoleDisplaySnapshot,
  type RoleStateRepairEvent,
} from "@tavern/shared";
import { createResponseError } from "../errors/normalize-error.js";
import { TavernApiError } from "../errors/tavern-api-error.js";

export async function readRoleStateStream(
  response: Response,
  callbacks: {
    onCurrent: (snapshot: RoleDisplaySnapshot) => void;
    onRepair: (event: RoleStateRepairEvent) => void;
  },
): Promise<void> {
  if (!response.ok) throw await createResponseError(response);
  if (!response.body)
    throw new TavernApiError({
      code: "RESULT_UNKNOWN",
      message: apiErrorMessages.RESULT_UNKNOWN,
      status: response.status,
    });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    event = "message";
  let data: string[] = [];
  function dispatch() {
    const name = event,
      payload = data.join("\n");
    event = "message";
    data = [];
    if (!payload) return;
    if (name === "state_current")
      callbacks.onCurrent(roleSnapshotSchema.parse(JSON.parse(payload)));
    else if (name === "state_repair")
      callbacks.onRepair(roleStateRepairEventSchema.parse(JSON.parse(payload)));
    else if (name === "error") {
      const failure = JSON.parse(payload);
      throw new TavernApiError({
        code: failure.code,
        message: failure.message,
        status: response.status,
      });
    }
  }
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (!line) dispatch();
        else if (line.startsWith("event:"))
          event = line.slice(6).replace(/^ /, "");
        else if (line.startsWith("data:"))
          data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
