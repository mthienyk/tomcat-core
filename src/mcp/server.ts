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
import { CoreError } from "../errors/index.js";

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

// structuredContent is emitted without outputSchema: @modelcontextprotocol/sdk's output validation
// rejects several permissive Zod exports; clients still receive JSON in text + structured payloads.
const formatOutput = (output: unknown): string => {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
};

const toStructuredPayload = (payload: unknown): Record<string, unknown> => {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload as string | number | boolean | null };
};

const nextActionFromCoreError = (error: CoreError): string => {
  if (error.code === "BAD_REQUEST") return "fix_arguments_or_clarify";
  if (error.code === "FORBIDDEN") return "adjust_identity_scope";
  if (error.code === "NOT_FOUND") return "refresh_ids_via_resolve_entity";
  if (error.code === "CONNECTOR_FAILED") return "retry_or_check_connector_health";
  if (error.code === "CONNECTOR_NOT_CONFIGURED") {
    return "configure_connector_credentials";
  }
  return "inspect_audit_logs_or_support";
};

const formatToolFailure = (error: unknown): Record<string, unknown> => {
  if (error instanceof CoreError) {
    const retryable = error.code === "CONNECTOR_FAILED";
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
        status: error.status,
        retryable,
        nextAction: nextActionFromCoreError(error),
      },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      error: {
        code: "BAD_REQUEST",
        message: "Tool argument validation failed.",
        details: { issues: error.flatten() },
        retryable: false,
        nextAction: "fix_arguments",
      },
    };
  }
  const message = error instanceof Error ? error.message : "unknown_error";
  return {
    error: {
      code: "INTERNAL",
      message,
      details: null,
      retryable: false,
      nextAction: "inspect_audit_logs_or_support",
    },
  };
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

    // Approval-required tools use a permissive schema so the SDK always calls
    // our handler — which returns FORBIDDEN before any argument inspection.
    const registeredSchema = tool.approvalRequired
      ? ({} as ZodRawShape)
      : inputShape(tool.inputSchema);

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description,
        inputSchema: registeredSchema,
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
          const structuredContent = formatToolFailure(
            new CoreError(
              "FORBIDDEN",
              `Tool "${tool.name}" requires human approval (access: ${tool.access}).`,
              403,
              { approvalRequired: true, access: tool.access },
            ),
          );
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  JSON.stringify(structuredContent, null, 2),
              },
            ],
            structuredContent,
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
          const structuredContent = toStructuredPayload(result.output);
          return {
            content: [{ type: "text", text: formatOutput(structuredContent) }],
            structuredContent,
          };
        } catch (error) {
          const structuredContent = formatToolFailure(error);
          options.auditor.record(options.caller, {
            action: "mcp.tool_call",
            resource: `mcp://${tool.name}`,
            outcome: "error",
            reason: "tool_execution_failed",
            meta: {
              toolName: tool.name,
              errorMessage:
                typeof structuredContent["error"] === "object" &&
                  structuredContent["error"] !== null &&
                  "message" in structuredContent["error"]
                  ? String(
                    (structuredContent["error"] as { message: unknown }).message,
                  )
                  : JSON.stringify(structuredContent),
            },
          });
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(structuredContent, null, 2),
              },
            ],
            structuredContent,
          };
        }
      },
    );
  }

  return server;
};
