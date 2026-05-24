# Tomcat Business Plan (BP) Playbook

Methodology for Guillaume (CFO Partner) and finance workflows at Tomcat.
Call `read_bp_playbook` before any BP generation or restructuring task.

## Goal

Produce a **Tomcat-standard financial BP** (Excel deliverable) from what exists in Drive:
DSN/payroll exports, loan schedules, founder business plans, accounting history.

Target: ~90% auto-fill. Guillaume validates before export to the founder or board.

## Canonical template (reference)

Source of truth on Drive: `05. Templates BP / MAJ Template BP SaaS.xlsx` (not copied into git).

**12 tabs:**

| Tab | Role |
| --- | --- |
| Input Réalisé | Historical actuals (P&L realised) |
| Input Prévisionnel | Forecast assumptions entry point |
| CA | Revenue build (MRR, offers, usage) |
| AACE | External charges |
| RH | Payroll / headcount |
| Financement | Debt & equity schedules |
| P&L | Computed P&L |
| Plan de trésorerie | 12-month cash plan |
| BPI × 3 | BPI grant / loan reporting views |
| Tableaux Dossiers | Summary tables for dossiers |

**Portfolio reality (Drive audit):** 0% of portfolio deliverables use this template as-is.
Most files are **founder-custom** Excel models. A « Tomcat » or « BP Tomcat » filename
does **not** mean the canonical template was used.

## Three workflow modes (same engine, different entry)

| Mode | When | Drive signals | Primary tool (planned) |
| --- | --- | --- | --- |
| **transform** | Founder already has a usable BP | `.xlsx` with custom tabs (Debt, Revenue, Payroll…) and **no** canonical tabs | `restructure_founder_bp` |
| **generate** | No usable BP; only raw inputs | DSN/payroll export, loan PDF, accounting history; stub or empty BP | `draft_business_plan` |
| **hybrid** | Founder BP exists **and** fresh inputs to overlay | Custom BP + recent DSN or loan schedule | transform then refresh specific tabs |

**Estimated mix:** ~70% transform, ~15% generate, ~15% hybrid.

Auto-detection (planned in `assemble_company_finance_pack`):

- `founderBpFileId` present + canonical tabs absent → **transform**
- no founder BP + payroll/debt inputs present → **generate**
- both → **hybrid** (transform base, overlay RH from DSN, Financement from loan docs)

Until orchestrator tools ship, infer mode manually from Drive inventory and follow the chain below.

## Tool chain

### Available today

1. `resolve_entity` — company ids + drive token candidates
2. `resolve_company_drive_folder` — `purpose: "bp_inputs"` → folder path, present/missing inputs
3. `list_company_documents` — flat search; pass `driveTokens[]`, filter `titleContains: "BP"`
4. `read_company_document_excerpt` — read spreadsheet/text exports (not PDF scans)
5. `read_bp_playbook` — this document
6. `assemble_company_finance_pack` — classify Drive inputs; return `recommendedMode`
7. `draft_bp_tab_debt` — confidential Financement draft from founder Debt tab

### Planned (not yet callable)

| Tool | Role |
| --- | --- |
| `restructure_founder_bp` | Map all founder tabs → canonical template (transform) |
| `draft_business_plan` | Fill template from structured inputs (generate) |
| `draft_bp_tab_payroll` | RH tab from structured payroll input |
| `draft_bp_tab_revenue` | CA tab (MRR / usage / annual patterns) |
| `export_business_plan` | Write `.xlsx` (values only V1); **requires user approval** |

**Do not invent tool names or claim a draft exists until `export_business_plan` succeeds.**

## Founder tab → canonical mapping

When restructuring a founder BP, map by **semantic role**, not exact names:

| Founder signals | Canonical tab |
| --- | --- |
| Debt, Financial debt, Loan, BNP Loan | Financement |
| Payroll, Staff costs, RH, People | RH |
| Revenue, Revenues, MRR, topline, HYP-Revenues | CA |
| Cash, Cash FC, Plan de trésorerie | Plan de trésorerie |
| P&L, Compte de résultat | P&L |
| Assumptions, Hypothèses, Input | Input Prévisionnel |

Examples from Drive: eSwit (16 custom tabs), Webyn (BP-Cash, BNP Loan), Casawatt (Financial debt).

## Revenue patterns (CA tab)

Inspect the founder model or CRM context before filling CA:

| Pattern | When | Warning |
| --- | --- | --- |
| `monthly_mrr_multi_offer` | SaaS with tiered MRR (template default) | — |
| `annual_subscription` | Annual contracts dominant | Adjust churn/recognition |
| `usage_based` | Token/API usage (e.g. Umamy) | Do not force pure MRR |
| `custom` | None of the above | **Strong warning** — manual review required |

Never classify revenue with keyword rules alone; read the model and state assumptions.

## Payroll / DSN (V1 scope)

**V1:** structured payroll input only — Pennylane export, Excel table, or pasted grid.
**Not V1:** native XML DSN parser.

File classification on Drive (filename) finds DSN PDFs; extracting numbers requires
a structured export or manual excerpt via `read_company_document_excerpt`.

In **hybrid** mode: founder BP provides structure; payroll input **overwrites** RH tab.

## Debt / loans

Sources: BPI loan PDFs, bank amortization schedules (`échéancier`), tab « Debt » in founder BP.

Financement tab must reproduce each loan **1:1**: principal, rate, schedule, remaining balance.

First benchmark slice: `draft_bp_tab_debt` on eSwit (`Debt` tab → `Financement`).

## Success criteria (benchmark)

Before calling a BP « done », check:

| Metric | Threshold |
| --- | --- |
| Template structure | All 12 canonical tabs present |
| Financement | 1:1 match on each identified loan |
| P&L bottom line | ±5% vs source over 12 months |
| Plan de trésorerie | ±10% month-end cash over 12 months |
| RH / payroll | ±5% vs structured payroll input |

Benchmark companies: **eSwit** (transform), **Yuccan** or **Webyn** (hybrid).

## Confidentiality & approval

- `draft_*` tools → confidential drafts, not shared externally
- `export_business_plan` → **approval required**; include diff vs existing Drive BP
- Audit trail on reads of DSN/debt sources
- Never publish or upload to Drive without explicit user confirmation

## Common mistakes (orchestrator)

1. Assuming « BP Tomcat » in the filename means canonical template — it usually does not
2. Skipping `resolve_entity` when the company name is ambiguous (e.g. « Incom » matches Fincome)
3. Using `find_latest_deck` when the user needs the **financial model** — prefer `list_company_documents` with `titleContains: "BP"`
4. Treating M2 analysis workbooks (Supply Finder synthèse) as operational BPs
5. Promising formula-linked Excel in V1 — **V1 export is values only**; formulas relink in V2

## Related workflows

- **M2 financial analysis** — separate from operational BP; may share Drive inputs
- **Board prep** — `prepare_board_brief`; board deck ≠ financial BP
- **Latest pitch** — `find_latest_deck`; ranking prefers pitch decks over financial models
