import assert from "node:assert/strict";
import fs from "node:fs";
const config = JSON.parse(
  fs.readFileSync(
    new URL("./published-prototype.config.json", import.meta.url),
    "utf8",
  ),
);
const base = `http://127.0.0.1:${config.port}`;
const api = async (method, url, body) => {
  const r = await fetch(base + url, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (r.status === 204) return null;
  const b = await r.json();
  assert(r.ok, `${url}: ${JSON.stringify(b).slice(0, 200)}`);
  return b.data;
};
const records = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../docs/plans/evidence/published-backend/regex-migration.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const results = [];
for (const record of records) {
  const release = await api("GET", `/role-releases/${record.releaseId}`);
  const versions = await api(
    "GET",
    `/regex-profiles/${release.regex_profile_id}/versions`,
  );
  const scripts = versions.find(
    (v) => v.id === release.regex_profile_version_id,
  ).snapshot;
  const preview = async (text, depth, channel = "prompt") =>
    api("POST", "/regex-profiles/preview", {
      text,
      depth,
      channel,
      placement: 2,
      scripts,
    });
  const near = await preview(
    "正文<Analysis>internal</Analysis><UpdateVariable>update</UpdateVariable>",
    0,
  );
  assert(!near.text.includes("internal"));
  assert(near.text.includes("<UpdateVariable>"));
  const far = await preview(
    "正文<Analysis>internal</Analysis><UpdateVariable>update</UpdateVariable>",
    6,
  );
  assert(!far.text.includes("<UpdateVariable>"));
  assert(!far.text.includes("internal"));
  const display = await preview(
    "<gametext>走进书店。</gametext>[bg|书店]<StatusPlaceHolderImpl/>",
    0,
    "display",
  );
  assert(!display.text.includes("<img"));
  assert(!display.text.includes("<!DOCTYPE"));
  assert(display.text.includes("走进书店。"));
  const created = await api(
    "POST",
    `/role-releases/${release.id}/sessions`,
    {},
  );
  const id = created.session.id;
  try {
    const dry = await api("POST", `/sessions/${id}/respond/dry-run`, {
      message: "今天的天气怎么样？",
    });
    const encoded = JSON.stringify(dry);
    assert(encoded.includes("【云瑾】包裹最新指示"));
    for (const removed of record.audit.filter((a) => a.decision === "remove"))
      assert(
        !encoded.includes(removed.name),
        `Removed execution rule still present: ${removed.name}`,
      );
    results.push({
      releaseId: release.id,
      nearMatches: near.matched_rule_names,
      farMatches: far.matched_rule_names,
      displayPreservesNarrative: true,
      dryRun: true,
      sessionId: id,
    });
  } finally {
    await api("DELETE", `/sessions/${id}`);
  }
}
fs.writeFileSync(
  new URL(
    "../../../../docs/plans/evidence/published-backend/regex-migration-check.json",
    import.meta.url,
  ),
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results));
