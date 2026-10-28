import fs from "node:fs";
import assert from "node:assert/strict";
import { compileRegexMigration, migration } from "./regex-migration.mjs";
const config = JSON.parse(
  fs.readFileSync(
    new URL("./published-prototype.config.json", import.meta.url),
    "utf8",
  ),
);
const base = `http://127.0.0.1:${config.port}`;
const api = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(result)}`);
  return result.data;
};
const releases = await api("GET", "/role-releases");
const selected = [
  ...new Map([...releases].reverse().map((r) => [r.character_id, r])).values(),
];
const evidence = [];
for (const release of selected) {
  const original = release.character_snapshot.extensions.regex_scripts;
  const key = Object.keys(migration.sources).find(
    (k) =>
      k !== "preset" &&
      original.every((r) =>
        migration.sources[k].rules.some((d) => d.id === r.id),
      ),
  );
  if (!key) throw new Error("REGEX_CHARACTER_NOT_REVIEWED");
  const versions = await api("GET", `/presets/${release.preset_id}/versions`);
  const presetVersion = versions.find(
    (v) => v.id === release.preset_version_id,
  );
  assert(presetVersion, "Bound preset version must exist");
  const preset = await api("GET", `/presets/${release.preset_id}`);
  const { scripts, audit } = compileRegexMigration([
    {
      key,
      kind: "character",
      name: release.character_snapshot.name,
      resourceId: release.character_id,
      versionId: release.character_version_id,
      scripts: original,
    },
    {
      key: "preset",
      kind: "preset",
      name: preset.name,
      resourceId: release.preset_id,
      versionId: release.preset_version_id,
      scripts: presetVersion.snapshot.extensions.regex_scripts,
    },
  ]);
  const detail = await api(
    "GET",
    `/regex-profiles/${release.regex_profile_id}`,
  );
  if (
    JSON.stringify(
      detail.data.map(
        ({
          source,
          id,
          minDepth,
          maxDepth,
          findRegex,
          replaceString,
          disabled,
        }) => ({
          source,
          id,
          minDepth,
          maxDepth,
          findRegex,
          replaceString,
          disabled,
        }),
      ),
    ) ===
    JSON.stringify(
      scripts.map(
        ({
          source,
          id,
          minDepth,
          maxDepth,
          findRegex,
          replaceString,
          disabled,
        }) => ({
          source,
          id,
          minDepth,
          maxDepth,
          findRegex,
          replaceString,
          disabled,
        }),
      ),
    )
  ) {
    evidence.push({
      characterId: release.character_id,
      releaseId: release.id,
      regexVersionId: release.regex_profile_version_id,
      audit,
      unchanged: true,
    });
    continue;
  }
  await api("PUT", `/regex-profiles/${release.regex_profile_id}`, {
    name: `${release.name} · 演绎正则`,
    data: scripts,
    expected_version: detail.version,
  });
  const saved = await api("GET", `/regex-profiles/${release.regex_profile_id}`);
  assert.deepEqual(
    saved.data.map((s) => ({
      id: s.id,
      source: s.source,
      minDepth: s.minDepth,
      maxDepth: s.maxDepth,
      disabled: s.disabled,
    })),
    scripts.map((s) => ({
      id: s.id,
      source: s.source,
      minDepth: s.minDepth,
      maxDepth: s.maxDepth,
      disabled: s.disabled,
    })),
    "Persisted scripts preserve provenance and order",
  );
  const regexVersions = await api(
    "GET",
    `/regex-profiles/${release.regex_profile_id}/versions`,
  );
  const latest = [...regexVersions].sort(
    (a, b) => b.version_no - a.version_no,
  )[0];
  const body = Object.fromEntries(
    [
      "name",
      "character_id",
      "character_version_id",
      "preset_id",
      "preset_version_id",
      "regex_profile_id",
      "worldbook_id",
      "worldbook_version_id",
      "prompt_mode",
      "default_user_id",
    ].map((k) => [k, release[k]]),
  );
  body.regex_profile_version_id = latest.id;
  body.model_slots = release.model_slots.map(
    ({ slot, profile_id, params }) => ({ slot, profile_id, params }),
  );
  const published = await api("POST", "/role-releases", body);
  evidence.push({
    characterId: release.character_id,
    previousReleaseId: release.id,
    releaseId: published.id,
    regexVersionId: latest.id,
    audit,
  });
}
fs.writeFileSync(
  new URL(
    "../../../../docs/plans/evidence/published-backend/regex-migration.json",
    import.meta.url,
  ),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    evidence.map(({ audit, ...rest }) => ({
      ...rest,
      kept: audit?.filter((x) => x.decision === "keep").length,
      removed: audit?.filter((x) => x.decision === "remove").length,
    })),
  ),
);
