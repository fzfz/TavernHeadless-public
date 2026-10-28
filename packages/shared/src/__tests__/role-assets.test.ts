import { expect, it } from "vitest";
import { roleAssetFileSchema } from "../schemas/role-assets.js";

const file = (base64: string) => ({
  name: "audio.mp3",
  mime: "audio/mpeg",
  purpose: "media",
  base64,
});
it("validates large role media without exhausting the regular expression stack", () => {
  const encoded = Buffer.alloc(8 * 1024 * 1024, 1).toString("base64");
  expect(roleAssetFileSchema.safeParse(file(encoded)).success).toBe(true);
});
it.each(["", "AA==", "AAA=", "AAAA"])(
  "accepts complete base64 groups: %s",
  (value) => {
    expect(roleAssetFileSchema.safeParse(file(value)).success).toBe(true);
  },
);
it.each([
  "A",
  "AA",
  "AAA",
  "A===",
  "=AAA",
  "AA=A",
  "AA==AAAA",
  "AAA\n",
  "AAA-",
  "AAAA=",
])("rejects malformed base64: %s", (value) => {
  expect(roleAssetFileSchema.safeParse(file(value)).success).toBe(false);
});
