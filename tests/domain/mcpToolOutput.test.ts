import { describe, expect, it } from "vitest";
import { wrapToolOutput } from "../../src/domain/mcpToolOutput.js";

describe("mcpToolOutput", () => {
  it("wrapToolOutput defaults citations and warnings to empty arrays", () => {
    const envelope = wrapToolOutput({ ok: true });
    expect(envelope.data).toEqual({ ok: true });
    expect(envelope.citations).toEqual([]);
    expect(envelope.warnings).toEqual([]);
    expect(envelope.nextSuggestedTools).toBeUndefined();
    expect(envelope.run).toBeUndefined();
  });

  it("wrapToolOutput preserves optional orchestration hints", () => {
    const envelope = wrapToolOutput(
      { count: 2 },
      {
        warnings: [{ code: "TEST", message: "demo" }],
        nextSuggestedTools: [
          { toolName: "resolve_entity", reason: "ambiguous name" },
        ],
        run: { runId: "run_1", status: "accepted", pollTool: "get_tool_run" },
      },
    );
    expect(envelope.warnings).toHaveLength(1);
    expect(envelope.nextSuggestedTools?.[0]?.toolName).toBe("resolve_entity");
    expect(envelope.run?.runId).toBe("run_1");
  });
});
