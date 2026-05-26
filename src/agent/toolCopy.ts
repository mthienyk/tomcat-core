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
      "Portfolio explorer by HubSpot sector tag: list startups sharing a sector "
      + "with a reference company, with ranked note excerpts. Not semantic search — "
      + "tags are coarse (e.g. marketplace spans many unrelated verticals).",
    whenToUse: [
      "Broad portfolio scan: « all marketplace / fintech / saas companies we have seen »",
      "After find_similar_cases when you want sector-tagged peers as a secondary lens",
      "NOT for M1 prep on a precise product wedge — use find_similar_cases instead",
    ],
    prerequisites: [
      "Reference startup via startupId or unambiguous startupName, OR a sector filter",
    ],
    inputTips: [
      "startupId — list peers sharing HubSpot sector tags with this company",
      "sector — list all visible startups with this sector tag",
      "limit — max startups (default 10)",
      "notesPerMatch — note excerpts per match (default 5, max 10)",
      "authorEmail — filter excerpts to one author after matches are found",
    ],
    output: [
      "ToolRunEnvelope with data.referenceStartup, data.matches[], note excerpts",
      "searchBasis: shared_sectors_with_reference or sector filter",
      "Excerpts ranked by M1/M2 quality boost then recency",
    ],
    nextTools: [
      { name: "find_similar_cases", when: "Product-wedge or cross-segment semantic memory" },
      { name: "read_startup_notes", when: "Full notes for one historical match" },
    ],
    limitations: [
      "Sector tags are HubSpot metadata, not product semantics",
      "A marketplace tag includes proptech, BTP, and unrelated verticals",
      "Does not replace find_similar_cases for M1/M2 prep on a specific wedge",
    ],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  find_similar_cases: meta({
    summary:
      "Tomcat semantic CRM memory: vector search over LLM-refined note excerpts "
      + "(recap + investment_lens per note). recap mixes facts and plain-language concepts "
      + "for retrieval; investment_lens holds Tomcat judgment.",
    whenToUse: [
      "M1/M2 prep: « have we seen a similar product wedge / GTM / judgment profile? »",
      "Conceptual CRM search (retention problems, GTM issues, engagement) via query or searchTexts",
      "Cross-segment memory when HubSpot sector tags are incomplete or misleading",
      "When you have a reference note: noteId anchor (best scores)",
      "When you have a reference startup: startupId excludes it and attaches metadata",
      "Combine with grep_crm_notes for exact terms (proper nouns, tools, named metrics)",
    ],
    prerequisites: [
      "resolve_entity first when prepping a known company",
      "Requires semantic index (Postgres + embeddings worker)",
    ],
    inputTips: [
      "INDEX SHAPE — each note is offline-refined into two embedded excerpts: recap (facts, metrics, market + plain-language concepts for retrieval) and investment_lens (Tomcat judgment, red flags, M1/M2 conclusion). Not raw HubSpot bodies.",
      "searchTexts (preferred for M1 prep) — 1–2 excerpts in recap/investment_lens style. Operational vocabulary (Silae, PayFit, NRR cohorte, canal expert-comptable), not user questions.",
      "query — natural-language concept search over the same index (rich recap should match). Example: « startups qui perdent beaucoup d'utilisateurs ».",
      "For exact terms (McDonalds, PayFit, churn 41%), combine with grep_crm_notes in parallel.",
      "Good recap-style: \"Pinql — app mobile gestion locative pour proprio particuliers et foncières. Bail digital, MRR 6 k€, wedge B2B foncières. Pénètre le marché locatif mais conversion foncières encore faible — risque GTM long cycle.\"",
      "Good lens-style: \"Early-stage proptech, wedge B2B foncières crédible si drop legacy. Valo 6-7 M€ vs MRR ~6 k€. Concurrents Welmo, Qeeps.\"",
      "Bad: \"Quelles boîtes similaires avons-nous vues?\" (question format).",
      "chunkKind recap — product/feature similarity. Default for product questions.",
      "chunkKind investment_lens — Tomcat judgment profile. May return cross-sector matches.",
      "noteId — embed indexed recap + investment_lens chunks (note_anchor); falls back to raw body if not indexed yet.",
      "startupId — exclude reference company; prefer this over searchTexts alone when reference is known.",
      "Do NOT pass authorEmail on the first call — search broadly, then read_startup_notes with authorEmail for Élie perspective.",
      "TEMPLATE payroll recap: \"NessPay-style SaaS paie intégrée Silae/PayFit, distribution via cabinets comptables, avance sur salaire PME. Connecteurs paie natifs, churn et NRR par cohorte.\"",
      "TEMPLATE HR SMB recap: \"HR Tech SaaS entretiens annuels et GPEC pour PME/ETI blue-collar. Churn très faible, contrats upfront multi-années, CVR demo faible.\"",
      "TEMPLATE proptech recap: \"Pinql-style app gestion locative pour proprio particuliers et foncières. Bail digital, mandataire B2C, wedge B2B foncières au nb de lots.\"",
      "Prefer prepare_m1_meeting_brief when Élie asks for M1 prep in natural language — it generates searchTexts server-side.",
      "sinceDays — optional recency window",
    ],
    output: [
      "ToolRunEnvelope: matches[] with whySimilar, soWhat, topEvidence (noteId + date)",
      "regimeSignals — scoreLevel (encoding-regime conformance, NOT match quality), vocabularyMatch, topScore",
      "qualitySignals — topClusterCoherence, noisyTopMatch (top 1 may be a high-score outlier), scoreDispersion",
      "suggestedRewrite — when regimeSignals indicate misaligned searchTexts",
    ],
    nextTools: [
      { name: "read_startup_notes", when: "Full notes on top 2–3 matches; add authorEmail=elie here" },
      { name: "grep_crm_notes", when: "Exact terms (proper nouns, tools, metrics) to complement vector hits" },
      { name: "find_competitive_history", when: "Broad sector-tag portfolio scan as complement only" },
    ],
    limitations: [
      "Score measures encoding-regime conformance, not guaranteed relevance — inspect qualitySignals.noisyTopMatch",
      "find_competitive_history sector tags are too coarse for precise wedge search",
      "Returns empty with CRM_MEMORY_INDEX_EMPTY until indexing worker has run",
    ],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  grep_crm_notes: meta({
    summary:
      "Keyword search over HubSpot note bodies plus indexed semantic metadata "
      + "(competitorNames, markets). Complements find_similar_cases vector search.",
    whenToUse: [
      "Find exact mentions: product names, tools (Silae, PayFit, Rosaly), metrics, proper nouns (McDonalds)",
      "When semantic search misses because searchTexts are misaligned or the concept has no exact keyword in notes",
      "Competitor names extracted from a deck or prepare_m1_meeting_brief",
      "For conceptual queries (retention problems, GTM issues, low engagement), call find_similar_cases in parallel — grep will not surface cases when the exact word is absent from notes",
    ],
    inputTips: [
      "query — space-separated terms; use quotes for phrases (\"gestion locative\")",
      "matchMode all (default) — every term must appear; any — at least one term",
      "Prefer proper nouns alone (Rosaly, PayFit) over ambiguous French (avance, paie) in any mode",
      "Also searches index meta competitorNames/markets when note body has no hit",
    ],
    output: [
      "matches[] with noteId, matchSource (note_body | index_meta), matchedField when index_meta",
      "Full bodies via read_startup_notes on selected noteId",
    ],
    nextTools: [
      { name: "read_startup_notes", when: "Full note body for a grep hit" },
      { name: "find_similar_cases", when: "Semantic neighbors — use query for concepts, searchTexts for M1-style prep" },
    ],
    limitations: [
      "Substring match only — no stemming or fuzzy match yet",
      "Ambiguous French terms filtered in matchMode any when combined with other terms",
    ],
    sources: ["hubspot"],
    access: "confidential",
    approvalRequired: false,
  }),

  prepare_m1_meeting_brief: meta({
    summary:
      "Orchestrated M1 prep brief for Élie: deck excerpt + LLM-generated searchTexts, "
      + "semantic similar cases, competitor keyword grep, existing CRM highlights.",
    whenToUse: [
      "Élie prepares an M1 tomorrow and asks for similar companies / competitive memory",
      "Natural-language M1 prep without hand-writing searchTexts",
      "After resolve_entity when startupId is known",
    ],
    prerequisites: [
      "resolve_entity when company name is ambiguous",
      "Semantic CRM index (find_similar_cases)",
    ],
    inputTips: [
      "startupId or startupName (required)",
      "oralContext — optional 4–5 prep angles Élie identified orally before the call",
      "sinceDays — default 1095 (~3 years)",
      "similarLimit — default 5 semantic matches",
    ],
    output: [
      "generatedSearchTexts — server-side recap-style excerpts used for vector search",
      "similarCases — same shape as find_similar_cases",
      "competitorGrep — keyword hits per grounded competitor hint (names must appear in deck, CRM, or oralContext)",
      "competitorHintsDropped — LLM-suggested names filtered out when not in source material",
      "prepAngles — suggested diligence angles",
      "existingCrmHighlights — prior notes on this startup",
    ],
    nextTools: [
      { name: "read_startup_notes", when: "Full Élie notes on top similar match" },
      { name: "find_similar_cases", when: "Refine with manual searchTexts if regimeSignals low" },
    ],
    limitations: [
      "Deck optional — brief proceeds with CRM + profile if Drive deck missing",
      "searchTexts quality depends on deck excerpt and LLM availability",
    ],
    sources: ["hubspot", "drive"],
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
      "Call assemble_company_finance_pack then restructure_founder_bp — not draft slices alone",
    ],
    sources: ["playbook"],
    access: "confidential",
    approvalRequired: false,
  }),

  assemble_company_finance_pack: meta({
    summary:
      "Start BP workflow: classify Drive inputs, pick top founder BP, detect transform/hybrid/generate.",
    whenToUse: [
      "After read_bp_playbook + resolve_entity — always the first Drive pass for BP",
    ],
    inputTips: [
      "driveTokens + companyLabel (canonicalName) from resolve_entity — required when names diverge",
      "Omit titleContains — auto-matches BP, Business Plan, DSN, loan filenames",
      "alternateFounderBps — ask the user which scenario if multiple",
    ],
    output: [
      "recommendedMode, founderBpFile, alternateFounderBps[], classifiedFiles[], inputSummary",
    ],
    nextTools: [
      { name: "restructure_founder_bp", when: "transform or hybrid with founderBpFile" },
      { name: "read_company_document_excerpt", when: "hybrid — debt/DSN PDFs to overlay" },
    ],
    limitations: ["Generate mode (no founder BP) not automated — agent + user from template"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  restructure_founder_bp: meta({
    summary:
      "Primary BP tool: structured draft + coverage + reviewBrief for the agent to present in French.",
    whenToUse: [
      "After assemble — main deliverable before export",
      "Agent reads reviewBrief.agentTasks and confirmBeforeExport with the finance reviewer",
    ],
    inputTips: [
      "companyLabel — pass canonicalName from resolve_entity for readable export filename",
      "recommendedMode — pass from assemble recommendedMode",
    ],
    output: [
      "draft, coverage (exportReady flag), parseDiagnostics, reviewBrief { summaryForChat, confirmBeforeExport, agentTasks }",
    ],
    nextTools: [
      { name: "read_bp_tab_preview", when: "parseDiagnostics show low confidence on Financement or RH" },
      { name: "export_business_plan", when: "Only after the user explicitly asks to export and coverage.exportReady" },
    ],
    limitations: [
      "Does not replace agent judgment on CA/AACE — surfaces assumptions for discussion",
      "Export blocked if placeholders remain or parseDiagnostics.financement confidence is low",
    ],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  read_bp_tab_preview: meta({
    summary:
      "Preview a founder BP tab as TSV with detected layout — CFO inspection before validating Financement/RH.",
    whenToUse: [
      "parseDiagnostics confidence is low",
      "Finance reviewer wants to see raw tab structure before export",
      "Hybrid mode — cross-check BNP Loan tab vs Drive PDF échéanciers",
    ],
    inputTips: [
      "tabName — optional; defaults to debt, payroll, or revenue tab",
      "maxRows — default 25; increase up to 60 for wide models",
    ],
    output: ["previewTsv, detectedLayouts { debt?, payroll? }, availableTabs[]"],
    nextTools: [
      { name: "restructure_founder_bp", when: "After layout review — rerun with updated understanding" },
      { name: "read_company_document_excerpt", when: "Hybrid — read loan PDF schedules on Drive" },
    ],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  export_business_plan: meta({
    summary:
      "Export values-only Tomcat xlsx (Financement + RH). Requires confirmed: true after explicit user approval in chat.",
    whenToUse: [
      "User explicitly confirmed export after reviewing reviewBrief",
    ],
    prerequisites: [
      "restructure_founder_bp completed with coverage.exportReady true",
      "confirmed: true only when the user asked in the conversation",
    ],
    inputTips: [
      "Agent: decode xlsxBase64 and help the user save the file (artifact/download features)",
      "companyLabel for filename — not raw HubSpot id",
    ],
    output: ["xlsxBase64, filename, coverage, parseDiagnostics, agentNextStep"],
    limitations: [
      "Blocked when parseDiagnostics.financement confidence is low",
      "V1: Financement + RH values only; P&L/trésorerie/BPI keep template formulas — manual relink",
      "Not uploaded to Drive automatically",
    ],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  draft_bp_tab_debt: meta({
    summary: "Optional slice: Financement draft only. Prefer restructure_founder_bp for full workflow.",
    whenToUse: ["Debug debt parsing on a specific founder BP tab"],
    inputTips: ["driveTokens when alternate Drive token used"],
    limitations: ["Use restructure_founder_bp for the normal BP workflow"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  draft_bp_tab_payroll: meta({
    summary: "Optional slice: RH draft only. Prefer restructure_founder_bp.",
    whenToUse: ["Debug payroll parsing on a specific founder BP tab"],
    limitations: ["Use restructure_founder_bp for the normal BP workflow"],
    sources: ["drive"],
    access: "confidential",
    approvalRequired: false,
  }),

  draft_bp_tab_revenue: meta({
    summary:
      "Optional slice: CA pattern hint. Agent must still discuss revenue model with the user — not auto-fill CA.",
    whenToUse: ["Inspect founder revenue tab structure before agent-led CA discussion"],
    limitations: ["Does not produce export-ready CA — agent validates assumptions with the user"],
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
