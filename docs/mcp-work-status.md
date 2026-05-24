# MCP Tomcat — note de reprise

Dernière mise à jour : 2026-05-24

Document de handoff pour reprendre le travail sur le MCP Tomcat Core. Spec normative : [mcp-use-cases.md](./mcp-use-cases.md).

---

## Ce qu'on fait

Construire un **MCP opinionné** pour Tomcat : des tools orientés tâches (pas des wrappers API), consommables par Claude Desktop, Cursor, Society, et futurs clients investisseurs.

Deux surfaces prévues :

| Surface | Auth | Tools |
|---------|------|-------|
| **Internal** (stdio aujourd'hui) | Google OAuth local (`npm run auth:google`) | 25 tools complets |
| **Investor** (HTTP, futur) | OAuth + rôle DB | Sous-ensemble filtré |

Principe clé : **resolve first** (`resolve_entity`) avant les reads ciblés. Outputs structurés via `ToolRunEnvelope` quand migré.

---

## Ce qui est fait (Phase 0)

### Infrastructure MCP

- [x] `scripts/mcpServer.ts` — entry stdio avec Signal Hub bootstrap
- [x] `src/mcp/server.ts` — registration des 25 tools, erreurs structurées, audit
- [x] `src/mcp/instructions.ts` — instructions orchestrateur (MCP `instructions`)
- [x] `src/mcp/toolMeta.ts` — `formatToolDescription()` (WHEN TO USE, LIMITATIONS, etc.)
- [x] `src/agent/toolCopy.ts` — descriptions structurées pour les 25 tools
- [x] `src/agent/toolRegistry.ts` — registry unique (HTTP agent + MCP)
- [x] `src/domain/mcpToolOutput.ts` — `ToolRunEnvelope`, `wrapToolOutput`, warning codes
- [x] `src/services/signalHub/bootstrap.ts` — wiring partagé HTTP + MCP

### Tools livrés (25)

**CRM / portfolio**

- `search_startups`, `read_startup_notes`, `read_startup_deals`, `read_startup_meetings`
- `list_portfolio_signals`, `build_board_prep_context`, `prepare_board_brief`
- `generate_portfolio_signal_digest`
- `resolve_entity`, `list_company_crm_activity`
- `list_company_documents`, `read_company_document_excerpt`
- `list_portfolio_context`, `build_company_360_context`
- `find_competitive_history` (Phase 0)
- `resolve_company_drive_folder` (Phase 1 P0 #1)
- `generate_portfolio_signal_digest` (Phase 1 P0 #3)

**Signal Hub (LinkedIn via Unipile)**

- `signal_hub_list_watched`, `signal_hub_add_watched`, `signal_hub_set_priority`
- `signal_hub_recent_signals`, `signal_hub_search_signals`, `signal_hub_resolve_entity`
- `signal_hub_list_accounts`, `signal_hub_request_refresh`
- `signal_hub_freeze_account` (approval-required, bloqué sur MCP)

### Enveloppes ToolRunEnvelope

Seuls ces tools retournent déjà l'enveloppe complète :

- `build_board_prep_context`
- `find_competitive_history`
- `resolve_company_drive_folder`
- `prepare_board_brief`
- `generate_portfolio_signal_digest`

Les 20 autres renvoient encore des payloads bruts (migration progressive).

### Tests (203 passing)

| Fichier | Couverture |
|---------|------------|
| `tests/mcp/server.test.ts` | Contrat MCP, auth, enveloppes, validation |
| `tests/agent/toolRegistry.test.ts` | Sync enum/registry/copy, strict Zod |
| `tests/services/boardBrief.test.ts` | Brief actionnable, checklist, warnings |
| `tests/services/portfolioSignalDigest.test.ts` | Digest multi-sources, warnings, suggestions |
| `tests/domain/mcpToolOutput.test.ts` | `wrapToolOutput` |
| `tests/agent/toolBenchmark.test.ts` | Corpus 62 questions + mapping registry |

Commandes :

```bash
npm test
npm run typecheck
npm run mcp:stdio
```

### Fixes récents (2026-05-24)

- [x] **Consolidation board prep** — `boardBrief.ts` source unique ; HTTP `/internal/briefs/board-prep` et `build_board_prep_context` (deprecated) projettent depuis le même orchestrateur ; suppression de `briefs.ts`
- [x] **`prepare_board_brief`** — service `boardBrief.ts`, brief actionnable (checklist, open questions, multi-sources), tests service + MCP
- [x] **`resolve_company_drive_folder`** — service `companyDriveFolder.ts`, extension connecteur Drive (folders + path), ToolRunEnvelope, tests service + MCP
- [x] **`generate_portfolio_signal_digest` hardening** — mapping LinkedIn, notes CRM, quiet companies, troncature par activité ; digest = Signal Hub + HubSpot (Monday = référentiel portco seulement)
- [x] `boardPrepEnvelope` — plus de faux `MONDAY_SIGNALS_EMPTY` quand des citations HubSpot/Drive existent sans signaux Monday
- [x] Test `startupId` inconnu + `sector` → fallback sector, pas de `REFERENCE_NOT_FOUND`
- [x] `docs/tool-benchmark/registry-mapping.json` — mapping aspirational → tools registry (85 noms)
- [x] Test benchmark : tout `candidateTool` du corpus a une entrée dans le mapping

---

## Ce qui reste à faire

### Phase 1 — tools P0 (ordre recommandé)

1. ~~**`resolve_company_drive_folder`**~~ — ✅ livré 2026-05-24
2. ~~**`prepare_board_brief`**~~ — ✅ livré 2026-05-24
3. ~~**`generate_portfolio_signal_digest`**~~ — ✅ livré 2026-05-24
4. **`prepare_m1_meeting_brief`** — brief pré-M1
5. **`run_m2_financial_analysis`** — async + `runId` (pattern Tasks)
6. **`score_startup_list_against_thesis`** — nécessite Dealfy / thesis store

### Dette technique connue

| Sujet | Priorité | Notes |
|-------|----------|-------|
| Duplication board prep (`briefs.ts` vs `boardBrief.ts`) | — | ✅ Consolidé 2026-05-24 |
| `nextSuggestedTools` vers tools non implémentés | Basse | ✅ Retiré (ex. `run_m2_financial_analysis`) |
| Migrer les 19 tools restants vers `ToolRunEnvelope` | Moyenne | Spec §13 dans mcp-use-cases.md |
| Similarité `find_competitive_history` sector-only | Basse | Documenté ; pas sémantique |
| Liaison HubSpot ↔ Monday par nom | Moyenne | Fragile dans `resolve_entity` |
| Mutations (write HubSpot, update Monday) | Phase 2+ | Approval-required |
| Connecteur Investors stub | Phase 3 | Surface investisseur incomplète |
| Tests intégration connecteurs réels | Basse | Tout mocké aujourd'hui |
| MCP HTTP remote (prod) | Phase 2 | stdio = dev local seulement |
| Benchmark `questions.json` | Basse | Noms aspirational ; voir `registry-mapping.json` pour l'équivalent actuel |
| Validation Zod double couche (SDK vs handler) | Basse | Messages d'erreur non uniformes |

### Phase 2–4 (aperçu)

Voir [mcp-use-cases.md §10](./mcp-use-cases.md) :

- Phase 2 : mutations contrôlées, async runs, investor MCP HTTP
- Phase 3 : Dealfy, thesis scoring, committee prep
- Phase 4 : observabilité, benchmark automatisé, Tasks extension MCP

---

## Fichiers clés

```
src/agent/toolRegistry.ts       # Registry + handlers
src/agent/toolCopy.ts           # Descriptions LLM
src/mcp/server.ts               # MCP server builder
src/mcp/instructions.ts         # Server instructions
scripts/mcpServer.ts            # stdio entry
src/services/competitiveHistory.ts
src/services/companyDriveFolder.ts
src/services/boardBrief.ts
src/services/portfolioSignalDigest.ts
src/domain/mcpToolOutput.ts
docs/mcp-use-cases.md           # Spec normative
docs/tool-benchmark/
  questions.json                # 62 questions benchmark
  registry-mapping.json         # Mapping aspirational → registry
```

---

## Reprendre le travail

1. Lire cette note + [mcp-use-cases.md §10](./mcp-use-cases.md) (plan Phase 1)
2. `npm test && npm run typecheck` pour valider l'état
3. Prochain outil Phase 1 : **`prepare_m1_meeting_brief`**
4. Mettre à jour cette note en fin de session

---

## Décisions d'architecture (ne pas casser)

- **Un registry, deux surfaces** — pas de duplication tool definitions
- **Domain entities = contrat** — mapper les APIs externes vers `src/domain/entities.ts`
- **Pas de keyword classifier** — LLM + prompt pour catégoriser
- **Approval-required** — refus MCP, exécution HTTP API seulement
- **Async externe** — `signal_hub_request_refresh` retourne `{ jobId }`, jamais d'appel sync Unipile depuis un tool
