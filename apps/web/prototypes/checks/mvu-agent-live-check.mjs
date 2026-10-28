import {parseGalgame} from "../characters/gushengman/main.js";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createFormalTransport } from "../shared/formal-transport.prototype.js";
const config = JSON.parse(
  fs.readFileSync(
    new URL("./published-prototype.config.json", import.meta.url),
    "utf8",
  ),
);
const base = `http://127.0.0.1:${config.port}`;
const api = async (path, body) => {
  const r = await fetch(
    base + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const b = await r.json();
  assert(r.ok, JSON.stringify(b.error));
  return b.data;
};
const migrations = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../docs/plans/evidence/published-backend/mvu-agent-migration.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const key = process.argv[2];
const migration = migrations.find((m) => m.key === key);
assert(migration);
const messages =
  key === "linqian"
    ? [
        "我把买来的水果放在桌上，说：“你今天累不累？先坐下来休息一会儿吧。”",
        "我陪她坐了十分钟，然后起身去厨房倒了两杯温水，把一杯放在她手边。",
      ]
    : [
        "我在旁边坐下，轻声说：“刚才那段旋律很好听。你愿意和我聊聊它的来历吗？”",
        "我认真听她说完，陪她坐了十分钟，然后说：“我愿意继续听你练习，不着急。”",
      ];
const release = await api(`/role-releases/${migration.releaseId}`);
const created = await api(`/role-releases/${release.id}/sessions`, {
  user_id: release.default_user_id,
  opening_id: release.openings.find((o) => o.default).id,
});
const evidence = {
  key,
  releaseId: release.id,
  sessionId: created.session.id,
  rounds: [],
};
const destination = new URL(
  `../../../../docs/plans/evidence/published-backend/mvu-live-${key}.json`,
  import.meta.url,
);
const save = () =>
  fs.writeFileSync(destination, JSON.stringify(evidence, null, 2) + "\n");
save();
console.log(JSON.stringify({ key, sessionId: evidence.sessionId }));
const transport = createFormalTransport({
  sessionId: evidence.sessionId,
  fetchImpl: (url, options) => fetch(base + url, options),
});
let loaded = await transport.loadSession();
for (const message of messages) {
  const dry = await api(`/sessions/${evidence.sessionId}/respond/dry-run`, {
    message,
  });
  assert(
    !/<(?:UpdateVariable|JSONPatch|Analysis)>/.test(
      dry.messages.map((m) => m.content).join("\n"),
    ),
    "Narrator request contains old MVU format",
  );
  const round = {
    message,
    before: loaded.current,
    events: [],
    dryRunWithoutMvu: true,
  };
  evidence.rounds.push(round);
  save();
  const emit = (envelope) => {
    round.events.push(envelope);
  };
  try {
    await transport.send({
      text: message,
      current: loaded.current,
      route: "/send",
      testHeaders: {},
      emit,
    });
    loaded = await transport.loadSession();
    round.after = loaded.current;
    assert.notEqual(round.after.snapshotId, round.before.snapshotId);
    const texts = round.events
      .filter((e) => e.type === "text")
      .map((e) => e.data.text || "")
      .join("");
    assert(
      !/<(?:UpdateVariable|JSONPatch|Analysis)>/.test(texts),
      "Narrative emits old MVU protocol",
    );
    const completedText = round.events.findLast(e=>e.type === "text" && e.data.type === "end")?.data.text;
    assert(completedText?.trim(), "Completed text is empty");
    assert(!completedText.includes("<｜begin▁of▁thinking｜>"), "Completed text contains a model thinking marker");
    if (key === "gushengman") assert(parseGalgame(completedText).length > 0, "Completed text has no dialogue frames");
    round.success = true;
  } catch (error) {
    round.success = false;
    round.error = { code: error.code, message: error.message };
    save();
    console.log(
      JSON.stringify({
        key,
        round: evidence.rounds.length,
        error: round.error,
      }),
    );
    break;
  }
  save();
  console.log(
    JSON.stringify({
      key,
      round: evidence.rounds.length,
      success: true,
      snapshotId: round.after.snapshotId,
    }),
  );
}
