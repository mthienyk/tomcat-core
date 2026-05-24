# MCP Tomcat — note de reprise

Dernière mise à jour : 2026-05-24 (post quick wins + mini-livrables)

Document de handoff pour reprendre le travail sur le MCP Tomcat Core. Spec normative : [mcp-use-cases.md](./mcp-use-cases.md).

> **Pivot conception 2026-05-24** : les outils MCP retournent des **mini-livrables** (briefs synthétiques ranked) plutôt que de la donnée brute. Voir [Leçons live](#leçons-du-test-live-2026-05-24) et [Quick wins livrés](#quick-wins-livrés-2026-05-24).

---

## Ce qu'on fait

Construire un **MCP opinionné** pour Tomcat : des tools orientés tâches (pas des wrappers API), consommables par Claude Desktop, Cursor, Society, et futurs clients investisseurs.

Deux surfaces prévues :

| Surface | Auth | Tools |
|---------|------|-------|
| **Internal** (stdio aujourd'hui) | Google OAuth local (`npm run auth:google`) | 27 tools |
| **Investor** (HTTP, futur) | OAuth + rôle DB | Sous-ensemble filtré |

Principe clé : **resolve first** (`resolve_entity`) avant les reads ciblés. Outputs structurés via `ToolRunEnvelope` quand migré.

---

## Quick wins livrés (2026-05-24)

| # | Action | Statut |
|---|--------|--------|
| 1 | `prepare_board_brief` sans Monday | ✅ Dégradation gracieuse + warning `PORTFOLIO_LINK_MISSING` |
| 2 | Cache CoreStore + LRU 60s HubSpot | ✅ `startups.ts` + MCP stdio via CoreStore si `DATABASE_URL` |
| 3 | `list_company_documents` filtré + ranked | ✅ `driveDocuments.ts` |
| 4 | Cap CRM top-N ranked | ✅ `crmActivityLimits.ts` + `companyContext.ts` |

### Nouveaux mini-livrables

| Tool | Remplace / complète | Statut |
|------|---------------------|--------|
| `summarize_company_activity` | 4 wrappers CRM | ✅ Live Wenabi ; notes M1/exec summary > deals screening |
| `find_latest_deck` | Chaîne list → read excerpt | ✅ Live Wenabi ; filtre logos, ranking deck > BP |

**Test live Wenabi (2026-05-24)** : `resolve_entity` → `find_latest_deck` retourne BP Financier V2 (xlsx, binaire) ; `summarize_company_activity` remonte la note M1 exec summary (#1). Gap connu : token Drive HubSpot `"Wenabi"` ≠ dossier Monday `"KOMEET (ex WENABI)"` → alias store Phase 1ter.

---

## Ce qui est fait (Phase 0)

### Infrastructure MCP

- [x] `scripts/mcpServer.ts` + `scripts/mcp-launch.sh` — stdio Cursor (paths absolus, nvm)
- [x] `src/mcp/server.ts` — registration tools, erreurs structurées, audit
- [x] `src/mcp/instructions.ts` — workflows orchestrateur
- [x] `src/agent/toolRegistry.ts` — registry unique (HTTP agent + MCP)
- [x] `src/domain/mcpToolOutput.ts` — `ToolRunEnvelope`, warning codes

### Tools livrés (27)

**CRM / portfolio**

- `search_startups`, `read_startup_notes`, `read_startup_deals`, `read_startup_meetings`
- `list_portfolio_signals`, `build_board_prep_context`, `prepare_board_brief`
- `generate_portfolio_signal_digest`
- `resolve_entity`, `list_company_crm_activity`
- **`summarize_company_activity`**, **`find_latest_deck`** (nouveaux)
- `list_company_documents`, `read_company_document_excerpt`
- `list_portfolio_context`, `build_company_360_context`
- `find_competitive_history`, `resolve_company_drive_folder`

**Signal Hub** — 9 tools (inchangé)

### Enveloppes ToolRunEnvelope

Tools avec enveloppe complète :

- `build_board_prep_context`, `find_competitive_history`, `resolve_company_drive_folder`
- `prepare_board_brief`, `generate_portfolio_signal_digest`
- **`summarize_company_activity`**, **`find_latest_deck`**

### Tests (214 passing)

```bash
npm test
npm run typecheck
npm run mcp:stdio   # ou scripts/mcp-launch.sh via Cursor mcp.json
```

Couverture clé : `findLatestDeck.test.ts`, `companyActivitySummary.test.ts`, `driveDocuments.test.ts`, `boardBrief.test.ts`, `tests/mcp/server.test.ts`.

---

## Leçons du test live (2026-05-24)

### Ce qui marche

- `resolve_entity`, `find_competitive_history`, `resolve_company_drive_folder`
- **`summarize_company_activity`** — facts ranked, notes diligence en tête
- **`find_latest_deck`** — évite le bruit logos/PDFs juridiques ; excerpt si Google Slides/Docs
- Validations Zod, approval-required sur `signal_hub_freeze_account`

### Frictions restantes

| Friction | Mitigation actuelle | Prochaine étape |
|----------|---------------------|-----------------|
| HubSpot ↔ Drive naming (Wenabi vs KOMEET) | Warning `PORTFOLIO_LINK_MISSING` + `driveTokenSource` | Alias store Phase 1ter |
| BP xlsx binaire sans excerpt | Warning `DRIVE_BINARY_NOT_EXTRACTABLE` | Pas de faux retry `read_company_document_excerpt` |
| Dossier avec fichiers mais sans deck matché | Warning `DRIVE_DECK_NOT_FOUND` (≠ folder vide) | `list_company_documents` |
| 4 wrappers CRM encore exposés | `summarize_company_activity` recommandé en instructions | Déprécier les wrappers |

---

## Ce qui reste à faire

### Phase 1bis

| Tool | Statut |
|------|--------|
| `whats_new_for_me` | À faire — digest personnel par owner HubSpot |
| `prepare_m1_meeting_brief` | Planifié |

### Phase 1ter — Alias store

Migration `entity_aliases`, populate KOMEET=Wenabi, intégration `resolve_entity`.

### Clean-up surface (25 → ~16)

Déprécier `read_startup_*`, `list_company_crm_activity`, `build_board_prep_context` après adoption des mini-livrables.

### Dette technique

| Sujet | Priorité |
|-------|----------|
| Alias store HubSpot ↔ Monday ↔ Drive | Élevée |
| Migrer les tools restants vers `ToolRunEnvelope` | Moyenne |
| MCP HTTP remote prod | Phase 2 |

---

## Fichiers clés

```
src/services/findLatestDeck.ts
src/services/companyActivitySummary.ts
src/services/driveDocuments.ts
src/services/boardBrief.ts
src/agent/toolRegistry.ts
scripts/mcp-launch.sh
docs/mcp-use-cases.md
```

---

## Reprendre le travail

1. `npm test && npm run typecheck`
2. Phase 1ter : alias store
3. `whats_new_for_me` ou dépréciation wrappers CRM
4. Mettre à jour cette note en fin de session

---

## Décisions d'architecture (ne pas casser)

- **Un registry, deux surfaces**
- **Domain entities = contrat**
- **Mini-livrables > wrappers**
- **Dégradation gracieuse** — warning, pas 404
- **CoreStore-first** — Postgres puis API live en fallback
