import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import type { FastifyInstance } from "fastify";
import {
  nativeCardFileContentSchema,
  nativeCardImportSchema,
  nativeCardSchema,
  validateNativeCardPackage,
  type NativeCardPackageFile,
} from "../../../../packages/shared/src/index.js";

import { buildApp } from "../../../../apps/api/src/app.js";
import { createDatabase } from "../../../../apps/api/src/db/client.js";
import { migrateDatabase } from "../../../../apps/api/src/db/migrations.js";
import { loadStorageConfig } from "../../../../apps/api/src/storage-config.js";
import {
  readNativeCardZip,
  type NativeCardZipLimits,
} from "../../../../apps/api/src/services/native-card/zip.js";
import nativeCardLimits from "../../../../apps/api/config/native-card.json" with { type: "json" };
import { formatToolMessage, toolMessages } from "./tool-config.ts";

const messages = toolMessages.formal;

type RequestEvidence = {
  method: "POST" | "GET";
  path: string;
  headers: Record<string, string>;
  bodyReference?: string;
  bodyByteLength?: number;
  statusCode: number | null;
  response: unknown;
  transportError?: string;
};

type Diagnostic = {
  stage: string;
  message: string;
  details?: unknown;
};

type FormalEvidence = {
  version: 1;
  runId: string;
  sourceZipPath: string;
  startedAt: string;
  completedAt?: string;
  status: "passed" | "failed";
  evidenceDirectory: string;
  readbackPath: string;
  requests: RequestEvidence[];
  importedCardId: string | null;
  zipRead: {
    status: "not_started" | "passed" | "failed";
    fileCount?: number;
    error?: string;
  };
  schemaValidation: {
    status: "not_started" | "passed" | "failed";
    valid?: boolean;
    issues?: unknown[];
  };
  diagnostics: Diagnostic[];
};

type ReadbackEvidence = {
  status: "not_started" | "not_attempted" | "passed" | "failed";
  reason?: string;
  files: Array<{
    path: string;
    requestPath?: string;
    requestIndex?: number;
    statusCode?: number | null;
    expectedByteLength?: number;
    actualByteLength?: number;
    equal?: boolean;
    encoding?: "utf8" | "base64";
    diagnostic?: string;
  }>;
};

type InjectOptions =
  | {
      method: "POST";
      url: string;
      headers?: Record<string, string>;
      payload?: Uint8Array;
    }
  | { method: "GET"; url: string };

function isContained(root: string, path: string): boolean {
  const child = relative(root, path);
  return (
    child !== "" &&
    child !== ".." &&
    !child.startsWith(".." + sep) &&
    !child.startsWith(sep)
  );
}

async function lstatOptional(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function validateDirectoryPath(
  path: string,
  taskDirectory: string,
  allowMissing: boolean,
): Promise<boolean> {
  if (path !== taskDirectory && !isContained(taskDirectory, path))
    throw new Error(formatToolMessage(messages.evidenceEscape, { path }));
  const stat = await lstatOptional(path);
  if (!stat) {
    if (!allowMissing)
      throw new Error(formatToolMessage(messages.evidenceMissing, { path }));
    return false;
  }
  if (!stat.isDirectory())
    throw new Error(
      formatToolMessage(messages.evidenceDirectoryType, { path }),
    );
  const actualPath = await realpath(path);
  if (
    actualPath !== path ||
    (actualPath !== taskDirectory && !isContained(taskDirectory, actualPath))
  )
    throw new Error(
      formatToolMessage(messages.evidenceResolvesOutside, { path }),
    );
  return true;
}

async function ensureDirectory(
  path: string,
  taskDirectory: string,
): Promise<void> {
  const exists = await validateDirectoryPath(path, taskDirectory, true);
  if (!exists) {
    try {
      await mkdir(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  await validateDirectoryPath(path, taskDirectory, false);
}

async function prepareFormalPaths(
  zipPath: string,
  evidenceDirectory: string,
  runId: string,
): Promise<{
  sourceZipPath: string;
  evidenceDirectory: string;
  runEvidenceDirectory: string;
  requestBodiesDirectory: string;
  zipBytes: Buffer;
}> {
  const requestedEvidenceDirectory = resolve(evidenceDirectory);
  const requestedTaskDirectory = dirname(requestedEvidenceDirectory);
  const taskDirectory = await realpath(requestedTaskDirectory);
  await validateDirectoryPath(taskDirectory, taskDirectory, false);

  const evidenceName = basename(requestedEvidenceDirectory);
  if (!evidenceName || evidenceName === "." || evidenceName === "..")
    throw new Error(messages.evidenceParent);
  const taskRelativeZipPath = relative(
    requestedTaskDirectory,
    resolve(zipPath),
  );
  if (
    taskRelativeZipPath === "" ||
    taskRelativeZipPath === ".." ||
    taskRelativeZipPath.startsWith(".." + sep) ||
    taskRelativeZipPath.startsWith(sep)
  )
    throw new Error(
      formatToolMessage(messages.zipInsideTask, { path: zipPath }),
    );

  const sourceZipPath = resolve(taskDirectory, taskRelativeZipPath);
  if (!isContained(taskDirectory, sourceZipPath))
    throw new Error(
      formatToolMessage(messages.zipInsideTask, { path: zipPath }),
    );
  const zipStat = await lstat(sourceZipPath);
  if (!zipStat.isFile())
    throw new Error(
      formatToolMessage(messages.zipRegularFile, { path: sourceZipPath }),
    );
  const actualZipPath = await realpath(sourceZipPath);
  if (
    actualZipPath !== sourceZipPath ||
    !isContained(taskDirectory, actualZipPath)
  )
    throw new Error(
      formatToolMessage(messages.zipResolvesOutside, { path: sourceZipPath }),
    );
  const zipBytes = await readFile(sourceZipPath);

  const resolvedEvidenceDirectory = join(taskDirectory, evidenceName);
  await validateDirectoryPath(resolvedEvidenceDirectory, taskDirectory, true);
  const formalRunsDirectory = join(resolvedEvidenceDirectory, "formal-runs");
  await validateDirectoryPath(formalRunsDirectory, taskDirectory, true);
  const runEvidenceDirectory = join(formalRunsDirectory, runId);
  const existingRun = await lstatOptional(runEvidenceDirectory);
  if (existingRun)
    throw new Error(
      formatToolMessage(messages.runAlreadyExists, {
        path: runEvidenceDirectory,
      }),
    );

  await ensureDirectory(resolvedEvidenceDirectory, taskDirectory);
  await ensureDirectory(formalRunsDirectory, taskDirectory);
  await mkdir(runEvidenceDirectory);
  await validateDirectoryPath(runEvidenceDirectory, taskDirectory, false);
  const requestBodiesDirectory = join(runEvidenceDirectory, "request-bodies");
  await mkdir(requestBodiesDirectory);
  await validateDirectoryPath(requestBodiesDirectory, taskDirectory, false);

  return {
    sourceZipPath,
    evidenceDirectory: resolvedEvidenceDirectory,
    runEvidenceDirectory,
    requestBodiesDirectory,
    zipBytes,
  };
}

function responseValue(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function responseData(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return undefined;
  }
  return value.data;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function addDiagnostic(
  evidence: FormalEvidence,
  stage: string,
  message: string,
  details?: unknown,
): void {
  evidence.diagnostics.push({
    stage,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

async function captureRequest(
  app: FastifyInstance,
  evidence: FormalEvidence,
  options: InjectOptions,
  requestBodiesDirectory: string,
): Promise<{ statusCode: number; response: unknown; requestIndex: number }> {
  const requestIndex = evidence.requests.length;
  const requestEvidence = {
    method: options.method,
    path: options.url,
    headers: options.method === "POST" ? { ...(options.headers ?? {}) } : {},
    ...(options.method === "POST" && options.payload !== undefined
      ? {
          bodyReference: join(
            "request-bodies",
            `${String(requestIndex).padStart(3, "0")}.bin`,
          ),
          bodyByteLength: options.payload.byteLength,
        }
      : {}),
  };
  if (options.method === "POST" && options.payload !== undefined) {
    const bodyPath = join(
      requestBodiesDirectory,
      `${String(requestIndex).padStart(3, "0")}.bin`,
    );
    if (!isContained(evidence.evidenceDirectory, bodyPath))
      throw new Error(
        formatToolMessage(messages.requestBodyEvidenceEscape, {
          path: bodyPath,
        }),
      );
    await writeFile(bodyPath, options.payload, { flag: "wx" });
  }
  try {
    const result = await app.inject(options);
    const response = responseValue(result.body);
    const requestIndex =
      evidence.requests.push({
        ...requestEvidence,
        statusCode: result.statusCode,
        response,
      }) - 1;
    return {
      statusCode: result.statusCode,
      response,
      requestIndex,
    };
  } catch (error) {
    evidence.requests.push({
      ...requestEvidence,
      statusCode: null,
      response: null,
      transportError: describeError(error),
    });
    throw error;
  }
}

function decodeReadback(
  value: unknown,
): { content: Buffer; encoding: "utf8" | "base64" } | undefined {
  const parsed = nativeCardFileContentSchema.safeParse(responseData(value));
  if (!parsed.success) return undefined;
  if (parsed.data.encoding === "utf8") {
    return {
      content: Buffer.from(parsed.data.content, "utf8"),
      encoding: "utf8",
    };
  }
  const content = Buffer.from(parsed.data.content, "base64");
  if (content.toString("base64") !== parsed.data.content) return undefined;
  return { content, encoding: "base64" };
}

function markReadbackNotAttempted(
  readback: ReadbackEvidence,
  files: readonly NativeCardPackageFile[],
  reason: string,
): void {
  readback.status = "not_attempted";
  readback.reason = reason;
  readback.files = files.map((file) => ({ path: file.path }));
}

/**
 * Imports a package through the formal API in isolated storage and verifies
 * every saved package file against the bytes in the submitted ZIP.
 */
export async function verifyFormalPackage(
  zipPath: string,
  evidenceDirectory: string,
): Promise<unknown> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const paths = await prepareFormalPaths(zipPath, evidenceDirectory, runId);
  const {
    sourceZipPath,
    runEvidenceDirectory,
    requestBodiesDirectory,
    zipBytes,
  } = paths;
  const evidence: FormalEvidence = {
    version: 1,
    runId,
    sourceZipPath,
    startedAt: new Date().toISOString(),
    status: "failed",
    evidenceDirectory: runEvidenceDirectory,
    readbackPath: join(runEvidenceDirectory, "readback.json"),
    requests: [],
    importedCardId: null,
    zipRead: { status: "not_started" },
    schemaValidation: { status: "not_started" },
    diagnostics: [],
  };
  const readback: ReadbackEvidence = { status: "not_started", files: [] };
  let app: FastifyInstance | undefined;
  let sourceFiles: NativeCardPackageFile[] = [];
  let stage = "app_start";

  try {
    stage = "app_start";
    const storage = loadStorageConfig({
      DATA_DIR: join(runEvidenceDirectory, "storage"),
    });
    const database = createDatabase(storage.databasePath);
    try {
      migrateDatabase(database);
    } finally {
      database.close();
    }
    const built = await buildApp({
      storage,
      databasePath: storage.databasePath,
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;

    const fileName = basename(evidence.sourceZipPath) || "package.zip";
    const inspectPath = `/native-cards/imports?fileName=${encodeURIComponent(fileName)}`;
    stage = "inspect";
    const inspection = await captureRequest(
      app,
      evidence,
      {
        method: "POST",
        url: inspectPath,
        headers: { "content-type": "application/zip" },
        payload: zipBytes,
      },
      requestBodiesDirectory,
    );

    stage = "zip_read";
    try {
      sourceFiles = readNativeCardZip(
        zipBytes,
        nativeCardLimits as NativeCardZipLimits,
      );
      evidence.zipRead = { status: "passed", fileCount: sourceFiles.length };
    } catch (error) {
      evidence.zipRead = { status: "failed", error: describeError(error) };
      addDiagnostic(
        evidence,
        "zip_read",
        messages.zipReadFailed,
        describeError(error),
      );
    }

    if (sourceFiles.length > 0) {
      stage = "schema_validation";
      const validation = validateNativeCardPackage(sourceFiles);
      evidence.schemaValidation = {
        status: validation.valid ? "passed" : "failed",
        valid: validation.valid,
        issues: validation.issues,
      };
      markReadbackNotAttempted(
        readback,
        sourceFiles,
        messages.importNotConfirmed,
      );
    }

    const inspectionData = nativeCardImportSchema.safeParse(
      responseData(inspection.response),
    );
    if (inspection.statusCode !== 200) {
      addDiagnostic(
        evidence,
        "inspect",
        formatToolMessage(messages.inspectHttp, {
          statusCode: inspection.statusCode,
        }),
        inspection.response,
      );
    } else if (!inspectionData.success) {
      addDiagnostic(
        evidence,
        "inspect",
        messages.inspectSchema,
        inspectionData.error.issues,
      );
    } else if (inspectionData.data.status !== "ready") {
      addDiagnostic(
        evidence,
        "schema_validation",
        formatToolMessage(messages.packageRejected, {
          count: inspectionData.data.issues.length,
        }),
        {
          apiIssues: inspectionData.data.issues,
          localIssues: evidence.schemaValidation.issues ?? [],
        },
      );
    } else if (evidence.zipRead.status !== "passed") {
      addDiagnostic(evidence, "zip_read", messages.apiReadyZipReadFailed);
    } else if (evidence.schemaValidation.valid !== true) {
      addDiagnostic(
        evidence,
        "schema_validation",
        messages.apiAcceptedSchemaRejected,
        evidence.schemaValidation.issues,
      );
    } else {
      stage = "confirm";
      const confirmPath = `/native-cards/imports/${encodeURIComponent(inspectionData.data.id)}/confirm`;
      const confirmation = await captureRequest(
        app,
        evidence,
        {
          method: "POST",
          url: confirmPath,
        },
        requestBodiesDirectory,
      );
      const card = nativeCardSchema.safeParse(
        responseData(confirmation.response),
      );
      if (confirmation.statusCode !== 201) {
        addDiagnostic(
          evidence,
          "confirm",
          formatToolMessage(messages.confirmHttp, {
            statusCode: confirmation.statusCode,
          }),
          confirmation.response,
        );
        markReadbackNotAttempted(
          readback,
          sourceFiles,
          messages.importNotConfirmed,
        );
      } else if (!card.success) {
        addDiagnostic(
          evidence,
          "confirm",
          messages.confirmSchema,
          card.error.issues,
        );
        markReadbackNotAttempted(
          readback,
          sourceFiles,
          messages.confirmCardMissing,
        );
      } else {
        evidence.importedCardId = card.data.id;
        delete readback.reason;
        readback.status = "passed";
        readback.files = [];
        for (const file of [...sourceFiles].sort((left, right) =>
          left.path.localeCompare(right.path),
        )) {
          const filePath = `/native-cards/${encodeURIComponent(card.data.id)}/file?path=${encodeURIComponent(file.path)}`;
          const item: ReadbackEvidence["files"][number] = {
            path: file.path,
            requestPath: filePath,
            expectedByteLength: file.content.byteLength,
          };
          readback.files.push(item);
          try {
            stage = `readback:${file.path}`;
            const result = await captureRequest(
              app,
              evidence,
              {
                method: "GET",
                url: filePath,
              },
              requestBodiesDirectory,
            );
            item.requestIndex = result.requestIndex;
            item.statusCode = result.statusCode;
            if (result.statusCode !== 200) {
              item.equal = false;
              item.diagnostic = formatToolMessage(messages.fileReadHttp, {
                path: file.path,
                statusCode: result.statusCode,
              });
              readback.status = "failed";
              addDiagnostic(evidence, "readback", item.diagnostic, {
                path: file.path,
                response: result.response,
              });
              continue;
            }
            const decoded = decodeReadback(result.response);
            if (!decoded) {
              item.equal = false;
              item.diagnostic = formatToolMessage(messages.fileContentSchema, {
                path: file.path,
              });
              readback.status = "failed";
              addDiagnostic(evidence, "readback", item.diagnostic, {
                path: file.path,
                response: result.response,
              });
              continue;
            }
            item.encoding = decoded.encoding;
            item.actualByteLength = decoded.content.byteLength;
            item.equal = Buffer.from(file.content).equals(decoded.content);
            if (!item.equal) {
              item.diagnostic = formatToolMessage(messages.fileBytesDiffer, {
                path: file.path,
              });
              readback.status = "failed";
              addDiagnostic(evidence, "readback", item.diagnostic, {
                path: file.path,
                expectedByteLength: file.content.byteLength,
                actualByteLength: decoded.content.byteLength,
              });
            }
          } catch (error) {
            item.equal = false;
            item.diagnostic = describeError(error);
            readback.status = "failed";
            addDiagnostic(
              evidence,
              "readback",
              formatToolMessage(messages.fileReadFailed, { path: file.path }),
              item.diagnostic,
            );
          }
        }
      }
    }
  } catch (error) {
    addDiagnostic(
      evidence,
      stage,
      formatToolMessage(messages.verificationFailed, { stage }),
      describeError(error),
    );
    if (sourceFiles.length > 0 && readback.status === "not_started") {
      markReadbackNotAttempted(
        readback,
        sourceFiles,
        formatToolMessage(messages.verificationStopped, { stage }),
      );
    }
  } finally {
    if (app) {
      try {
        await app.close();
      } catch (error) {
        addDiagnostic(
          evidence,
          "app_close",
          messages.appCloseFailed,
          describeError(error),
        );
      }
    }
    evidence.completedAt = new Date().toISOString();
    const readbackComplete =
      readback.status === "passed" &&
      readback.reason === undefined &&
      evidence.importedCardId !== null &&
      readback.files.length === sourceFiles.length &&
      readback.files.every((file) => file.equal === true);
    if (readback.status === "passed" && !readbackComplete)
      addDiagnostic(evidence, "readback", messages.readbackIncomplete, {
        hasReason: readback.reason !== undefined,
        importedCardId: evidence.importedCardId,
        expectedFileCount: sourceFiles.length,
        actualFileCount: readback.files.length,
        failedPaths: readback.files
          .filter((file) => file.equal !== true)
          .map((file) => file.path),
      });
    evidence.status =
      evidence.diagnostics.length === 0 && readbackComplete
        ? "passed"
        : "failed";
    try {
      await writeFile(
        evidence.readbackPath,
        `${JSON.stringify(readback, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        join(runEvidenceDirectory, "formal.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      addDiagnostic(
        evidence,
        "evidence_write",
        messages.evidenceSaveFailed,
        describeError(error),
      );
      evidence.status = "failed";
    }
  }

  return {
    passed: evidence.status === "passed",
    status: evidence.status,
    evidenceDirectory: evidence.evidenceDirectory,
    readbackPath: evidence.readbackPath,
    importedCardId: evidence.importedCardId,
    requests: evidence.requests.map(
      ({
        method,
        path,
        headers,
        bodyReference,
        bodyByteLength,
        statusCode,
        transportError,
      }) => ({
        method,
        path,
        headers,
        ...(bodyReference ? { bodyReference } : {}),
        ...(bodyByteLength === undefined ? {} : { bodyByteLength }),
        statusCode,
        ...(transportError ? { transportError } : {}),
      }),
    ),
    zipRead: evidence.zipRead,
    schemaValidation: evidence.schemaValidation,
    diagnostics: evidence.diagnostics,
    readback: {
      status: readback.status,
      fileCount: readback.files.length,
      failedPaths: readback.files
        .filter((file) => file.equal === false)
        .map((file) => file.path),
    },
  };
}
