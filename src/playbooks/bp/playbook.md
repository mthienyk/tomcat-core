# Tomcat Business Plan (BP) Playbook

Methodology for Tomcat finance BP workflows.
Call `read_bp_playbook` before any BP generation or restructuring task.

## Goal

Produce a **Tomcat-standard financial BP** (Excel deliverable) from what exists in Drive:
DSN/payroll exports, loan schedules, founder business plans, accounting history.

Target: auto-fill Financement + RH where parsing is reliable (~50% of editable tabs V1).
The finance reviewer validates CA, AACE, recrutements and approves export before the xlsx is written.

## Agent + MCP role split

| Layer | Who | Does what |
| --- | --- | --- |
| MCP | Tools | Drive discovery, classify inputs, parse spreadsheet tabs, structured draft JSON |
| Agent | Conversation | Present `reviewBrief`, discuss CA/AACE/recrutements in French, read PDF prêts/DSN via excerpt, decode `xlsxBase64` for download |
| Human | Finance reviewer | Validates `manualReviewTabs`, picks BP scenario if several on Drive, explicitly approves export |

**Use the agent's conversation and file capabilities** — do not try to auto-fill judgment tabs (CA, AACE) or export without explicit human approval.

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

| Mode | When | Drive signals | Primary tool |
| --- | --- | --- | --- |
| **transform** | Founder already has a usable BP | `.xlsx` with custom tabs (Debt, Revenue, Payroll…) | `restructure_founder_bp` |
| **generate** | No usable BP; only raw inputs | DSN/payroll export, loan PDF, accounting history | Agent + user from template (`draft_business_plan` planned) |
| **hybrid** | Founder BP exists **and** fresh inputs to overlay | Custom BP + recent DSN or loan schedule | `restructure_founder_bp` then `read_company_document_excerpt` on debt/DSN |

**Estimated mix:** ~70% transform, ~15% generate, ~15% hybrid.

Auto-detection in `assemble_company_finance_pack`:

- founder BP spreadsheet present → **transform** or **hybrid** (if payroll/debt inputs too)
- no founder BP + payroll/debt inputs present → **generate** (not automated — warning returned)
- neither → **generate** with missing-input warning

## Tool chain

### Primary chain

1. `read_bp_playbook` — this document
2. `resolve_entity` — company ids + `driveTokens` + `canonicalName` (use as `companyLabel`)
3. `assemble_company_finance_pack` — classify Drive inputs; return `recommendedMode`, `founderBpFile`
4. `restructure_founder_bp` — structured draft + `reviewBrief` + honest `coverage.autoFillPct`
5. Agent presents brief to the finance reviewer; hybrid: `read_company_document_excerpt` on debt/DSN PDFs
6. User approves export → `export_business_plan(confirmed: true)` → `xlsxBase64`

### Supporting tools

| Tool | Role |
| --- | --- |
| `resolve_company_drive_folder` | `purpose: "bp_inputs"` → folder path, present/missing inputs |
| `list_company_documents` | flat search; pass `driveTokens[]`; omit narrow `titleContains` — assemble auto-filters |
| `read_company_document_excerpt` | read spreadsheet/text exports; PDF prêts/DSN in hybrid mode |
| `draft_bp_tab_debt` | debug slice — Financement only (prefer `restructure_founder_bp`) |
| `draft_bp_tab_payroll` | debug slice — RH only |
| `draft_bp_tab_revenue` | CA pattern hint — agent still validates with the user |

### Planned

| Tool | Role |
| --- | --- |
| `draft_business_plan` | Fill template from structured inputs only (generate mode, ~15% cases) |

**Do not claim a BP is export-ready until `export_business_plan` succeeds with `confirmed: true`.**

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

- `draft_*` and `restructure_founder_bp` → confidential drafts, not shared externally
- `export_business_plan` → requires explicit user approval in chat (`confirmed: true`); agent decodes `xlsxBase64` for download — not uploaded to Drive automatically
- V1 export: **values only** on Financement + RH; P&L/trésorerie/BPI keep template formulas for manual relink
- Placeholders block export until restructure is clean
- Never publish or upload to Drive without explicit user confirmation

## Common mistakes (orchestrator)

1. Assuming « BP Tomcat » in the filename means canonical template — it usually does not
2. Skipping `resolve_entity` when the company name is ambiguous (e.g. « Incom » matches Fincome)
3. Using `find_latest_deck` when the user needs the **financial model** — prefer `assemble_company_finance_pack` (auto-filters BP titles)
4. Treating M2 analysis workbooks (Supply Finder synthèse) as operational BPs
5. Promising formula-linked Excel in V1 — **V1 export is values only**; formulas relink in V2

## Related workflows

- **M2 financial analysis** — separate from operational BP; may share Drive inputs
- **Board prep** — `prepare_board_brief`; board deck ≠ financial BP
- **Latest pitch** — `find_latest_deck`; ranking prefers pitch decks over financial models
