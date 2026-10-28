const jsonHeaders = Object.freeze({ "Content-Type": "application/json" });

function defaultError(code, message) {
  return Object.assign(new Error(message || "Request failed"), { code });
}

function unwrap(body) {
  return body && typeof body === "object" && "data" in body ? body.data : body;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function normalizeSource(source = {}) {
  return {
    kind: source.kind,
    runId: source.runId ?? source.run_id ?? null,
    jobId: source.jobId ?? source.job_id ?? null,
  };
}

function normalizeRecord(value) {
  return {
    sessionId: value.sessionId ?? value.session_id,
    branchId: value.branchId ?? value.branch_id,
    floorId: value.floorId ?? value.floor_id ?? null,
    attemptId: value.attemptId ?? value.attempt_id ?? null,
    versionId: value.versionId ?? value.version_id,
    snapshotId: value.snapshotId ?? value.snapshot_id,
    parentSnapshotId:
      value.parentSnapshotId ?? value.parent_snapshot_id ?? null,
    variables: value.variables,
    source: normalizeSource(value.source),
  };
}

function normalizeDelivery(value) {
  const delivery = {
    html: value.html,
    css: value.css,
    scriptUrl: value.scriptUrl ?? value.script_url,
    assets: value.assets,
    data: value.data,
  };
  const floorHtml = value.floorHtml ?? value.floor_html;
  if (floorHtml !== undefined) delivery.floorHtml = floorHtml;
  return delivery;
}

function resolvedVariables(body) {
  return Object.fromEntries(
    unwrap(body).resolved.map((item) => [item.key, item.value]),
  );
}

function parseCursor(cursor) {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  if (!Number.isInteger(offset) || offset < 0)
    throw Object.assign(new Error("Floor cursor is invalid"), {
      code: "INVALID_CURSOR",
    });
  return offset;
}

function sseBlocks(buffer, flush = false) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = flush ? "" : blocks.pop();
  return { blocks: blocks.filter(Boolean), rest };
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: JSON.parse(data.join("\n")) };
}

export function createFormalTransport({
  sessionId,
  fetchImpl = globalThis.fetch,
  makeError = defaultError,
}) {
  requiredString(sessionId, "sessionId");
  if (typeof fetchImpl !== "function")
    throw new TypeError("fetchImpl must be a function");

  async function json(url, options) {
    const response = await fetchImpl(url, options);
    const body = await response.json();
    if (!response.ok) {
      const code = body?.error?.code || "NETWORK_ERROR";
      throw makeError(code, body?.error?.message);
    }
    return body;
  }

  const roleBase = `/sessions/${encodeURIComponent(sessionId)}/role-view`;
  let snapshotIndex = new Map();
  let pendingStateFloorId = null;


  function rememberSnapshots(role) {
    snapshotIndex = new Map(
      (role.snapshots || []).map((item) => [
        item.floorId ?? item.floor_id,
        {
          floorId: item.floorId ?? item.floor_id,
          attemptId: item.attemptId ?? item.attempt_id,
          snapshotId: item.snapshotId ?? item.snapshot_id,
        },
      ]),
    );
  }

  async function variableSnapshot(record, pageId) {
    const query = new URLSearchParams({ session_id: sessionId });
    if (record.branchId) query.set("branch_id", record.branchId);
    if (record.floorId) query.set("floor_id", record.floorId);
    if (pageId) query.set("page_id", pageId);
    return resolvedVariables(await json(`/variables/resolve?${query}`));
  }

  async function activePages(floorId) {
    const query = new URLSearchParams({
      floor_id: floorId,
      is_active: "true",
      sort_by: "page_no",
      sort_order: "asc",
      limit: "100",
    });
    return unwrap(await json(`/pages?${query}`));
  }

  async function persistedRecord(url, resolveVariables = false) {
    const record = normalizeRecord(unwrap(await json(url)));
    if (!resolveVariables) return record;
    const pages = record.floorId ? await activePages(record.floorId) : [];
    await variableSnapshot(record, pages.at(-1)?.id);
    return {
      ...record,
      variables: structuredClone(record.variables),
    };
  }

  async function getFloorRecord(floorId, resolve = false) {
    return persistedRecord(
      `${roleBase}/floors/${encodeURIComponent(floorId)}`,
      resolve,
    );
  }

  async function updateRoleState(floorId) {
    await json(
      `/sessions/${encodeURIComponent(sessionId)}/role-state/updates`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ floor_id: floorId }),
      },
    );
    return getFloorRecord(floorId, true);
  }

  async function getMessages({ floorId, attemptId = floorId }) {
    const pageMessages = [unwrap(await json(`/sessions/${encodeURIComponent(sessionId)}/role-messages?floor_id=${encodeURIComponent(floorId)}`))];
    return pageMessages.flatMap((messages) =>
      messages.map((message) => ({
        id: message.id,
        role:
          message.role === "user"
            ? "user"
            : message.role === "assistant"
              ? "assistant"
              : "agent",
        text: message.content,
        floorId,
        attemptId,
        streamId: message.source || message.id,
        status: "completed",
      })),
    );
  }

  async function loadSession() {
    const [formalBody, roleBody] = await Promise.all([
      json(`/sessions/${encodeURIComponent(sessionId)}`),
      json(roleBase),
    ]);
    const formal = unwrap(formalBody);
    const role = unwrap(roleBody);
    rememberSnapshots(role);
    const initial = normalizeRecord(role.initial);
    const current = normalizeRecord(role.current);
    const pages = current.floorId ? await activePages(current.floorId) : [];
    await variableSnapshot(current, pages.at(-1)?.id);
    const normalizedCurrent = {
      ...current,
      variables: structuredClone(current.variables),
    };
    if (initial.snapshotId !== current.snapshotId)
      await variableSnapshot(initial);
    const normalizedInitial =
      initial.snapshotId === current.snapshotId
        ? normalizedCurrent
        : {
            ...initial,
            variables: structuredClone(initial.variables),
          };
    const pendingFloorId =
      role.processing?.pendingStateFloorId ??
      role.processing?.pending_state_floor_id ??
      null;
    let pendingMain = role.processing?.pendingMain ?? null;
    if (pendingFloorId) {
      pendingStateFloorId = pendingFloorId;
      const messages = await getMessages({ floorId: pendingFloorId });
      pendingMain = {
        input:
          messages.findLast((message) => message.role === "user")?.text ||
          "重试变量更新",
        text:
          messages.findLast((message) => message.role === "assistant")?.text ||
          "",
      };
    }
    return {
      characterId: role.character_id ?? formal.character_binding?.character_id,
      sessionId: formal.id,
      branchId: normalizedCurrent.branchId,
      versionId:
        role.character_version_id ??
        formal.character_binding?.character_version_id,
      name:
        role.name ??
        formal.character_binding?.snapshot_summary?.name ??
        formal.title,
      initial: normalizedInitial,
      current: normalizedCurrent,
      messages: [],
      processing: {
        pendingMain,
        pendingFollowups: Boolean(role.processing?.pendingFollowups),
      },
      delivery: normalizeDelivery(role.delivery),
      capabilities: role.capabilities ?? {
        send: true,
        history: true,
        customFloors: Boolean(
          role.delivery.floorHtml ?? role.delivery.floor_html,
        ),
      },
    };
  }

  async function listFloors({ branchId, cursor, limit }) {
    const offset = parseCursor(cursor);
    const query = new URLSearchParams({
      session_id: sessionId,
      branch_id: branchId,
      state: "committed",
      sort_by: "floor_no",
      sort_order: "asc",
      limit: String(limit),
      offset: String(offset),
    });
    const [body, roleBody] = await Promise.all([
      json(`/floors?${query}`),
      json(roleBase),
    ]);
    rememberSnapshots(unwrap(roleBody));
    const indexedFloors = body.data.filter((floor) =>
      snapshotIndex.has(floor.id),
    );
    return {
      items: indexedFloors.map((floor) => snapshotIndex.get(floor.id)),
      nextCursor: body.meta.has_more
        ? String(body.meta.offset + body.meta.limit)
        : null,
    };
  }

  async function getSnapshot(snapshotId) {
    return persistedRecord(
      `${roleBase}/snapshots/${encodeURIComponent(snapshotId)}`,
      true,
    );
  }

  async function getFloor({ floorId }) {
    const after = await getFloorRecord(floorId, true);
    const before = after.parentSnapshotId
      ? await getSnapshot(after.parentSnapshotId)
      : after;
    return { before, after };
  }

  async function send({ text, current, emit, route, testHeaders }) {
    const retryState = testHeaders["x-state-update-retry"] === "true";
    if (
      route !== "/send" ||
      (Object.keys(testHeaders).length > 0 && !retryState)
    )
      throw makeError("INVALID_REQUEST", "Unsupported chat operation");
    if (retryState) {
      if (!pendingStateFloorId)
        throw makeError("STATE_RETRY_INVALID", "No state update is pending");
      const after = await updateRoleState(pendingStateFloorId);
      pendingStateFloorId = null;
      emit({
        type: "commit",
        data: {
          eventId: `commit:${after.snapshotId}`,
          sessionId,
          branchId: after.branchId,
          kind: "generated",
          previousCurrentSnapshotId: current.snapshotId,
          before: current,
          after,
        },
      });
      emit({ type: "completed", data: { snapshotId: after.snapshotId } });
      return { runId: null, summary: null, tools: [] };
    }
    const response = await fetchImpl(
      `/sessions/${encodeURIComponent(sessionId)}/respond/stream`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ message: text }),
      },
    );
    if (!response.ok) {
      const body = await response.json();
      throw makeError(
        body?.error?.code || "NETWORK_ERROR",
        body?.error?.message,
      );
    }
    if (!response.body) throw makeError("RESULT_UNKNOWN");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let started = null;
    let accumulated = "";
    let revision = 0;
    let done = null;
    let runId = null;
    let attemptId = null;
    let summary = null;
    const tools = [];

    const consume = async (block) => {
      const parsed = parseSseBlock(block);
      if (!parsed) return;
      const { event, data } = parsed;
      if (event === "start") {
        started = data;
        const execution = unwrap(
          await json(`/floors/${encodeURIComponent(data.floor_id)}/run`),
        ).run;
        runId = requiredString(execution?.run_id, "run_id");
        attemptId = `${runId}:${execution.attempt_no}`;
        emit({
          type: "text",
          data: {
            sessionId,
            branchId: data.branch_id,
            floorId: data.floor_id,
            attemptId,
            streamId: `response:${data.floor_id}`,
            runId,
            jobId: null,
            messageId: null,
            revision: revision++,
            type: "start",
            status: "streaming",
            text: accumulated,
            error: null,
          },
        });
      } else if (event === "chunk") {
        // Raw provider chunks belong to the execution record; role_text carries page content.
      } else if (event === "role_text") {
        if (!started) throw makeError("RESULT_UNKNOWN");
        accumulated = data.text;
        emit({
          type: "text",
          data: {
            sessionId,
            branchId: started.branch_id,
            floorId: started.floor_id,
            attemptId,
            streamId: `response:${started.floor_id}`,
            runId,
            jobId: null,
            messageId: null,
            revision: revision++,
            type: "update",
            status: "streaming",
            text: accumulated,
            error: null,
          },
        });
      } else if (event === "run") {
        runId = data.run_id ?? runId;
      } else if (event === "tool") {
        tools.push(data);
      } else if (event === "summary") {
        summary = data;
      } else if (event === "done") {
        done = data;
      } else if (event === "error") {
        throw makeError(data.code, data.message);
      } else {
        throw makeError("INVALID_REQUEST");
      }
    };

    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const parsed = sseBlocks(buffer);
        buffer = parsed.rest;
        for (const block of parsed.blocks) await consume(block);
      }
      buffer += decoder.decode();
      const parsed = sseBlocks(buffer, true);
      for (const block of parsed.blocks) await consume(block);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }

    if (!started || !done || done.floor_id !== started.floor_id)
      throw makeError("RESULT_UNKNOWN");

    const messages = await getMessages({
      floorId: done.floor_id,
      attemptId,
    });
    const assistant = messages.findLast(
      (message) => message.role === "assistant",
    );
    emit({
      type: "text",
      data: {
        sessionId,
        branchId: started.branch_id,
        floorId: done.floor_id,
        attemptId,
        streamId: `response:${done.floor_id}`,
        runId,
        jobId: null,
        messageId: assistant?.id ?? null,
        revision: revision++,
        type: "end",
        status: "completed",
        text: assistant?.text ?? "",
        error: null,
      },
    });
    pendingStateFloorId = done.floor_id;
    const after = await updateRoleState(done.floor_id);
    pendingStateFloorId = null;
    emit({
      type: "commit",
      data: {
        eventId: `commit:${after.snapshotId}`,
        sessionId,
        branchId: after.branchId,
        kind: "generated",
        previousCurrentSnapshotId: current.snapshotId,
        before: current,
        after,
      },
    });
    emit({ type: "completed", data: { snapshotId: after.snapshotId } });
    return { runId, summary, tools };
  }

  return {
    loadSession,
    getSnapshot,
    getFloor,
    getMessages,
    listFloors,
    send,
  };
}

export function createRoleCatalogTransport({
  fetchImpl = globalThis.fetch,
  makeError = defaultError,
} = {}) {
  async function request(url, options, full = false) {
    const response = await fetchImpl(url, options);
    const body = await response.json();
    if (!response.ok)
      throw makeError(
        body?.error?.code || "NETWORK_ERROR",
        body?.error?.message,
      );
    return full ? body : body.data;
  }
  return {
    listReleases: () => request("/role-releases?latest_per_character=true"),
    getRelease: (releaseId) =>
      request(`/role-releases/${encodeURIComponent(releaseId)}`),
    async listSessions(status = "") {
      const items = [];
      let offset = 0;
      while (true) {
        const query = new URLSearchParams({sort_by:"updated_at",sort_order:"desc",limit:"100",offset:String(offset)});
        if (status) query.set("status",status);
        const page = await request(`/sessions?${query}`, undefined, true);
        items.push(...page.data);
        if (!page.meta.has_more) return items;
        offset += page.data.length;
      }
    },
    async listUsers() {
      const users = [];
      let offset = 0;
      while (true) {
        const page = await request(
          `/users?status=active&sort_by=name&sort_order=asc&limit=100&offset=${offset}`,
          undefined,
          true,
        );
        users.push(...page.data);
        if (!page.meta.has_more) return users;
        offset += page.data.length;
      }
    },
    createSession({ releaseId, userId, openingId }) {
      return request(
        `/role-releases/${encodeURIComponent(releaseId)}/sessions`,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ user_id: userId, opening_id: openingId }),
        },
      );
    },
  };
}

export const formalTransportInternals = Object.freeze({
  normalizeRecord,
  parseSseBlock,
});
