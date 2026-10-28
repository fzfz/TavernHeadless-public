import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTavernClient } from "@tavern/sdk";
import { nativeCardSystemConfigurationSchema } from "@tavern/shared";
import { nativeCardAcceptanceConfigSchema } from "../test/fixtures/native-card/acceptance-config.schema.js";

const root = resolve(new URL("../../..", import.meta.url).pathname);
const config = nativeCardAcceptanceConfigSchema.parse(
  JSON.parse(
    await readFile(
      process.env.NATIVE_CARD_ACCEPTANCE_CONFIG ?? new URL(
        "../test/fixtures/native-card/acceptance-config.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
const directory = resolve(
  root,
  process.env.NATIVE_CARD_ACCEPTANCE_DATA_DIR ?? config.dataDirectory,
);
const client = createTavernClient({
  baseUrl: `http://127.0.0.1:${config.apiPort}`,
});
const configuration = nativeCardSystemConfigurationSchema.parse(
  JSON.parse(
    await readFile(resolve(directory, "system-selection.json"), "utf8"),
  ),
);
const cards = await client.nativeCards.list();
const card = process.env.NATIVE_CARD_ACCEPTANCE_CARD_ID
  ? cards.find((card) => card.id === process.env.NATIVE_CARD_ACCEPTANCE_CARD_ID)
  : cards.at(-1);
if (!card) throw new Error("Import a card into the acceptance instance first.");
const publication = await client.nativeCards.publish({
  cardId: card.id,
  revision: card.revision,
  configuration,
  note: "原生 ZIP 真实运行验收",
});
const session = await client.roleReleases.createSession({
  releaseId: publication.releaseId,
  input: { opening_id: "first", user_id: configuration.defaultUserId },
});
await writeFile(
  resolve(directory, "runtime-publication.json"),
  JSON.stringify({ card, publication, session }, null, 2),
);
const dryRun = await client.sessions.respondDryRun({
  sessionId: String(session.session.id),
  message: config.userMessage,
});
await writeFile(
  resolve(directory, "dry-run.json"),
  JSON.stringify(dryRun, null, 2),
);
console.log(
  JSON.stringify(
    {
      cardId: card.id,
      revision: card.revision,
      publication,
      sessionId: session.session.id,
      dryRun,
    },
    null,
    2,
  ),
);
