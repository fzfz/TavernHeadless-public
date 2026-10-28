import { z } from "zod";
import schema from "../../docs/provenance/site.schema.json";
import source from "../../docs/provenance/site.json";

export type SiteConfig = { [Key in keyof typeof schema.properties]: string };

// The JSON schema owns the names and string constraints of the site configuration.
const shape = Object.fromEntries(
  Object.entries(schema.properties).map(([key, value]) => [
    key,
    z.string().regex(new RegExp(value.pattern)),
  ]),
) as { [Key in keyof SiteConfig]: z.ZodString };

export function parseSiteConfig(value: unknown): SiteConfig {
  const config = z.object(shape).strict().parse(value);
  if (new URL(config.siteUrl).pathname !== config.basePath) {
    throw new Error(
      "siteUrl 的路径必须与 basePath 一致；请修改 docs/provenance/site.json。",
    );
  }
  return config;
}

export const siteConfig = parseSiteConfig(source);

export function assertSiteEnvironment(env: NodeJS.ProcessEnv): void {
  const expected = {
    AGENT_REPOSITORY: siteConfig.repository,
    AGENT_PUBLIC_SITE_URL: siteConfig.siteUrl,
    AGENT_BASE_PATH: siteConfig.basePath,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (env[name] !== undefined && env[name] !== value) {
      throw new Error(
        `${name} 与 docs/provenance/site.json 不一致；请使用该文件中的配置。`,
      );
    }
  }
}
