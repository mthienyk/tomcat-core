# Tomcat Tool Catalog Candidates

This catalog is the canonical design layer for Tomcat Core tools. It is intentionally provider-neutral: each tool can be exposed as an MCP tool, an OpenAI function/tool, a Claude client tool, or a Gemini function declaration.

## Naming Rules

- Use ASCII names with letters, digits, dots, underscores and hyphens only.
- Keep names under 64 characters to stay portable across Gemini and MCP.
- Prefer domain prefixes: `crm`, `work`, `drive`, `investors`, `signals`, `briefs`, `policy`, `audit`, `content`, `finance`.
- Inputs are always one JSON object. Outputs are always structured objects with compact summaries and optional citations.

## Access Levels

- `public`: safe metadata or tool help.
- `internal`: Tomcat team operational data.
- `confidential`: deal, portfolio, investor or board context.
- `restricted`: legal, payroll, bank, shareholder, tax or outbound send workflows.

## V1 Read-Only Core

### `entity.resolve_company`

Resolves an ambiguous company, startup or deal name to canonical IDs before any sensitive lookup.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": { "type": "string", "description": "Company, startup or deal name fragment." },
    "sources": {
      "type": "array",
      "items": { "type": "string", "enum": ["hubspot", "monday", "drive"] },
      "description": "Allowed systems to search."
    }
  },
  "required": ["query"]
}
```

Output: `{ "matches": [{ "entityId": "...", "name": "...", "sourceIds": {...}, "confidence": 0.91 }], "needsClarification": false }`

Policy: `internal` minimum. Return multiple candidates instead of guessing.

### `crm.search_deals`

Searches HubSpot deals by stage, pipeline, sector, source, owner, recency and free-text name.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": { "type": ["string", "null"], "description": "Optional deal or company search phrase." },
    "sector": { "type": ["string", "null"] },
    "pipeline": { "type": ["string", "null"] },
    "stage": { "type": ["string", "null"] },
    "ownerId": { "type": ["string", "null"] },
    "createdSince": { "type": ["string", "null"], "description": "ISO date." },
    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 20 }
  },
  "required": ["query", "sector", "pipeline", "stage", "ownerId", "createdSince", "limit"]
}
```

Output: `{ "deals": [...], "filtersApplied": {...}, "citations": [...] }`

Policy: `confidential`. Never expose private notes unless paired with `crm.summarize_notes`.

### `crm.get_pipeline_summary`

Aggregates stage counts, dwell time and conversion patterns across HubSpot pipelines.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "pipeline": { "type": ["string", "null"] },
    "groupBy": { "type": "string", "enum": ["stage", "owner", "source", "sector"] },
    "dateRange": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "from": { "type": "string" },
        "to": { "type": "string" }
      },
      "required": ["from", "to"]
    }
  },
  "required": ["pipeline", "groupBy", "dateRange"]
}
```

Output: `{ "summary": [...], "notableChanges": [...], "warnings": [...] }`

Policy: `internal`; `confidential` if deal names are included.

### `crm.find_stale_deals`

Finds deals with no recent activity or too much time in one stage.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "minDaysInStage": { "type": "integer", "minimum": 1, "maximum": 365 },
    "minDaysSinceActivity": { "type": "integer", "minimum": 1, "maximum": 365 },
    "pipeline": { "type": ["string", "null"] }
  },
  "required": ["minDaysInStage", "minDaysSinceActivity", "pipeline"]
}
```

Output: `{ "deals": [{ "dealId": "...", "name": "...", "stage": "...", "daysInStage": 41, "daysSinceActivity": 18 }] }`

Policy: `internal`.

### `crm.summarize_notes`

Summarizes accessible HubSpot notes for a deal or company with redaction and citations.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "entityId": { "type": "string" },
    "topic": { "type": ["string", "null"] },
    "maxNotes": { "type": "integer", "minimum": 1, "maximum": 50 }
  },
  "required": ["entityId", "topic", "maxNotes"]
}
```

Output: `{ "themes": [...], "risks": [...], "citations": [...] }`

Policy: `confidential`. Confidential note bodies are summarized, not dumped.

### `crm.find_duplicate_companies`

Detects likely duplicate HubSpot company records by normalized domain, name and aliases.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": { "type": ["string", "null"] },
    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "required": ["query", "limit"]
}
```

Output: `{ "clusters": [{ "canonicalSuggestion": "...", "records": [...], "reason": "same_domain" }] }`

Policy: `internal`. No merges, read-only.

### `work.search_boards`

Searches Monday boards by startup, batch, board kind or owner.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": { "type": ["string", "null"] },
    "kind": { "type": ["string", "null"], "enum": ["company", "sprint", "task", "epic", "subitems", null] },
    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
  },
  "required": ["query", "kind", "limit"]
}
```

Output: `{ "boards": [{ "boardId": "...", "name": "...", "itemsCount": 40 }] }`

Policy: `internal`.

### `work.list_open_actions`

Lists open Monday actions for a company board, sprint or epic.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "boardId": { "type": "string" },
    "statusFilter": { "type": ["string", "null"] },
    "olderThanDays": { "type": ["integer", "null"], "minimum": 1, "maximum": 365 }
  },
  "required": ["boardId", "statusFilter", "olderThanDays"]
}
```

Output: `{ "actions": [{ "itemId": "...", "name": "...", "owner": "...", "status": "...", "ageDays": 12 }] }`

Policy: `internal`; `confidential` for company-specific investor or board actions.

### `work.find_blockers`

Finds blocked, stale or high-priority Monday items across boards.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "boardIds": { "type": "array", "items": { "type": "string" } },
    "severity": { "type": ["string", "null"], "enum": ["low", "medium", "high", null] }
  },
  "required": ["boardIds", "severity"]
}
```

Output: `{ "blockers": [...], "summary": "..." }`

Policy: `internal`.

### `drive.search_company_docs`

Searches Google Drive for company documents while respecting Drive ACLs.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "companyId": { "type": "string" },
    "documentType": {
      "type": ["string", "null"],
      "enum": ["memo", "board_deck", "legal", "finance", "reporting", "all", null]
    },
    "limit": { "type": "integer", "minimum": 1, "maximum": 25 }
  },
  "required": ["companyId", "documentType", "limit"]
}
```

Output: `{ "documents": [{ "fileId": "...", "name": "...", "mimeType": "...", "modifiedTime": "...", "citation": "drive://..." }] }`

Policy: `confidential`. Do not bypass Google permissions.

### `drive.check_folder_completeness`

Checks whether expected folder categories or files exist for a company or vehicle.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "entityId": { "type": "string" },
    "template": { "type": "string", "enum": ["pre_round", "portfolio_reporting", "vehicle_reporting"] }
  },
  "required": ["entityId", "template"]
}
```

Output: `{ "complete": false, "missing": ["legal"], "present": ["memo", "finance"], "citations": [...] }`

Policy: `confidential`; `restricted` for vehicle reporting.

### `signals.collect_weekly_highlights`

Collects compact, cited facts across HubSpot, Monday and Drive for internal digest workflows.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "dateRange": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "from": { "type": "string" },
        "to": { "type": "string" }
      },
      "required": ["from", "to"]
    },
    "audience": { "type": "string", "enum": ["internal", "investors", "marketing"] }
  },
  "required": ["dateRange", "audience"]
}
```

Output: `{ "facts": [{ "claim": "...", "source": "...", "citation": "..." }], "excluded": [...] }`

Policy: `internal` minimum. Investor-facing outputs require downstream approval.

### `briefs.build_company_360`

Builds a cross-system view of one company with CRM state, Monday actions, Drive docs and cited risks.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "companyId": { "type": "string" },
    "sections": {
      "type": "array",
      "items": { "type": "string", "enum": ["crm", "work", "docs", "risks", "next_actions"] }
    }
  },
  "required": ["companyId", "sections"]
}
```

Output: `{ "profile": {...}, "sections": {...}, "citations": [...], "redactions": [...] }`

Policy: `confidential`.

### `policy.evaluate_request`

Evaluates whether a request is allowed, needs clarification, needs approval or must be refused.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "requestText": { "type": "string" },
    "persona": { "type": "string" },
    "requestedSources": { "type": "array", "items": { "type": "string" } },
    "operation": { "type": "string", "enum": ["read", "summarize", "export", "draft", "send", "write"] }
  },
  "required": ["requestText", "persona", "requestedSources", "operation"]
}
```

Output: `{ "decision": "allowed|clarify|approval_required|refused", "reason": "...", "requiredApprovals": [...] }`

Policy: always available. It does not read business data.

### `tools.search_catalog`

Searches the tool catalog by user task and returns candidate tool definitions.

Input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 10 }
  },
  "required": ["query", "limit"]
}
```

Output: `{ "tools": [{ "name": "...", "description": "...", "why": "..." }] }`

Policy: public metadata only.

## V2 and Restricted Tools

These tools should not execute without tighter policy, citations and approval flows.

- `investors.match_deal`: matches a deal with investor profiles. Requires source-grounded explanations and no hallucinated affinity.
- `comms.prepare_outbound_batch`: prepares recipients and message drafts. Requires human approval before send.
- `comms.draft_digest`: drafts WhatsApp/email digest from cited facts. Requires human approval before external distribution.
- `content.draft_grounded_posts`: drafts LinkedIn posts from verified facts. Requires claim safety review.
- `content.review_claim_safety`: checks drafts for investment promises, unsupported performance claims and confidentiality leaks.
- `finance.collect_kpi_reports`: reads restricted finance files and returns KPI deltas with citations.
- `finance.reconcile_revenue`: compares bank exports and declared revenue. Restricted and never exposed raw bank rows to the model.
- `legal.summarize_obligations`: summarizes shareholder or legal documents. Requires explicit approval and legal disclaimer.
- `audit.search_tool_runs`: searches AI/tool audit logs for admin review.
- `ops.estimate_enrichment_cost`: estimates enrichment spend before external enrichment calls.

## Execution Guardrails

1. Resolve entities before sensitive reads.
2. Prefer summaries and citations over raw dumps.
3. Enforce source ACLs first, then Tomcat role policies.
4. Require approvals for write, send, export and restricted finance/legal operations.
5. Log every tool call with principal, tool name, redacted args, decision, latency and citation count.
6. Return tool execution errors as structured, model-readable feedback so the planner can self-correct.
