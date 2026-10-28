import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readTaskContext } from "./task-context.ts";
import { afterEach, describe, expect, it } from "vitest";
import { v3Card } from "./source-fixtures.ts";
import { begin } from "./source.ts";
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

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "state-write-"));
  cleanup.push(directory);
  const sourceFile = join(directory, "source.json");
  await writeFile(
    sourceFile,
    JSON.stringify(
      v3Card({
        extensions: {
          profileReplacement: {
            updaterPrompt: "B",
            writablePaths: ["/manual"],
            stateSchemaFile: "manual.json",
          },
          candidate: { count: "invalid" },
          invalidText: '{"count":"invalid"}',
          invalidScalar: '"invalid"',
          script:
            "const State = z.object({count:z.number(),hidden:z.boolean().default(false)});",
        },
      }),
    ),
  );
  const task = await begin(sourceFile);
  cleanup.push(join(task.packageDirectory, ".."));
  await writeFile(
    join(task.packageDirectory, "openings.json"),
    JSON.stringify({
      defaultOpeningIds: { individual: "default" },
      items: [
        {
          id: "default",
          title: "默认开场",
          summary: "",
          kind: "story",
          audience: "individual",
          textFile: "openings/default.txt",
        },
      ],
    }),
  );
  await mkdir(join(task.packageDirectory, "openings"), { recursive: true });
  await writeFile(join(task.packageDirectory, "openings/default.txt"), "开场");
  return task;
}

async function followTask<
  T extends { taskFile: string; packageDirectory: string },
  R,
>(task: T, operation: Promise<R>): Promise<R> {
  const result = await operation;
  if (
    result &&
    typeof result === "object" &&
    "taskFile" in result &&
    typeof result.taskFile === "string"
  ) {
    cleanup.push(dirname(result.taskFile));
    Object.assign(task, await readTaskContext(result.taskFile), {
      taskFile: result.taskFile,
    });
  }
  return result;
}

describe("complete profile candidate", () => {
  it("replaces optional profile fields through copy and regenerates permissions", async () => {
    const task = await fixture(),
      request = join(task.packageDirectory, "..", "request.json");
    const { runStateCommand } = await import("./state-write.ts");
    await writeFile(
      request,
      JSON.stringify({
        schema: {
          properties: { count: { type: "integer" } },
          additionalProperties: false,
        },
        permissions: [{ field: "/count", write: true }],
        profile: { updaterPrompt: "A", maxTokens: 99 },
      }),
    );
    await followTask(
      task,
      runStateCommand("state-schema", [task.taskFile, request]),
    );
    await followTask(
      task,
      mapCopyFile(
        task.taskFile,
        "/data/extensions/profileReplacement",
        "agents/state-update/profile.json",
      ),
    );
    const profile = JSON.parse(
      await readFile(
        join(task.packageDirectory, "agents/state-update/profile.json"),
        "utf8",
      ),
    );
    expect(profile).toMatchObject({
      updaterPrompt: "B",
      writablePaths: ["/count"],
      stateSchemaFile: "state/schema.json",
    });
    expect(profile.maxTokens).toBeUndefined();
  });
});

describe("persisted permission admission", () => {
  it("rejects a non-boolean persisted permission before generating writable paths", async () => {
    const task = await fixture(),
      request = join(task.packageDirectory, "..", "request.json");
    const { runStateCommand } = await import("./state-write.ts");
    await writeFile(
      request,
      JSON.stringify({
        schema: {
          properties: { count: { type: "integer" } },
          additionalProperties: false,
        },
      }),
    );
    await followTask(
      task,
      runStateCommand("state-schema", [task.taskFile, request]),
    );
    const original = await readFile(
      join(task.packageDirectory, "agents/state-update/profile.json"),
      "utf8",
    );
    await writeFile(
      join(task.packageDirectory, "..", "state-permissions.json"),
      JSON.stringify({ permissions: [{ field: "/count", write: "yes" }] }),
    );
    await expect(
      runStateCommand("state-paths", [task.taskFile]),
    ).rejects.toMatchObject({
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            keyword: "type",
            pointer: "/permissions/0/write",
          }),
        ]),
      },
    });
    expect(
      await readFile(
        join(task.packageDirectory, "agents/state-update/profile.json"),
        "utf8",
      ),
    ).toBe(original);
    await writeFile(
      request,
      JSON.stringify({ permissions: [{ field: "/count", write: false }] }),
    );
    await expect(
      runStateCommand("state-permissions", [task.taskFile, request]),
    ).resolves.toMatchObject({ writablePaths: [] });
  });
});

describe("facts schema identifier", () => {
  it("accepts factsSchema with its own id when generating model output constraints", async () => {
    const task = await fixture(),
      request = join(task.packageDirectory, "..", "request.json");
    await writeFile(
      request,
      JSON.stringify({
        schema: {
          properties: { count: { type: "integer" } },
          additionalProperties: false,
        },
        profile: {
          updaterPrompt: "",
          factsSchema: {
            $id: "https://example.test/facts.json",
            type: "object",
            properties: { summary: { type: "string" } },
            additionalProperties: false,
          },
        },
      }),
    );
    const { runStateCommand } = await import("./state-write.ts");
    await expect(
      runStateCommand("state-schema", [task.taskFile, request]),
    ).resolves.toMatchObject({ writablePaths: [] });
  });
});

describe("state command path boundaries", () => {
  it("rejects a schema reached through a symbolic-link directory", async () => {
    const task = await fixture(),
      external = await mkdtemp(join(tmpdir(), "external-state-"));
    cleanup.push(external);
    await writeFile(
      join(external, "schema.json"),
      JSON.stringify({
        type: "object",
        properties: { count: { type: "integer" } },
        additionalProperties: false,
      }),
    );
    await symlink(external, join(task.packageDirectory, "state"), "dir");
    const { runStateCommand } = await import("./state-write.ts");
    await expect(
      runStateCommand("state-fields", [task.taskFile]),
    ).rejects.toThrow();
  });
});

describe("state schema and request admission", () => {
  it("rejects invalid schemas, keywords, refs and manually provided generated paths without writing", async () => {
    const task = await fixture(),
      request = join(task.packageDirectory, "..", "request.json");
    const { runStateCommand } = await import("./state-write.ts");
    for (const submission of [
      { schema: { type: "array" } },
      {
        schema: {
          properties: { count: { type: "integer", minimum: "wrong" } },
        },
      },
      { schema: { properties: { count: { $ref: "#/$defs/missing" } } } },
      { schema: { properties: {} }, targetFile: "state/other.json" },
      {
        schema: { properties: {} },
        profile: { updaterPrompt: "", writablePaths: ["/manual"] },
      },
      { permissions: [], profile: { stateSchemaFile: "manual.json" } },
    ]) {
      await writeFile(request, JSON.stringify(submission));
      await expect(
        runStateCommand(
          "state-schema" in submission || "schema" in submission
            ? "state-schema"
            : "state-permissions",
          [task.taskFile, request],
        ),
      ).rejects.toThrow();
      await expect(
        readFile(join(task.packageDirectory, "state/schema.json")),
      ).rejects.toThrow();
    }
  });
  it("accepts data combinators and local refs while listing unclear field structure with its schema location", async () => {
    const task = await fixture(),
      request = join(task.packageDirectory, "..", "request.json");
    const { runStateCommand } = await import("./state-write.ts");
    await writeFile(
      request,
      JSON.stringify({
        schema: {
          $defs: { choice: { type: "integer", enum: [1, 2] } },
          properties: { count: { $ref: "#/$defs/choice" } },
          required: ["count"],
          additionalProperties: false,
        },
        initialStates: [{ openingId: "default", value: { count: 1 } }],
      }),
    );
    await followTask(
      task,
      runStateCommand("state-schema", [task.taskFile, request]),
    );
    await expect(
      runStateCommand("state-fields", [task.taskFile]),
    ).rejects.toMatchObject({
      diagnostic: {
        issues: [
          expect.objectContaining({
            pointer: "/count",
            schemaPath: "#/properties/count",
            keyword: "field",
          }),
        ],
      },
    });
    await writeFile(request, JSON.stringify({ value: { count: 3 } }));
    await expect(
      runStateCommand("state-initial", [task.taskFile, "default", request]),
    ).rejects.toMatchObject({
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({ pointer: "/count", keyword: "enum" }),
        ]),
      },
    });
  });
  it("keeps facts schema refs in the same compiler session and rejects invalid profile configuration", async () => {
    const task = await fixture(),
      request = join(task.packageDirectory, "..", "request.json");
    const { runStateCommand } = await import("./state-write.ts");
    await writeFile(
      request,
      JSON.stringify({
        schema: {
          $id: "https://example.test/state.json",
          properties: { count: { type: "integer" } },
          required: ["count"],
          additionalProperties: false,
        },
        profile: {
          updaterPrompt: "",
          factsSchema: { $ref: "https://example.test/state.json" },
        },
      }),
    );
    await followTask(
      task,
      runStateCommand("state-schema", [task.taskFile, request]),
    );
    const before = await readFile(
      join(task.packageDirectory, "agents/state-update/profile.json"),
      "utf8",
    );
    await writeFile(
      request,
      JSON.stringify({ permissions: [], profile: { maxTokens: -1 } }),
    );
    await expect(
      runStateCommand("state-permissions", [task.taskFile, request]),
    ).rejects.toMatchObject({
      diagnostic: {
        issues: [
          expect.objectContaining({
            file: join(
              task.packageDirectory,
              "agents/state-update/profile.json",
            ),
            pointer: "/maxTokens",
            keyword: "too_small",
            expected: { detail: expect.any(String) },
          }),
        ],
      },
    });
    expect(
      await readFile(
        join(task.packageDirectory, "agents/state-update/profile.json"),
        "utf8",
      ),
    ).toBe(before);
  });
});

describe("schema group changes and source coverage", () => {
  it("uses fresh source inventory to reject omitted source fields and unfinished source decisions", async () => {
    const task = await fixture(),
      request = join(task.packageDirectory, "..", "request.json");
    const { runStateCommand } = await import("./state-write.ts");
    await writeFile(
      request,
      JSON.stringify({
        sourcePointer: "/data/extensions/script",
        symbol: "State",
      }),
    );
    const source = (await followTask(
      task,
      runStateCommand("state-source", [task.taskFile, request]),
    )) as { unresolved: Array<{ id: string }> };
    const declaration = {
      schema: {
        properties: { count: { type: "number" } },
        required: ["count"],
        additionalProperties: false,
      },
      initialStates: [{ openingId: "default", value: { count: 1 } }],
      coverage: {
        sourcePointer: "/data/extensions/script",
        symbol: "State",
        mappings: [{ source: "/count", target: "/count" }],
        decisions: source.unresolved.map((item) => ({
          id: item.id,
          reason: "默认值由开场初值提供。",
        })),
      },
    };
    await writeFile(
      join(task.packageDirectory, "..", "state-source.json"),
      JSON.stringify({
        sourcePointer: "/data/extensions/script",
        symbol: "State",
        fields: [{ pointer: "/count" }],
        unresolved: [],
      }),
    );
    await writeFile(request, JSON.stringify(declaration));
    await expect(
      runStateCommand("state-schema", [task.taskFile, request]),
    ).rejects.toMatchObject({
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            keyword: "coverage",
            expected: expect.objectContaining({ missing: ["/hidden"] }),
          }),
        ]),
      },
    });
    declaration.coverage.mappings.push({ source: "/hidden", target: "/count" });
    declaration.coverage.decisions = [];
    await writeFile(request, JSON.stringify(declaration));
    await expect(
      runStateCommand("state-schema", [task.taskFile, request]),
    ).rejects.toMatchObject({
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            keyword: "coverage",
            expected: expect.objectContaining({
              undecided: source.unresolved.map((item) => item.id),
            }),
          }),
        ]),
      },
    });
    await expect(
      readFile(join(task.packageDirectory, "state/schema.json")),
    ).rejects.toThrow();
  });
  it("revalidates existing unreferenced initial values and permissions, then accepts an aligned group", async () => {
    const task = await fixture(),
      request = join(task.packageDirectory, "..", "request.json");
    const { runStateCommand } = await import("./state-write.ts");
    await writeFile(
      request,
      JSON.stringify({
        schema: {
          properties: { count: { type: "integer" } },
          required: ["count"],
          additionalProperties: false,
        },
        initialStates: [{ openingId: "default", value: { count: 1 } }],
        permissions: [{ field: "/count", write: true }],
      }),
    );
    await followTask(
      task,
      runStateCommand("state-schema", [task.taskFile, request]),
    );
    const original = await readFile(
      join(task.packageDirectory, "state/schema.json"),
      "utf8",
    );
    await writeFile(
      join(task.packageDirectory, "state/initial/spare.json"),
      '{"count":2}\n',
    );
    await writeFile(
      request,
      JSON.stringify({
        schema: {
          properties: { renamed: { type: "integer" } },
          required: ["renamed"],
          additionalProperties: false,
        },
        initialStates: [{ openingId: "default", value: { renamed: 1 } }],
      }),
    );
    await expect(
      runStateCommand("state-schema", [task.taskFile, request]),
    ).rejects.toMatchObject({
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({ keyword: "permission", pointer: "/count" }),
        ]),
      },
    });
    await writeFile(
      request,
      JSON.stringify({
        schema: {
          properties: { renamed: { type: "integer" } },
          required: ["renamed"],
          additionalProperties: false,
        },
        initialStates: [{ openingId: "default", value: { renamed: 1 } }],
        permissions: [{ field: "/renamed", write: true }],
      }),
    );
    await expect(
      runStateCommand("state-schema", [task.taskFile, request]),
    ).rejects.toMatchObject({
      diagnostic: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            file: join(task.packageDirectory, "state/initial/spare.json"),
          }),
        ]),
      },
    });
    expect(
      await readFile(join(task.packageDirectory, "state/schema.json"), "utf8"),
    ).toBe(original);
    await rm(join(task.packageDirectory, "state/initial/spare.json"));
    await followTask(
      task,
      runStateCommand("state-schema", [task.taskFile, request]),
    );
    expect(
      JSON.parse(
        await readFile(
          join(task.packageDirectory, "agents/state-update/profile.json"),
          "utf8",
        ),
      ).writablePaths,
    ).toEqual(["/renamed"]);
    expect(
      JSON.parse(
        await readFile(
          join(task.packageDirectory, "state/initial/default.json"),
          "utf8",
        ),
      ),
    ).toEqual({ renamed: 1 });
  });
});

describe("source state coverage", () => {
  it("rejects a missing source symbol before registering the inventory", async () => {
    const task = await fixture(),
      request = join(task.packageDirectory, "..", "request.json");
    await writeFile(
      request,
      JSON.stringify({
        sourcePointer: "/data/extensions/script",
        symbol: "Absent",
      }),
    );
    const { runStateCommand } = await import("./state-write.ts");
    await expect(
      runStateCommand("state-source", [task.taskFile, request]),
    ).rejects.toThrow();
    await expect(
      readFile(join(task.packageDirectory, "..", "state-source.json")),
    ).rejects.toThrow();
  });
});

describe("state CLI request contract", () => {
  it("exposes request schema and resolves request paths while rejecting output paths", async () => {
    const { commandHelp } = await import("./tool-config.ts");
    const { parseInvocation } = await import("./cli.ts");
    const help = commandHelp("state-schema") as Record<string, unknown>;
    expect(help.requestSchema).toMatch(/state-request.schema.json$/);
    expect(help.definition).toBe("#/$defs/state-schema");
    const call = await parseInvocation(
      ["state-initial", "task.json", "default", "request.json"],
      "/tmp",
    );
    expect(call.positional).toEqual([
      "/tmp/task.json",
      "default",
      "/tmp/request.json",
    ]);
    await expect(
      parseInvocation(
        [
          "state-schema",
          "task.json",
          "request.json",
          "--target-file",
          "state/schema.json",
        ],
        "/tmp",
      ),
    ).rejects.toThrow();
  });
});

describe("generated state submission", () => {
  it("generates schema, opening references and profile paths from submitted data", async () => {
    const task = await fixture();
    const request = join(task.packageDirectory, "..", "request.json");
    await writeFile(
      request,
      JSON.stringify({
        schema: {
          properties: {
            stats: {
              type: "object",
              properties: {
                "a/b": { type: "integer" },
                "x~y": { type: "boolean" },
              },
              required: ["a/b", "x~y"],
              additionalProperties: false,
            },
            items: { type: "array", items: { type: "string" } },
          },
          required: ["stats", "items"],
          additionalProperties: false,
        },
        initialStates: [
          {
            openingId: "default",
            value: { stats: { "a/b": 1, "x~y": false }, items: [] },
          },
        ],
        permissions: [
          { field: "/stats", write: true },
          { field: "/stats/x~0y", write: false },
          { field: "/items", write: true },
        ],
        profile: { updaterPrompt: "更新变量。" },
      }),
    );
    const { runStateCommand } = await import("./state-write.ts");
    await followTask(
      task,
      runStateCommand("state-schema", [task.taskFile, request]),
    );
    const profile = JSON.parse(
      await readFile(
        join(task.packageDirectory, "agents/state-update/profile.json"),
        "utf8",
      ),
    );
    expect(profile.writablePaths).toEqual(["/items", "/stats/a~1b"]);
    expect(profile.stateSchemaFile).toBe("state/schema.json");
    expect(
      JSON.parse(
        await readFile(join(task.packageDirectory, "character.json"), "utf8"),
      ).stateUpdate,
    ).toBe("agents/state-update/profile.json");
    expect(
      JSON.parse(
        await readFile(join(task.packageDirectory, "openings.json"), "utf8"),
      ).items[0].initialStateFile,
    ).toBe("state/initial/default.json");
    expect(
      JSON.parse(
        await readFile(
          join(task.packageDirectory, "state/schema.json"),
          "utf8",
        ),
      ).$schema,
    ).toBe("https://json-schema.org/draft/2020-12/schema");
    await followTask(task, runStateCommand("state-paths", [task.taskFile]));
    expect(
      JSON.parse(
        await readFile(
          join(task.packageDirectory, "agents/state-update/profile.json"),
          "utf8",
        ),
      ).writablePaths,
    ).toEqual(profile.writablePaths);
  });
});

describe("complete state candidates from copy and parse", () => {
  it("rejects invalid single-field and batch candidates across both commands", async () => {
    const task = await fixture();
    await mkdir(join(task.packageDirectory, "state/initial"), {
      recursive: true,
    });
    await writeFile(
      join(task.packageDirectory, "state/schema.json"),
      JSON.stringify({
        type: "object",
        properties: { count: { type: "integer" } },
        required: ["count"],
        additionalProperties: false,
      }),
    );
    const target = join(task.packageDirectory, "state/initial/default.json");
    const original = '{"count":2}\n';
    await writeFile(target, original);
    const operations = [
      () =>
        mapCopyFile(
          task.taskFile,
          "/data/extensions/candidate/count",
          "state/initial/default.json",
          { targetPointer: "/count" },
        ),
      () =>
        mapCopyFieldsFile(task.taskFile, "state/initial/default.json", [
          {
            sourcePointer: "/data/extensions/candidate/count",
            targetPointer: "/count",
          },
        ]),
      () =>
        mapParseFile(
          task.taskFile,
          "/data/extensions/invalidText",
          "state/initial/default.json",
          { format: "json" },
        ),
      () =>
        mapParseFile(
          task.taskFile,
          "/data/extensions/invalidScalar",
          "state/initial/default.json",
          { format: "json", targetPointer: "/count" },
        ),
      () =>
        mapParseFieldsFile(
          task.taskFile,
          "state/initial/default.json",
          [
            {
              sourcePointer: "/data/extensions/invalidScalar",
              targetPointer: "/count",
            },
          ],
          "json",
        ),
      () =>
        mapCopyFile(
          task.taskFile,
          "/data/extensions/invalidText",
          "state/initial/default.json",
        ),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toThrow();
      expect(await readFile(target, "utf8")).toBe(original);
    }
  });
});

describe("state writes through conversion commands", () => {
  it("rejects an invalid copied initial state and preserves the previous file", async () => {
    const task = await fixture();
    await mkdir(join(task.packageDirectory, "state/initial"), {
      recursive: true,
    });
    await writeFile(
      join(task.packageDirectory, "state/schema.json"),
      JSON.stringify({
        type: "object",
        properties: { count: { type: "integer" } },
        required: ["count"],
        additionalProperties: false,
      }),
    );
    const target = join(task.packageDirectory, "state/initial/default.json");
    const original = '{"count":2}\n';
    await writeFile(target, original);
    await expect(
      mapCopyFile(
        task.taskFile,
        "/data/extensions/candidate",
        "state/initial/default.json",
      ),
    ).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(original);
  });
});
