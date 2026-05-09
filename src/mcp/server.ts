import { z, type ZodRawShape } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Auditor } from "../audit/audit.js";
import type { Identity } from "../domain/identity.js";
import {
  AGENT_TOOL_REGISTRY,
  executeRegisteredAgentTool,
  type AgentToolServices,
} from "../agent/toolRegistry.js";
import type { CoreToolName } from "../domain/agent.js";

export type McpAgentServerOptions = {
  name?: string;
  version?: string;
  services: AgentToolServices;
  caller: Identity;
  auditor: Auditor;
};

const inputShape = (schema: z.ZodTypeAny): ZodRawShape => {
  if (schema instanceof z.ZodObject) return schema.shape as ZodRawShape;
  throw new Error(
    "MCP server expects every registered tool to expose a ZodObject input schema",
  );
};

const formatOutput = (output: unknown): string => {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
};

export const buildMcpAgentServer = (
  options: McpAgentServerOptions,
): McpServer => {
  const server = new McpServer({
    name: options.name ?? "tomcat-core",
    version: options.version ?? "0.1.0",
  });

  for (const tool of AGENT_TOOL_REGISTRY) {
    const description =
      `${tool.description}\n\n`
      + `Sources: ${tool.sources.join(", ")} | `
      + `Access: ${tool.access} | `
      + `Approval required: ${tool.approvalRequired ? "yes" : "no"}`;

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description,
        inputSchema: inputShape(tool.inputSchema),
      },
      async (args) => {
        if (tool.approvalRequired) {
          options.auditor.record(options.caller, {
            action: "mcp.tool_call",
            resource: `mcp://${tool.name}`,
            outcome: "denied",
            reason: "approval_required",
            meta: { toolName: tool.name, access: tool.access },
          });
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `Tool "${tool.name}" requires human approval `
                  + `(access: ${tool.access}). Refused via MCP.`,
              },
            ],
          };
        }

        const startedAt = Date.now();
        try {
          const result = await executeRegisteredAgentTool(
            options.services,
            options.caller,
            {
              toolName: tool.name as CoreToolName,
              arguments: (args ?? {}) as Record<string, unknown>,
            },
          );
          options.auditor.record(options.caller, {
            action: "mcp.tool_call",
            resource: `mcp://${tool.name}`,
            outcome: "allowed",
            reason: undefined,
            meta: {
              toolName: tool.name,
              durationMs: Date.now() - startedAt,
            },
          });
          return {
            content: [{ type: "text", text: formatOutput(result.output) }],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unknown_error";
          options.auditor.record(options.caller, {
            action: "mcp.tool_call",
            resource: `mcp://${tool.name}`,
            outcome: "error",
            reason: "tool_execution_failed",
            meta: { toolName: tool.name, errorMessage: message },
          });
          return {
            isError: true,
            content: [
              { type: "text", text: `Tool execution failed: ${message}` },
            ],
          };
        }
      },
    );
  }

  return server;
};
