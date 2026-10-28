import type { FastifyInstance } from "fastify";
import { parseRegexScripts } from "@tavern/adapters-sillytavern";
import {
  buildRegexSubstitutionContext,
  executeRegexScriptsWithTrace,
} from "../services/prompt-runtime/regex/runtime-facade.js";
import {
  regexPreviewBodySchema,
  regexPreviewResponseSchema,
  type RegexPreviewBody,
} from "./schemas/regex-preview.js";
export async function registerRegexPreviewRoutes(app: FastifyInstance) {
  app.post<{ Body: RegexPreviewBody }>(
    "/regex-profiles/preview",
    {
      schema: {
        tags: ["regex-profiles"],
        body: regexPreviewBodySchema,
        response: { 200: regexPreviewResponseSchema },
      },
    },
    async (request, reply) => {
      let scripts;
      try {
        scripts = parseRegexScripts(request.body.scripts);
      } catch {
        return reply.code(400).send({
          error: {
            code: "INVALID_REQUEST",
            message: "正则规则格式无效，请检查规则字段。",
          },
        });
      }
      const body = request.body;
      const result = executeRegexScriptsWithTrace(
        body.text,
        scripts,
        body.placement,
        {
          channel: body.channel,
          depth: body.depth,
          ...buildRegexSubstitutionContext(body.variables ?? {}),
        },
      );
      return {
        data: {
          text: result.text,
          candidate_rule_names: result.candidateRuleNames,
          matched_rule_names: result.matchedRuleNames,
          skipped_rules: result.skippedRules.map((r) => ({
            rule_name: r.ruleName,
            reason: r.reason,
          })),
        },
      };
    },
  );
}
