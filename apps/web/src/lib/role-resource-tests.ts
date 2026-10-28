import type { TavernClient, RegexProfileRuleInput, LlmProvider } from "@tavern/sdk";
import type { RegexPreviewResult } from "@tavern/shared";
import type { RoleResourceDocument } from "./role-resource.schema.js";
import { toRaw } from "vue";

export type { RegexPreviewResult } from "@tavern/shared";

export function snapshotRoleResource(document: RoleResourceDocument): RoleResourceDocument {
  return structuredClone(toRaw(document));
}

export function createResourceTestTracker() {
  let version = 0;
  return {
    begin: () => ++version,
    invalidate: () => { version++; },
    isCurrent: (token: number) => token === version,
  };
}

export function parseRegexVariables(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "{}");
  } catch {
    throw new Error("invalidVariables");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
    throw new Error("invalidVariables");
  return parsed as Record<string, unknown>;
}

export async function previewRoleRegex(
  client: TavernClient,
  document: RoleResourceDocument,
  options: {
    text: string;
    placement: 1 | 2;
    channel: "persist" | "prompt" | "display" | "edit";
    depth: number;
    variables: string;
  },
): Promise<RegexPreviewResult> {
  if (!Number.isInteger(options.depth) || options.depth < 0)
    throw new Error("invalidDepth");
  const variables = parseRegexVariables(options.variables);
  const scripts = document.entries as RegexProfileRuleInput[] | undefined;
  if (!scripts || scripts.some((item) => typeof item.findRegex !== "string"))
    throw new Error("invalidRules");
  return client.regexProfiles.preview({
      text: options.text,
      scripts,
      placement: options.placement,
      channel: options.channel,
      depth: options.depth,
      variables,
  });
}

export function modelProbeOptions(
  document: RoleResourceDocument,
  saved: RoleResourceDocument | undefined,
  operation: "discover" | "test",
) {
  const value = document.value;
  const provider = String(value.provider ?? "") as LlmProvider;
  const apiKey = String(value.api_key ?? "").trim();
  const baseUrl = String(value.base_url ?? "").trim();
  const modelId = String(value.model_id ?? "").trim();
  if (operation === "test" && !modelId) throw new Error("modelRequired");
  if (apiKey) return {
    provider,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(operation === "test" ? { modelId } : {}),
  };
  const savedBaseUrl = String(saved?.value.base_url ?? "").trim();
  if (!document.id || !saved || provider !== saved.value.provider ||
      (savedBaseUrl && !baseUrl)) throw new Error("keyRequired");
  return {
    profileId: document.id,
    ...(baseUrl ? { baseUrl } : {}),
    ...(operation === "test" ? { modelId } : {}),
  };
}
