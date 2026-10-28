import workflowSchema from "../../.agents/skills/tavern-client-integration/references/workflow.schema.json";
import clientWorkflow from "../../.agents/skills/tavern-client-integration/references/workflow.json";
import projectWorkflow from "../../.agents/skills/tavern-project-contributing/references/workflow.json";

export const skillWorkflows = [clientWorkflow, projectWorkflow];
export type SkillWorkflow = (typeof skillWorkflows)[number];

export function buildSkillArtifacts(
  basePath: string,
  workflows: SkillWorkflow[] = skillWorkflows,
) {
  function path(value: string): string {
    if (
      !new RegExp(workflowSchema.$defs.siteRelativePath.pattern).test(value)
    ) {
      throw new Error(
        `Skill 站内路径无效：${value}。请使用 workflow.schema.json 规定的相对路径。`,
      );
    }
    return `${basePath}${value}`;
  }
  return workflows.map((workflow) => {
    const { $schema, ...content } = workflow;
    return {
      ...content,
      humanPage: path(workflow.humanPage),
      json: path(workflow.json),
      relatedDocs: workflow.relatedDocs.map((doc) => ({
        ...doc,
        path: path(doc.path),
      })),
    };
  });
}
