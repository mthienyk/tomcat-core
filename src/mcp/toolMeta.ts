import type { AgentToolAccess } from "../domain/agentTools.js";

export type ToolDescriptionMeta = {
  summary: string;
  whenToUse: readonly string[];
  prerequisites?: readonly string[];
  inputTips?: readonly string[];
  output?: readonly string[];
  nextTools?: readonly { name: string; when: string }[];
  limitations?: readonly string[];
  sources: readonly string[];
  access: AgentToolAccess;
  approvalRequired: boolean;
};

export const formatToolDescription = (meta: ToolDescriptionMeta): string => {
  const blocks: string[] = [meta.summary];

  if (meta.whenToUse.length > 0) {
    blocks.push(
      "WHEN TO USE:\n" + meta.whenToUse.map((line) => `- ${line}`).join("\n"),
    );
  }
  if (meta.prerequisites && meta.prerequisites.length > 0) {
    blocks.push(
      "PREREQUISITES:\n" + meta.prerequisites.map((line) => `- ${line}`).join("\n"),
    );
  }
  if (meta.inputTips && meta.inputTips.length > 0) {
    blocks.push(
      "INPUT TIPS:\n" + meta.inputTips.map((line) => `- ${line}`).join("\n"),
    );
  }
  if (meta.output && meta.output.length > 0) {
    blocks.push(
      "OUTPUT:\n" + meta.output.map((line) => `- ${line}`).join("\n"),
    );
  }
  if (meta.nextTools && meta.nextTools.length > 0) {
    blocks.push(
      "THEN CONSIDER:\n"
        + meta.nextTools.map((t) => `- ${t.name}: ${t.when}`).join("\n"),
    );
  }
  if (meta.limitations && meta.limitations.length > 0) {
    blocks.push(
      "LIMITATIONS:\n" + meta.limitations.map((line) => `- ${line}`).join("\n"),
    );
  }

  blocks.push(
    `Sources: ${meta.sources.join(", ")} | Access: ${meta.access} | `
      + `Approval required: ${meta.approvalRequired ? "yes" : "no"}`,
  );

  return blocks.join("\n\n");
};
