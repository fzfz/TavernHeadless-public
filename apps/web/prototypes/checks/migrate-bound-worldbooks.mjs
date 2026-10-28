import fs from "node:fs";
import assert from "node:assert/strict";
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
  assert(r.ok, `${method} ${url}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.data;
};
const releases = await api("GET", "/role-releases");
const selected = [
  ...new Map([...releases].reverse().map((r) => [r.character_id, r])).values(),
];
const evidence = [];
for (const r of selected) {
  const snapshot = structuredClone(r.character_snapshot);
  if (!snapshot.characterBook) {
    assert(r.worldbook_id);
    continue;
  }
  const originalBook = snapshot.characterBook;
  const imported = await api("POST", "/import/worldbook", {
    name: originalBook.name || `${r.name} 世界书`,
    data: originalBook,
  });
  const books = await api("GET", `/worldbooks/${imported.id}/versions`);
  const worldVersion = [...books].sort(
    (a, b) => b.version_no - a.version_no,
  )[0];
  delete snapshot.characterBook;
  // Keep the existing immutable media references; no second copy of the assets is needed.
  const delivery = snapshot.extensions?.tavern_headless?.runtimeDelivery;
  if (delivery) {
    delivery.scriptUrl = delivery.scriptUrl.replace(
      "{version}",
      r.character_version_id,
    );
    for (const asset of Object.values(delivery.assets))
      asset.url = asset.url.replace("{version}", r.character_version_id);
  }
  const detail = await api("GET", `/characters/${r.character_id}`);
  const character = await api(
    "POST",
    `/characters/${r.character_id}/versions`,
    { snapshot, expected_revision: detail.revision },
  );
  assert(!character.snapshot.characterBook);
  const body = Object.fromEntries(
    [
      "name",
      "character_id",
      "preset_id",
      "preset_version_id",
      "regex_profile_id",
      "regex_profile_version_id",
      "prompt_mode",
      "default_user_id",
    ].map((k) => [k, r[k]]),
  );
  Object.assign(body, {
    character_version_id: character.id,
    worldbook_id: imported.id,
    worldbook_version_id: worldVersion.id,
    model_slots: r.model_slots.map(({ slot, profile_id, params }) => ({
      slot,
      profile_id,
      params,
    })),
  });
  const release = await api("POST", "/role-releases", body);
  evidence.push({
    characterId: r.character_id,
    previousReleaseId: r.id,
    releaseId: release.id,
    characterVersionId: character.id,
    worldbookId: imported.id,
    worldbookVersionId: worldVersion.id,
    entryCount: originalBook.entries.length,
  });
}
fs.writeFileSync(
  new URL(
    "../../../../docs/plans/evidence/published-backend/bound-worldbook-migration.json",
    import.meta.url,
  ),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence));
