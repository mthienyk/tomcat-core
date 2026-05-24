import type { ToolDescriptionMeta } from "../mcp/toolMeta.js";

const meta = (
  partial: ToolDescriptionMeta,
): ToolDescriptionMeta => partial;

export const TOOL_DESCRIPTIONS = {
  search_startups: meta({
    summary:
      "Discover startups in Tomcat HubSpot CRM visible to the caller. "
      + "Returns canonical startup ids and sector tags.",
    whenToUse: [
      "Confirm a company exists before reading notes, deals, or meetings",
      "List startups in a sector for funnel or competitive scans",
      "Obtain startupId after the user gives an approximate name (prefer resolve_entity if cross-system ids are needed)",
    ],
    inputTips: [
      "startupId — exact match, single result",
      "startupName — case-insensitive substring, may return multiple rows",
      "sector — exact sector tag match across visible startups",
      "limit — default 50, max 200",
    ],
    output: [
      "Array of Startup objects: id, name, sectors, stage, visibilityTier",
    ],
    nextTools: [
      { name: "read_startup_notes", when: "You have startupId and need CRM context" },
      { name: "find_competitive_history", when: "Compare against prior deals in the same sector" },
      { name: "resolve_entity", when: "You also need Monday portfolioCompanyId or Drive linkage" },
    ],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  resolve_entity: meta({
    summary:
      "Router tool: map a free-text company fragment to HubSpot startupId and "
      + "Monday portfolioCompanyId candidates. Always prefer this before narrow reads when the name may be ambiguous.",
    whenToUse: [
      "User mentions a company by partial name, typo, or nickname",
      "Before list_company_crm_activity, list_company_documents, or build_board_prep_context",
      "When search_startups returned multiple matches",
    ],
    output: [
      "candidates[] with canonicalName, startupId, portfolioCompanyId, matchedSources",
      "needsClarification — true when more than one plausible match; ask the user",
      "warnings — linkage gaps between HubSpot and Monday",
    ],
    nextTools: [
      { name: "build_company_360_context", when: "Single candidate confirmed" },
      { name: "resolve_company_drive_folder", when: "Drive folder or M2/BP inputs needed" },
      { name: "list_company_crm_activity", when: "CRM timeline only" },
      { name: "prepare_board_brief", when: "Board or portfolio prep (preferred)" },
      { name: "build_board_prep_context", when: "Legacy minimal board context only" },
    ],
    limitations: [
      "HubSpot ↔ Monday linkage is name-based and may be incomplete",
    ],
    sources: ["hubspot", "monday"],
    access: "confidential",
    approvalRequired: false,
  }),

  find_competitive_history: meta({
    summary:
      "Tomcat memory: list historically seen startups similar to a reference company "
      + "or sector, with recent note excerpts. Opinionated alternative to raw sector search.",
    whenToUse: [
      "Prep M1/M2: « what similar companies have we seen? »",
      "Compare a new deal against prior HubSpot notes in the same vertical",
      "Before prepare_m1_meeting_brief (P0) for competitive so-what",
    ],
    prerequisites: [
      "Reference startup via startupId or unambiguous startupName, OR a sector filter",
    ],
    inputTips: [
      "startupId — preferred when known from resolve_entity",
      "sector — list peers when you do not have a reference startup",
      "limit — max similar startups (default 10)",
      "notesPerMatch — note excerpts per match (default 3)",
    ],
    output: [
      "ToolRunEnvelope with data.referenceStartup, data.matches[], note excerpts",
      "warnings when ambiguous name or empty matches",
      "nextSuggestedTools for deeper CRM reads",
    ],
    nextTools: [
      { name: "read_startup_notes", when: "Full notes for one historical match" },
      { name: "read_company_document_excerpt", when: "Deck or board pack for a match" },
    ],
    limitations: [
      "Similarity is sector-based today, not semantic deck analysis",
      "Only startups visible to the caller ACL",
    ],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  resolve_company_drive_folder: meta({
    summary:
      "Locate the Google Drive folder for a portfolio company, return breadcrumb path, "
      + "folder inventory, and missing inputs for M2/BP/reporting workflows.",
    whenToUse: [
      "Before run_m2_financial_analysis or generate_bp_from_template",
      "« Where is the Série A folder for [Boîte]? »",
      "Check which BP or M2 inputs are missing in Drive",
    ],
    prerequisites: [
      "portfolioCompanyId from resolve_entity, or startupId/startupName with Monday linkage",
    ],
    inputTips: [
      "purpose — company_root (default), series_a, pre_round, m2_financial, bp_inputs, reporting",
      "folderLimit — max folder candidates (default 10)",
      "inventoryLimit — max items listed inside the primary folder (default 50)",
    ],
    output: [
      "ToolRunEnvelope: primaryFolder with path, folderCandidates[], inventory[]",
      "presentInputs / missingInputs when purpose is not company_root",
      "warnings when folder missing, ambiguous, or inputs incomplete",
    ],
    nextTools: [
      { name: "read_company_document_excerpt", when: "Extract text from a listed file" },
      { name: "list_company_documents", when: "Fallback flat search when folder structure fails" },
    ],
    limitations: [
      "Folder discovery uses portfolioCompanyId substring match on Drive folder names",
      "Input gap checks are keyword-based on filenames, not semantic classification",
    ],
    sources: ["drive", "monday"],
    access: "confidential",
    approvalRequired: false,
  }),

  build_board_prep_context: meta({
    summary:
      "Deprecated. Returns Monday highlights/risks and citations only. "
      + "Use prepare_board_brief for actionable prep with checklist and open questions.",
    whenToUse: [
      "Only when a legacy client still calls this tool name",
    ],
    limitations: [
      "Deprecated — identical data path as prepare_board_brief with a reduced payload",
      "Does not include checklist, open questions, or LinkedIn signals in data",
    ],
    nextTools: [
      { name: "prepare_board_brief", when: "Always prefer this for board prep" },
    ],
    sources: ["hubspot", "monday", "drive", "signal_hub"],
    access: "confidential",
    approvalRequired: false,
  }),

  prepare_board_brief: meta({
    summary:
      "Actionable board prep brief: executive snapshot, CRM timeline, Drive board pack, "
      + "LinkedIn signals, open questions, and a ready/missing/review checklist.",
    whenToUse: [
      "Board meeting prep for a portfolio company",
      "« Prépare tout pour le board de [Boîte] »",
      "After resolve_entity when portfolioCompanyId or startupId is known",
    ],
    prerequisites: [
      "portfolioCompanyId OR startupId/startupName with Monday linkage",
    ],
    inputTips: [
      "sinceDaysMonday — default 90",
      "sinceDaysLinkedIn — default 30",
      "notesLimit / dealsLimit / meetingsLimit — bound CRM payload",
    ],
    output: [
      "ToolRunEnvelope with executiveSnapshot.openQuestions[] and prepChecklist[]",
      "latestBoardPack when a Drive filename matches « board »",
      "nextSuggestedTools for deck excerpt and Signal Hub refresh",
    ],
    nextTools: [
      { name: "read_company_document_excerpt", when: "Latest board deck identified" },
      { name: "resolve_company_drive_folder", when: "Board deck missing — locate folder" },
      { name: "signal_hub_recent_signals", when: "Refresh LinkedIn activity" },
    ],
    limitations: [
      "Monday signals may be empty until connector is wired",
      "Open questions are rule-based flags, not LLM synthesis",
    ],
    sources: ["hubspot", "monday", "drive", "signal_hub"],
    access: "confidential",
    approvalRequired: false,
  }),

  generate_portfolio_signal_digest: meta({
    summary:
      "Friday News material: weekly digest of portfolio activity from Monday signals, "
      + "Signal Hub LinkedIn events, and recent HubSpot notes — grouped by company, not by theme.",
    whenToUse: [
      "« What happened in the portfolio this week? »",
      "Matière brute for Friday News or internal comms digest",
      "After watchlist is configured for portfolio founders",
    ],
    inputTips: [
      "sinceDays — default 7 (weekly), max 30",
      "portfolioCompanyId — optional focus on one portco",
      "priority — filter Signal Hub watchlist (hot / warm / cold)",
      "includeCrmNotes — default true; HubSpot excerpts per company",
      "includeQuietCompanies — default false; omit portcos with zero facts in the window",
    ],
    output: [
      "ToolRunEnvelope: companies[] with linkedInSignals, crmNotes per portco (Monday optional if wired later)",
      "unlinkedLinkedInSignals for events without portfolio mapping",
      "summary.totalFacts and companiesWithActivity — Claude classifies themes, does not publish",
    ],
    nextTools: [
      { name: "signal_hub_recent_signals", when: "Drill into one active company" },
      { name: "prepare_board_brief", when: "Deep brief on the top portco in the digest" },
    ],
    limitations: [
      "Does not assign editorial themes (ops / hiring / funding) — orchestrator LLM does",
      "Quiet portcos omitted by default — pass includeQuietCompanies for full roster",
      "No auto-generated LinkedIn post text",
    ],
    sources: ["monday", "signal_hub", "hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  build_company_360_context: meta({
    summary:
      "Multi-section assembler for a full company dossier. Use when the user wants "
      + "« everything on X ». Prefer atomic tools when only one slice is needed.",
    whenToUse: [
      "Pre-call brief requiring CRM + docs + portfolio context",
      "Internal digest covering multiple data sources in one call",
    ],
    inputTips: [
      "sections — pick profile, crm_activity, documents, portfolio_signals, events",
      "Provide portfolioCompanyId OR startupId/startupName",
    ],
    output: [
      "Combined sections with warnings[] for missing linkages or empty connectors",
    ],
    nextTools: [
      { name: "read_company_document_excerpt", when: "Drill into a specific Drive file" },
      { name: "signal_hub_recent_signals", when: "LinkedIn activity missing from Monday" },
    ],
    sources: ["hubspot", "monday", "drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  list_company_crm_activity: meta({
    summary:
      "Batch-read HubSpot notes, deals, and meetings for one company in a single call. "
      + "Efficient CRM timeline reconstruction.",
    whenToUse: [
      "« What happened with this company in CRM? »",
      "After resolve_entity when you need deals + notes + meetings together",
    ],
    inputTips: [
      "Prefer startupId from resolve_entity",
      "portfolioCompanyId resolves via Monday name token when startup id unknown",
      "Toggle includeNotes/includeDeals/includeMeetings to shrink payload",
    ],
    output: ["notes[], deals[], meetings[] — permission-filtered, recency-sorted"],
    nextTools: [
      { name: "read_company_document_excerpt", when: "Notes reference a deck in Drive" },
    ],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  read_startup_notes: meta({
    summary: "Read permission-filtered HubSpot notes for one startup.",
    whenToUse: ["Deep dive on CRM notes when list_company_crm_activity is too broad"],
    inputTips: ["Require startupId or exact startupName"],
    output: ["Notes sorted by recency; sensitive fields redacted per caller tier"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  read_startup_deals: meta({
    summary: "Read HubSpot deals for one startup, sorted by latest update.",
    whenToUse: ["Pipeline stage review or closing context"],
    inputTips: ["startupId preferred over startupName"],
    output: ["Deals with status mapped to Tomcat funnel stages"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  read_startup_meetings: meta({
    summary: "Read HubSpot meetings for one startup, most recent first.",
    whenToUse: ["Rebuild meeting timeline before a call"],
    inputTips: ["startupId preferred"],
    output: ["Meetings with subject, attendees, occurredAt"],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  list_portfolio_signals: meta({
    summary: "Monday portfolio signals (hires, funding, press, risk) for one portco.",
    whenToUse: ["Portfolio risk scan when Monday signal board is populated"],
    inputTips: ["sinceDays defaults to 30"],
    output: ["PortfolioSignal[] — may be empty if Monday board not wired"],
    limitations: ["Prefer signal_hub_recent_signals for LinkedIn-native signals"],
    nextTools: [
      { name: "signal_hub_recent_signals", when: "Monday returns empty" },
    ],
    sources: ["monday"],
    access: "confidential",
    approvalRequired: false,
  }),

  list_company_documents: meta({
    summary: "List Google Drive files whose names contain the portfolio company token.",
    whenToUse: [
      "Find board packs, BP folders, or reporting docs",
      "Before read_company_document_excerpt",
    ],
    inputTips: [
      "portfolioCompanyId — same token as Monday/Drive naming convention",
      "titleContains — optional filename filter (e.g. « board »)",
    ],
    output: ["documents[] with driveFileId, title, citation metadata"],
    nextTools: [
      { name: "resolve_company_drive_folder", when: "Locate the company folder before listing files" },
      { name: "read_company_document_excerpt", when: "Extract text from a listed file" },
    ],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  read_company_document_excerpt: meta({
    summary:
      "Extract plain text from a Google Doc, Slide, or Sheet listed by list_company_documents.",
    whenToUse: ["Read deck or board pack content for synthesis"],
    inputTips: [
      "driveFileId must come from list_company_documents for the same portfolioCompanyId",
      "maxChars default 8000; use charOffset for pagination",
    ],
    limitations: ["PDF/binary scans are not text-extractable — warning returned"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  list_portfolio_context: meta({
    summary: "Monday portfolio row + signals + upcoming events for one portco.",
    whenToUse: ["Lightweight portfolio context without full 360"],
    inputTips: ["sinceDaysSignals defaults to 30"],
    output: ["portfolioRow, signals[], upcomingEvents[], warnings[]"],
    limitations: ["Signals/events may be empty until Monday boards are wired"],
    sources: ["monday"],
    access: "confidential",
    approvalRequired: false,
  }),

  signal_hub_list_watched: meta({
    summary: "List entities on the LinkedIn Signal Hub watchlist.",
    whenToUse: ["See which founders/companies are monitored", "Audit watchlist coverage"],
    inputTips: ["priority filter: hot | warm | cold"],
    output: ["Watched entities with linkedinUrl, startupId, priority"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
  }),

  signal_hub_add_watched: meta({
    summary: "Add a founder or company to the Signal Hub watchlist.",
    whenToUse: ["User asks to track LinkedIn activity for a person or portco"],
    prerequisites: ["internal_team role"],
    inputTips: ["Link to HubSpot via startupId when known"],
    nextTools: [
      { name: "signal_hub_request_refresh", when: "Enqueue first signal fetch" },
    ],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
  }),

  signal_hub_set_priority: meta({
    summary: "Set polling priority (hot/warm/cold) for a watched entity.",
    whenToUse: ["Prioritize veille for active deals or hot portcos"],
    prerequisites: ["internal_team role"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
  }),

  signal_hub_recent_signals: meta({
    summary: "Recent LinkedIn signals for one watched entity or HubSpot startup.",
    whenToUse: [
      "Friday News material, board prep LinkedIn context",
      "Fallback when Monday list_portfolio_signals is empty",
    ],
    prerequisites: ["watchedId OR startupId"],
    inputTips: [
      "sinceIso — ISO datetime lower bound",
      "textContains — filter posts mentioning keyword",
      "signalType — post | reaction | comment | profile_change",
    ],
    nextTools: [
      { name: "signal_hub_request_refresh", when: "Signals stale or empty" },
    ],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
  }),

  signal_hub_search_signals: meta({
    summary: "Cross-entity signal search (e.g. hiring posts across portfolio).",
    whenToUse: [
      "« Which portcos posted about hiring? »",
      "Portfolio-wide LinkedIn scan without naming one entity",
    ],
    inputTips: ["textContains + sinceIso are the main filters", "limit max 100"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
  }),

  signal_hub_resolve_entity: meta({
    summary: "Resolve a name or LinkedIn URL to a Signal Hub watchedId.",
    whenToUse: ["Before signal_hub_recent_signals when user gives a loose name"],
    output: ["watchedId or needsClarification with candidates"],
    nextTools: [
      { name: "signal_hub_recent_signals", when: "Entity resolved" },
    ],
    sources: ["signal_hub", "hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  signal_hub_list_accounts: meta({
    summary: "Status of Unipile LinkedIn accounts (quota, freeze state, errors).",
    whenToUse: ["Before unipile refresh", "Debug Signal Hub ingestion"],
    prerequisites: ["internal_team role"],
    sources: ["signal_hub"],
    access: "internal",
    approvalRequired: false,
  }),

  signal_hub_request_refresh: meta({
    summary:
      "Enqueue async LinkedIn signal refresh. Returns immediately with jobId — never blocks on Unipile/Serper.",
    whenToUse: ["User wants fresh LinkedIn data for a watched entity"],
    inputTips: [
      "source defaults to serper_public (no LinkedIn account needed)",
      "unipile requires active account — check signal_hub_list_accounts first",
    ],
    output: ["{ jobId, accepted: true } — poll with signal_hub_recent_signals after delay"],
    sources: ["signal_hub"],
    access: "confidential",
    approvalRequired: false,
  }),

  signal_hub_freeze_account: meta({
    summary: "Emergency freeze of a Unipile LinkedIn account.",
    whenToUse: ["Kill-switch on suspicious LinkedIn activity"],
    prerequisites: ["internal_team role", "Human approval — blocked on MCP stdio"],
    limitations: ["approvalRequired — use HTTP API for execution"],
    sources: ["signal_hub"],
    access: "internal",
    approvalRequired: true,
  }),
} as const satisfies Record<string, ToolDescriptionMeta>;

export type ToolCopyKey = keyof typeof TOOL_DESCRIPTIONS;
