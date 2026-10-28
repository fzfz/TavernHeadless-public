import { readFile } from "node:fs/promises";

/** Read the JSON result saved by the public CLI without embedding result data in stdio. */
export async function readCommandData(output: string) {
  const reference = JSON.parse(output) as {
    resultFile?: string;
    diagnosticFile?: string;
  };
  const file = reference.resultFile ?? reference.diagnosticFile;
  if (!file) throw new Error("The CLI output did not reference a result file.");
  const saved = JSON.parse(await readFile(file, "utf8")) as {
    data: Record<string, unknown>;
  };
  return saved.data;
}

export function commandStderr(error: unknown): string {
  const stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr;
  if (typeof stderr !== "string") throw error;
  return stderr;
}
