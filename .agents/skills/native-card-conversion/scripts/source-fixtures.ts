import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { precheckCard } from "./source.ts";
import { validateSourceCard } from "./source-format.ts";
import { taskPaths } from "./source-config.ts";
import { taskRepositoryRoot } from "./task-context.ts";
import runtime from "./runtime.json" with { type: "json" };

export function v1Card(data: Record<string, unknown> = {}) {
  return {
    name: "测试角色",
    description: "",
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: "",
    ...data,
  };
}

export function v2Card(data: Record<string, unknown> = {}) {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      ...v1Card(),
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
      creator: "",
      character_version: "",
      extensions: {},
      ...data,
    },
  };
}

export function v3Card(data: Record<string, unknown> = {}) {
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: { ...v2Card().data, group_only_greetings: [], ...data },
  };
}

export function sourceBook(
  entries: unknown[] = [],
  data: Record<string, unknown> = {},
) {
  return { extensions: {}, entries, ...data };
}

export function sourceEntry(data: Record<string, unknown> = {}) {
  return {
    keys: [],
    content: "",
    extensions: {},
    enabled: true,
    insertion_order: 0,
    use_regex: false,
    ...data,
  };
}

export function completeSourceFixture(source: unknown): unknown {
  if (source === null || typeof source !== "object" || Array.isArray(source))
    return source;
  const value = source as Record<string, unknown>;
  if (!Object.hasOwn(value, "spec")) return { ...value, ...v1Card(value) };
  if (
    value.data === null ||
    typeof value.data !== "object" ||
    Array.isArray(value.data)
  )
    return value;
  const data = { ...(value.data as Record<string, unknown>) };
  if (
    data.character_book !== null &&
    typeof data.character_book === "object" &&
    !Array.isArray(data.character_book)
  ) {
    const book = data.character_book as Record<string, unknown>;
    data.character_book = {
      ...book,
      ...sourceBook([], book),
      ...(Array.isArray(book.entries)
        ? {
            entries: book.entries.map((entry) =>
              entry !== null &&
              typeof entry === "object" &&
              !Array.isArray(entry)
                ? { ...entry, ...sourceEntry(entry as Record<string, unknown>) }
                : entry,
            ),
          }
        : {}),
    };
  }
  const card = value.spec === "chara_card_v2" ? v2Card(data) : v3Card(data);
  return {
    ...card,
    ...value,
    data: {
      ...data,
      ...card.data,
    },
  };
}
export function precheckSourceFixture(source: unknown) {
  const admitted = validateSourceCard(completeSourceFixture(source));
  if (!admitted.success) throw new Error(JSON.stringify(admitted));
  return precheckCard(admitted);
}

export async function sourceTaskFiles(sourceFile: string) {
  const output = join(taskRepositoryRoot, runtime.outputDirectory);
  const owned: string[] = [];
  const directories = await readdir(output).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const name of directories) {
    if (!name.startsWith(taskPaths.prefix)) continue;
    const file = join(output, name, taskPaths.task);
    try {
      const task = JSON.parse(await readFile(file, "utf8"));
      if (task.originalSourceFile === sourceFile) owned.push(file);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        !(error instanceof SyntaxError)
      )
        throw error;
    }
  }
  return owned.sort();
}
