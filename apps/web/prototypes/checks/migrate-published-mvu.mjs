import { parse as parseYaml } from "../../../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js";
import { importOpenings } from "../shared/import-openings.js";
import fs from "node:fs";
import assert from "node:assert/strict";
import { migrateMvuToAgent, readMvuInitialVariables } from "./mvu-agent-migration.mjs";
import { compileRegexMigration, migration } from "./regex-migration.mjs";
const config = JSON.parse(
  fs.readFileSync(
    new URL("./published-prototype.config.json", import.meta.url),
    "utf8",
  ),
);
const api = async (method, url, body) => {
  const r = await fetch(`http://localhost:${config.port}` + url, {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const b = await r.json();
  assert(r.ok, `${url}:${JSON.stringify(b).slice(0, 200)}`);
  return b.data;
};
const selected = [
  ...new Map(
    [...(await api("GET", "/role-releases"))]
      .reverse()
      .map((r) => [r.character_id, r]),
  ).values(),
];
const evidencePath = new URL("../../../../docs/plans/evidence/published-backend/mvu-agent-migration.json", import.meta.url);
const evidence = process.argv[2] ? JSON.parse(fs.readFileSync(evidencePath)).filter(item=>item.key!==process.argv[2]) : [];
const archivePath = new URL("../../../../docs/plans/evidence/published-backend/mvu-source-entries.json", import.meta.url);
const archive = fs.existsSync(archivePath) ? JSON.parse(fs.readFileSync(archivePath)) : [];
for (const release of selected) {
  const snapshot = release.character_snapshot;
  const original = snapshot.extensions.regex_scripts;
  const key = Object.keys(migration.sources).find(
    (k) =>
      k !== "preset" &&
      original.every((r) =>
        migration.sources[k].rules.some((d) => d.id === r.id),
      ),
  );
  if (process.argv[2] && key !== process.argv[2]) continue;
  const books = await api(
    "GET",
    `/worldbooks/${release.worldbook_id}/versions`,
  );
  const sourceBook = books.find(
    (v) => v.id === release.worldbook_version_id,
  ).snapshot;
  archive.push({releaseId:release.id, characterId:release.character_id, worldbook:sourceBook, stateUpdate:snapshot.extensions.tavern_headless.stateUpdate});
  fs.writeFileSync(new URL("../../../../docs/plans/evidence/published-backend/mvu-source-entries.json", import.meta.url), JSON.stringify(archive,null,2)+"\n");
  const migrated = migrateMvuToAgent(key, snapshot, sourceBook);
  const metadata = JSON.parse(fs.readFileSync(new URL(`../characters/${key}/openings.json`, import.meta.url)));
  migrated.snapshot.extensions.tavern_headless.openings = importOpenings({...snapshot, greeting:snapshot.primaryGreeting}, metadata, readMvuInitialVariables(key, sourceBook, parseYaml), {parseYaml});
  const book = await api("GET", `/worldbooks/${release.worldbook_id}`);
  await api("PUT", `/worldbooks/${release.worldbook_id}`, {
    name: book.name,
    data: migrated.worldbook,
    expected_version: book.version,
  });
  const bookVersion = [
    ...(await api("GET", `/worldbooks/${release.worldbook_id}/versions`)),
  ].sort((a, b) => b.version_no - a.version_no)[0];
  const detail = await api("GET", `/characters/${release.character_id}`);
  const version = await api(
    "POST",
    `/characters/${release.character_id}/versions`,
    { snapshot: migrated.snapshot, expected_revision: detail.revision },
  );
  const presets = await api("GET", `/presets/${release.preset_id}/versions`);
  const preset = await api("GET", `/presets/${release.preset_id}`);
  const compiled = compileRegexMigration([
    {
      key,
      kind: "character",
      name: release.name,
      resourceId: release.character_id,
      versionId: version.id,
      scripts: original,
    },
    {
      key: "preset",
      kind: "preset",
      name: preset.name,
      resourceId: release.preset_id,
      versionId: release.preset_version_id,
      scripts: presets.find((v) => v.id === release.preset_version_id).snapshot
        .extensions.regex_scripts,
    },
  ]);
  const regex = await api("GET", `/regex-profiles/${release.regex_profile_id}`);
  await api("PUT", `/regex-profiles/${release.regex_profile_id}`, {
    name: regex.name,
    data: compiled.scripts,
    expected_version: regex.version,
  });
  const regexVersion = [
    ...(await api(
      "GET",
      `/regex-profiles/${release.regex_profile_id}/versions`,
    )),
  ].sort((a, b) => b.version_no - a.version_no)[0];
  const body = Object.fromEntries(
    [
      "name",
      "character_id",
      "preset_id",
      "preset_version_id",
      "regex_profile_id",
      "worldbook_id",
      "prompt_mode",
      "default_user_id",
    ].map((k) => [k, release[k]]),
  );
  Object.assign(body, {
    character_version_id: version.id,
    worldbook_version_id: bookVersion.id,
    regex_profile_version_id: regexVersion.id,
    model_slots: release.model_slots.map(({ slot, profile_id, params }) => ({
      slot,
      profile_id,
      params,
    })),
  });
  const published = await api("POST", "/role-releases", body);
  evidence.push({
    key,
    releaseId: published.id,
    previousReleaseId: release.id,
    characterVersionId: version.id,
    worldbookVersionId: bookVersion.id,
    regexVersionId: regexVersion.id,
    remainingRules: compiled.scripts.length,
  });
}
fs.writeFileSync(
  new URL(
    "../../../../docs/plans/evidence/published-backend/mvu-agent-migration.json",
    import.meta.url,
  ),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence));
