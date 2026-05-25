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
      { name: "summarize_company_activity", when: "Single candidate confirmed — default CRM read" },
      { name: "find_latest_deck", when: "User asks for deck or pitch (not financial BP model)" },
      { name: "read_bp_playbook", when: "User asks to generate, restructure, or review a Business Plan" },
      { name: "resolve_company_drive_folder", when: "Locate BP inputs folder (purpose: bp_inputs)" },
      { name: "find_competitive_history", when: "Compare against prior deals in the same sector" },
      { name: "list_company_documents", when: "Browse all Drive docs, not just deck" },
      { name: "prepare_board_brief", when: "Explicit board or comité prep only" },
      { name: "list_company_crm_activity", when: "Full raw CRM dump needed (prefer summarize first)" },
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
      + "or sector, with ranked note excerpts (M1/M2 synthesis prioritized). "
      + "Opinionated alternative to raw sector search.",
    whenToUse: [
      "Prep M1/M2: « what similar companies have we seen? »",
      "« Sors-moi les boîtes concurrentes qu'on a vues sur ce segment »",
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
      "notesPerMatch — note excerpts per match (default 5, max 10)",
      "authorEmail — filter excerpts to one author (e.g. elie.dupredesaintmaur@tomcat.eu for Élie M1/M2 notes)",
    ],
    output: [
      "ToolRunEnvelope with data.referenceStartup, data.matches[], note excerpts with authorEmail",
      "Excerpts ranked by M1/M2 quality boost then recency, not raw recency only",
      "warnings when ambiguous name or empty matches",
      "nextSuggestedTools for deeper CRM reads",
    ],
    nextTools: [
      { name: "read_startup_notes", when: "Full notes for one historical match" },
      { name: "find_similar_cases", when: "Semantic similarity beyond sector tags" },
      { name: "read_company_document_excerpt", when: "Deck or board pack for a match" },
    ],
    limitations: [
      "Similarity is sector-based today, not semantic deck analysis",
      "Only startups visible to the caller ACL",
      "Use find_similar_notes (planned) for cross-segment semantic memory",
    ],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  find_similar_cases: meta({
    summary:
      "Tomcat semantic memory: find historically seen startups similar to a reference company, "
      + "a free-text question, or a note anchor. Returns company-level matches with cited evidence notes.",
    whenToUse: [
      "Prep M1/M2: « have we seen similar cases before? »",
      "After resolve_entity when sector tags are incomplete or misleading",
      "Cross-segment memory: payroll, GTM motion, red flags, market view",
    ],
    prerequisites: [
      "Prefer startupId from resolve_entity for prep workflows",
      "Requires semantic index (Postgres + embeddings worker)",
    ],
    inputTips: [
      "startupId — primary input when prepping a known company",
      "query — free-text when no reference startup is resolved yet",
      "authorEmail — filter evidence to one author (e.g. Élie M1/M2 notes)",
      "sinceDays — limit to recent history",
      "chunkKind — investment_lens for Tomcat judgment, recap for general similarity",
    ],
    output: [
      "ToolRunEnvelope with matches[] aggregated by startupId",
      "Each match: whySimilar, soWhat, topEvidence note excerpts with ids",
      "indexStats.chunksIndexed surfaces empty-index warnings",
    ],
    nextTools: [
      { name: "read_startup_notes", when: "Full note bodies for a top match" },
      { name: "find_competitive_history", when: "Sector-tagged peers as complement" },
    ],
    limitations: [
      "Returns empty with CRM_MEMORY_INDEX_EMPTY until the indexing worker has run",
      "Semantic similarity complements but does not replace sector-based history",
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
      "Before assemble_company_finance_pack, restructure_founder_bp, or draft_business_plan (when available)",
      "« Where is the Série A folder for [Boîte]? »",
      "Check which BP or M2 inputs are missing in Drive",
      "Start of any BP workflow — after read_bp_playbook and resolve_entity",
    ],
    prerequisites: [
      "portfolioCompanyId from resolve_entity, or startupId/startupName with Monday linkage",
    ],
    inputTips: [
      "purpose — company_root (default), series_a, pre_round, m2_financial, bp_inputs, reporting",
      "driveTokens — pass from resolve_entity when folder search misses on portfolioCompanyId alone",
      "folderLimit — max folder candidates (default 10)",
      "inventoryLimit — max items listed inside the primary folder (default 50)",
    ],
    output: [
      "ToolRunEnvelope: primaryFolder with path, folderCandidates[], inventory[]",
      "presentInputs / missingInputs when purpose is not company_root",
      "For bp_inputs: keyword hints for BP file, DSN, loan, history (filename-based)",
      "warnings when folder missing, ambiguous, or inputs incomplete",
    ],
    nextTools: [
      { name: "read_bp_playbook", when: "First BP on this company — confirm transform vs generate mode" },
      { name: "list_company_documents", when: "Flat search when folder inventory is incomplete" },
      { name: "read_company_document_excerpt", when: "Extract text from a listed file" },
    ],
    limitations: [
      "Requires GOOGLE_DRIVE_SHARED_DRIVE_ID on the server (Tomcat Drive shared drive)",
      "Folder discovery tries driveTokens[] then portfolioCompanyId substring match",
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

  find_latest_deck: meta({
    summary:
      "Returns the most recent deck-like Drive file (pitch, BP, Slides) for a company, "
      + "with ranked alternates and an optional text excerpt when extractable.",
    whenToUse: [
      "« Quel est le dernier deck de [Boîte] ? »",
      "« Montre-moi le pitch »",
      "Presentation materials — **not** the primary tool for financial BP Excel models",
    ],
    inputTips: [
      "Prefer startupId from resolve_entity; portfolioCompanyId is the Drive folder token",
      "maxExcerptChars — default 4000, max 12000",
      "alternateLimit — other ranked deck candidates (default 3)",
    ],
    output: [
      "ToolRunEnvelope: deck (primary), alternates[], citations with driveFileId",
      "Warnings when folder token mismatches HubSpot name or file is binary PDF",
      "nextSuggestedTools for read_company_document_excerpt or resolve_company_drive_folder",
    ],
    nextTools: [
      { name: "read_company_document_excerpt", when: "Need a longer excerpt from the cited file" },
      { name: "read_bp_playbook", when: "User actually needs the financial BP model, not the pitch deck" },
      { name: "list_company_documents", when: "Search financial BP with titleContains: BP" },
      { name: "summarize_company_activity", when: "Cross-check CRM context against the deck" },
      { name: "resolve_company_drive_folder", when: "Deck search missed — browse the folder" },
    ],
    limitations: [
      "Ranking prefers pitch/deck over financial BP when both exist",
      "Title-based matching; PDF decks without deck/pitch/BP in the name may be missed",
      "Binary files (PDF, XLSX, PPTX) return metadata only unless Google native format",
    ],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  summarize_company_activity: meta({
    summary:
      "Default CRM read: ranked top facts (notes, deals, meetings) for one startup "
      + "in a single mini-livrable. Prefer this over chaining raw CRM tools.",
    whenToUse: [
      "« Que sait-on de [Boîte] ? »",
      "« Où en est le deal ? »",
      "After resolve_entity when the user wants CRM context, not a board pack",
      "Pre-M1/M2 quick context before deeper reads",
    ],
    inputTips: [
      "Prefer startupId from resolve_entity",
      "factLimit — default 12 ranked facts, max 25",
      "notesLimit / dealsLimit / meetingsLimit — scan window before ranking",
    ],
    output: [
      "ToolRunEnvelope: profile, summary stats, facts[] ranked by recency × relevance",
      "Pinned facts when present: Latest Elie note, Latest M1/M2 synthesis",
      "Each fact has kind, headline, occurredAt, author in detail, citation",
      "nextSuggestedTools for competitive history and Drive docs",
    ],
    nextTools: [
      { name: "find_competitive_history", when: "Sector peers or prior Tomcat memory needed" },
      { name: "find_similar_cases", when: "Semantic cross-segment memory for prep M1/M2" },
      { name: "find_latest_deck", when: "User asks for deck, pitch, or presentation" },
      { name: "list_company_documents", when: "Browse all Drive docs, not just deck" },
      { name: "read_startup_notes", when: "Full note bodies beyond ranked excerpts" },
      { name: "prepare_board_brief", when: "User explicitly asks for board prep" },
    ],
    limitations: [
      "Rule-based ranking today, not LLM synthesis inside the tool",
      "Does not read Drive or Signal Hub — CRM only",
    ],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  list_company_crm_activity: meta({
    summary:
      "Raw CRM batch read: notes, deals, and meetings for one company. "
      + "Prefer summarize_company_activity unless you need the full unparsed timeline.",
    whenToUse: [
      "Full CRM dump when summarize_company_activity is too selective",
      "Export-style timeline reconstruction",
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
    summary:
      "Read permission-filtered HubSpot notes for one startup, with optional author and recency filters.",
    whenToUse: [
      "Deep dive on CRM notes when list_company_crm_activity is too broad",
      "Read Élie M1/M2 synthesis notes on a company or peer match",
      "After find_competitive_history when excerpts need full bodies",
    ],
    inputTips: [
      "Require startupId or exact startupName",
      "authorEmail — filter to one author (substring match, case-insensitive)",
      "sinceDays — only notes created within the last N days",
      "minBodyLength — skip short ops notes (e.g. 500 for M1/M2-length synthesis)",
    ],
    output: [
      "Notes sorted by recency; sensitive fields redacted per caller tier",
      "Always cite note id, authorEmail, and createdAt in synthesis",
    ],
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
    summary:
      "List Google Drive files whose names contain the portfolio company token. "
      + "Primary discovery for founder BPs, DSN exports, and loan schedules.",
    whenToUse: [
      "Find financial BP models (titleContains: « BP » or « Business Plan »)",
      "After resolve_company_drive_folder when inventory is incomplete",
      "Before read_company_document_excerpt on a specific file",
    ],
    inputTips: [
      "portfolioCompanyId — same token as Monday/Drive naming convention",
      "driveTokens — pass from resolve_entity when HubSpot and Monday names diverge (e.g. KOMEET ex WENABI)",
      "titleContains — « BP » for financial models; avoid confusing with pitch decks",
    ],
    output: [
      "documents[] with driveFileId, title, citation metadata",
      "driveTokenUsed when multi-token lookup succeeds on an alternate name",
    ],
    nextTools: [
      { name: "read_bp_playbook", when: "Determine transform vs generate from file list" },
      { name: "read_company_document_excerpt", when: "Read a listed spreadsheet or Google Sheet export" },
      { name: "resolve_company_drive_folder", when: "Folder path unknown — locate bp_inputs first" },
    ],
    limitations: [
      "Filename search only — does not classify spreadsheet tabs or workflow mode",
      "Logos and marketing assets may appear if they contain the company token",
    ],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  read_company_document_excerpt: meta({
    summary:
      "Extract plain text from a Google Doc, Slide, or Sheet listed by list_company_documents.",
    whenToUse: [
      "Read founder BP spreadsheet exports for restructuring (transform mode)",
      "Read loan schedule or payroll table content before draft_bp_tab_* (when available)",
      "Board deck or memo synthesis",
    ],
    inputTips: [
      "driveFileId must come from list_company_documents for the same portfolioCompanyId",
      "maxChars default 8000; use charOffset for pagination",
      "For large Excel BPs: excerpt key tabs (Debt, Revenue, Payroll) in separate calls",
    ],
    nextTools: [
      { name: "read_bp_playbook", when: "Map excerpted tabs to canonical template structure" },
    ],
    limitations: [
      "PDF/binary scans are not text-extractable — warning returned",
      "Does not parse DSN XML; structured payroll must be Excel/Sheet or pasted grid (V1)",
    ],
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

  list_portfolio_companies: meta({
    summary:
      "Monday portfolio annuaire: all portcos visible to the caller with HubSpot linkage and Drive index counts.",
    whenToUse: [
      "List Tomcat portcos (~8) before picking one for board prep, BP, or digest",
      "Check HubSpot link status and Drive file coverage across the portfolio",
      "External investor: see only portcos in their tier",
    ],
    inputTips: ["No arguments — returns the full visible portco set (small, enumerable)"],
    output: [
      "total, companies[] with portfolioCompanyId, canonicalName, startupId, matchedSources, driveIndexedFileCount",
    ],
    nextTools: [
      { name: "resolve_entity", when: "Pick a portco for driveTokens and cross-system ids" },
      { name: "search_startups", when: "CRM funnel discovery by sector or name (not portcos)" },
      { name: "generate_portfolio_signal_digest", when: "Weekly portfolio highlights" },
    ],
    limitations: [
      "Monday portcos only — not the 1700+ HubSpot CRM funnel (use search_startups)",
      "driveIndexedFileCount reflects board_packs cache, not live Drive fallback",
    ],
    sources: ["monday", "hubspot", "drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  read_bp_playbook: meta({
    summary:
      "Tomcat BP methodology: canonical template structure, three workflow modes "
      + "(transform / generate / hybrid), tab mapping, DSN V1 scope, tool chain, and benchmark thresholds. "
      + "**Call this first** before any Business Plan task.",
    whenToUse: [
      "User asks to generate, restructure, review, or export a Business Plan",
      "Before inferring transform vs generate vs hybrid from Drive files",
      "When unsure whether a « BP Tomcat » file uses the canonical template (usually it does not)",
      "Before calling planned tools: assemble_company_finance_pack, restructure_founder_bp, draft_business_plan",
    ],
    inputTips: [
      "section — optional excerpt: modes | tools | mapping | payroll | debt | benchmark | mistakes",
    ],
    output: [
      "playbook — full markdown spec or section excerpt",
      "sections — index of topics covered",
      "version — playbook revision date",
    ],
    nextTools: [
      { name: "resolve_entity", when: "Company identified — get portfolioCompanyId and driveTokens" },
      { name: "assemble_company_finance_pack", when: "Classify Drive inputs and get recommendedMode" },
      { name: "resolve_company_drive_folder", when: "purpose: bp_inputs — folder and missing inputs" },
      { name: "list_company_documents", when: "Find founder BP xlsx and payroll/debt files" },
    ],
    limitations: [
      "Static methodology — does not read Drive or produce a BP draft",
      "Call assemble_company_finance_pack and draft_bp_tab_debt for Drive classification and Financement drafts",
    ],
    sources: ["playbook"],
    access: "confidential",
    approvalRequired: false,
  }),

  assemble_company_finance_pack: meta({
    summary:
      "Classify Drive finance inputs for a portco and return recommendedMode "
      + "(transform / generate / hybrid) plus founder BP candidate with optional sheet peek.",
    whenToUse: [
      "After read_bp_playbook and resolve_entity — start of any BP workflow for Guillaume",
      "Determine transform vs generate vs hybrid from Drive inventory",
      "Before draft_bp_tab_debt or restructure_founder_bp (when available)",
    ],
    prerequisites: [
      "portfolioCompanyId from resolve_entity",
      "read_bp_playbook called first on first BP task for this company",
    ],
    inputTips: [
      "driveTokens — pass from resolve_entity when HubSpot and Monday names diverge",
      "titleContains — narrow to « BP » or « Business Plan » for financial models",
      "peekFounderBpSheets — default true; reads sheet names from top founder xlsx for canonical detection",
    ],
    output: [
      "ToolRunEnvelope: recommendedMode, modeRationale, founderBpFile, classifiedFiles[], inputSummary",
      "warnings when inputs missing or canonical tabs already present",
      "nextSuggestedTools → draft_bp_tab_debt when transform/hybrid",
    ],
    nextTools: [
      { name: "draft_bp_tab_debt", when: "recommendedMode is transform or hybrid and founderBpFile is set" },
      { name: "read_company_document_excerpt", when: "Need to inspect payroll/debt file content" },
      { name: "resolve_company_drive_folder", when: "Folder path or missing inputs unclear" },
    ],
    limitations: [
      "Filename classification only except one optional xlsx sheet-name peek",
      "Does not produce an exportable BP — drafts require draft_* tools",
    ],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  draft_bp_tab_debt: meta({
    summary:
      "Confidential draft: parse founder BP Debt/Loan tab and map instruments to canonical Financement schema. "
      + "First end-to-end BP slice (benchmark: eSwit). Not exported to Drive.",
    whenToUse: [
      "After assemble_company_finance_pack identified a founder BP (transform/hybrid)",
      "Map eSwit-style Debt tab → Financement instruments 1:1",
      "Guillaume review before export_business_plan (when available)",
    ],
    prerequisites: [
      "founderBpFileId from assemble_company_finance_pack or list_company_documents",
      "portfolioCompanyId in scope",
    ],
    inputTips: [
      "sourceTab — default auto-detect (Debt, Loan, Financement); set explicitly if ambiguous",
      "Review mappingNotes and warnings — principal may be missing in founder models",
    ],
    output: [
      "ToolRunEnvelope: founderInstruments[], financementDraft (Zod-validated), mappingNotes[], status: confidential_draft",
      "citations with driveFileId of source spreadsheet",
    ],
    nextTools: [
      { name: "read_bp_playbook", when: "Validate Financement 1:1 benchmark thresholds (section: benchmark)" },
    ],
    limitations: [
      "Confidential draft only — never share externally or upload to Drive without approval",
      "V1 maps instrument rows, not monthly amortization schedules line-by-line",
      "export_business_plan not yet available — no xlsx output from this tool",
    ],
    sources: ["drive"],
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
