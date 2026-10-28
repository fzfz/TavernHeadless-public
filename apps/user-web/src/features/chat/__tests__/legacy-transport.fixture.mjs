export function createLegacyTestTransport(sessionId) {
  const base = `/script-api/sessions/${encodeURIComponent(sessionId)}`;
  async function request(path) {
    const response = await fetch(base + path);
    const body = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(body.error?.message || "request failed"), {
        code: body.error?.code || "NETWORK_ERROR",
      });
    return body;
  }
  return {
    loadSession: () => request(""),
    subscribeState: () => () => {},
    recalculateLatest: async () => { throw new Error("Test transport has no recalculation handler"); },
    restoreMissing: async () => { throw new Error("Test transport has no restore handler"); },
    getSnapshot: (snapshotId) =>
      request(`/snapshots/${encodeURIComponent(snapshotId)}`),
    listFloors(params) {
      return request(`/floors?${new URLSearchParams(params)}`);
    },
    listSnapshots(params) {
      return request(`/snapshots?${new URLSearchParams(params)}`);
    },
    getMessages(params) {
      return request(`/messages?${new URLSearchParams(params)}`);
    },
    async send({ text, route, testHeaders, emit }) {
      const response = await fetch(base + route, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...testHeaders },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw Object.assign(
          new Error(body.error?.message || "request failed"),
          {
            code: body.error?.code || "NETWORK_ERROR",
          },
        );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line.trim()) emit(JSON.parse(line));
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) emit(JSON.parse(buffer));
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    },
  };
}
