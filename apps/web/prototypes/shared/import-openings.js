// Import every source opening. Metadata decorates entries; it never filters them.
export function importOpenings(
  snapshot,
  metadata,
  initialVariables,
  { parseYaml, performerName } = {},
) {
  const sources = [
    { id: "first", text: snapshot.greeting },
    ...(snapshot.alternateGreetings ?? []).map((text, index) => ({
      id: `alternate-${index + 1}`,
      text,
    })),
  ];
  for (const id of Object.keys(metadata.entries)) {
    if (!sources.some((source) => source.id === id))
      throw new Error(`Unknown opening metadata: ${id}`);
  }
  const items = sources.map((source, index) => {
    const details = metadata.entries[source.id];
    let variables = structuredClone(details?.variables ?? initialVariables);
    const substitute = (text) =>
      performerName ? text.replaceAll("{{user}}", performerName) : text;
    const init = source.text.match(/<initvar>([\s\S]*?)<\/initvar>/);
    if (init) {
      if (!parseYaml) throw new Error("Opening initvar requires YAML parser");
      variables = parseYaml(substitute(init[1]));
    }
    const patch = source.text.match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/);
    if (patch)
      for (const operation of JSON.parse(substitute(patch[1]))) {
        if (operation.op !== "replace" || !operation.path.startsWith("/"))
          throw new Error("Unsupported opening patch");
        const parts = operation.path
          .slice(1)
          .split("/")
          .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
        const last = parts.pop();
        let target = variables;
        for (const part of parts) {
          if (!target || !Object.hasOwn(target, part))
            throw new Error("Unknown opening patch path");
          target = target[part];
        }
        if (!target || !Object.hasOwn(target, last))
          throw new Error("Unknown opening patch path");
        target[last] = operation.value;
      }
    return {
      id: source.id,
      title: details?.title ?? (index === 0 ? "主开场" : `备用开场 ${index}`),
      summary:
        details?.summary ??
        (index === 0 ? "角色卡的主开场。" : `角色卡的第 ${index} 个备用开场。`),
      kind: details?.kind ?? "story",
      text: source.text,
      displayText: substitute(
        source.text
          .replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/g, "")
          .replace(/<StatusPlaceHolderImpl\s*\/>/g, ""),
      ).trim(),
      variables,
    };
  });
  if (!items.some((item) => item.id === metadata.defaultOpeningId))
    throw new Error("Unknown default opening");
  return { defaultOpeningId: metadata.defaultOpeningId, items };
}
