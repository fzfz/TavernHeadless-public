export interface CreationPathTemplate {
  pathTemplate: string;
}

export function orderPackageFilesByTemplates(
  paths: readonly string[],
  templates: readonly CreationPathTemplate[],
): string[] {
  const pending = new Set(paths);
  const ordered: string[] = [];
  for (const { pathTemplate } of templates) {
    const source = pathTemplate
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\{[^{}]+\\\}/g, "[^/]+");
    const pattern = new RegExp(`^${source}$`);
    for (const path of [...pending].filter((item) => pattern.test(item)).sort((a, b) => a.localeCompare(b))) {
      pending.delete(path);
      ordered.push(path);
    }
  }
  return [...ordered, ...[...pending].sort((a, b) => a.localeCompare(b))];
}

export function orderDomainFiles(
  domain: string,
  paths: readonly string[],
  templates: readonly CreationPathTemplate[],
): string[] {
  if (domain === "worldbooks") return [...paths].sort((a, b) => a.localeCompare(b));
  if (domain === "openings") {
    return paths.filter((path) => path.startsWith("openings/") && path.endsWith(".txt")).sort((a, b) => a.localeCompare(b));
  }
  if (domain === "variables") {
    return paths.filter((path) => path === "state/schema.json" || path.startsWith("state/initial/")).sort((a, b) => a.localeCompare(b));
  }
  return orderPackageFilesByTemplates(paths, templates);
}
