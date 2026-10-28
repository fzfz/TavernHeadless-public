export interface NativeCardFileSnapshot {
  encoding: string;
  content: string;
}

export interface NativeCardFixedFileRule {
  pathPattern: string;
}

export function isPackageFileReadable(
  path: string,
  savedPaths: readonly string[],
  workspacePaths: readonly string[],
  movedFromPaths: readonly string[],
  deletedPaths: readonly string[],
): boolean {
  if (deletedPaths.includes(path) || movedFromPaths.includes(path)) return false;
  return workspacePaths.includes(path) || savedPaths.includes(path);
}

export function isFixedPackageFile(
  path: string,
  fixedFiles: readonly NativeCardFixedFileRule[],
): boolean {
  return fixedFiles.some((rule) => rule.pathPattern === path);
}

export function findPackageFileReferences(
  paths: readonly string[],
  targetPath: string,
  files: Readonly<Record<string, NativeCardFileSnapshot | undefined>>,
): string[] {
  return paths.filter((path) => {
    if (!path.endsWith(".json") || path === targetPath || path === "manifest.json") return false;
    const file = files[path];
    if (!file || file.encoding !== "utf8") return false;
    try {
      return containsExactString(JSON.parse(file.content) as unknown, targetPath);
    } catch {
      return false;
    }
  });
}

function containsExactString(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsExactString(item, expected));
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => containsExactString(item, expected));
  }
  return false;
}
