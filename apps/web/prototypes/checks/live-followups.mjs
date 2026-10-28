import fs from "node:fs";
const errors = JSON.parse(
  fs.readFileSync(
    new URL("../shared/card-errors.json", import.meta.url),
    "utf8",
  ),
);
import { streamCompletion, updateLiveState } from "./openrouter-live.mjs";

export async function runFollowups({
  state,
  profile,
  config,
  write,
  textEvent,
  validateOutput,
  validateState,
  signal,
  stream = streamCompletion,
  update = updateLiveState,
}) {
  const chain = state.pendingChain;
  if (!chain) return;
  const bindings = profile.sourceAgentBindingIds || [];
  while (chain.index < chain.agents.length) {
    const binding = chain.agents[chain.index];
    if (!bindings.includes(binding.id)) throw new Error("STATE_AGENT_UNBOUND");
    const jobId = `${chain.runId}:job:${binding.id}`;
    const messageId = `${jobId}:message`;
    chain.jobs ??= {};
    const job = (chain.jobs[binding.id] ??= {
      jobId,
      baseSnapshotId: state.current.snapshotId,
      text: null,
      status: "running",
    });
    if (job.status === "committed") {
      chain.index++;
      continue;
    }
    if (job.baseSnapshotId !== state.current.snapshotId)
      throw new Error("STATE_BASE_STALE");
    if (
      state.current.floorId !== chain.floorId ||
      state.current.attemptId !== chain.attemptId
    )
      throw new Error("STATE_ATTEMPT_INACTIVE");
    const base = {
      sessionId: state.sessionId,
      branchId: state.branchId,
      floorId: chain.floorId,
      attemptId: chain.attemptId,
      runId: chain.runId,
      jobId,
      streamId: `${jobId}:stream`,
      messageId: null,
      revision: 0,
      type: "start",
      status: "streaming",
      text: "",
      error: null,
    };
    job.revision = (job.revision || 0) + 1;
    write(textEvent(base, { revision: job.revision }));
    try {
      if (job.text === null) {
        let text = "";
        for await (const chunk of stream(
          { ...config, maxTokens: profile.maxTokens },
          config.narratorModel,
          [
            { role: "system", content: binding.prompt },
            {
              role: "user",
              content: JSON.stringify({
                variables: state.current.variables,
                sourceMessages: state.messages.filter(
                  (m) => m.floorId === chain.floorId,
                ),
              }),
            },
          ],
          signal,
        )) {
          text += chunk.text;
          job.model = chunk.model;
          if (chunk.text)
            write(
              textEvent(base, {
                revision: ++job.revision,
                type: "update",
                text,
              }),
            );
        }
        if (!text.trim()) throw new Error("NARRATIVE_EMPTY");
        job.text = text;
        state.messages.push({
          id: messageId,
          role: "agent",
          text,
          floorId: chain.floorId,
          attemptId: chain.attemptId,
          streamId: base.streamId,
          status: "completed",
        });
      }
      write(
        textEvent(base, {
          revision: ++job.revision,
          type: "end",
          status: "completed",
          text: job.text,
          messageId,
        }),
      );
      const before = structuredClone(state.current);
      const result = await update({
        config,
        profile,
        before: before.variables,
        sources: [{ messageId, revision: 0, role: "agent", text: job.text }],
        validateOutput,
        validateState,
        signal,
        priorFacts: chain.facts || [],
        floorBefore: chain.floorBefore,
        consumedSources: state.messages.filter(
          (m) => m.floorId === chain.floorId && m.id !== messageId,
        ),
      });
      if (state.current.snapshotId !== job.baseSnapshotId)
        throw new Error("STATE_BASE_STALE");
      const record = {
        ...before,
        snapshotId: `${jobId}:snapshot`,
        parentSnapshotId: before.snapshotId,
        variables: result.variables,
        source: { kind: "job", runId: chain.runId, jobId },
      };
      // Validate outgoing record before mutating authoritative state.
      const envelope = { type: "current", data: record };
      chain.assertRecord?.(record);
      state.snapshots.set(record.snapshotId, structuredClone(record));
      state.current = record;
      chain.facts ??= [];
      if (result.output.facts) chain.facts.push(result.output.facts);
      job.status = "committed";
      job.snapshotId = record.snapshotId;
      state.liveEvidence.push({
        floorId: chain.floorId,
        attemptId: chain.attemptId,
        jobId,
        sourceMessageIds: [messageId],
        models: { narrator: job.model, updater: result.updaterModel },
        proposal: result.output,
        beforeSnapshotId: before.snapshotId,
        afterSnapshotId: record.snapshotId,
      });
      write(envelope);
      chain.index++;
    } catch (error) {
      if (job.status === "committed") throw error;
      job.status = "failed";
      job.error = error.message;
      write(
        textEvent(base, {
          revision: ++job.revision,
          type: "error",
          status: "failed",
          text: job.text || "",
          error: {
            code: "STATE_FOLLOWUP_FAILED",
            message: errors.STATE_FOLLOWUP_FAILED,
          },
        }),
      );
      throw error;
    }
  }
  state.completedChains ??= [];
  state.completedChains.push({
    floorId: chain.floorId,
    attemptId: chain.attemptId,
    jobs: chain.jobs,
  });
  state.pendingChain = null;
}
