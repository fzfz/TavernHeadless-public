import { expect, it } from "vitest";
import {
  createInitialRespondStreamState,
  reduceRespondStream,
} from "./reduce-respond-stream.js";
it("leaves role projection events for the role session controller", () => {
  const state = createInitialRespondStreamState();
  expect(
    reduceRespondStream(state, {
      type: "role_text",
      payload: { text: "visible", phase: "completed" },
    }),
  ).toBe(state);
});
