# Note de test MCP — `find_similar_cases` (sans HyDE)

**Date** : 2026-05-25  
**Changement** : query-time simplifié. Plus de LLM serveur au moment de la recherche. Claude rédige `searchTexts` denses ; le serveur embed + pgvector + ACL.

**Prérequis** : MCP remote Tomcat (prod), index ~2 956 notes / 5 912 chunks.

---

## Ce qui a changé

| Avant | Après |
| --- | --- |
| `startupId` seul déclenchait HyDE (~10 s) | `startupId` seul ne suffit plus : il faut `searchTexts`, `query` ou `noteId` |
| `query` passait par HyDE (~12 s) | `query` = embed direct (~1–2 s) |
| HyDE générait 1–3 fausses notes côté serveur | Claude écrit les extraits avant l'appel tool |

Latence attendue : **1–3 s** par appel (vs 10–12 s avant).

---

## Scénarios à tester (dans Claude / Cursor MCP)

### 1. Prep M1 payroll B2B (chemin recommandé)

**Prompt utilisateur :**

> Je prépare un M1 demain sur une boîte SaaS paie/RH pour PME, canal expert-comptable. Quelles boîtes similaires avons-nous déjà vues ? Notes Élie si possible.

**Comportement attendu côté agent :**

1. `resolve_entity` si une boîte est nommée
2. Rédaction de 1–2 `searchTexts` denses (style note M1 / investment lens), pas la question brute
3. `find_similar_cases` avec :
   - `searchTexts` (recommandé)
   - `authorEmail`: `elie.dupredesaintmaur@tomcat.eu`
   - `sinceDays`: `1095`
   - `limit`: `5`
   - `startupId` si boîte de référence connue (exclusion)
4. `read_startup_notes` sur le top match

**Critères de succès :**

- Réponse en **< 5 s** pour `find_similar_cases` (hors synthèse Claude)
- Matches pertinents secteur paie/RH, canal comptable, churn/NRR
- Evidence citée avec `noteId` + date
- Pas de mention « HyDE » dans les logs ou la réponse

**Exemple de searchTexts attendus :**

```text
M1 — SaaS paie/RH pour PME, canal expert-comptable, churn élevé sur segment self-serve, question sur NRR et wedge vs PayFit.

Investment lens: marché payroll SMB saturé, intérêt si canal comptable crédible et rétention cohorte >100%.
```

---

### 2. Requête simple (fallback `query`)

**Prompt :**

> find_similar_cases sur payroll B2B SaaS PME expert-comptable, notes Élie, 3 dernières années

**Attendu :**

- `searchBasis`: `free_text` si seul `query` est passé
- Latence ~1–2 s
- Top matches cohérents (ex. Empowill, Kalent, Wobee selon embedding)

---

### 3. Anchor note Favikon (`noteId`)

**Prompt :**

> Retrouve des cas similaires à la note M1 Favikon (noteId 84190149041)

**Attendu :**

- `searchBasis`: `note_anchor`
- Latence ~1.5–3 s
- Matches type creator marketing / churn / PLG (ex. Tenors, Bowo)

---

### 4. Erreur volontaire — `startupId` seul

**Prompt :**

> find_similar_cases startupId=hs_XXXX sans autre paramètre

**Attendu :**

- Erreur claire : fournir `searchTexts`, `query` ou `noteId`
- L'agent doit reformuler et rappeler avec `searchTexts`

---

### 5. Complément secteur

Après un `find_similar_cases` réussi sur une boîte résolue :

> Montre aussi les peers secteur HubSpot

**Attendu :**

- `find_competitive_history` en complément (pas en remplacement)
- Les deux sources sont citées distinctement

---

## Checklist qualité

- [ ] Latence perçue < 5 s sur `find_similar_cases`
- [ ] `searchTexts` rédigés par l'agent ressemblent à des extraits M1 (pas une question utilisateur)
- [ ] Top 3 matches pertinents sur payroll B2B
- [ ] `noteId` Favikon retourne des cas creator/churn
- [ ] `startupId` seul est refusé proprement
- [ ] `read_startup_notes` fonctionne sur un match retourné
- [ ] Aucune attente de 10+ secondes (signe que l'ancien HyDE tourne encore)

---

## Benchmark local (optionnel)

```bash
npm run crm:query-benchmark
```

Référence prod DB (2026-05-25) :

| Path | Latence |
| --- | --- |
| searchTexts payroll | ~3.1 s |
| query direct | ~1.3 s |
| noteId Favikon | ~1.5 s |

---

## Si ça ne marche pas

| Symptôme | Cause probable |
| --- | --- |
| Tool absent | MCP pas connecté au remote prod ou image pas déployée |
| `CRM_MEMORY_INDEX_EMPTY` | Index worker off ou DB vide |
| Résultats hors sujet | `searchTexts` trop vagues ; demander à l'agent de réécrire en style M1 |
| Toujours ~10 s | Ancienne image encore en prod ; vérifier `/health` + tag image |
| Erreur embeddings | `OPENAI_API_KEY` manquante sur le container |

Vérifier l'index :

```bash
npm run crm:index-status
```

Health prod :

```bash
curl -s https://tomcatcore91c5e290-api.functions.fnc.fr-par.scw.cloud/health | jq
```
