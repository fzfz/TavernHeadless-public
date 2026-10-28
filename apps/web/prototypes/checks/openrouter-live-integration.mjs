import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const backend = "/srv/tavern/TavernHeadless";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "openrouter-integration-"),
);
const config = path.join(directory, "credentials.json");
const hook = path.join(directory, "transport.mjs");
fs.writeFileSync(
  config,
  JSON.stringify({
    apiKey: "fixture",
    baseUrl: "https://openrouter.ai/api/v1",
    narratorModel: "openrouter/free",
    updaterModel: "openrouter/free",
  }),
  { mode: 0o600 },
);
fs.writeFileSync(
  hook,
  `
const original=globalThis.fetch;
let retryFailed=false;
globalThis.fetch=async (url,options)=>{
 if(url!=='https://openrouter.ai/api/v1/chat/completions') return original(url,options);
 const body=JSON.parse(options.body);
 const input=JSON.parse(body.messages.at(-1).content.startsWith('{')?body.messages.at(-1).content:'{}');
 const update=Boolean(input.sources);
 const failed=update && (input.sources[0].text==='invalid-state' || (input.sources[0].text==='retry-state' && !retryFailed));
 if(update && input.sources[0].text==='retry-state') retryFailed=true;
 const text=update?JSON.stringify({changes:[{op:'set',path:'/顾声慢/情感连结度',value:failed?101:input.before.顾声慢.情感连结度+2}],evidenceMessageIds:[input.sources[1].messageId]}):'<gametext>\\n旁白|||她收好乐谱，和你谈起新的旋律。\\n</gametext>';
 const payload=[...text].map(content=>'data: '+JSON.stringify({model:'fixture/free',choices:[{delta:{content}}]})+'\\n\\n').join('')+'data: [DONE]\\n\\n';
 return new Response(payload);
};
`,
);
const child = spawn(
  path.join(backend, "node_modules/.bin/tsx"),
  [
    "--import",
    hook,
    path.join(root, "apps/web/prototypes/checks/serve-script-prototype.mjs"),
    backend,
    "0",
    "/srv/tavern/TavernHeadless-inspect-20260914/node_modules/.pnpm/better-sqlite3@12.8.0/node_modules/better-sqlite3",
  ],
  {
    cwd: root,
    env: { ...process.env, OPENROUTER_CONFIG: config },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
try {
  const info = await new Promise((resolve, reject) => {
    let output = "",
      errors = "";
    const timeout = setTimeout(
      () => reject(new Error("Server startup timeout " + errors)),
      20000,
    );
    child.stderr.on("data", (v) => (errors += v));
    child.on("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Server exited " + errors));
    });
    child.stdout.on("data", (v) => {
      output += v;
      const line = output.split("\n").find((l) => l.startsWith("{"));
      if (line) {
        clearTimeout(timeout);
        resolve(JSON.parse(line));
      }
    });
  });
  const origin = info.origin || info.url;
  assert.ok(origin, JSON.stringify(info));
  const get = async (route) => (await fetch(origin + route)).json();
  const send = async (text, retry = false) =>
    (
      await (
        await fetch(origin + "/script-api/sessions/script-gushengman/send", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(retry ? { "x-state-update-retry": "true" } : {}),
          },
          body: JSON.stringify({ text }),
        })
      ).text()
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  for (const text of ["聊聊乐谱", "一起练习"]) {
    const events = await send(text);
    assert.equal(
      events.at(-1).type,
      "completed",
      JSON.stringify(events.at(-1)),
    );
    assert.ok(
      events.filter((e) => e.type === "text" && e.data.type === "update")
        .length > 2,
    );
    assert.ok(
      events.findIndex((e) => e.type === "text" && e.data.type === "end") <
        events.findIndex((e) => e.type === "commit"),
    );
  }
  const evidence = await get(
    "/script-api/sessions/script-gushengman/live-evidence",
  );
  assert.equal(evidence.turns.length, 2);
  assert.equal(
    evidence.turns[1].beforeSnapshotId,
    evidence.turns[0].afterSnapshotId,
  );
  const failure = await send("invalid-state");
  assert.equal(failure.at(-1).type, "error");
  assert.equal(failure.at(-1).data.code, "STATE_SCHEMA_INVALID");
  assert.equal(
    failure.some((e) => e.type === "commit"),
    false,
  );
  assert.equal(
    (await get("/script-api/sessions/script-gushengman/live-evidence")).turns
      .length,
    2,
  );
  const rejected = await send("retry-state");
  assert.equal(rejected.at(-1).type, "error");
  const retried = await send("retry-state", true);
  assert.equal(retried.at(-1).type, "completed");
  assert.equal(retried.find((e) => e.type === "commit").data.kind, "retried");
  assert.equal(
    retried.filter((e) => e.type === "text" && e.data.type === "update").length,
    0,
  );
  assert.equal(
    retried.find((e) => e.type === "text" && e.data.type === "end").data.text,
    rejected.find((e) => e.type === "text" && e.data.type === "end").data.text,
  );
  assert.equal(
    (await send("retry-state", true)).at(-1).data.code,
    "STATE_RETRY_INVALID",
  );
  console.log(
    "Live branch integration passed: streamed text, two sequential commits, invalid update rollback (mock provider)",
  );
} finally {
  child.kill("SIGTERM");
  fs.rmSync(directory, { recursive: true, force: true });
}
