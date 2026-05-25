import { z } from "zod";

export const AgentContextSchema = z
  .object({
    currentStartupId: z.string().min(1).optional(),
    currentStartupName: z.string().min(1).optional(),
    currentPortfolioCompanyId: z.string().min(1).optional(),
    currentDealId: z.string().min(1).optional(),
    currentBoardId: z.string().min(1).optional(),
    selectedDocumentId: z.string().min(1).optional(),
  })
  .strict();

export type AgentContext = z.infer<typeof AgentContextSchema>;

export const CoreToolNameSchema = z.enum([
  "search_startups",
  "read_startup_notes",
  "read_startup_deals",
  "read_startup_meetings",
  "list_portfolio_signals",
  "build_board_prep_context",
  "resolve_entity",
  "summarize_company_activity",
  "find_latest_deck",
  "list_company_crm_activity",
  "list_company_documents",
  "read_company_document_excerpt",
  "list_portfolio_context",
  "list_portfolio_companies",
  "build_company_360_context",
  "find_competitive_history",
  "find_similar_cases",
  "prepare_board_brief",
  "generate_portfolio_signal_digest",
  "resolve_company_drive_folder",
  "read_bp_playbook",
  "assemble_company_finance_pack",
  "draft_bp_tab_debt",
  // Signal Hub
  "signal_hub_list_watched",
  "signal_hub_add_watched",
  "signal_hub_set_priority",
  "signal_hub_recent_signals",
  "signal_hub_search_signals",
  "signal_hub_resolve_entity",
  "signal_hub_list_accounts",
  "signal_hub_request_refresh",
  "signal_hub_freeze_account",
]);

export type CoreToolName = z.infer<typeof CoreToolNameSchema>;

export type AgentToolCall = {
  toolName: CoreToolName;
  arguments: Record<string, unknown>;
};

export type AgentToolResult = {
  toolName: CoreToolName;
  output: unknown;
};
