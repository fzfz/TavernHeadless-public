import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { v3Card } from "./source-fixtures.ts";
import { begin } from "./source.ts";
import { runStateCommand } from "./state-write.ts";
import {
  mapCopyFile,
  mapCopyFieldsFile,
  mapParseFile,
  mapParseFieldsFile,
} from "./write.ts";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const examples = [
  {
    name: "object structure",
    schema: { type: "object" },
    valid: {},
    invalid: [],
    keyword: "type",
  },
  {
    name: "number type",
    schema: { type: "number" },
    valid: 1,
    invalid: "1",
    keyword: "type",
  },
  {
    name: "required field",
    schema: {
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
    },
    valid: { count: 1 },
    invalid: {},
    keyword: "required",
  },
  {
    name: "additional property",
    schema: {
      type: "object",
      properties: { count: { type: "integer" } },
      additionalProperties: false,
    },
    valid: { count: 1 },
    invalid: { count: 1, extra: true },
    keyword: "additionalProperties",
  },
  {
    name: "integer type",
    schema: { type: "integer" },
    valid: 2,
    invalid: 2.5,
    keyword: "type",
  },
  {
    name: "numeric lower bound",
    schema: { type: "integer", minimum: 0, maximum: 5 },
    valid: 0,
    invalid: -1,
    keyword: "minimum",
  },
  {
    name: "numeric upper bound",
    schema: { type: "integer", minimum: 0, maximum: 5 },
    valid: 5,
    invalid: 6,
    keyword: "maximum",
  },
  {
    name: "enum",
    schema: { type: "string", enum: ["one", "two"] },
    valid: "one",
    invalid: "three",
    keyword: "enum",
  },
  {
    name: "const",
    schema: { type: "boolean", const: true },
    valid: true,
    invalid: false,
    keyword: "const",
  },
  {
    name: "string constraints",
    schema: { type: "string", minLength: 2, maxLength: 4, pattern: "^[A-Z]+$" },
    valid: "AB",
    invalid: "abcde",
    keyword: "pattern",
  },
  {
    name: "unique array members",
    schema: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
      items: { type: "integer" },
    },
    valid: [1, 2],
    invalid: [1, 1],
    keyword: "uniqueItems",
  },
  {
    name: "tuple member types",
    schema: {
      type: "array",
      prefixItems: [{ type: "string" }, { type: "number" }],
      minItems: 2,
      items: false,
    },
    valid: ["A", 2],
    invalid: [2, "A"],
    keyword: "type",
  },
  {
    name: "allOf",
    schema: { type: "integer", allOf: [{ minimum: 0 }, { multipleOf: 2 }] },
    valid: 4,
    invalid: 3,
    keyword: "multipleOf",
  },
  {
    name: "anyOf",
    schema: { type: "integer", anyOf: [{ maximum: 0 }, { minimum: 10 }] },
    valid: 11,
    invalid: 5,
    keyword: "anyOf",
  },
  {
    name: "oneOf",
    schema: { type: "integer", oneOf: [{ minimum: 0 }, { maximum: 10 }] },
    valid: 11,
    invalid: 5,
    keyword: "oneOf",
  },
  {
    name: "not",
    schema: { type: "integer", not: { const: 5 } },
    valid: 6,
    invalid: 5,
    keyword: "not",
  },
  {
    name: "conditional required field",
    schema: {
      type: "object",
      properties: { enabled: { type: "boolean" }, detail: { type: "string" } },
      if: { properties: { enabled: { const: true } }, required: ["enabled"] },
      then: { required: ["detail"] },
    },
    valid: { enabled: true, detail: "A" },
    invalid: { enabled: true },
    keyword: "required",
  },
  {
    name: "dependent required field",
    schema: {
      type: "object",
      properties: { trigger: { type: "boolean" }, detail: { type: "string" } },
      dependentRequired: { trigger: ["detail"] },
    },
    valid: { trigger: true, detail: "A" },
    invalid: { trigger: true },
    keyword: "dependentRequired",
  },
  {
    name: "nullable value",
    schema: { type: ["string", "null"], enum: [null, "go"] },
    valid: null,
    invalid: "bad",
    keyword: "enum",
  },
];
async function fixture(example: (typeof examples)[number]) {
  const directory = await mkdtemp(join(tmpdir(), "state-constraints-"));
  cleanup.push(directory);
  const sourceFile = join(directory, "source.json");
  await writeFile(
    sourceFile,
    JSON.stringify(
      v3Card({
        extensions: {
          candidate: { state: example.invalid },
          candidateText: JSON.stringify({ state: example.invalid }),
          fieldText: JSON.stringify(example.invalid),
          valid: { state: example.valid },
        },
      }),
    ),
  );
  const task = await begin(sourceFile);
  cleanup.push(join(task.packageDirectory, ".."));
  await mkdir(join(task.packageDirectory, "state/initial"), {
    recursive: true,
  });
  await mkdir(join(task.packageDirectory, "openings"), { recursive: true });
  await writeFile(join(task.packageDirectory, "openings/default.txt"), "开场");
  await writeFile(
    join(task.packageDirectory, "openings.json"),
    JSON.stringify({
      defaultOpeningIds: { individual: "default" },
      items: [
        {
          id: "default",
          title: "开场",
          summary: "",
          kind: "story",
          audience: "individual",
          textFile: "openings/default.txt",
          initialStateFile: "state/initial/default.json",
        },
      ],
    }),
  );
  await writeFile(
    join(task.packageDirectory, "state/schema.json"),
    JSON.stringify({
      type: "object",
      properties: { state: example.schema },
      required: ["state"],
      additionalProperties: false,
    }),
  );
  const target = join(task.packageDirectory, "state/initial/default.json");
  const original = JSON.stringify({ state: example.valid }) + "\n";
  await writeFile(target, original);
  return { task, target, original, request: join(directory, "request.json") };
}

describe("complete state constraints at every conversion write entry", () => {
  it.each(examples)(
    "keeps the previous JSON for $name at copy, parse and state submission",
    async (example) => {
      const { task, target, original, request } = await fixture(example);
      await writeFile(
        request,
        JSON.stringify({ value: { state: example.invalid } }),
      );
      const operations = [
        () =>
          mapCopyFile(
            task.taskFile,
            "/data/extensions/candidate",
            "state/initial/default.json",
          ),
        () =>
          mapCopyFile(
            task.taskFile,
            "/data/extensions/candidate/state",
            "state/initial/default.json",
            { targetPointer: "/state" },
          ),
        () =>
          mapCopyFieldsFile(task.taskFile, "state/initial/default.json", [
            {
              sourcePointer: "/data/extensions/candidate/state",
              targetPointer: "/state",
            },
          ]),
        () =>
          mapParseFile(
            task.taskFile,
            "/data/extensions/candidateText",
            "state/initial/default.json",
            { format: "json" },
          ),
        () =>
          mapParseFile(
            task.taskFile,
            "/data/extensions/fieldText",
            "state/initial/default.json",
            { format: "json", targetPointer: "/state" },
          ),
        () =>
          mapParseFieldsFile(
            task.taskFile,
            "state/initial/default.json",
            [
              {
                sourcePointer: "/data/extensions/fieldText",
                targetPointer: "/state",
              },
            ],
            "json",
          ),
        () =>
          runStateCommand("state-initial", [task.taskFile, "default", request]),
      ];
      for (const operation of operations) {
        await expect(operation()).rejects.toMatchObject({
          diagnostic: {
            issues: expect.arrayContaining([
              expect.objectContaining({
                keyword: example.keyword,
                file: target,
              }),
            ]),
          },
        });
        expect(await readFile(target, "utf8")).toBe(original);
      }
      const copied = await mapCopyFile(
        task.taskFile,
        "/data/extensions/valid",
        "state/initial/default.json",
      );
      if ("taskFile" in copied)
        cleanup.push(dirname(copied.taskFile as string));
      expect(await readFile(target, "utf8")).toBe(original);
      expect(JSON.parse(await readFile(copied.file, "utf8"))).toEqual({
        state: example.valid,
      });
    },
  );
  it("returns structured field diagnostics through the public CLI failure file", async () => {
    const { task, target, original, request } = await fixture(examples[1]!);
    await writeFile(request, JSON.stringify({ value: { state: "1" } }));
    const execute = promisify(execFile);
    try {
      await execute(process.execPath, [
        resolve(".agents/skills/native-card-conversion/scripts/convert.mjs"),
        "state-initial",
        task.taskFile,
        "default",
        request,
      ]);
      throw new Error("Expected the state command to fail");
    } catch (error) {
      const result = error as { stdout: string; stderr: string; code: number };
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      const diagnostic = JSON.parse(
        await readFile(JSON.parse(result.stderr).diagnosticFile, "utf8"),
      );
      expect(diagnostic.data.issues).toContainEqual(
        expect.objectContaining({
          file: target,
          pointer: "/state",
          keyword: "type",
          expected: { type: "number" },
          schemaPath: "#/properties/state/type",
        }),
      );
      expect(await readFile(target, "utf8")).toBe(original);
    }
  });
});
