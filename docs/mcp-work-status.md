# MCP Tomcat — note de reprise

Dernière mise à jour : 2026-05-24 (read model seed validé)

Document de handoff pour reprendre le travail sur le MCP Tomcat Core. Spec normative : [mcp-use-cases.md](./mcp-use-cases.md). Read model Postgres : [local-read-model-handoff.md](./local-read-model-handoff.md). **Mémoire CRM / notes Élie** : [crm-notes-memory-handoff.md](./crm-notes-memory-handoff.md).

---

## Ce qu'on fait

Construire un **MCP opinionné** pour Tomcat : des tools orientés tâches (pas des wrappers API), consommables par Cursor (remote prod), Claude Desktop, Society, et futurs clients investisseurs.

| Surface | Auth | Tools exposés |
|---------|------|---------------|
| **Remote HTTP** (`/mcp` Scaleway) | MCP OAuth (Cursor) ou Bearer Google manuel | **19** tools (Signal Hub off) ou **28** (Signal Hub on) |
| **stdio local** | Google session (`npm run auth:google`) | Idem, piloté par `SIGNAL_HUB_ENABLED` |
| **HTTP `/ai/query`** | Bearer Google / service token | Registry complet (Signal Hub non filtré aujourd'hui) |

Principe clé : **resolve first** (`resolve_entity`) avant les reads ciblés. Outputs structurés via `ToolRunEnvelope`.

**Business Plan (Guillaume)** : appeler **`read_bp_playbook` en premier** — Claude n'a pas la méthode en mémoire ; le playbook + descriptions tools l'éduquent.

---

## Architecture actuelle (2026-05-24)

```
src/agent/toolRegistry.ts     ← source unique (schemas, handlers, access)
        │
        ├── src/agent/toolCopy.ts        ← descriptions éducatives (WHEN TO USE, THEN CONSIDER)
        ├── src/agent/toolCatalog.ts     ← filtre Signal Hub (listMcpAgentTools)
        │         └── src/mcp/server.ts + src/mcp/http.ts + src/mcp/instructions.ts
        │
        ├── src/playbooks/bp/playbook.md ← spec méthode BP (servie par read_bp_playbook)
        ├── src/services/bpPlaybook.ts
        │
        ├── src/services/entityResolution.ts    ← scoring + driveTokens[]
        ├── src/services/driveTokenLookup.ts    ← listDriveFiles/FoldersForTokens
        ├── src/services/companyContext.ts      ← resolve_entity, list_company_documents
        ├── src/services/companyDriveFolder.ts  ← resolve_company_drive_folder
        └── src/services/findLatestDeck.ts
```

Build copie `src/playbooks/` → `dist/playbooks/` (`npm run build`).

---

## Read model Postgres (seed validé 2026-05-24)

Scaleway prod : `/health/readiness` → **`ready`**. MCP lit HubSpot / Monday / Drive depuis Postgres via `storeBacked` (fallback live si `healthy=false`).

| Dataset | Records prod |
| --- | ---: |
| startups | 1 746 |
| notes | 4 316 |
| portfolio_companies | 8 |
| board_packs | 823 |

**Sync wasteful** : corrigé et **deployé** prod 2026-05-24. Voir [local-read-model-handoff.md](./local-read-model-handoff.md) §7.4.

**Monday 8 portcos** : à confirmer avec Kevin / Audrien (live API = 8 boards emoji).

**Webhook HubSpot** : phase 2 (secret manquant).

---

## Drive prod — fix et validation

**Cause racine MCP remote « vide »** : `GOOGLE_DRIVE_SHARED_DRIVE_ID` manquant en prod (`0AO2MAh9ncUDNUk9PVA` = Tomcat Drive).

| Action | Statut |
|--------|--------|
| `GOOGLE_DRIVE_SHARED_DRIVE_ID` dans `deploy-container.sh` + `.env.example` | ✅ |
| Multi-token `driveTokens[]` sur `list_company_documents` + `resolve_company_drive_folder` | ✅ |
| Redeploy image `6883d5e` | ✅ (container ready, `/health/connectors` drive ok) |
| Validation MCP remote 3 boîtes (Seedext, Fincome, Wenabi) | ⚠️ OAuth Cursor à reconnecter ; validé en local |

**Scripts d'audit BP (Drive)** :

- `scripts/download-bp-study.mjs` — échantillon xlsx → `/tmp/bp-study/`
- `scripts/list-bp-drive.mjs` — listing rapide
- `scripts/analyze-recent-bps.mjs` — heuristiques filenames
- `scripts/classify-bp-workflows.mjs` — scan Drive workflow types

---

## Business Plan — état et décisions

### Réalité portfolio (audit Drive, ~22 xlsx analysés)

- **0 %** des livrables portfolio utilisent le template canonique `MAJ Template BP SaaS.xlsx` (12 onglets)
- **~70 % transform** — BP founder custom → restructurer au format Tomcat
- **~15 % generate** — inputs seuls (DSN, prêts, historique), greenfield
- **~15 % hybrid** — BP founder + overlay DSN/prêts frais (ex. Yuccan, Webyn)
- « BP Tomcat » dans le filename **≠** template canonique (souvent format maison)

### Trois modes (même moteur, entrées différentes)

| Mode | Entrée | Tool planned |
|------|--------|--------------|
| **transform** | BP founder `.xlsx` custom | `restructure_founder_bp` |
| **generate** | DSN export, prêts, historique | `draft_business_plan` |
| **hybrid** | Les deux | transform puis overlay onglets RH/Financement |

**Décision** : prévoir **les 3 modes** dès la foundation ; routeur dans `assemble_company_finance_pack` (planned).

### Template dans le repo

- **Pas de xlsx binaire dans git**
- Référence Drive : `05. Templates BP / MAJ Template BP SaaS.xlsx`
- Repo = spec markdown + Zod + `defaults.yaml`, regénérée via script `extract-bp-template-spec` (à faire)

### DSN V1

- **Pas de parser XML DSN** en V1
- Input = export Pennylane / table Excel / grid structurée (`parse_payroll_input` planned)
- Classification filename ≠ parsing contenu

### Critères benchmark (go/no-go)

| Métrique | Seuil |
|----------|-------|
| Structure 12 onglets | 100 % |
| Financement vs prêts identifiés | 1:1 |
| P&L bottom line 12 mois | ±5 % |
| Plan de trésorerie | ±10 % |
| RH vs payroll input | ±5 % |

Benchmarks : **eSwit** (transform), **Yuccan/Webyn** (hybrid).

### Éducation orchestrateur (Claude)

| Couche | Fichier |
|--------|---------|
| Instructions MCP | `src/mcp/instructions.ts` — section BP workflows |
| Playbook on-demand | `read_bp_playbook` → `src/playbooks/bp/playbook.md` |
| Descriptions tools | `src/agent/toolCopy.ts` — chaîne resolve → folder → docs → excerpt |

---

## Tools livrés

**CRM / portfolio / Drive / playbook (19 sans Signal Hub)**

- `search_startups`, `read_startup_notes`, `read_startup_deals`, `read_startup_meetings`
- `list_portfolio_signals`, `build_board_prep_context`, `prepare_board_brief`
- `generate_portfolio_signal_digest`
- `resolve_entity`, `list_company_crm_activity`
- `summarize_company_activity`, `find_latest_deck`
- `list_company_documents`, `read_company_document_excerpt`
- `list_portfolio_context`, `build_company_360_context`
- `find_competitive_history`, `resolve_company_drive_folder`
- **`read_bp_playbook`** ← méthode BP Tomcat (modes, mapping, benchmark)

**Signal Hub (+9 si `SIGNAL_HUB_ENABLED=true`)**

- `signal_hub_list_watched`, `signal_hub_add_watched`, `signal_hub_set_priority`
- `signal_hub_recent_signals`, `signal_hub_search_signals`, `signal_hub_resolve_entity`
- `signal_hub_list_accounts`, `signal_hub_request_refresh`, `signal_hub_freeze_account`

**Planned (documentés dans playbook, pas encore callable)**

- `assemble_company_finance_pack`, `restructure_founder_bp`, `draft_business_plan`
- `draft_bp_tab_debt`, `draft_bp_tab_payroll`, `draft_bp_tab_revenue`
- `export_business_plan` (approval required)

---

## Entity resolution — 3 couches

| Couche | Statut | Rôle |
|--------|--------|------|
| **1. Heuristiques** | ✅ Live | `matchConfidence`, alias `(ex WENABI)` → `driveTokens[]` |
| **2. Multi-token Drive** | ✅ Live | `find_latest_deck`, `list_company_documents`, `resolve_company_drive_folder` |
| **3. Alias store persistant** | 🔜 | Table `entity_aliases` |

**Piège** : `resolve_entity("Incom")` matche **Fincome** (substring) — toujours confirmer si ambigu.

---

## Ce qui reste à faire

| Priorité | Sujet |
|----------|--------|
| **P0 BP** | Redeploy prod avec `read_bp_playbook` + playbook dist |
| **P0 BP** | Script `extract-bp-template-spec.mjs` → markdown + Zod (pas xlsx git) |
| **P0 BP** | PR foundation : `assemble_company_finance_pack` + `draft_bp_tab_debt` |
| **P0 BP** | Benchmark chiffré eSwit (transform) |
| Haute | HubSpot sync engine prod : webhook + backfill |
| Haute | Alias store persistant (`entity_aliases`) |
| Moyenne | Activer Signal Hub prod |
| Basse | `prepare_m1_meeting_brief`, wrappers CRM deprecated |

---

## Fichiers clés

```
src/playbooks/bp/playbook.md       ← spec méthode BP
src/services/bpPlaybook.ts
src/mcp/instructions.ts            ← buildMcpServerInstructions + section BP
src/agent/toolCopy.ts              ← descriptions éducatives
src/agent/toolRegistry.ts
src/services/driveTokenLookup.ts
src/services/companyDriveFolder.ts
src/services/companyContext.ts
scripts/scaleway/deploy-container.sh
scripts/classify-bp-workflows.mjs
scripts/download-bp-study.mjs
```

---

## Reprendre le travail

```bash
npm test && npm run typecheck
```

1. **BP suite** : `extract-bp-template-spec.mjs` → `src/playbooks/bp/template-schema.ts`
2. **`assemble_company_finance_pack`** : classify Drive, `recommendedMode`
3. **`draft_bp_tab_debt`** : slice eSwit Debt → Financement
4. Redeploy Scaleway après merge playbook tool

---

## Décisions d'architecture (ne pas casser)

- **Un registry, surfaces filtrées** — MCP via `toolCatalog`
- **Domain entities = contrat** (`src/domain/entities.ts`)
- **Mini-livrables > wrappers**
- **Claude s'éduque via tools** — playbook + descriptions, pas de mémoire implicite
- **Template BP** : forme versionnée dans repo, xlsx référence sur Drive
- **V1 export BP** : xlsx values only ; formulas V2
- **Feature flags** — Signal Hub off par défaut
