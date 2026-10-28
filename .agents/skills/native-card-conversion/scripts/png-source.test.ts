import { completeSourceFixture } from "./source-fixtures.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readPngCard } from "./png-source.ts";
import { pngCard } from "./source-config.ts";
import { begin } from "./source.ts";

function chunk(type: string, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4, "ascii");
  data.copy(bytes, 8);
  return bytes;
}
function text(key: string, value: string) {
  return chunk("tEXt", Buffer.from(key + "\0" + value, "latin1"));
}
function png(...chunks: Buffer[]) {
  return Buffer.concat([
    Buffer.from(pngCard.signature),
    chunk("IHDR", Buffer.alloc(13)),
    ...chunks,
    chunk("IEND"),
  ]);
}
const json = JSON.stringify(
  completeSourceFixture({
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: { name: "测试角色", description: "原始文字" },
  }),
);
const encoded = Buffer.from(json).toString("base64");

describe("PNG character metadata", () => {
  it.each(["chara", "ccv3", "ChArA", "CCV3"])(
    "reads %s without changing JSON bytes",
    (key) => {
      expect(readPngCard(png(text(key, encoded)))).toEqual(Buffer.from(json));
    },
  );
  it("reads a large card body without a recursive Base64 pattern", () => {
    const body = JSON.stringify(
      completeSourceFixture({
        name: "测试角色",
        description: "大正文".repeat(350000),
      }),
    );
    expect(
      readPngCard(
        png(text("chara", Buffer.from(body).toString("base64"))),
      ).toString(),
    ).toBe(body);
  });
  it("prefers ccv3 regardless of chunk order", () => {
    for (const chunks of [
      [
        text("chara", Buffer.from("old").toString("base64")),
        text("ccv3", encoded),
      ],
      [
        text("ccv3", encoded),
        text("chara", Buffer.from("old").toString("base64")),
      ],
    ])
      expect(readPngCard(png(...chunks))).toEqual(Buffer.from(json));
  });
  it("takes the first matching chunk and ignores unrelated metadata", () => {
    expect(
      readPngCard(
        png(
          text("description", "not card data"),
          text("ccv3", encoded),
          text("ccv3", "broken"),
        ),
      ),
    ).toEqual(Buffer.from(json));
  });
  it("does not replace malformed ccv3 with chara", () => {
    expect(
      readPngCard(
        png(
          text("ccv3", Buffer.from("{").toString("base64")),
          text("chara", encoded),
        ),
      ).toString(),
    ).toBe("{");
  });
  it.each([
    [Buffer.from("not PNG"), pngCard.errors.signature],
    [
      Buffer.concat([Buffer.from(pngCard.signature), Buffer.alloc(3)]),
      pngCard.errors.chunk,
    ],
    [png(text("chara", encoded)).subarray(0, -1), pngCard.errors.chunk],
    [Buffer.from(pngCard.signature), pngCard.errors.end],
    [png(chunk("tEXt", Buffer.from("missing separator"))), pngCard.errors.text],
    [png(text("description", "other")), pngCard.errors.metadata],
  ])("reports malformed image or metadata", (bytes, message) => {
    expect(() => readPngCard(bytes)).toThrow(message);
  });
  it.each([encoded.replace(/=+$/, ""), encoded + "\n"])(
    "uses the same Base64 decoding behavior as SillyTavern",
    (encodedText) => {
      expect(readPngCard(png(text("chara", encodedText)))).toEqual(
        Buffer.from(json),
      );
    },
  );
  it.each(["png", "json"])(
    "the Skill entry resolves a relative %s input from the calling directory",
    async (extension) => {
      const directory = await mkdtemp(join(tmpdir(), "relative card "));
      let output: string | undefined;
      try {
        const name = "角色." + extension;
        await writeFile(
          join(directory, name),
          extension === "png" ? png(text("ccv3", encoded)) : Buffer.from(json),
        );
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            resolve(
              ".agents/skills/native-card-conversion/scripts/convert.mjs",
            ),
            "begin",
            name,
          ],
          { cwd: directory },
        );
        const reference = JSON.parse(stdout);
        const envelope = JSON.parse(
          await readFile(reference.resultFile, "utf8"),
        );
        const result = envelope.data;
        expect(result.taskFile).toEqual(expect.any(String));
        output = dirname(result.taskFile);
        const task = JSON.parse(await readFile(result.taskFile, "utf8"));
        expect(await realpath(task.originalSourceFile)).toBe(
          await realpath(join(directory, name)),
        );
        expect(await readFile(task.sourceFile, "utf8")).toBe(json);
      } finally {
        await rm(directory, { recursive: true, force: true });
        if (output) await rm(output, { recursive: true, force: true });
      }
    },
  );
  it("begin reads one PNG input and saves its embedded JSON as source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "png card "));
    let output: string | undefined;
    try {
      const file = join(directory, "角色.PNG");
      const bytes = png(text("ccv3", encoded));
      await writeFile(file, bytes);
      const result = await begin(file);
      output = dirname(result.taskFile);
      const task = JSON.parse(await readFile(result.taskFile, "utf8"));
      expect(await readFile(file)).toEqual(bytes);
      expect(await readFile(task.sourceFile, "utf8")).toBe(json);
      expect(task.originalSourceFile).toBe(file);
      expect(
        JSON.parse(
          await readFile(
            join(result.packageDirectory, "character.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({
        name: "测试角色",
        description: "原始文字",
        exampleDialogue: "",
        tags: [],
      });
      expect(result.pendingCount).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
      if (output) await rm(output, { recursive: true, force: true });
    }
  });
  it("begin reports an invalid JSON body in PNG", async () => {
    const directory = await mkdtemp(join(tmpdir(), "png invalid "));
    try {
      const file = join(directory, "card.png");
      await writeFile(
        file,
        png(text("chara", Buffer.from("{").toString("base64"))),
      );
      await expect(begin(file)).rejects.toThrow(SyntaxError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
