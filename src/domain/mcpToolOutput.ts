import type { Citation } from "./entities.js";

/** Partial data or degraded connector — never silent. See docs/mcp-use-cases.md §13. */
export type ToolWarning = {
  code: string;
  message: string;
  mitigation?: string;
};

/** Hint for the orchestrator on the next tool call in a chain. */
export type SuggestedToolCall = {
  toolName: string;
  reason: string;
  arguments?: Record<string, unknown>;
};

export type ToolRunStatus = "accepted" | "running" | "completed" | "failed";

export type ToolRunHandle = {
  runId: string;
  status: ToolRunStatus;
  /** MCP tool name to poll when status is accepted or running. */
  pollTool?: string;
};

/**
 * Standard envelope for MCP tool outputs (spec: docs/mcp-use-cases.md §13).
 * Existing tools may return bare payloads until migrated; new tools SHOULD use this.
 */
export type ToolRunEnvelope<T> = {
  data: T;
  citations: Citation[];
  warnings: ToolWarning[];
  nextSuggestedTools?: SuggestedToolCall[];
  run?: ToolRunHandle;
};

export const wrapToolOutput = <T>(
  data: T,
  options?: {
    citations?: Citation[];
    warnings?: ToolWarning[];
    nextSuggestedTools?: SuggestedToolCall[];
    run?: ToolRunHandle;
  },
): ToolRunEnvelope<T> => ({
  data,
  citations: options?.citations ?? [],
  warnings: options?.warnings ?? [],
  ...(options?.nextSuggestedTools !== undefined
    ? { nextSuggestedTools: options.nextSuggestedTools }
    : {}),
  ...(options?.run !== undefined ? { run: options.run } : {}),
});

/** Known warning codes — extend as connectors and tools evolve. */
export const ToolWarningCodes = {
  MONDAY_SIGNALS_EMPTY: "MONDAY_SIGNALS_EMPTY",
  DRIVE_PDF_NOT_EXTRACTABLE: "DRIVE_PDF_NOT_EXTRACTABLE",
  PORTFOLIO_LINK_MISSING: "PORTFOLIO_LINK_MISSING",
  CONNECTOR_DEGRADED: "CONNECTOR_DEGRADED",
  NO_SECTOR_MATCHES: "NO_SECTOR_MATCHES",
  DRIVE_FOLDER_NOT_FOUND: "DRIVE_FOLDER_NOT_FOUND",
  DRIVE_FOLDER_AMBIGUOUS: "DRIVE_FOLDER_AMBIGUOUS",
  DRIVE_INPUTS_INCOMPLETE: "DRIVE_INPUTS_INCOMPLETE",
  BOARD_PACK_NOT_INDEXED: "BOARD_PACK_NOT_INDEXED",
  DEPRECATED_TOOL: "DEPRECATED_TOOL",
  WATCHLIST_EMPTY: "WATCHLIST_EMPTY",
  DIGEST_SCOPE_TRUNCATED: "DIGEST_SCOPE_TRUNCATED",
  LINKEDIN_EVENTS_TRUNCATED: "LINKEDIN_EVENTS_TRUNCATED",
} as const;
