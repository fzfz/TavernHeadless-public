import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  withTestResources,
  testResources,
  testRuntime,
} from "./test-resources.ts";

import type * as apiApp from "../../../../apps/api/src/app.js";
import type { TestResources } from "./test-resources.ts";
import { writeNativeCardZip } from "../../../../apps/api/src/services/native-card/zip.js";
import { verifyFormalPackage as verifyPackage } from "./formal.js";

const verifyFormalPackage = (...args: Parameters<typeof verifyPackage>) =>
  testResources().measure("api:import-and-readback", () =>
    verifyPackage(...args),
  );
import { formatToolMessage, toolMessages } from "./tool-config.ts";

type RequestRecord = {
  method: "POST" | "GET";
  path: string;
  headers: Record<string, string>;
  bodyReference?: string;
  bodyByteLength?: number;
  statusCode: number | null;
  response?: unknown;
  transportError?: string;
};

type VerificationResult = {
  passed: boolean;
  status: "passed" | "failed";
  evidenceDirectory: string;
  readbackPath: string;
  importedCardId: string | null;
  requests: RequestRecord[];
  diagnostics: Array<{ stage: string; message: string; details?: unknown }>;
  zipRead: { status: string };
  schemaValidation: { status: string };
};

type ReadbackResult = {
  status: string;
  reason?: string;
  files: Array<{
    path: string;
    requestPath?: string;
    requestIndex?: number;
    statusCode?: number | null;
    encoding?: string;
    equal?: boolean;
    diagnostic?: string;
  }>;
};

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "native-card-formal-"));
  testResources().addDirectory(root);
  return root;
}

async function readFixture(): Promise<Record<string, string>> {
  return JSON.parse(
    await readFile(
      new URL(
        "../../../../apps/api/test/fixtures/native-card/harbor.files.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

async function writePackage(
  path: string,
  files: Record<string, string | Uint8Array>,
): Promise<void> {
  const archive = writeNativeCardZip(
    Object.entries(files).map(([filePath, content]) => ({
      path: filePath,
      content: Buffer.from(content),
    })),
  );
  await writeFile(path, archive);
}

type InjectRequest = { method?: string; url?: string };
type InjectResponse = { statusCode: number; body: string };
type ResponseOverride = { statusCode: number; body: string };
type RequestFault = (
  request: InjectRequest,
  response: InjectResponse,
) => ResponseOverride | undefined | Promise<ResponseOverride | undefined>;

const requestFaults = new WeakMap<TestResources, RequestFault>();

vi.mock("../../../../apps/api/src/app.js", async (importOriginal) => {
  const actual = await importOriginal<typeof apiApp>();
  return {
    ...actual,
    buildApp: async (...args: Parameters<typeof actual.buildApp>) => {
      const fault = requestFaults.get(testResources());
      const built = await actual.buildApp(...args);
      if (fault) {
        const originalInject = built.app.inject.bind(built.app);
        built.app.inject = (async (input: unknown) => {
          const response = (await originalInject(
            input as never,
          )) as InjectResponse;
          const override = await fault(input as InjectRequest, response);
          return override ? { ...response, ...override } : response;
        }) as typeof built.app.inject;
      }
      return built;
    },
  };
});

function installRequestFault(fault: RequestFault): void {
  requestFaults.set(testResources(), fault);
}

describe("verifyFormalPackage", () => {
  it(
    "imports through the formal API and compares every saved file byte-for-byte",
    withTestResources(async () => {
      const root = await createRoot();
      const packageFiles: Record<string, string | Uint8Array> =
        await readFixture();
      const manifest = JSON.parse(String(packageFiles["manifest.json"])) as {
        files: Array<{ path: string; mediaType: string; purpose: string }>;
      };
      manifest.files.push({
        path: "assets/badge.png",
        mediaType: "image/png",
        purpose: "media",
      });
      packageFiles["manifest.json"] = JSON.stringify(manifest, null, 2);
      packageFiles["assets/badge.png"] = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j86kAAAAASUVORK5CYII=",
        "base64",
      );
      const zipPath = join(root, "role.zip");
      const evidenceDirectory = join(root, "evidence");
      await writePackage(zipPath, packageFiles);
      const submittedZip = await readFile(zipPath);

      const result = (await verifyFormalPackage(
        zipPath,
        evidenceDirectory,
      )) as VerificationResult;
      const formal = JSON.parse(
        await readFile(join(result.evidenceDirectory, "formal.json"), "utf8"),
      ) as VerificationResult;
      const readback = JSON.parse(
        await readFile(result.readbackPath, "utf8"),
      ) as ReadbackResult;

      expect(result.status).toBe("passed");
      expect(result.passed).toBe(true);
      expect(result.importedCardId).toEqual(expect.any(String));
      expect(formal.requests.slice(0, 2)).toMatchObject([
        {
          method: "POST",
          path: "/native-cards/imports?fileName=role.zip",
          statusCode: 200,
        },
        {
          method: "POST",
          path: expect.stringMatching(
            /^\/native-cards\/imports\/[^/]+\/confirm$/,
          ),
          statusCode: 201,
        },
      ]);
      expect(formal.requests).toHaveLength(
        Object.keys(packageFiles).length + 2,
      );
      const zipRequest = formal.requests[0];
      expect(zipRequest).toMatchObject({
        method: "POST",
        path: "/native-cards/imports?fileName=role.zip",
        headers: { "content-type": "application/zip" },
        bodyByteLength: submittedZip.byteLength,
        bodyReference: "request-bodies/000.bin",
      });
      expect(
        await readFile(
          join(result.evidenceDirectory, zipRequest!.bodyReference!),
        ),
      ).toEqual(submittedZip);
      expect(result.requests[0]).toMatchObject({
        headers: { "content-type": "application/zip" },
        bodyByteLength: submittedZip.byteLength,
        bodyReference: zipRequest!.bodyReference,
      });
      expect(readback.status).toBe("passed");
      expect(readback).not.toHaveProperty("reason");
      expect(readback.files).toHaveLength(Object.keys(packageFiles).length);
      expect(readback.files.every((file) => file.equal === true)).toBe(true);
      expect(
        readback.files.find((file) => file.path === "assets/badge.png"),
      ).toMatchObject({
        statusCode: 200,
        encoding: "base64",
        equal: true,
      });
      expect(
        readback.files.find((file) => file.path === "manifest.json")
          ?.requestPath,
      ).toContain("path=manifest.json");
      await writeFile(zipPath, Buffer.from("later role.zip version"));
      expect(
        await readFile(
          join(result.evidenceDirectory, zipRequest!.bodyReference!),
        ),
      ).toEqual(submittedZip);
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "saves API and shared-schema diagnostics when package validation fails",
    withTestResources(async () => {
      const root = await createRoot();
      const packageFiles = await readFixture();
      packageFiles["character.json"] = JSON.stringify({ name: 42 });
      const zipPath = join(root, "invalid-character.zip");
      const evidenceDirectory = join(root, "evidence");
      await writePackage(zipPath, packageFiles);

      const result = (await verifyFormalPackage(
        zipPath,
        evidenceDirectory,
      )) as VerificationResult;
      const formal = JSON.parse(
        await readFile(join(result.evidenceDirectory, "formal.json"), "utf8"),
      ) as VerificationResult;
      const readback = JSON.parse(
        await readFile(result.readbackPath, "utf8"),
      ) as ReadbackResult;

      expect(result.status).toBe("failed");
      expect(result.passed).toBe(false);
      expect(result.importedCardId).toBeNull();
      expect(result.schemaValidation.status).toBe("failed");
      expect(result.requests).toHaveLength(1);
      expect(result.requests[0]).toMatchObject({
        path: "/native-cards/imports?fileName=invalid-character.zip",
        statusCode: 200,
      });
      expect(
        result.diagnostics.some((item) => item.stage === "schema_validation"),
      ).toBe(true);
      expect(formal.requests[0]?.response).toMatchObject({
        data: { status: "invalid" },
      });
      expect(readback.status).toBe("not_attempted");
      expect(readback.files).toHaveLength(Object.keys(packageFiles).length);
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "records ZIP reader and API errors for an invalid archive",
    withTestResources(async () => {
      const root = await createRoot();
      const zipPath = join(root, "broken.zip");
      const evidenceDirectory = join(root, "evidence");
      const submittedZip = Buffer.from("not a zip archive");
      await writeFile(zipPath, submittedZip);

      const result = (await verifyFormalPackage(
        zipPath,
        evidenceDirectory,
      )) as VerificationResult;
      const formal = JSON.parse(
        await readFile(join(result.evidenceDirectory, "formal.json"), "utf8"),
      ) as VerificationResult;
      const readback = JSON.parse(
        await readFile(result.readbackPath, "utf8"),
      ) as ReadbackResult;

      expect(result.status).toBe("failed");
      expect(result.passed).toBe(false);
      expect(result.zipRead.status).toBe("failed");
      expect(result.requests[0]).toMatchObject({
        path: "/native-cards/imports?fileName=broken.zip",
        statusCode: 400,
      });
      expect(result.diagnostics.some((item) => item.stage === "zip_read")).toBe(
        true,
      );
      expect(formal.requests[0]?.response).toMatchObject({
        error: { code: "NATIVE_CARD_ZIP_INVALID" },
      });
      expect(formal.requests[0]).toMatchObject({
        headers: { "content-type": "application/zip" },
        bodyByteLength: submittedZip.byteLength,
        bodyReference: "request-bodies/000.bin",
      });
      expect(
        await readFile(
          join(result.evidenceDirectory, formal.requests[0]!.bodyReference!),
        ),
      ).toEqual(submittedZip);
      expect(readback.status).toBe("not_started");
      await writeFile(zipPath, Buffer.from("repaired input"));
      expect(
        await readFile(
          join(result.evidenceDirectory, formal.requests[0]!.bodyReference!),
        ),
      ).toEqual(submittedZip);
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "rejects a linked formal evidence directory without writing to its target",
    withTestResources(async () => {
      const root = await createRoot();
      const external = await createRoot();
      const zipPath = join(root, "role.zip");
      const evidenceDirectory = join(root, "formal");
      await writePackage(zipPath, await readFixture());
      await symlink(external, evidenceDirectory, "dir");

      await expect(
        verifyFormalPackage(zipPath, evidenceDirectory),
      ).rejects.toThrow("正式校验证据路径必须指向普通目录");
      expect(await readdir(external)).toEqual([]);
      expect(await readdir(root)).toContain("formal");
      expect(await readdir(root)).not.toContain("formal-runs");
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "rejects linked and file-blocked formal-runs paths without external writes",
    withTestResources(async () => {
      const linkedRoot = await createRoot();
      const linkedExternal = await createRoot();
      const linkedZip = join(linkedRoot, "role.zip");
      const linkedEvidence = join(linkedRoot, "formal");
      await writePackage(linkedZip, await readFixture());
      await mkdir(linkedEvidence);
      await symlink(linkedExternal, join(linkedEvidence, "formal-runs"), "dir");

      await expect(
        verifyFormalPackage(linkedZip, linkedEvidence),
      ).rejects.toThrow("正式校验证据路径必须指向普通目录");
      expect(await readdir(linkedExternal)).toEqual([]);

      const evidenceBlockedRoot = await createRoot();
      const evidenceBlockedZip = join(evidenceBlockedRoot, "role.zip");
      const evidenceBlockedPath = join(evidenceBlockedRoot, "formal");
      await writePackage(evidenceBlockedZip, await readFixture());
      await writeFile(evidenceBlockedPath, "keep this evidence blocker");

      await expect(
        verifyFormalPackage(evidenceBlockedZip, evidenceBlockedPath),
      ).rejects.toThrow("正式校验证据路径必须指向普通目录");
      expect(await readFile(evidenceBlockedPath, "utf8")).toBe(
        "keep this evidence blocker",
      );
      expect(await readdir(evidenceBlockedRoot)).toContain("role.zip");

      const blockedRoot = await createRoot();
      const blockedZip = join(blockedRoot, "role.zip");
      const blockedEvidence = join(blockedRoot, "formal");
      const blockedRuns = join(blockedEvidence, "formal-runs");
      await writePackage(blockedZip, await readFixture());
      await mkdir(blockedEvidence);
      await writeFile(blockedRuns, "keep this blocker");

      await expect(
        verifyFormalPackage(blockedZip, blockedEvidence),
      ).rejects.toThrow("正式校验证据路径必须指向普通目录");
      expect(await readFile(blockedRuns, "utf8")).toBe("keep this blocker");
      expect(await readdir(blockedEvidence)).toEqual(["formal-runs"]);
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "rejects non-file and symlink-ancestor ZIP inputs before creating evidence",
    withTestResources(async () => {
      const root = await createRoot();
      const external = await createRoot();
      const evidenceDirectory = join(root, "formal");
      const externalZip = join(external, "role.zip");
      const submittedZip = writeNativeCardZip(
        Object.entries(await readFixture()).map(([path, content]) => ({
          path,
          content: Buffer.from(content),
        })),
      );
      await writeFile(externalZip, submittedZip);
      const linkedDirectory = join(root, "linked-input");
      await symlink(external, linkedDirectory, "dir");

      await expect(
        verifyFormalPackage(
          join(linkedDirectory, "role.zip"),
          evidenceDirectory,
        ),
      ).rejects.toThrow("正式校验的 ZIP 解析到了任务目录之外");
      expect(await readdir(root)).toEqual(["linked-input"]);
      expect(await readFile(externalZip)).toEqual(submittedZip);
      expect(await readdir(external)).toEqual(["role.zip"]);

      const fileBlockedRoot = await createRoot();
      const directoryInput = join(fileBlockedRoot, "role.zip");
      await mkdir(directoryInput);
      await expect(
        verifyFormalPackage(directoryInput, join(fileBlockedRoot, "formal")),
      ).rejects.toThrow("正式校验的 ZIP 必须指向普通文件");
      expect(await readdir(fileBlockedRoot)).toEqual(["role.zip"]);
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "preserves the confirmation response and does not attempt readback after confirmation fails",
    withTestResources(async () => {
      const root = await createRoot();
      const packageFiles = await readFixture();
      const zipPath = join(root, "confirm-failure.zip");
      const evidenceDirectory = join(root, "evidence");
      await writePackage(zipPath, packageFiles);
      installRequestFault((request) => {
        if (request.method !== "POST" || !request.url?.endsWith("/confirm")) {
          return undefined;
        }
        return {
          statusCode: 503,
          body: JSON.stringify({
            error: {
              code: "TEST_CONFIRM_UNAVAILABLE",
              message: "The injected confirmation failure is recorded.",
            },
          }),
        };
      });

      const result = (await verifyFormalPackage(
        zipPath,
        evidenceDirectory,
      )) as VerificationResult;
      const formal = JSON.parse(
        await readFile(join(result.evidenceDirectory, "formal.json"), "utf8"),
      ) as { requests: RequestRecord[] };
      const readback = JSON.parse(
        await readFile(result.readbackPath, "utf8"),
      ) as ReadbackResult;
      const confirmRequest = formal.requests.find((request) =>
        request.path.endsWith("/confirm"),
      );

      expect(result.passed).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.importedCardId).toBeNull();
      expect(confirmRequest).toMatchObject({
        statusCode: 503,
        response: {
          error: { code: "TEST_CONFIRM_UNAVAILABLE" },
        },
      });
      expect(
        result.diagnostics.find((diagnostic) => diagnostic.stage === "confirm")
          ?.details,
      ).toMatchObject({
        error: { code: "TEST_CONFIRM_UNAVAILABLE" },
      });
      expect(readback.status).toBe("not_attempted");
      expect(readback.reason).toBe(toolMessages.formal.importNotConfirmed);
      expect(formal.requests).toHaveLength(2);
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "marks mismatched saved bytes as failed and records the changed GET response",
    withTestResources(async () => {
      const root = await createRoot();
      const packageFiles = await readFixture();
      const zipPath = join(root, "readback-mismatch.zip");
      const evidenceDirectory = join(root, "evidence");
      await writePackage(zipPath, packageFiles);
      let changedFirstReadback = false;
      installRequestFault((request, response) => {
        if (request.method !== "GET" || changedFirstReadback) return undefined;
        changedFirstReadback = true;
        const body = JSON.parse(response.body) as {
          data: { content: string; encoding: "utf8" | "base64" };
        };
        body.data.content =
          body.data.encoding === "utf8"
            ? `${body.data.content}\u0000injected-mismatch`
            : Buffer.from(
                Buffer.from(body.data.content, "base64").map(
                  (byte) => byte ^ 1,
                ),
              ).toString("base64");
        return { statusCode: response.statusCode, body: JSON.stringify(body) };
      });

      const result = (await verifyFormalPackage(
        zipPath,
        evidenceDirectory,
      )) as VerificationResult;
      const formal = JSON.parse(
        await readFile(join(result.evidenceDirectory, "formal.json"), "utf8"),
      ) as { requests: RequestRecord[] };
      const readback = JSON.parse(
        await readFile(result.readbackPath, "utf8"),
      ) as ReadbackResult;
      const firstReadback = readback.files[0];
      const capturedResponse =
        formal.requests[firstReadback?.requestIndex ?? -1];

      expect(result.passed).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.importedCardId).toEqual(expect.any(String));
      expect(changedFirstReadback).toBe(true);
      expect(readback.status).toBe("failed");
      expect(
        readback.files.filter((file) => file.equal === false),
      ).toHaveLength(1);
      expect(firstReadback).toMatchObject({
        statusCode: 200,
        equal: false,
        diagnostic: formatToolMessage(toolMessages.formal.fileBytesDiffer, {
          path: "agents/state-update/profile.json",
        }),
      });
      expect(capturedResponse?.response).toMatchObject({
        data: { content: expect.stringContaining("injected-mismatch") },
      });
      expect(
        result.diagnostics.find((diagnostic) => diagnostic.stage === "readback")
          ?.details,
      ).toMatchObject({ path: firstReadback?.path });
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "continues file checks when the readback endpoint returns an error",
    withTestResources(async () => {
      const root = await createRoot();
      const packageFiles = await readFixture();
      const zipPath = join(root, "readback-unavailable.zip");
      const evidenceDirectory = join(root, "evidence");
      await writePackage(zipPath, packageFiles);
      let failedFirstReadback = false;
      installRequestFault((request) => {
        if (request.method !== "GET" || failedFirstReadback) return undefined;
        failedFirstReadback = true;
        return {
          statusCode: 503,
          body: JSON.stringify({
            error: {
              code: "TEST_READBACK_UNAVAILABLE",
              message: "The injected file-read failure is recorded.",
            },
          }),
        };
      });

      const result = (await verifyFormalPackage(
        zipPath,
        evidenceDirectory,
      )) as VerificationResult;
      const formal = JSON.parse(
        await readFile(join(result.evidenceDirectory, "formal.json"), "utf8"),
      ) as { requests: RequestRecord[] };
      const readback = JSON.parse(
        await readFile(result.readbackPath, "utf8"),
      ) as ReadbackResult;
      const failedRequest = formal.requests.find(
        (request) => request.statusCode === 503,
      );
      const failedDiagnostic = result.diagnostics.find(
        (diagnostic) => diagnostic.stage === "readback",
      );

      expect(result.passed).toBe(false);
      expect(result.status).toBe("failed");
      expect(failedFirstReadback).toBe(true);
      expect(readback.status).toBe("failed");
      expect(readback.files).toHaveLength(Object.keys(packageFiles).length);
      expect(
        readback.files.filter((file) => file.equal === false),
      ).toHaveLength(1);
      expect(failedRequest).toMatchObject({
        method: "GET",
        statusCode: 503,
        response: {
          error: { code: "TEST_READBACK_UNAVAILABLE" },
        },
      });
      expect(failedDiagnostic?.details).toMatchObject({
        response: { error: { code: "TEST_READBACK_UNAVAILABLE" } },
      });
    }),
    testRuntime.integrationTimeoutMs,
  );

  it(
    "returns the confirmation response when saving formal evidence fails",
    withTestResources(async () => {
      const root = await createRoot();
      const packageFiles = await readFixture();
      const zipPath = join(root, "evidence-write-failure.zip");
      const evidenceDirectory = join(root, "evidence");
      await writePackage(zipPath, packageFiles);
      installRequestFault(async (request) => {
        if (request.method !== "POST" || !request.url?.endsWith("/confirm")) {
          return undefined;
        }
        const runEntries = await readdir(
          join(evidenceDirectory, "formal-runs"),
          {
            withFileTypes: true,
          },
        );
        const runDirectory = join(
          evidenceDirectory,
          "formal-runs",
          runEntries.find((entry) => entry.isDirectory())!.name,
        );
        await mkdir(join(runDirectory, "formal.json"));
        return {
          statusCode: 503,
          body: JSON.stringify({
            error: {
              code: "TEST_CONFIRM_BEFORE_EVIDENCE_FAILURE",
              message:
                "The response must remain available in the returned diagnostic.",
            },
          }),
        };
      });

      const result = (await verifyFormalPackage(
        zipPath,
        evidenceDirectory,
      )) as VerificationResult;
      const readback = JSON.parse(
        await readFile(result.readbackPath, "utf8"),
      ) as ReadbackResult;
      const confirmDiagnostic = result.diagnostics.find(
        (diagnostic) => diagnostic.stage === "confirm",
      );

      expect(result.passed).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.requests[1]).toMatchObject({
        statusCode: 503,
        path: expect.stringMatching(/\/confirm$/),
      });
      expect(confirmDiagnostic?.details).toMatchObject({
        error: { code: "TEST_CONFIRM_BEFORE_EVIDENCE_FAILURE" },
      });
      expect(
        result.diagnostics.some(
          (diagnostic) => diagnostic.stage === "evidence_write",
        ),
      ).toBe(true);
      expect(readback.status).toBe("not_attempted");
    }),
    testRuntime.integrationTimeoutMs,
  );
});

it(
  "isolates request faults while an earlier verification is still active",
  async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = withTestResources(async () => {
      const root = await createRoot();
      await writePackage(join(root, "role.zip"), await readFixture());
      installRequestFault(async () => {
        entered();
        await gate;
        return {
          statusCode: 503,
          body: JSON.stringify({ error: "first task fault" }),
        };
      });
      const result = (await verifyFormalPackage(
        join(root, "role.zip"),
        join(root, "evidence"),
      )) as VerificationResult;
      expect(result.passed).toBe(false);
    })();
    try {
      await reached;
      await withTestResources(async () => {
        const root = await createRoot();
        await writePackage(join(root, "role.zip"), await readFixture());
        const result = (await verifyFormalPackage(
          join(root, "role.zip"),
          join(root, "evidence"),
        )) as VerificationResult;
        expect(result.passed).toBe(true);
      })();
    } finally {
      release();
      await first;
    }
  },
  testRuntime.integrationTimeoutMs,
);
