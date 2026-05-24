# Society

Spec produit et architecture cible. **Society** est la plateforme web privée
Tomcat (`society.tomcat.eu`). **tomcat-core** en est le nexus data, permissions
et sync.

Référence UX : démo Jeremy (`tomcat-demo.html`, esprit produit ; le HTML utilisait
le nom provisoire « Club », abandonné). Notre implémentation sera mieux
structurée, backend réel, permissions serveur.

---

## 1. Vision

**Society** = espace privé du cercle Tomcat (investisseurs, partenaires, et à
terme fondateurs et autres profils). Quatre piliers :

| Pilier | Contenu type |
| --- | --- |
| Investir | Dealflow, SPV Apollo, co-invest direct (selon tier) |
| Apprendre | Masterclasses, formations |
| Contribuer | Vote, mentorat, intros |
| Être ensemble | Events, annuaire, actualités |

Society (app web, repo séparé) porte l'UI, l'auth membre et le BFF. Core ne
décide jamais côté client : chaque requête recalcule accès et redaction.

---

## 2. Découpage Core / Society

| Responsabilité | Society | Core |
| --- | --- | --- |
| UI (home, pipeline, events, membres…) | ✓ | |
| Login magic link / email+password (membres) | ✓ | |
| Login Google (`@tomcat.eu`, équipe) | ✓ UI → token Google | ✓ vérifie ID token |
| Résolution personne → profil membre | ✓ | |
| JWT service `society` + `act_as` vers Core | ✓ signe | ✓ vérifie |
| Permissions & redaction données | | ✓ |
| Sync HubSpot, Monday, Drive | | ✓ |
| Read model Postgres | | ✓ |
| Admin accès / membres (UI) | ✓ | ✓ API `/internal/*` |
| Agent IA équipe | consomme | ✓ |

Prod : `https://society.tomcat.eu` → CORS Core. Client service enregistré :
`society` (`society.read` | `society.write`).

---

## 3. Authentification

### 3.1 Membres Society (priorité #1)

**Magic link** (ou email + mot de passe si autorisé pour ce membre).

Flow :

1. Membre saisit email sur Society.
2. Society vérifie que l'email est **autorisé** (table membres, statut actif).
3. Society envoie le lien / valide le mot de passe.
4. Society crée une session et résout le **profil membre** (kind, tier, capabilities, `memberId`).
5. Appels Core : header `X-Service-Token` avec `sub: society`, scope `society.read`
   (ou `society.write` si mutation), et claims `act_as` décrivant l'identité effective.

L'auth membre **ne vit pas dans Core**. Core fait confiance au token signé par
Society (secret partagé `SERVICE_TOKEN_SECRET`).

### 3.2 Équipe Tomcat

**Google OAuth** (`@tomcat.eu`). Society obtient un ID token Google et peut :

- appeler Core en **humain** : `Authorization: Bearer <google-id-token>` ;
- ou déléguer via JWT service + `act_as` avec rôle interne.

Rôle résolu depuis la table `users` (Postgres). Jeremy = `admin` pour `/internal/*`.

### 3.3 Lien personne → identité métier

**À définir** (email dans `investor_records`, table `society_members` dédiée, etc.).
Society est responsable de cette résolution avant d'appeler Core.

---

## 4. Modèle membre (cible)

Au-delà du rôle plat `external_investor` actuel, viser trois **kinds** :

| Kind | Description | Auth typique |
| --- | --- | --- |
| `internal` | Équipe Tomcat | Google `@tomcat.eu` |
| `society_member` | Investisseur / partenaire Society | Magic link |
| `founder` | Fondateur startup (Apollo, portfolio…) | Magic link (à valider) |

Chaque membre a :

- `memberId` (clé stable)
- `kind`
- `tier` (string ouverte tant que non figée avec Jeremy — voir §5)
- `capabilities[]` (effectives = tier + overrides)
- champs de scope optionnels : `investorId`, `portfolioCompanyIds`, `startupIds`

**Overrides granulaires** (exceptions par personne, gérées par admin) :

| Override | Type | Exemple |
| --- | --- | --- |
| `can_direct_co_invest` | bool | Partner sans LP flag global |
| `is_lp` | bool | LP pour portfolio TCV |
| `capabilities_add` | string[] | droit ponctuel |
| `capabilities_deny` | string[] | retrait ponctuel |
| `active` | bool | révoquer l'accès sans supprimer le profil |

Évaluation cible dans Core :

```
effective = (tier_defaults ∪ overrides_add) \ overrides_deny
can(member, action) = action ∈ effective  (+ policies entité : visibilityTier, etc.)
```

---

## 5. Tiers Society (brouillon — validation Jeremy)

Noms et prix issus de la démo ; **non figés** en enum code (`ClubTier` dans le
code = alias legacy à renommer `SocietyTier`). Capabilities héritées du tier sauf
override.

| Tier | Accès indicatif (démo) |
| --- | --- |
| **Explorer** | Communauté, masterclasses, réseau, events (liste) |
| **Investor** | Explorer + dealflow Apollo, vote sélection, intros |
| **Partner** | Investor + co-invest direct, advisory, office hours |
| **Limited Partner (LP)** | Partner + vue portfolio TCV (fonds), co-invest |
| **Founding Member** | Statut premium — à préciser avec Jeremy |
| **Internal** | Accès équipe (pipeline complet, admin si rôle `admin`) |

Flags démo mappés : `isLP` → tier LP ou override ; `canDirect` → capability
`deals.direct.co_invest`.

---

## 6. Matrice capabilities

Convention : `society.*` = accès plateforme ; `deals.*` = investissement ;
`admin.*` = réservé équipe admin. Catalogue : [capabilities.md](./capabilities.md).

### 6.1 Capabilities par tier (protocole de base)

| Capability | Explorer | Investor | Partner | LP | Internal |
| --- | :---: | :---: | :---: | :---: | :---: |
| `society.access` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `community.directory.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `news.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `events.list` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `events.register` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `masterclasses.access` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `startups.browse` | | ✓ | ✓ | ✓ | ✓ |
| `pipeline.read` | | ✓ | ✓ | ✓ | ✓ |
| `pipeline.detail.read` | | ✓ | ✓ | ✓ | ✓ |
| `deals.spv.subscribe` | | ✓ | ✓ | ✓ | ✓ |
| `deals.vote` | | ✓ | ✓ | ✓ | ✓ |
| `intros.read` / `intros.contribute` | | ✓ | ✓ | ✓ | ✓ |
| `deals.direct.co_invest` | | | ✓ | ✓ | ✓ |
| `portfolio.apollo.read` | | ✓ | ✓ | ✓ | ✓ |
| `portfolio.tcv.read` | | | | ✓ | ✓ |
| `portfolio.signals.read` | | ✓ | ✓ | ✓ | ✓ |
| `admin.members.read` | | | | | admin |
| `admin.members.write` | | | | | admin |
| `admin.access.write` | | | | | admin |
| `internal.tools` | | | | | ✓ |

### 6.2 Kind `founder` (brouillon)

| Capability | Founder |
| --- | :---: |
| `society.access` | ✓ |
| `events.list` / `events.register` | ✓ (events fondateurs) |
| `startup.own.read` | ✓ (sa startup uniquement) |
| `pipeline.read` | |
| `deals.*` | |

Scope limité par `startupIds` assignés.

### 6.3 Mapping vers Core aujourd'hui (V1 implémenté)

Le code actuel utilise des **actions** plates, pas encore les capabilities
fine-grained :

| Action Core | Équivalent capability cible | Route(s) |
| --- | --- | --- |
| `society.read` | garde-fou global lecture Society | `/society/*`, `/connectors/hubspot/startups`, `/signals/*` (partie read) |
| `society.write` | mutations Society (RSVP, profil…) | *aucune route encore* |
| `internal.read` | `admin.members.read`, sync | `/internal/investors`, `/internal/users`, `/internal/sync/freshness` |
| `admin.write` | `admin.members.write`, `admin.access.write` | `POST /internal/investors`, `POST /internal/users` |

**Évolution prévue** : introduire `can(id, capability)` en plus de `can(id, action)`,
sans casser les clients existants. Society envoie toujours `society.read` ; Core
affine par capability + entité.

---

## 7. Modules Society ↔ données

| Module (démo) | Source Core | Dataset / connecteur | Statut sync |
| --- | --- | --- | --- |
| Home (agrégé) | endpoint agrégé *à créer* | multi | partiel |
| Pipeline / fiches startup | HubSpot + Monday | `hubspot.startups`, deals, notes | ✓ startups ; activity partiel |
| Portfolio Apollo / TCV | Monday + HubSpot | `monday.portfolio` | ✓ 8 sociétés |
| Signaux portfolio | Monday | `monday.signals` | vide (board à câbler) |
| Events | Monday | `monday.events` | vide (board à câbler) |
| Membres / tiers | Postgres | `investor_records`, *`society_members` à créer* | schéma partiel |
| Actualités | *à définir* | HubSpot ou CMS Society | — |
| Deals SPV / co-invest | *à définir* | HubSpot deals ou module Society | — |

Signal Hub LinkedIn (`/signals/*`, outils agent) = **outil interne équipe**, pas
le même produit que signaux portfolio Monday de Society.

Voir [suivi-lundi-connecteurs.md](./suivi-lundi-connecteurs.md) pour Monday events/signaux.

---

## 8. Périmètre livraison

### V1 (minimum viable Society)

- [ ] Login membre autorisé (magic link) + login équipe Google
- [ ] Résolution profil membre côté Society → JWT `act_as`
- [ ] Home Society agrégé (1 appel Core, réponse rapide)
- [ ] Events : liste (+ inscription si `society.write`)
- [ ] Browse startups / portfolio selon tier
- [ ] Admin Jeremy : membres, tiers, accès (`/internal/*`)

### Phase 2 (richesse démo)

- Pipeline dealflow + fiche startup détaillée (scorecard, timeline)
- Deals SPV Apollo + co-invest direct
- Annuaire membres complet
- Vote sélection, intros, actualités

---

## 9. Performance (exigence produit)

Objectif : **latence perçue premium**, read model local, cloud FR (Scaleway).

| Principe | Implémentation |
| --- | --- |
| Pas d'appel CRM au hot path | Postgres read model + sync 15 min (`storeBacked`) |
| Home en 1 round-trip | `GET /society/home` (agrégé, à implémenter) |
| Pagination systématique | `limit` / cursor sur listes (startups, events, membres) |
| Index Postgres | hot paths indexés (startup_id, investor_id, dates events) |
| Freshness observable | `GET /health/readiness`, `/internal/sync/freshness` |
| Society | SSR ou prefetch, skeleton UI, pas de waterfall 5× API |

Cible indicative hot read : **p95 < 300 ms** depuis Postgres (hors cold start
container).

---

## 10. Admin (Jeremy)

Premier admin : **Jeremy** (`users.role = admin`). UI dans Society, section
`/admin` (même app, menu selon rôle).

Actions admin V1 :

| Action | API Core |
| --- | --- |
| Lister / créer / éditer investisseurs | `GET/POST /internal/investors` |
| Lister / créer / éditer users équipe | `GET/POST /internal/users` |
| Voir santé sync | `GET /internal/sync/freshness` |
| Overrides capabilities par membre | *API à créer* (`society_members`) |

Auth admin : Google `@tomcat.eu` + rôle `admin` en DB (pas JWT service seul).

---

## 11. État implémentation Core (2026-05)

| Élément | Statut |
| --- | --- |
| Postgres read model + sync HubSpot/Monday portfolio | ✓ prod |
| Routes `/society/investors/:id/home`, `/society/portfolio/:id/signals` | ✓ |
| JWT service `society` + `act_as` | ✓ |
| Modèle capabilities fine-grained | spec seulement |
| Table `society_members` + overrides | à créer |
| `investor_records` peuplé | à faire |
| Jeremy en `users` admin | à seed |
| Monday events / signaux | boards à câbler |
| `society.write` routes | à définir |
| Endpoint home agrégé | à créer |

---

## 12. Décisions ouvertes (Jeremy / produit)

1. Taxonomie finale des tiers et prix
2. Périmètre exact **Founding Member** vs Partner
3. **Founders** : quels modules, quelle auth
4. Lien email → `memberId` / `investorId`
5. Deals SPV : source de vérité (HubSpot, Society, autre)
6. Actualités Society : HubSpot, Monday, CMS Society

---

## 13. Références code

| Sujet | Fichier |
| --- | --- |
| Routes Society actuelles | `src/api/routes/society.ts`, `src/services/society.ts` |
| Policies | `src/permissions/policies.ts` |
| Identité | `src/domain/identity.ts`, `src/storage/migrations/pg_003_identity.sql` |
| Entités | `src/domain/entities.ts` (`ClubTier` → renommer `SocietyTier`) |
| Service token | `src/auth/serviceToken.ts` |
| Deploy prod | [DEPLOY.md](../DEPLOY.md), [DATABASE.md](../DATABASE.md) |
