import assert from "node:assert/strict";
import fs from "node:fs";
import { parseGalgame } from "../characters/gushengman/main.js";
const messages = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../../docs/plans/evidence/openrouter-live/third-messages.json",
      import.meta.url,
    ),
  ),
);
const text = messages.find((m) => m.role === "assistant").text;
let checked = 0;
for (let end = 1; end <= text.length; end++) {
  const frames = parseGalgame(text.slice(0, end));
  for (const frame of frames)
    for (const character of Object.values(frame.stage.characters)) {
      assert.notEqual(
        character.sprite,
        "顾声慢",
        `incomplete command at ${end}`,
      );
    }
  checked++;
}
for (let n = 1; n < 10; n++)
  assert.equal(parseGalgame("<gametext>".slice(0, n)).length, 0);
const frames = parseGalgame(text);
assert.ok(
  frames.some((f) => f.speaker === "顾声慢" && f.text.includes("明天见。")),
);
assert.ok(frames.some((f) => f.stage.characters.C.sprite === "棒球服微笑"));
assert.equal(parseGalgame("<gametext>\n[show|顾声慢|C|棒球服微笑").length, 0);
console.log(
  `GAL parser passed ${checked} real-response prefixes and multiline dialogue checks`,
);
