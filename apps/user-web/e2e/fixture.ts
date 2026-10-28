import { readFile } from "node:fs/promises";

export const acceptanceUsers = [
  {
    email: "reader-a@example.test",
    password: "Reader-A-2026!",
    name: "读者甲",
  },
  {
    email: "reader-b@example.test",
    password: "Reader-B-2026!",
    name: "读者乙",
  },
] as const;

export async function roleFixture(
  index: number,
): Promise<{ name: string; files: Record<string, string> }> {
  const files = JSON.parse(
    await readFile(
      new URL(
        "../../api/test/fixtures/native-card/harbor.files.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
  const character = JSON.parse(files["character.json"]!);
  const manifest = JSON.parse(files["manifest.json"]!);
  const name =
    index === 0
      ? "雾港来信"
      : index === 1
        ? "旧城夜话"
        : `雾港档案 ${String(index + 1).padStart(2, "0")}`;
  character.name = name;
  character.tags = index % 2 ? ["都市", "慢节奏"] : ["悬疑", "城市探索"];
  manifest.packageId = `user-web-acceptance-${index + 1}`;
  files["character.json"] = JSON.stringify(character);
  if (index % 2) {
    delete manifest.frontend;
    for (const path of Object.keys(files))
      if (path.startsWith("frontend/")) delete files[path];
    manifest.files = manifest.files.filter(
      (file: { path: string }) => !file.path.startsWith("frontend/"),
    );
  } else {
    files["frontend/index.html"] = files["frontend/index.html"]!.replace(
      "雾港来信",
      name,
    );
  }
  files["manifest.json"] = JSON.stringify(manifest);
  return { name, files };
}

export const statePreset = {
  name: "用户 Web 验收变量更新",
  prompts: [
    {
      identifier: "main",
      name: "状态更新",
      role: "system",
      content: "USER_WEB_STATE_FIXTURE：根据当前来源输出状态更新 JSON。",
      system_prompt: true,
    },
    ...[
      "stateDefinition",
      "stateRules",
      "stateBefore",
      "stateHistory",
      "stateEvidence",
      "stateOutputContract",
    ].map((identifier) => ({
      identifier,
      name: identifier,
      role: "system",
      marker: true,
    })),
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        "main",
        "stateDefinition",
        "stateRules",
        "stateBefore",
        "stateHistory",
        "stateEvidence",
        "stateOutputContract",
      ].map((identifier) => ({ identifier, enabled: true })),
    },
  ],
};
