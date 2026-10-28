// Explicit source-format conversions; raw preset files remain unchanged.
export function preparePresetImport(source, policy) {
  const data = structuredClone(source);
  const conversions = [];
  for (const prompt of data.prompts || []) {
    const mapped = policy.roleAliases[prompt.role];
    if (mapped) {
      conversions.push({
        identifier: prompt.identifier,
        field: "role",
        from: prompt.role,
        to: mapped,
      });
      prompt.role = mapped;
    }
    if (policy.commentMacros && typeof prompt.content === "string") {
      const withoutComments = prompt.content.replace(
        /\{\{\/\/(?:(?!\{\{|\}\})[\s\S])*\}\}/g,
        "",
      );
      if (withoutComments !== prompt.content)
        conversions.push({
          identifier: prompt.identifier,
          field: "content",
          macro: "//",
        });
      prompt.content = withoutComments;
    }
    if (policy.trimMacro && typeof prompt.content === "string") {
      // Matches SillyTavern public/scripts/macros.js trim semantics.
      const trimmed = prompt.content.replace(
        /(?:\r?\n)*{{trim}}(?:\r?\n)*/gi,
        "",
      );
      if (trimmed !== prompt.content)
        conversions.push({
          identifier: prompt.identifier,
          field: "content",
          macro: "trim",
        });
      prompt.content = trimmed;
    }
  }
  return { data, conversions };
}
