# MCP Tomcat — note de reprise

Dernière mise à jour : 2026-05-24 (MCP OAuth remote + Signal Hub gate + entity resolution)

Document de handoff pour reprendre le travail sur le MCP Tomcat Core. Spec normative : [mcp-use-cases.md](./mcp-use-cases.md).

---

## Ce qu'on fait

Construire un **MCP opinionné** pour Tomcat : des tools orientés tâches (pas des wrappers API), consommables par Cursor (remote prod), Claude Desktop, Society, et futurs clients investisseurs.

| Surface | Auth | Tools exposés |
|---------|------|---------------|
| **Remote HTTP** (`/mcp` Scaleway) | MCP OAuth (Cursor) ou Bearer Google manuel | 18 tools (Signal Hub off) ou 27 (Signal Hub on) |
| **stdio local** | Google session (`npm run auth:google`) | Idem, piloté par `SIGNAL_HUB_ENABLED` |
| **HTTP `/ai/query`** | Bearer Google / service token | Registry complet (Signal Hub non filtré aujourd'hui) |

Principe clé : **resolve first** (`resolve_entity`) avant les reads ciblés. Outputs structurés via `ToolRunEnvelope`.

---

## Architecture actuelle (2026-05-24)

```
src/agent/toolRegistry.ts     ← source unique (schemas, handlers, access)
        │
        ├── src/agent/toolCatalog.ts   ← filtre Signal Hub (listMcpAgentTools)
        │         │
        │         └── src/mcp/server.ts + src/mcp/http.ts  (remote + stdio)
        │
        ├── src/services/boardBrief.ts          ← signalHubEnabled
        ├── src/services/portfolioSignalDigest.ts
        │
        └── src/services/entityResolution.ts    ← scoring + driveTokens[]
                  │
                  ├── src/services/companyContext.ts  (resolve_entity)
                  └── src/services/findLatestDeck.ts  (multi-token Drive lookup)
```

### MCP OAuth remote (prod)

- Routes : `/.well-known/*`, `/oauth/register`, `/oauth/authorize`, `/oauth/callback/google`, `/oauth/token`, `/oauth/revoke`
- Cursor se connecte sans header Bearer statique dans `mcp.json`
- Tokens opaques (sha256 en base), PKCE S256, refresh rotation
- **Piège résolu** : ne pas laisser `"Authorization": "Bearer …"` stale dans `mcp.json` quand OAuth est actif (Cursor priorise le header sur le flow OAuth)
- **Piège résolu** : le resolver MCP OAuth doit passer **avant** le resolver Google JWT (tokens opaques ≠ JWT)

Voir [docs/auth-google-mcp.md](./auth-google-mcp.md).

### Signal Hub — feature flag

| `SIGNAL_HUB_ENABLED` | Effet |
|----------------------|--------|
| `false` (défaut) | 9 tools `signal_hub_*` absents de `tools/list` ; pas de suggestions Signal Hub ; queue ingest ne démarre pas |
| `true` | Comportement complet (Serper + Unipile + 9 tools) |

Activer quand prêt :

```bash
SIGNAL_HUB_ENABLED=true
SERPER_API_KEY=...
# UNIPILE_* si feed privé
```

Scaleway : `deploy-container.sh` injecte `SIGNAL_HUB_ENABLED=false` par défaut.

Les routes HTTP `/signals/*` restent montées (admin / webhooks) même quand le flag est off.

### Entity resolution — 3 couches

| Couche | Statut | Rôle |
|--------|--------|------|
| **1. Heuristiques** | ✅ Live | `matchConfidence`, token overlap, alias parentétique `(ex WENABI)` → `driveTokens[]` sur `resolve_entity` |
| **2. Multi-token Drive** | ✅ partiel | `find_latest_deck` essaie les tokens dans l'ordre (`listDriveFilesForTokens`) |
| **3. Alias store persistant** | 🔜 | Table `entity_aliases`, confirmations humaines |

**Exemple Wenabi** : HubSpot `"Wenabi"`, Monday `"KOMEET (ex WENABI)"` (si en portefeuille). `resolve_entity("Wenabi")` renvoie `driveTokens` incluant le nom Monday et l'alias extrait `WENABI`. `find_latest_deck` tente chaque token jusqu'à un hit Drive.

**Limites connues (edge cases)**

| Cas | Comportement | Mitigation |
|-----|--------------|------------|
| Query substring ambiguë (`"atlas"` → Atlas + Atlas Labs) | `needsClarification: true` | Utilisateur choisit ; ou query plus précise |
| HubSpot-only, dossier Drive sous alias Monday | `find_latest_deck` OK si `driveTokens` passés | `prepare_board_brief` / `resolve_company_drive_folder` utilisent encore **un seul** token Monday ou nom HubSpot |
| Dedup tokens normalisés | `Wenabi` et `WENABI` fusionnés (même clé lower-case) | Volontaire — évite les appels Drive redondants |
| Internal scope Drive | `ensurePortfolioCompanyInScope` accepte tout token pour `internal_team` | By design pour les deals hors Monday |
| Signal Hub off + `/ai/query` | Agent HTTP voit encore les tools Signal Hub | Filtrage MCP seulement ; aligner plus tard si besoin |

---

## Tools livrés

**CRM / portfolio / Drive (18 sans Signal Hub)**

- `search_startups`, `read_startup_notes`, `read_startup_deals`, `read_startup_meetings`
- `list_portfolio_signals`, `build_board_prep_context`, `prepare_board_brief`
- `generate_portfolio_signal_digest`
- `resolve_entity`, `list_company_crm_activity`
- `summarize_company_activity`, `find_latest_deck`
- `list_company_documents`, `read_company_document_excerpt`
- `list_portfolio_context`, `build_company_360_context`
- `find_competitive_history`, `resolve_company_drive_folder`

**Signal Hub (+9 si `SIGNAL_HUB_ENABLED=true`)**

- `signal_hub_list_watched`, `signal_hub_add_watched`, `signal_hub_set_priority`
- `signal_hub_recent_signals`, `signal_hub_search_signals`, `signal_hub_resolve_entity`
- `signal_hub_list_accounts`, `signal_hub_request_refresh`, `signal_hub_freeze_account`

---

## Leçons live (2026-05-24)

### Ce qui marche en prod (remote MCP)

- OAuth Cursor → `/mcp` sans token manuel
- `resolve_entity`, `summarize_company_activity`, `find_competitive_history`, `prepare_board_brief`, `build_company_360_context`
- Portfolio Monday : Addeus, Bloom, Seedext, Kabaun, Aistos, Fincome, Kaptcher, Magma
- Wenabi : HubSpot-only (pas dans Monday portfolio) ; CRM OK ; Drive dépend du token utilisé

### Frictions restantes

| Friction | Mitigation actuelle | Prochaine étape |
|----------|---------------------|-----------------|
| Drive naming cross-system | `driveTokens[]` + multi-token dans `find_latest_deck` | Étendre à `prepare_board_brief`, `resolve_company_drive_folder` |
| BP xlsx binaire | Warning `DRIVE_BINARY_NOT_EXTRACTABLE` | Pas de faux retry excerpt |
| Signal Hub pas encore actif | Flag off, tools masqués | `SIGNAL_HUB_ENABLED=true` + Serper quand prêt |
| `signal_hub_add_watched` 403 admin | Rôle `admin` ≠ `internal_team` sur certaines routes | Corriger quand Signal Hub activé |

---

## Ce qui reste à faire

| Priorité | Sujet |
|----------|--------|
| Haute | Multi-token Drive dans `prepare_board_brief` + `resolve_company_drive_folder` |
| Haute | Alias store persistant (`entity_aliases`) |
| Moyenne | Activer Signal Hub prod (`SIGNAL_HUB_ENABLED`, Serper, watchlist) |
| Moyenne | Filtrer Signal Hub dans `/ai/query` si flag off |
| Basse | Déprécier wrappers CRM (`read_startup_*`, `list_company_crm_activity`) |
| Basse | `whats_new_for_me`, `prepare_m1_meeting_brief` |

---

## Fichiers clés

```
src/agent/toolCatalog.ts          ← gate Signal Hub MCP
src/services/entityResolution.ts  ← scoring + driveTokens
src/services/driveTokenLookup.ts  ← lookup Drive séquentiel
src/services/companyContext.ts    ← resolve_entity enrichi
src/services/findLatestDeck.ts
src/auth/mcpOauth/                ← OAuth broker
src/mcp/instructions.ts           ← buildMcpServerInstructions(flag)
scripts/mcpServer.ts              ← stdio + signalHubEnabled
src/server.ts                     ← HTTP bootstrap
```

---

## Reprendre le travail

```bash
npm test && npm run typecheck
```

1. Tester Wenabi : `resolve_entity` → vérifier `driveTokens` → `find_latest_deck` avec tokens
2. Quand Signal Hub prêt : flag + secrets Scaleway, peupler watchlist
3. Phase alias store ou extension multi-token board brief

---

## Décisions d'architecture (ne pas casser)

- **Un registry, surfaces filtrées** — MCP via `toolCatalog`, pas de duplication handlers
- **Domain entities = contrat**
- **Mini-livrables > wrappers**
- **Dégradation gracieuse** — warning, pas 404
- **Feature flags** — Signal Hub off par défaut jusqu'à go-live
- **CoreStore-first** — Postgres puis API live en fallback
