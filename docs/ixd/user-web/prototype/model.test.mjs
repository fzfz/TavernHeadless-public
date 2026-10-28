import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "./model.mjs";

test("新演绎保留开场及创建时的人格，修改人格资料后历史身份仍可恢复", () => {
  const persona = {
    id: "p1",
    name: "裴修远",
    description: "游历江南的修书人。",
  };
  const session = createSession(
    { id: "c1", name: "沈知微", openings: ["请进。"] },
    persona,
    0,
  );
  persona.name = "陆遥";
  assert.equal(session.persona.name, "裴修远");
  assert.equal(session.persona.description, "游历江南的修书人。");
  assert.equal(session.messages[0].variants[0], "请进。");
});
