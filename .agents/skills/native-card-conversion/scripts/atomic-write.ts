import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { getCallDirectory } from "./output.ts";

/** Replace a regular file without following an existing symbolic link. */
export async function replaceFileContents(
  targetFile: string,
  contents: string,
  symbolicLinkMessage: string,
  packageDirectory?: string,
) {
  try {
    if ((await lstat(targetFile)).isSymbolicLink())
      throw new Error(symbolicLinkMessage);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const targetDirectory = dirname(targetFile);
  const packageParent = packageDirectory
    ? dirname(packageDirectory)
    : targetDirectory;
  const callDirectory = getCallDirectory();
  let stagingDirectory = callDirectory;
  let ownedStagingDirectory: string | undefined;
  if (stagingDirectory) {
    const relativeToPackage = packageDirectory
      ? relative(resolve(packageDirectory), resolve(stagingDirectory))
      : "..";
    const insidePackage =
      relativeToPackage === "" ||
      (relativeToPackage !== ".." &&
        !relativeToPackage.startsWith(".." + sep) &&
        !relativeToPackage.startsWith(sep));
    if (
      insidePackage ||
      (await stat(stagingDirectory)).dev !== (await stat(targetDirectory)).dev
    )
      stagingDirectory = undefined;
  }
  if (!stagingDirectory) {
    const fallbackParent = packageDirectory ? packageParent : targetDirectory;
    ownedStagingDirectory = await mkdtemp(
      join(fallbackParent, ".native-card-call-"),
    );
    stagingDirectory = ownedStagingDirectory;
  }

  const temporary = join(
    stagingDirectory,
    `.${basename(targetFile)}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
    );
    await handle.writeFile(contents, "utf8");
    await handle.close();
    handle = undefined;
    await rename(temporary, targetFile);
  } finally {
    try {
      if (handle) await handle.close();
      await rm(temporary, { force: true });
    } finally {
      if (ownedStagingDirectory)
        await rm(ownedStagingDirectory, { recursive: true, force: true });
    }
  }
}
