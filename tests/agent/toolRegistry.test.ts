import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CoreToolNameSchema } from "../../src/domain/agent.js";
import {
  AGENT_TOOL_NAMES,
  AGENT_TOOL_REGISTRY,
  executeRegisteredAgentTool,
  getAgentToolDefinition,
} from "../../src/agent/toolRegistry.js";
import { TOOL_DESCRIPTIONS } from "../../src/agent/toolCopy.js";
import { formatToolDescription } from "../../src/mcp/toolMeta.js";

describe("agent tool registry", () => {
  it("keeps CoreToolNameSchema, registry and toolCopy in sync", () => {
    const enumNames = [...CoreToolNameSchema.options].sort();
    const registryNames = [...AGENT_TOOL_NAMES].sort();
    const copyKeys = Object.keys(TOOL_DESCRIPTIONS).sort();

    expect(registryNames).toEqual(enumNames);
    expect(copyKeys).toEqual(registryNames);
    expect(AGENT_TOOL_REGISTRY).toHaveLength(registryNames.length);
  });

  it("formats every tool description with agent-first sections", () => {
    for (const tool of AGENT_TOOL_REGISTRY) {
      const copy = TOOL_DESCRIPTIONS[tool.name as keyof typeof TOOL_DESCRIPTIONS];
      expect(copy).toBeDefined();
      const formatted = formatToolDescription(copy);
      expect(formatted).toContain("WHEN TO USE:");
      expect(formatted).toMatch(/Sources:.+Access:.+Approval required/);
      expect(tool.description).toBe(formatted);
    }
  });

  it("rejects strict schema violations before handler execution", async () => {
    await expect(
      executeRegisteredAgentTool({} as never, {} as never, {
        toolName: "resolve_entity",
        arguments: { query: "Acme", extraField: true },
      }),
    ).rejects.toThrow();
  });

  it("requires startupId or startupName for read_startup_notes", async () => {
    await expect(
      executeRegisteredAgentTool(
        {
          startups: {} as never,
          society: {} as never,
          companyContext: {} as never,
          signalHub: {} as never,
          competitiveHistory: {} as never,
          companyDriveFolder: {} as never,
          boardBrief: {} as never,
        },
        {} as never,
        {
          toolName: "read_startup_notes",
          arguments: {},
        },
      ),
    ).rejects.toThrow("Either startupId or startupName is required");
  });

  it("maps every registry tool name through getAgentToolDefinition", () => {
    for (const name of AGENT_TOOL_NAMES) {
      expect(getAgentToolDefinition(name).name).toBe(name);
    }
    expect(() => getAgentToolDefinition("not_a_tool" as never)).toThrow(
      /Unknown registered agent tool/,
    );
  });

  it("uses Zod strict objects for non-approval tools", () => {
    const zeroArgTools = new Set([
      "signal_hub_list_accounts",
      "list_portfolio_companies",
    ]);
    const withInputs = AGENT_TOOL_REGISTRY.filter(
      (t) => !t.approvalRequired && !zeroArgTools.has(t.name),
    );
    for (const tool of withInputs) {
      expect(tool.inputSchema).toBeInstanceOf(z.ZodObject);
      const shape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
      expect(Object.keys(shape).length).toBeGreaterThan(0);
    }
  });
});
