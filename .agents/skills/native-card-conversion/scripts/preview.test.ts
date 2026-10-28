import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as viteModule from "vite";

vi.mock("vite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vite")>();
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) =>
      actual.createServer(...args),
  };
});

import { writeNativeCardZip } from "../../../../apps/api/src/services/native-card/zip.js";
import {
  startPreviewServer as startPreviewWithArchive,
  type PreviewScenario,
  type PreviewDependencies,
} from "./preview.js";
const startPreviewServer = (
  directory: string,
  dependencies: PreviewDependencies = {},
) =>
  startPreviewWithArchive(directory, dependencies, join(directory, "role.zip"));

const taskDirectories: string[] = [];
const outsideDirectories: string[] = [];
const previews: Array<Awaited<ReturnType<typeof startPreviewServer>>> = [];
const initialMasterKey = process.env.APP_SECRETS_MASTER_KEY;
const narratorPresetMarker = "正文预设专属标记：NARRATOR_PRESET_ONLY。";
const statePresetMarker = "独立状态预设专属标记：STATE_PRESET_ONLY。";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(previews.splice(0).map((preview) => preview.close()));
  await Promise.all(
    [...taskDirectories.splice(0), ...outsideDirectories.splice(0)].map(
      (path) => rm(path, { recursive: true, force: true }),
    ),
  );
  if (initialMasterKey === undefined) delete process.env.APP_SECRETS_MASTER_KEY;
  else process.env.APP_SECRETS_MASTER_KEY = initialMasterKey;
});

it("shares closing completion and releases logger writes after the preview closes", async () => {
  const createServer = viteModule.createServer;
  let logger!: NonNullable<Parameters<typeof createServer>[0]>["customLogger"];
  let server!: Awaited<ReturnType<typeof createServer>>;
  vi.spyOn(viteModule, "createServer").mockImplementation(async (config) => {
    logger = config!.customLogger;
    server = await createServer({
      ...config,
      configFile: false,
      optimizeDeps: { entries: [], include: [] },
    });
    return server;
  });
  const task = await createTask();
  const preview = await startPreviewServer(task);
  previews.push(preview);
  logger!.info("before close");
  const info = vi.spyOn(logger!, "info");
  const optimizer = server.environments.client.depsOptimizer!;
  await optimizer.init();
  const pendingLogs = new Map<ReturnType<typeof setTimeout>, () => void>();
  const schedule = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay !== 200) return schedule(callback, delay, ...args);
    const handle = schedule(() => {}, 0);
    pendingLogs.set(handle, () => callback(...args));
    return handle;
  }) as typeof setTimeout);
  vi.spyOn(globalThis, "clearTimeout").mockImplementation((handle) => {
    pendingLogs.delete(handle as ReturnType<typeof setTimeout>);
    cancel(handle);
  });
  for (const name of ["one", "two"]) {
    const path = join(task, name + ".mjs");
    await writeFile(path, `export const ${name} = 1;`);
    const dependency = optimizer.registerMissingImport(name, path);
    dependency.needsInterop = false;
    optimizer.run();
    await dependency.processing;
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let enteredClose!: () => void;
  const closeEntered = new Promise<void>((resolve) => {
    enteredClose = resolve;
  });
  const closeServer = server.close.bind(server);
  const closingServer = vi
    .spyOn(server, "close")
    .mockImplementation(async () => {
      enteredClose();
      await gate;
      logger!.info("during close");
      await closeServer();
    });
  let secondFinished = false;
  const first = preview.close();
  const second = preview.close().then(() => {
    secondFinished = true;
  });
  try {
    await closeEntered;
    expect(closingServer).toHaveBeenCalledOnce();
    expect(secondFinished).toBe(false);
  } finally {
    release();
    await Promise.all([first, second]);
  }
  const callsAtClose = info.mock.calls.length;
  const log = await readFile(
    join(preview.evidenceDirectory, "vite.log.jsonl"),
    "utf8",
  );
  expect(log).toContain("before close");
  expect(log).toContain("during close");
  await rm(preview.evidenceDirectory, { recursive: true, force: true });
  expect(() => {
    logger!.info("late info");
    logger!.warn("late warning");
    logger!.warnOnce("late warning once");
    logger!.error("late error");
  }).not.toThrow();
  expect(pendingLogs.size).toBeGreaterThan(0);
  for (const callback of pendingLogs.values()) callback();
  expect(
    info.mock.calls
      .slice(callsAtClose)
      .some(([message]) => message.includes("new dependencies optimized")),
  ).toBe(true);
}, 30000);

it("closes Vite and the listeners even when waiting for requests fails", async () => {
  const createServer = viteModule.createServer;
  let server!: Awaited<ReturnType<typeof createServer>>;
  vi.spyOn(viteModule, "createServer").mockImplementation(async (config) => {
    server = await createServer(config);
    return server;
  });
  const preview = await startPreviewServer(await createTask());
  const close = vi.spyOn(server, "close");
  vi.spyOn(server.environments.client, "waitForRequestsIdle").mockRejectedValue(
    new Error("request drain failed"),
  );
  const first = preview.close();
  const second = preview.close();
  const results = await Promise.allSettled([first, second]);
  expect(results[0]).toMatchObject({ status: "rejected" });
  expect(results[1]).toEqual(results[0]);
  expect(close).toHaveBeenCalledOnce();
  await expect(fetch(preview.url)).rejects.toThrow();
  const record = JSON.parse(
    await readFile(join(preview.evidenceDirectory, "closed.json"), "utf8"),
  );
  expect(record.cleanupErrors.join("\\n")).toContain("request drain failed");
}, 30000);

async function createTask(
  overrides: Partial<PreviewScenario> = {},
  options: {
    assetMarker?: string;
    packageFiles?: Record<string, string | Uint8Array>;
  } = {},
): Promise<string> {
  const taskDirectory = await mkdtemp(join(tmpdir(), "native-page-preview-"));
  taskDirectories.push(taskDirectory);
  const packageFiles =
    options.packageFiles ??
    (JSON.parse(
      await readFile(
        new URL(
          "../../../../apps/api/test/fixtures/native-card/harbor.files.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, string | Uint8Array>);
  if (options.assetMarker) {
    const portrait = packageFiles["assets/portrait.svg"];
    if (typeof portrait !== "string") {
      throw new Error("Harbor fixture has no text SVG portrait resource.");
    }
    packageFiles["assets/portrait.svg"] = portrait.replace(
      "MIST HARBOR",
      `MIST HARBOR ${options.assetMarker}`,
    );
  }
  await writeFile(
    join(taskDirectory, "role.zip"),
    writeNativeCardZip(
      Object.entries(packageFiles).map(([path, content]) => ({
        path,
        content: Buffer.from(content),
      })),
    ),
  );
  await writePreviewInput(taskDirectory, overrides);
  return taskDirectory;
}

async function writePreviewInput(
  taskDirectory: string,
  overrides: Partial<PreviewScenario> = {},
): Promise<void> {
  const statePresetData = JSON.parse(
    await readFile(
      new URL(
        "../../../../.planning/native-card-maintenance/verbatim-state-assembly/presets/primary-state-update.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const statePresetPrompts = statePresetData.prompts as
    | Array<Record<string, unknown>>
    | undefined;
  const statePresetMain = statePresetPrompts?.find(
    (prompt) => prompt.identifier === "main",
  );
  if (!statePresetMain || typeof statePresetMain.content !== "string") {
    throw new Error("State preset fixture has no main prompt.");
  }
  statePresetMain.content += `\n${statePresetMarker}`;

  const scenario: PreviewScenario = {
    version: 1,
    persona: {
      name: "周雨宁",
      description:
        "周雨宁是31岁的成年女性，是赵承文的同事。她谨慎、坦率，正在雾港邮局检查刚收到的信件。",
    },
    preset: {
      name: "完整人设预览预设",
      data: {
        prompts: [
          {
            identifier: "main",
            name: "身份与叙述",
            role: "system",
            content: `${narratorPresetMarker}用户姓名：{{user}}。用户人设：{{persona}}。`,
          },
          { identifier: "chatHistory", name: "历史", marker: true },
        ],
        prompt_order: [
          {
            character_id: 100000,
            order: [
              { identifier: "main", enabled: true },
              { identifier: "chatHistory", enabled: true },
            ],
          },
        ],
        names_behavior: 1,
      },
    },
    statePreset: {
      name: "独立状态更新预设",
      data: statePresetData,
    },
    modelParams: {
      max_context_tokens: 32768,
      max_output_tokens: 256,
      temperature: 0.4,
      reasoning_effort: "none",
    },
    sessionType: "individual",
    openingId: "first",
    testMessages: [
      {
        id: "identity-continuity",
        message:
          "【写作者元指令】请先说明目前由谁检查这封信，以及还缺哪些信息。",
        prompt_intent: "normal",
        debug_options: { include_worldbook_matches: true },
      },
    ],
    ...overrides,
  };
  await writeFile(
    join(taskDirectory, "preview.json"),
    `${JSON.stringify(scenario, null, 2)}\n`,
  );
}

function createPreviewExamplePackage(): Record<string, string> {
  const files: Record<string, string> = {
    "character.json": JSON.stringify({
      name: "顾星澜",
      description: "顾星澜是34岁的成年男性，临江档案馆的夜班值守员。",
      personality: "谨慎、坦率，遵守登记流程。",
      scenario: "夜班交接时，铜钥匙需要登记并存入暂存柜。",
      stateUpdate: "agents/state-update/profile.json",
    }),
    "openings.json": JSON.stringify({
      defaultOpeningIds: { individual: "archive-handoff" },
      items: [
        {
          id: "archive-handoff",
          title: "铜钥匙交接",
          summary: "检查交接台上的铜钥匙。",
          kind: "story",
          audience: "individual",
          textFile: "openings/archive-handoff.txt",
          initialStateFile: "state/initial/archive-handoff.json",
        },
      ],
    }),
    "openings/archive-handoff.txt":
      "顾星澜值守在临江档案馆。铜钥匙放在交接台，登记簿尚未填写。",
    "state/initial/archive-handoff.json": JSON.stringify({
      stash: {
        key_location: "交接台",
        registered_pages: 0,
        pending_transfer: true,
      },
      trust: 20,
    }),
    "state/schema.json": JSON.stringify({
      type: "object",
      required: ["stash", "trust"],
      properties: {
        stash: {
          type: "object",
          required: ["key_location", "registered_pages", "pending_transfer"],
          properties: {
            key_location: { type: "string" },
            registered_pages: { type: "integer", minimum: 0 },
            pending_transfer: { type: "boolean" },
          },
          additionalProperties: false,
        },
        trust: { type: "integer", minimum: 0, maximum: 100 },
      },
      additionalProperties: false,
    }),
    "agents/state-update/profile.json": JSON.stringify({
      updaterPrompt:
        "根据本轮对话更新铜钥匙位置、登记页码和信任值，并引用来源消息。",
      writablePaths: [
        "/stash/key_location",
        "/stash/registered_pages",
        "/stash/pending_transfer",
        "/trust",
      ],
      derivedPaths: [],
      stateSchemaFile: "state/schema.json",
      ruleFiles: [],
    }),
  };
  files["manifest.json"] = JSON.stringify({
    format: "tavern_headless_role_package",
    formatVersion: "1.0.0",
    packageId: "preview-example-contract-test",
    character: "character.json",
    openings: "openings.json",
    files: Object.keys(files).map((path) => ({
      path,
      mediaType: path.endsWith(".json") ? "application/json" : "text/plain",
      purpose: "data",
    })),
  });
  return files;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function readPreviewCover(preview: {
  apiUrl: string;
  url: string;
  sessionId: string;
}): Promise<string> {
  const roleViewResponse = await fetch(
    `${preview.apiUrl}/sessions/${encodeURIComponent(preview.sessionId)}/role-view`,
  );
  expect(roleViewResponse.status).toBe(200);
  const roleView = (await roleViewResponse.json()) as {
    data?: {
      delivery?: { assets?: Record<string, { url?: unknown }> };
    };
  };
  const coverUrl = roleView.data?.delivery?.assets?.cover?.url;
  if (typeof coverUrl !== "string") {
    throw new Error("Preview role view did not return its cover asset URL.");
  }
  const coverResponse = await fetch(new URL(coverUrl, preview.url));
  expect(coverResponse.status).toBe(200);
  return coverResponse.text();
}

async function requestPreviewTurn(
  preview: { sessionId: string; url: string },
  message = "【写作者元指令】请继续雾港邮局的调查。",
): Promise<{ status: number; contentType: string | null; body: string }> {
  const response = await fetch(
    new URL(
      `/api/sessions/${encodeURIComponent(preview.sessionId)}/respond/stream`,
      preview.url,
    ),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        branch_id: "main",
        generation_params: { stream: true },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  };
}

function parseSseEvents(
  responseText: string,
): Array<{ event: string; data: Record<string, unknown> }> {
  return responseText
    .split(/\r?\n\r?\n/)
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const dataLines = [...block.matchAll(/^data: ?(.*)$/gm)].map(
        (match) => match[1] ?? "",
      );
      if (!event || dataLines.length === 0) {
        throw new Error(`Malformed SSE event block: ${block}`);
      }
      return {
        event,
        data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>,
      };
    });
}

describe("formal isolated native-card preview server", () => {
  it("records one failed dry-run, continues the next, and opens and closes the preview page", async () => {
    const taskDirectory = await createTask({
      testMessages: [
        {
          id: "missing-branch",
          message: "请检查缺失分支。",
          branch_id: "branch-does-not-exist",
        },
        { id: "valid-message", message: "请继续检查信件。" },
      ],
    });
    const preview = await startPreviewServer(taskDirectory);
    previews.push(preview);

    const dryRuns = JSON.parse(
      await readFile(join(preview.evidenceDirectory, "dry-runs.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(dryRuns).toHaveLength(2);
    expect(dryRuns[0]).toMatchObject({
      id: "missing-branch",
      status: 404,
      passed: false,
      response: { error: { code: "branch_not_found" } },
    });
    expect(dryRuns[0]?.error).toEqual(expect.any(String));
    expect(dryRuns[1]).toMatchObject({
      id: "valid-message",
      status: 200,
      passed: true,
      checks: { assembledMessageCount: expect.any(Number) },
    });
    expect((await fetch(preview.url)).status).toBe(200);

    await preview.close();
    const closed = await readJson(
      join(preview.evidenceDirectory, "closed.json"),
    );
    expect(closed.cleanupErrors).toEqual([]);
  }, 30000);

  it("records empty assembled messages as a failed check and continues later checks", async () => {
    const taskDirectory = await createTask({
      testMessages: [
        { id: "empty-assembly", message: "触发空组装结果。" },
        { id: "after-empty", message: "继续检查信件。" },
      ],
    });
    const preview = await startPreviewServer(taskDirectory, {
      transformDryRunResponse: ({ payload }, response) =>
        (payload as { message?: string }).message === "触发空组装结果。"
          ? {
              statusCode: response.statusCode,
              body: { data: { messages: [] } },
            }
          : undefined,
    });
    previews.push(preview);

    const dryRuns = JSON.parse(
      await readFile(join(preview.evidenceDirectory, "dry-runs.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(dryRuns).toHaveLength(2);
    expect(dryRuns[0]).toMatchObject({
      id: "empty-assembly",
      status: 200,
      response: { data: { messages: [] } },
      passed: false,
      error: expect.stringContaining("未返回已组装消息"),
    });
    expect(dryRuns[1]).toMatchObject({ id: "after-empty", passed: true });
    expect(preview.dryRuns).toMatchObject([
      { id: "empty-assembly", passed: false, status: 200 },
      { id: "after-empty", passed: true, status: 200 },
    ]);
    expect(
      await readJson(join(preview.evidenceDirectory, "page.json")),
    ).toMatchObject({
      dryRuns: [
        { id: "empty-assembly", passed: false },
        { id: "after-empty", passed: true },
      ],
    });
    await preview.close();
  }, 30000);

  it("records a missing persona description in assembled messages without aborting the page", async () => {
    const taskDirectory = await createTask();
    const scenario = await readJson(join(taskDirectory, "preview.json"));
    const preview = await startPreviewServer(taskDirectory, {
      transformDryRunResponse: (_request, response) => ({
        statusCode: response.statusCode,
        body: {
          data: {
            messages: [
              {
                role: "system",
                content:
                  "This assembled response omits the configured persona description.",
              },
            ],
          },
        },
      }),
    });
    previews.push(preview);

    const dryRuns = JSON.parse(
      await readFile(join(preview.evidenceDirectory, "dry-runs.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(dryRuns[0]).toMatchObject({
      id: "identity-continuity",
      status: 200,
      passed: false,
      response: { data: { messages: expect.any(Array) } },
      error: expect.stringContaining("未包含完整 persona.description"),
    });
    const assembledMessages = (
      dryRuns[0]?.response as { data: { messages: unknown[] } }
    ).data.messages;
    expect(JSON.stringify(assembledMessages)).not.toContain(
      (scenario.persona as { description: string }).description,
    );
    expect(preview.dryRuns).toMatchObject([
      { id: "identity-continuity", passed: false, status: 200 },
    ]);
    expect((await fetch(preview.url)).status).toBe(200);
    await preview.close();
  }, 30000);

  it("assembles the configured example through formal dry-run and replays narrator/state updates in order", async () => {
    const scenario = JSON.parse(
      await readFile(
        new URL("./preview.example.json", import.meta.url),
        "utf8",
      ),
    ) as PreviewScenario;
    const taskDirectory = await createTask(scenario, {
      packageFiles: createPreviewExamplePackage(),
    });
    const preview = await startPreviewServer(taskDirectory);
    previews.push(preview);

    const requests = JSON.parse(
      await readFile(join(preview.evidenceDirectory, "requests.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(requests[2]?.request).toMatchObject({
      configuration: { model_capabilities: scenario.modelCapabilities },
    });

    const dryRuns = JSON.parse(
      await readFile(join(preview.evidenceDirectory, "dry-runs.json"), "utf8"),
    ) as Array<{
      response?: {
        data?: {
          messages?: Array<{ content?: unknown }>;
          assembly?: Record<string, unknown>;
        };
      };
    }>;
    expect(dryRuns).toHaveLength(scenario.testMessages.length);
    for (const [index, dryRun] of dryRuns.entries()) {
      const input = scenario.testMessages[index];
      if (!input) throw new Error(`Missing preview example message ${index}.`);
      const assembled = (dryRun.response?.data?.messages ?? [])
        .map((item) => String(item.content ?? ""))
        .join("\n");
      expect(assembled).toContain(scenario.persona.description);
      expect(assembled).toContain(`${scenario.persona.name}: ${input.message}`);
      expect(dryRun.response?.data?.assembly).toMatchObject({
        selected_prompt_order_character_id: 100000,
        names_behavior_applied: "always",
      });
    }

    const first = scenario.testMessages[0];
    const second = scenario.testMessages[1];
    if (!first || !second)
      throw new Error("Preview example must contain two ordered messages.");
    for (const input of [first, second]) {
      const turn = await requestPreviewTurn(preview, input.message);
      expect(turn.status).toBe(200);
      const done = parseSseEvents(turn.body).find(
        ({ event }) => event === "done",
      );
      expect(done?.data.floor_id).toEqual(expect.any(String));
      const update = await fetch(
        `${preview.apiUrl}/sessions/${encodeURIComponent(preview.sessionId)}/role-state/updates`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ floor_id: done?.data.floor_id }),
        },
      );
      const updateBody = await update.json();
      expect(update.status, JSON.stringify(updateBody)).toBe(200);
    }
    const replayEvents = (
      await readFile(
        join(
          String(preview.replaySnapshot()?.evidenceDirectory),
          "requests.jsonl",
        ),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(
      replayEvents
        .filter((event) => typeof event.callNumber === "number")
        .map((event) => event.configuredPurpose),
    ).toEqual(["narrator", "state_updater", "narrator", "state_updater"]);
    const secondNarrator = replayEvents.find((event) => event.callNumber === 3);
    const requestMessages =
      (
        secondNarrator?.requestBody as
          | { messages?: Array<{ role?: string; content?: unknown }> }
          | undefined
      )?.messages ?? [];
    const userHistoryAndInput = requestMessages
      .filter((message) => message.role === "user")
      .map((message) => String(message.content ?? ""))
      .join("\n");
    expect(userHistoryAndInput).toContain(
      `${scenario.persona.name}: ${first.message}`,
    );
    expect(userHistoryAndInput).toContain(
      `${scenario.persona.name}: ${second.message}`,
    );
  });

  it("imports, seeds the named persona and preset, verifies dry-run content, serves a loopback URL, and closes every listener", async () => {
    const taskDirectory = await createTask({
      offlineReplay: {
        steps: [
          {
            purpose: "narrator",
            model: "offline-page-narrator",
            text: "周雨宁把信封放到柜台上。",
          },
        ],
      },
    });
    const submittedZip = await readFile(join(taskDirectory, "role.zip"));
    const preview = await startPreviewServer(taskDirectory);
    previews.push(preview);
    const replacementZip = Buffer.from("replacement ZIP after import");
    await writeFile(join(taskDirectory, "role.zip"), replacementZip);

    expect(preview.generationMode).toBe("offline_replay");
    const pageUrl = new URL(preview.url);
    expect(pageUrl.hostname).toBe("127.0.0.1");
    expect(pageUrl.searchParams.get("sessionId")).toBe(preview.sessionId);
    expect(preview.apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Number(new URL(preview.apiUrl).port)).toBeGreaterThan(0);
    expect(preview.offlineReplayUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);

    const rootPage = await fetch(preview.url);
    expect(rootPage.status).toBe(200);
    expect(await rootPage.text()).toContain("<html");
    const entryModule = await fetch(new URL("/src/main.ts", preview.url));
    expect(entryModule.status).toBe(200);
    expect(entryModule.headers.get("content-type")).toMatch(/javascript/i);
    const appConfigResponse = await fetch(
      new URL("/config/application.json", preview.url),
    );
    expect(appConfigResponse.status).toBe(200);
    const appConfig = (await appConfigResponse.json()) as Record<
      string,
      unknown
    >;
    expect(appConfig.apiBaseUrl).toBe(`${pageUrl.origin}/api`);
    expect(appConfig.adminBaseUrl).toBe(preview.apiUrl);
    const apiHealth = await fetch(new URL("/api/health", preview.url));
    expect(apiHealth.status).toBe(200);
    expect(await apiHealth.json()).toMatchObject({ ok: true });
    const missingRoleAsset = await fetch(
      new URL("/role-assets/missing-preview-version/missing.txt", preview.url),
    );
    expect(missingRoleAsset.status).toBe(404);
    expect(missingRoleAsset.headers.get("content-type")).toMatch(
      /application\/json/i,
    );

    const requestRecords = JSON.parse(
      await readFile(join(preview.evidenceDirectory, "requests.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(requestRecords.map((record) => record.url)).toEqual([
      expect.stringMatching(/^\/native-cards\/imports\?fileName=role\.zip$/),
      expect.stringMatching(/^\/native-cards\/imports\/[^/]+\/confirm$/),
      expect.stringMatching(/^\/native-cards\/[^/]+\/preview-sessions$/),
      expect.stringMatching(/^\/sessions\/[^/]+\/role-view$/),
      expect.stringMatching(/^\/sessions\/[^/]+\/respond\/dry-run$/),
    ]);
    expect(requestRecords[0]).toMatchObject({
      request: null,
      headers: { "content-type": "application/zip" },
      bodyReference: "request-bodies/000.bin",
      bodyByteLength: submittedZip.byteLength,
    });
    expect(requestRecords[2]?.request).not.toHaveProperty(
      "configuration.model_capabilities",
    );
    const dryRun = requestRecords.at(-1)?.response as {
      data?: { messages?: Array<{ content?: unknown }> };
    };
    const assembled = (dryRun.data?.messages ?? [])
      .map((message) => String(message.content ?? ""))
      .join("\n");
    expect(assembled).toContain(
      "周雨宁是31岁的成年女性，是赵承文的同事。她谨慎、坦率，正在雾港邮局检查刚收到的信件。",
    );
    expect(assembled).toContain("周雨宁");

    const formalRecords = (
      await readFile(
        join(preview.evidenceDirectory, "http-results.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(formalRecords).toHaveLength(5);
    expect(formalRecords[0]).toMatchObject({
      method: "POST",
      request: null,
      headers: { "content-type": "application/zip" },
      bodyReference: "request-bodies/000.bin",
      bodyByteLength: submittedZip.byteLength,
      statusCode: 200,
    });
    expect(
      await readFile(
        join(preview.evidenceDirectory, "request-bodies", "000.bin"),
      ),
    ).toEqual(submittedZip);
    expect(await readFile(join(taskDirectory, "role.zip"))).toEqual(
      replacementZip,
    );
    expect(formalRecords.at(-1)).toMatchObject({
      method: "POST",
      url: expect.stringMatching(/\/respond\/dry-run$/),
      request: {
        message:
          "【写作者元指令】请先说明目前由谁检查这封信，以及还缺哪些信息。",
      },
      statusCode: 200,
    });
    expect(formalRecords[2]).toMatchObject({
      request: {
        configuration: {
          modelSlots: [
            { slot: "narrator", params: { max_context_tokens: 32768 } },
            { slot: "state_updater", params: { max_context_tokens: 32768 } },
          ],
        },
      },
    });

    const page = await readJson(join(preview.evidenceDirectory, "page.json"));
    expect(page.storageDirectory).toBe(
      join(preview.evidenceDirectory, "storage"),
    );
    expect(page.boundHost).toBe("127.0.0.1");
    const fixtureResponse = await fetch(
      `${preview.offlineReplayUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "offline-page-narrator",
          messages: [{ role: "user", content: "请继续。" }],
        }),
      },
    );
    expect(fixtureResponse.status).toBe(200);
    expect(await fixtureResponse.json()).toMatchObject({
      choices: [
        {
          message: { content: "周雨宁把信封放到柜台上。" },
        },
      ],
    });
    expect(preview.replaySnapshot()).toMatchObject({
      host: "127.0.0.1",
      callCount: 1,
      stepsConsumed: 1,
    });

    await preview.close();
    await expect(fetch(preview.url)).rejects.toThrow();
    await expect(fetch(preview.apiUrl)).rejects.toThrow();
    await expect(fetch(`${preview.offlineReplayUrl}/health`)).rejects.toThrow();
    const browserRequests = (
      await readFile(
        join(preview.evidenceDirectory, "browser-requests.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(browserRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "vite",
          url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\//),
          statusCode: 200,
        }),
        expect.objectContaining({
          source: "vite",
          path: "/config/application.json",
          statusCode: 200,
        }),
      ]),
    );
    expect(
      await readJson(join(preview.evidenceDirectory, "closed.json")),
    ).toMatchObject({
      offlineReplay: { callCount: 1 },
      cleanupErrors: [],
    });
  }, 30000);

  it("starts two previews concurrently on distinct ports with working pages, configs, proxies, and cleanup", async () => {
    const [firstTask, secondTask] = await Promise.all([
      createTask(),
      createTask(),
    ]);
    const results = await Promise.allSettled([
      startPreviewServer(firstTask),
      startPreviewServer(secondTask),
    ]);
    const activePreviews = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    previews.push(...activePreviews);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(activePreviews).toHaveLength(2);
    const [first, second] = activePreviews;
    if (!first || !second) return;

    const frontendPorts = activePreviews.map((preview) =>
      Number(new URL(preview.url).port),
    );
    const apiPorts = activePreviews.map((preview) =>
      Number(new URL(preview.apiUrl).port),
    );
    expect(frontendPorts.every((port) => port > 0)).toBe(true);
    expect(apiPorts.every((port) => port > 0)).toBe(true);
    expect(new Set(frontendPorts).size).toBe(2);
    expect(new Set(apiPorts).size).toBe(2);

    const pageResults = await Promise.all(
      activePreviews.map(async (preview) => {
        const [page, config, apiHealth, roleAsset] = await Promise.all([
          fetch(preview.url),
          fetch(new URL("/config/application.json", preview.url)),
          fetch(new URL("/api/health", preview.url)),
          fetch(
            new URL(
              "/role-assets/missing-preview-version/missing.txt",
              preview.url,
            ),
          ),
        ]);
        return {
          page,
          pageBody: await page.text(),
          config,
          configBody: (await config.json()) as Record<string, unknown>,
          apiHealth,
          apiHealthBody: (await apiHealth.json()) as Record<string, unknown>,
          roleAsset,
        };
      }),
    );
    for (const [index, result] of pageResults.entries()) {
      const preview = activePreviews[index]!;
      const frontendOrigin = new URL(preview.url).origin;
      expect(result.page.status).toBe(200);
      expect(result.pageBody).toContain("<html");
      expect(result.config.status).toBe(200);
      expect(result.configBody).toEqual({
        apiBaseUrl: `${frontendOrigin}/api`,
        adminBaseUrl: preview.apiUrl,
      });
      expect(result.apiHealth.status).toBe(200);
      expect(result.apiHealthBody).toMatchObject({ ok: true });
      expect(result.roleAsset.status).toBe(404);
    }

    await second.close();
    await first.close();
    for (const preview of activePreviews) {
      await expect(fetch(preview.url)).rejects.toThrow();
      await expect(fetch(preview.apiUrl)).rejects.toThrow();
      await expect(
        readJson(join(preview.evidenceDirectory, "closed.json")),
      ).resolves.toMatchObject({ cleanupErrors: [] });
    }
  }, 60000);

  it("isolates concurrent replay and role assets, keeps B live after closing A and failed startup, then restores the original key", async () => {
    const originalKey = "preview-review-original-key";
    process.env.APP_SECRETS_MASTER_KEY = originalKey;
    const modelParams = {
      max_context_tokens: 32768,
      max_output_tokens: 256,
      temperature: 0.4,
      stream: true,
      reasoning_effort: "none" as const,
    };
    const firstTask = await createTask(
      {
        modelParams,
        offlineReplay: {
          steps: [
            {
              purpose: "narrator",
              model: "preview-a-narrator",
              text: "A 的独立回放正文。",
            },
            {
              purpose: "state_updater",
              model: "preview-a-updater",
              agentOutput: {
                changes: [{ op: "set", path: "/trust", value: 22 }],
                evidenceMessageIds: ["$sourceMessageId[1]"],
              },
            },
          ],
        },
      },
      { assetMarker: "PREVIEW_A_RESOURCE" },
    );
    const secondTask = await createTask(
      {
        modelParams,
        offlineReplay: {
          steps: [
            {
              purpose: "narrator",
              model: "preview-b-narrator",
              text: "B 的独立回放正文。",
            },
            {
              purpose: "state_updater",
              model: "preview-b-updater",
              agentOutput: {
                changes: [{ op: "set", path: "/trust", value: 23 }],
                evidenceMessageIds: ["$sourceMessageId[1]"],
              },
            },
          ],
        },
      },
      { assetMarker: "PREVIEW_B_RESOURCE" },
    );
    const started = await Promise.allSettled([
      startPreviewServer(firstTask),
      startPreviewServer(secondTask),
    ]);
    const activePreviews = started.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    previews.push(...activePreviews);
    expect(started.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(activePreviews).toHaveLength(2);
    const [first, second] = activePreviews;
    if (!first || !second) return;
    const firstReplayUrl = first.offlineReplayUrl;
    const secondReplayUrl = second.offlineReplayUrl;
    if (!firstReplayUrl || !secondReplayUrl) {
      throw new Error("Both concurrent previews must start offline replay.");
    }

    expect(Number(new URL(firstReplayUrl).port)).not.toBe(
      Number(new URL(secondReplayUrl).port),
    );
    const [firstReplayHealth, secondReplayHealth] = await Promise.all([
      fetch(new URL("/health", firstReplayUrl)),
      fetch(new URL("/health", secondReplayUrl)),
    ]);
    expect(firstReplayHealth.status).toBe(200);
    expect(secondReplayHealth.status).toBe(200);

    const [firstCover, secondCover] = await Promise.all([
      readPreviewCover(first),
      readPreviewCover(second),
    ]);
    expect(firstCover).toContain("PREVIEW_A_RESOURCE");
    expect(firstCover).not.toContain("PREVIEW_B_RESOURCE");
    expect(secondCover).toContain("PREVIEW_B_RESOURCE");
    expect(secondCover).not.toContain("PREVIEW_A_RESOURCE");

    expect(process.env.APP_SECRETS_MASTER_KEY).toBe(
      "native-maintenance-isolated-test-key",
    );
    const firstTurn = await requestPreviewTurn(first);
    expect(firstTurn.status).toBe(200);
    expect(firstTurn.contentType).toContain("text/event-stream");
    expect(
      parseSseEvents(firstTurn.body).find(({ event }) => event === "done")
        ?.data,
    ).toMatchObject({ generated_text: "A 的独立回放正文。" });

    await first.close();
    await expect(fetch(first.url)).rejects.toThrow();
    await expect(fetch(first.apiUrl)).rejects.toThrow();
    await expect(fetch(new URL("/health", firstReplayUrl))).rejects.toThrow();
    expect(process.env.APP_SECRETS_MASTER_KEY).toBe(
      "native-maintenance-isolated-test-key",
    );

    const failedTask = await createTask({
      offlineReplay: {
        steps: [
          {
            purpose: "narrator",
            model: "failed-preview-narrator",
            text: "不会被生成。",
          },
        ],
      },
    });
    await expect(
      startPreviewServer(failedTask, {
        startReplayFixture: async () => {
          throw new Error("injected replay startup failure");
        },
      }),
    ).rejects.toMatchObject({ stage: "offline_replay_start" });
    expect(process.env.APP_SECRETS_MASTER_KEY).toBe(
      "native-maintenance-isolated-test-key",
    );

    const secondCoverAfterFirstClose = await readPreviewCover(second);
    expect(secondCoverAfterFirstClose).toContain("PREVIEW_B_RESOURCE");
    const secondTurn = await requestPreviewTurn(second);
    expect(secondTurn.status).toBe(200);
    expect(secondTurn.contentType).toContain("text/event-stream");
    expect(
      parseSseEvents(secondTurn.body).find(({ event }) => event === "done")
        ?.data,
    ).toMatchObject({ generated_text: "B 的独立回放正文。" });
    expect(second.replaySnapshot()).toMatchObject({ callCount: 1 });

    await second.close();
    await expect(fetch(second.url)).rejects.toThrow();
    await expect(fetch(second.apiUrl)).rejects.toThrow();
    await expect(fetch(new URL("/health", secondReplayUrl))).rejects.toThrow();
    expect(process.env.APP_SECRETS_MASTER_KEY).toBe(originalKey);
  }, 60000);

  it("restores the original master key after reverse-order and parallel close", async () => {
    const originalKey = "preview-close-order-original-key";
    process.env.APP_SECRETS_MASTER_KEY = originalKey;
    const [firstTask, secondTask] = await Promise.all([
      createTask(),
      createTask(),
    ]);
    const started = await Promise.all([
      startPreviewServer(firstTask),
      startPreviewServer(secondTask),
    ]);
    previews.push(...started);
    expect(process.env.APP_SECRETS_MASTER_KEY).toBe(
      "native-maintenance-isolated-test-key",
    );

    await started[1]!.close();
    expect(process.env.APP_SECRETS_MASTER_KEY).toBe(
      "native-maintenance-isolated-test-key",
    );
    await started[0]!.close();
    expect(process.env.APP_SECRETS_MASTER_KEY).toBe(originalKey);

    const [thirdTask, fourthTask] = await Promise.all([
      createTask(),
      createTask(),
    ]);
    const parallel = await Promise.all([
      startPreviewServer(thirdTask),
      startPreviewServer(fourthTask),
    ]);
    previews.push(...parallel);
    await Promise.all(parallel.map((preview) => preview.close()));
    expect(process.env.APP_SECRETS_MASTER_KEY).toBe(originalKey);
  }, 60000);

  it("streams a formal turn, saves the assistant body, runs the state updater, and reads the updated formal role view", async () => {
    const assistantBody = "沈知夏点头道谢，将潮湿的信封递到周雨宁手边。";
    const taskDirectory = await createTask({
      modelParams: {
        max_context_tokens: 32768,
        max_output_tokens: 256,
        temperature: 0.4,
        stream: true,
        reasoning_effort: "none",
      },
      offlineReplay: {
        steps: [
          {
            purpose: "narrator",
            model: "stream-page-narrator",
            text: assistantBody,
          },
          {
            purpose: "state_updater",
            model: "stream-page-updater",
            agentOutput: {
              changes: [{ op: "set", path: "/trust", value: 21 }],
              evidenceMessageIds: ["$sourceMessageId[1]"],
            },
          },
        ],
      },
    });
    const preview = await startPreviewServer(taskDirectory);
    previews.push(preview);

    const exchanges: Array<Record<string, unknown>> = [];
    const sessionPath = `/sessions/${encodeURIComponent(preview.sessionId)}`;
    const streamRequest = {
      message: "【写作者元指令】请让沈知夏把红伞放在一个具体位置。",
      branch_id: "main",
      generation_params: { stream: true },
    };
    const streamResponse = await fetch(
      `${preview.apiUrl}${sessionPath}/respond/stream`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(streamRequest),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const streamText = await streamResponse.text();
    exchanges.push({
      method: "POST",
      url: `${sessionPath}/respond/stream`,
      request: streamRequest,
      statusCode: streamResponse.status,
      contentType: streamResponse.headers.get("content-type"),
      response: streamText,
    });
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );

    const streamEvents = parseSseEvents(streamText);
    const startEvent = streamEvents.find(({ event }) => event === "start");
    const doneEvent = streamEvents.find(({ event }) => event === "done");
    expect(startEvent?.data.floor_id).toEqual(expect.any(String));
    expect(doneEvent?.data).toMatchObject({
      floor_id: startEvent?.data.floor_id,
      generated_text: assistantBody,
      final_state: "committed",
    });

    const floorId = String(startEvent?.data.floor_id);
    const floorsUrl = `${preview.apiUrl}${sessionPath}/role-messages/floors?branch_id=main&limit=20`;
    const floorsResponse = await fetch(floorsUrl);
    const floorsBody = (await floorsResponse.json()) as {
      data?: { items?: Array<Record<string, unknown>> };
    };
    exchanges.push({
      method: "GET",
      url: `${sessionPath}/role-messages/floors?branch_id=main&limit=20`,
      statusCode: floorsResponse.status,
      response: floorsBody,
    });
    expect(floorsResponse.status).toBe(200);
    expect(floorsBody.data?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ floorId, state: "committed" }),
      ]),
    );

    const messagesPath = `${sessionPath}/role-messages?branch_id=main&floor_id=${encodeURIComponent(floorId)}`;
    const messagesResponse = await fetch(`${preview.apiUrl}${messagesPath}`);
    const messagesBody = (await messagesResponse.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    exchanges.push({
      method: "GET",
      url: messagesPath,
      statusCode: messagesResponse.status,
      response: messagesBody,
    });
    expect(messagesResponse.status).toBe(200);
    const assistantMessage = messagesBody.data?.find(
      (message) => message.role === "assistant",
    );
    expect(assistantMessage).toMatchObject({ content: assistantBody });
    expect(assistantMessage?.id).toEqual(expect.any(String));

    const updatePath = `${sessionPath}/role-state/updates`;
    const updateRequest = { floor_id: floorId };
    const updateResponse = await fetch(`${preview.apiUrl}${updatePath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updateRequest),
    });
    const updateBody = (await updateResponse.json()) as Record<string, unknown>;
    exchanges.push({
      method: "POST",
      url: updatePath,
      request: updateRequest,
      statusCode: updateResponse.status,
      response: updateBody,
    });
    expect(updateResponse.status).toBe(200);

    const roleViewPath = `${sessionPath}/role-view`;
    const roleViewResponse = await fetch(`${preview.apiUrl}${roleViewPath}`);
    const roleViewBody = (await roleViewResponse.json()) as {
      data?: {
        current?: {
          floorId?: string | null;
          variables?: Record<string, unknown>;
        };
      };
    };
    exchanges.push({
      method: "GET",
      url: roleViewPath,
      statusCode: roleViewResponse.status,
      response: roleViewBody,
    });
    expect(roleViewResponse.status).toBe(200);
    expect(roleViewBody.data?.current).toMatchObject({
      floorId,
      variables: { trust: 21 },
    });

    const replayEvents = (
      await readFile(
        join(
          String(preview.replaySnapshot()?.evidenceDirectory),
          "requests.jsonl",
        ),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const narratorReplay = replayEvents.find((event) => event.callNumber === 1);
    const updaterReplay = replayEvents.find((event) => event.callNumber === 2);
    expect(narratorReplay).toMatchObject({
      configuredPurpose: "narrator",
      outcome: "stream_success",
      responseStatus: 200,
    });
    expect(updaterReplay).toMatchObject({
      configuredPurpose: "state_updater",
      configuredModel: "stream-page-updater",
      responseStatus: 200,
    });
    const narratorRequest = narratorReplay?.requestBody as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const narratorPrompt = (narratorRequest.messages ?? [])
      .map((message) => String(message.content ?? ""))
      .join("\n");
    expect(narratorPrompt).toContain(narratorPresetMarker);
    expect(JSON.stringify(narratorRequest.messages)).not.toContain(
      statePresetMarker,
    );
    const updaterRequest = updaterReplay?.requestBody as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const updaterPrompt = (updaterRequest.messages ?? [])
      .map((message) => String(message.content ?? ""))
      .join("\n");
    expect(updaterPrompt).toContain(statePresetMarker);
    expect(updaterPrompt).not.toContain(narratorPresetMarker);
    const stateEvidenceMessages = (updaterRequest.messages ?? []).flatMap(
      (message) => {
        if (typeof message.content !== "string") return [];
        return message.content.split(/\n\n/).flatMap((block) => {
          const content = block.trim();
          if (!content.startsWith("{") || !content.endsWith("}")) return [];
          try {
            const parsed = JSON.parse(content) as Record<string, unknown>;
            return Array.isArray(parsed.sources) &&
              typeof parsed.sourceIdentity === "object" &&
              parsed.sourceIdentity !== null &&
              !Array.isArray(parsed.sourceIdentity)
              ? [parsed]
              : [];
          } catch {
            return [];
          }
        });
      },
    );
    expect(stateEvidenceMessages).toHaveLength(1);
    const updaterInput = stateEvidenceMessages[0] as {
      sources?: Array<Record<string, unknown>>;
      sourceIdentity?: Record<string, unknown>;
      toolEvidence?: unknown[];
      worldbookSelection?: unknown;
      priorFacts?: unknown[];
      consumedSources?: unknown[];
      agentResults?: unknown[];
    };
    expect(updaterInput).toHaveProperty("sourceIdentity");
    expect(updaterInput.sourceIdentity).toMatchObject({
      floorId: expect.any(String),
      branchId: expect.any(String),
      messages: expect.any(Array),
    });
    expect(updaterInput).toMatchObject({
      toolEvidence: expect.any(Array),
      priorFacts: expect.any(Array),
      consumedSources: expect.any(Array),
      agentResults: expect.any(Array),
    });
    expect(Object.hasOwn(updaterInput, "worldbookSelection")).toBe(true);
    expect(updaterInput.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: assistantMessage?.id,
          role: "assistant",
          text: assistantBody,
        }),
      ]),
    );
    const requestRecords = JSON.parse(
      await readFile(join(preview.evidenceDirectory, "requests.json"), "utf8"),
    ) as Array<{
      url: string;
      request?: { configuration?: Record<string, unknown> };
    }>;
    const previewRequest = requestRecords.find((record) =>
      /\/native-cards\/[^/]+\/preview-sessions$/.test(record.url),
    );
    const previewConfiguration = previewRequest?.request?.configuration;
    expect(previewConfiguration).toMatchObject({
      statePresetId: expect.any(String),
      statePresetVersionId: expect.any(String),
    });
    expect(previewConfiguration?.statePresetId).not.toBe(
      previewConfiguration?.presetId,
    );
    expect(previewConfiguration?.statePresetVersionId).not.toBe(
      previewConfiguration?.presetVersionId,
    );
    const page = await readJson(join(preview.evidenceDirectory, "page.json"));
    expect(page.statePreset).toMatchObject({
      name: "独立状态更新预设",
      id: previewConfiguration?.statePresetId,
      versionId: previewConfiguration?.statePresetVersionId,
    });
    expect(preview.replaySnapshot()).toMatchObject({
      host: "127.0.0.1",
      callCount: 2,
      stepsConsumed: 2,
      streamedResponses: expect.any(Number),
      requestErrors: 0,
      modelMismatches: 0,
      unexpectedCalls: 0,
    });
    await writeFile(
      join(preview.evidenceDirectory, "stream-state-flow.json"),
      `${JSON.stringify(
        {
          sessionId: preview.sessionId,
          floorId,
          assistantMessage,
          exchanges,
          replaySnapshot: preview.replaySnapshot(),
          narratorReplay,
          updaterReplay,
          roleView: roleViewBody,
        },
        null,
        2,
      )}\n`,
    );
    await preview.close();
    const browserRequests = (
      await readFile(
        join(preview.evidenceDirectory, "browser-requests.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(browserRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "api",
          method: "POST",
          path: `${sessionPath}/respond/stream`,
          request: streamRequest,
          statusCode: 200,
          response: expect.stringContaining("event: done"),
        }),
        expect.objectContaining({
          source: "api",
          method: "POST",
          path: updatePath,
          request: updateRequest,
          statusCode: 200,
        }),
        expect.objectContaining({
          source: "api",
          method: "GET",
          path: roleViewPath,
          statusCode: 200,
          response: expect.objectContaining({
            data: expect.objectContaining({
              current: expect.objectContaining({
                variables: expect.objectContaining({ trust: 21 }),
              }),
            }),
          }),
        }),
      ]),
    );
  }, 30000);

  it("records the actual import error and aborts before creating the preview page", async () => {
    const taskDirectory = await mkdtemp(
      join(tmpdir(), "native-page-preview-invalid-"),
    );
    taskDirectories.push(taskDirectory);
    const submittedZip = Buffer.from("not a zip archive");
    await writeFile(join(taskDirectory, "role.zip"), submittedZip);
    await writePreviewInput(taskDirectory);

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "import_inspect",
    });
    const replacementZip = Buffer.from("repaired after failed import");
    await writeFile(join(taskDirectory, "role.zip"), replacementZip);
    const runDirectory = join(taskDirectory, "preview-runs");
    const runNames = await readdir(runDirectory);
    expect(runNames).toHaveLength(1);
    const evidenceDirectory = join(runDirectory, runNames[0]!);
    const failure = await readJson(join(evidenceDirectory, "failure.json"));
    expect(failure.stage).toBe("import_inspect");
    expect(String(failure.message)).toMatch(/HTTP \d{3}/);
    const requests = JSON.parse(
      await readFile(join(evidenceDirectory, "requests.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: expect.stringMatching(/^\/native-cards\/imports\?/),
      request: null,
      headers: { "content-type": "application/zip" },
      bodyReference: "request-bodies/000.bin",
      bodyByteLength: submittedZip.byteLength,
      statusCode: expect.any(Number),
      response: expect.anything(),
    });
    expect(requests[0]?.statusCode).toBeGreaterThanOrEqual(400);
    expect(requests[0]?.statusCode).toBeLessThan(500);
    expect(
      await readFile(join(evidenceDirectory, "request-bodies", "000.bin")),
    ).toEqual(submittedZip);
    expect(await readFile(join(taskDirectory, "role.zip"))).toEqual(
      replacementZip,
    );
    const httpResults = (
      await readFile(join(evidenceDirectory, "http-results.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(httpResults[0]).toMatchObject({
      headers: { "content-type": "application/zip" },
      bodyReference: "request-bodies/000.bin",
      bodyByteLength: submittedZip.byteLength,
    });
    await expect(
      readFile(join(evidenceDirectory, "page.json")),
    ).rejects.toThrow();
  });

  it("marks generation as unavailable when the scenario supplies no offline response fixture", async () => {
    const taskDirectory = await createTask();
    const preview = await startPreviewServer(taskDirectory);
    previews.push(preview);

    expect(preview.generationMode).toBe("unavailable");
    expect(preview.offlineReplayUrl).toBeUndefined();
    expect(
      await readJson(join(preview.evidenceDirectory, "page.json")),
    ).toMatchObject({
      generationMode: "unavailable",
      boundHost: "127.0.0.1",
    });
    await preview.close();
  }, 30000);

  it("preserves the formal missing-state-preset error when no independent preset is supplied", async () => {
    const taskDirectory = await createTask();
    const scenario = await readJson(join(taskDirectory, "preview.json"));
    delete scenario.statePreset;
    await writeFile(
      join(taskDirectory, "preview.json"),
      JSON.stringify(scenario),
    );

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "preview_session_create",
    });
    const runDirectory = join(taskDirectory, "preview-runs");
    const runNames = await readdir(runDirectory);
    const evidenceDirectory = join(runDirectory, runNames[0]!);
    const requests = JSON.parse(
      await readFile(join(evidenceDirectory, "requests.json"), "utf8"),
    ) as Array<{
      url: string;
      request?: { configuration?: Record<string, unknown> };
      response?: { error?: { code?: string } };
    }>;
    const previewRequest = requests.find((request) =>
      /\/native-cards\/[^/]+\/preview-sessions$/.test(request.url),
    );
    expect(previewRequest?.request?.configuration).not.toHaveProperty(
      "statePresetId",
    );
    expect(previewRequest?.request?.configuration).not.toHaveProperty(
      "statePresetVersionId",
    );
    expect(previewRequest?.response?.error?.code).toBe(
      "ROLE_STATE_PRESET_MISSING",
    );
    expect(
      await readJson(join(evidenceDirectory, "failure.json")),
    ).toMatchObject({ stage: "preview_session_create" });
  });

  it("rejects incomplete persona input before starting storage or listeners and saves the validation error", async () => {
    const taskDirectory = await createTask();
    const invalid = {
      version: 1,
      persona: { name: "缺少描述" },
      preset: { name: "测试预设", data: {} },
      sessionType: "individual",
      testMessages: [{ id: "one", message: "请继续。" }],
    };
    await writeFile(
      join(taskDirectory, "preview.json"),
      JSON.stringify(invalid),
    );

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "read_inputs",
      message: expect.stringContaining("预览配置"),
    });
    const runDirectory = join(taskDirectory, "preview-runs");
    const runNames = await readdir(runDirectory);
    const evidenceDirectory = join(runDirectory, runNames[0]!);
    expect(
      await readJson(join(evidenceDirectory, "failure.json")),
    ).toMatchObject({
      stage: "read_inputs",
    });
    await expect(
      readFile(join(evidenceDirectory, "requests.json")),
    ).rejects.toThrow();
    await expect(
      readFile(join(evidenceDirectory, "storage")),
    ).rejects.toThrow();
  });

  it("rejects a blank persona description before starting storage or listeners", async () => {
    const taskDirectory = await createTask();
    const scenario = await readJson(join(taskDirectory, "preview.json"));
    (scenario.persona as { description: string }).description = "";
    await writeFile(
      join(taskDirectory, "preview.json"),
      JSON.stringify(scenario),
    );

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "read_inputs",
      message: expect.stringContaining("预览配置"),
    });
    const runDirectory = join(taskDirectory, "preview-runs");
    const runNames = await readdir(runDirectory);
    const evidenceDirectory = join(runDirectory, runNames[0]!);
    expect(
      await readJson(join(evidenceDirectory, "failure.json")),
    ).toMatchObject({ stage: "read_inputs" });
    await expect(
      readFile(join(evidenceDirectory, "requests.json")),
    ).rejects.toThrow();
    await expect(
      readFile(join(evidenceDirectory, "storage")),
    ).rejects.toThrow();
  });

  it("rejects an invalid model capability grant with the shared schema before creating storage or sending requests", async () => {
    const taskDirectory = await createTask();
    const scenario = await readJson(join(taskDirectory, "preview.json"));
    scenario.modelCapabilities = {
      enabled: true,
      allowed: ["roll_dice"],
      slot: "narrator",
      transport: "text_protocol",
    };
    await writeFile(
      join(taskDirectory, "preview.json"),
      JSON.stringify(scenario),
    );

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "read_inputs",
      message: expect.stringMatching(/modelCapabilities.*allowed/s),
    });
    const runDirectory = join(taskDirectory, "preview-runs");
    const runNames = await readdir(runDirectory);
    const evidenceDirectory = join(runDirectory, runNames[0]!);
    expect(
      await readJson(join(evidenceDirectory, "failure.json")),
    ).toMatchObject({ stage: "read_inputs" });
    await expect(
      readFile(join(evidenceDirectory, "requests.json")),
    ).rejects.toThrow();
    await expect(
      readFile(join(evidenceDirectory, "storage")),
    ).rejects.toThrow();
  });

  it("preserves explicit null model capabilities in the formal preview request", async () => {
    const taskDirectory = await createTask({ modelCapabilities: null });
    const preview = await startPreviewServer(taskDirectory);
    previews.push(preview);
    const requests = JSON.parse(
      await readFile(join(preview.evidenceDirectory, "requests.json"), "utf8"),
    ) as Array<{ request?: { configuration?: Record<string, unknown> } }>;
    expect(requests[2]?.request?.configuration).toHaveProperty(
      "model_capabilities",
      null,
    );
  });

  it("rejects a blank test message before starting storage or listeners and saves the input error", async () => {
    const taskDirectory = await createTask();
    const scenario = await readJson(join(taskDirectory, "preview.json"));
    const testMessages = scenario.testMessages as Array<{
      message: string;
    }>;
    testMessages[0]!.message = "";
    await writeFile(
      join(taskDirectory, "preview.json"),
      JSON.stringify(scenario),
    );

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "read_inputs",
      message: expect.stringContaining("预览配置"),
    });
    const runDirectory = join(taskDirectory, "preview-runs");
    const runNames = await readdir(runDirectory);
    const evidenceDirectory = join(runDirectory, runNames[0]!);
    expect(
      await readJson(join(evidenceDirectory, "failure.json")),
    ).toMatchObject({ stage: "read_inputs" });
    await expect(
      readFile(join(evidenceDirectory, "requests.json")),
    ).rejects.toThrow();
    await expect(
      readFile(join(evidenceDirectory, "storage")),
    ).rejects.toThrow();
  });

  it("records the actual preview request when model capability limits exceed system policy", async () => {
    const grant: NonNullable<PreviewScenario["modelCapabilities"]> = {
      enabled: true,
      allowed: ["random"],
      slot: "narrator",
      transport: "text_protocol",
      limits: { maxCallsPerTurn: 17 },
    };
    const taskDirectory = await createTask({ modelCapabilities: grant });

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "preview_session_create",
      message: expect.stringMatching(/HTTP 4\d\d/),
    });
    const runDirectory = join(taskDirectory, "preview-runs");
    const runNames = await readdir(runDirectory);
    const evidenceDirectory = join(runDirectory, runNames[0]!);
    const requests = JSON.parse(
      await readFile(join(evidenceDirectory, "requests.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    const previewRequest = requests.at(-1);
    expect(previewRequest).toMatchObject({
      url: expect.stringMatching(/^\/native-cards\/[^/]+\/preview-sessions$/),
      request: { configuration: { model_capabilities: grant } },
      statusCode: expect.any(Number),
      response: { error: { code: expect.any(String) } },
    });
    expect(previewRequest?.statusCode).toBeGreaterThanOrEqual(400);
    expect(previewRequest?.statusCode).toBeLessThan(500);
    expect(
      await readJson(join(evidenceDirectory, "failure.json")),
    ).toMatchObject({ stage: "preview_session_create" });
  });

  it("rejects a role ZIP symlink that resolves outside the task directory", async () => {
    const taskDirectory = await mkdtemp(
      join(tmpdir(), "native-page-preview-boundary-"),
    );
    taskDirectories.push(taskDirectory);
    const outside = await mkdtemp(
      join(tmpdir(), "native-page-preview-outside-"),
    );
    outsideDirectories.push(outside);
    const externalZip = join(outside, "role.zip");
    await writeFile(externalZip, "not read from outside");
    await symlink(externalZip, join(taskDirectory, "role.zip"));
    await writePreviewInput(taskDirectory);

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "read_inputs",
      message: expect.stringContaining("预览需要普通 ZIP 文件"),
    });
  });

  it("rejects a preview-runs symlink before writing any evidence outside the task directory", async () => {
    const taskDirectory = await createTask();
    const outsideDirectory = await mkdtemp(
      join(tmpdir(), "native-page-preview-evidence-outside-"),
    );
    outsideDirectories.push(outsideDirectory);
    const previewRunsPath = join(taskDirectory, "preview-runs");
    await symlink(outsideDirectory, previewRunsPath, "dir");

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "read_inputs",
      message: expect.stringContaining("预览证据目录不能是符号链接"),
    });
    expect(await readdir(outsideDirectory)).toEqual([]);
    expect((await lstat(previewRunsPath)).isSymbolicLink()).toBe(true);
  });

  it("rejects a regular file blocking preview-runs without changing its bytes", async () => {
    const taskDirectory = await createTask();
    const previewRunsPath = join(taskDirectory, "preview-runs");
    const originalBytes = Buffer.from("preserve preview evidence blocker\n");
    await writeFile(previewRunsPath, originalBytes);

    await expect(startPreviewServer(taskDirectory)).rejects.toMatchObject({
      stage: "read_inputs",
      message: expect.stringContaining("预览证据路径必须指向目录"),
    });
    expect(await readFile(previewRunsPath)).toEqual(originalBytes);
  });
});
