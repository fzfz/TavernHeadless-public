import { readFile } from "node:fs/promises";
import { derive, validate, renderController } from "./backend-hooks.mjs";

const input = JSON.parse(
  await readFile(new URL("./backend-input.json", import.meta.url), "utf8"),
);
const candidate = derive(input);
const validation = validate({ ...input, candidate });
const rendered = renderController({
  bookId: "sample",
  entryId: 10,
  variables: candidate,
  characterBook: {
    entries: [{ id: 10, enabled: true, content: "待生成的地点说明" }],
  },
});
console.log(JSON.stringify({ candidate, validation, rendered }, null, 2));
