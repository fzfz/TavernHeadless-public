import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { siteConfig, assertSiteEnvironment } from "./docs/site-config";
import { buildSkillArtifacts } from "./docs/skill-artifacts";

async function main(): Promise<void> {
  assertSiteEnvironment(process.env);
  const skills = buildSkillArtifacts(siteConfig.basePath);
  const root = resolve("vitepress/public/agent/skills");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const catalog = {
    contractVersion: 1,
    generatedAt: new Date().toISOString(),
    humanEntry: `${siteConfig.basePath}agent/skills/`,
    skills: skills.map(
      ({ skillId, title, summary, status, humanPage, json }) => ({
        skillId,
        title,
        summary,
        status,
        humanPage,
        json,
      }),
    ),
  };
  await writeFile(
    resolve(root, "catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
  );
  for (const skill of skills) {
    await writeFile(
      resolve(root, `${skill.skillId}.json`),
      `${JSON.stringify(skill, null, 2)}\n`,
    );
  }
  console.log(
    `[skill-artifacts] generated ${skills.length} skills from repository workflows`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
