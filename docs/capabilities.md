# Capabilities — référence rapide

Liste normative des capabilities Society. Spec complète : [society.md](./society.md).

## Naming

Format : `domaine.action` ou `domaine.sous-domaine.action`. Minuscules, points.

## Catalogue

| Capability | Description |
| --- | --- |
| `society.access` | Accès à l'espace Society connecté |
| `community.directory.read` | Annuaire membres |
| `news.read` | Fil actualités Society |
| `events.list` | Voir les événements |
| `events.register` | S'inscrire à un événement |
| `masterclasses.access` | Contenus formation / masterclass |
| `startups.browse` | Recherche et liste startups (dealflow partagé) |
| `pipeline.read` | Vue funnel dealflow |
| `pipeline.detail.read` | Fiche startup détaillée |
| `deals.spv.subscribe` | Souscription SPV Apollo |
| `deals.direct.co_invest` | Co-invest direct (LP / Partner) |
| `deals.vote` | Vote sur sélection startups |
| `intros.read` | Voir demandes d'intros |
| `intros.contribute` | Proposer une intro |
| `portfolio.apollo.read` | Portfolio batch Apollo (BA) |
| `portfolio.tcv.read` | Portfolio fonds TCV (LP) |
| `portfolio.signals.read` | Signaux sur sociétés du scope |
| `startup.own.read` | Fiche de sa propre startup (founders) |
| `admin.members.read` | Lire profils membres (admin) |
| `admin.members.write` | Créer / éditer membres |
| `admin.access.write` | Tiers, capabilities, révocation accès |
| `internal.tools` | Outils équipe (hors Society membre) |

## Tiers → capabilities (résumé)

| Tier | Capabilities clés en plus du tier inférieur |
| --- | --- |
| Explorer | `society.access`, community, news, events, masterclasses |
| Investor | + startups, pipeline, deals SPV, vote, intros, portfolio Apollo, signaux |
| Partner | + `deals.direct.co_invest` |
| LP | + `portfolio.tcv.read` |
| Founder | `society.access`, events, `startup.own.read` (scope `startupIds`) |
| Internal | équivalent Investor+ ; admin selon rôle `users` |

Overrides par membre : voir §4 de [society.md](./society.md).

## Actions Core legacy (mapping)

| Action JWT | Rôle |
| --- | --- |
| `society.read` | Toute lecture Society via API Core |
| `society.write` | Mutations Society (RSVP, profil, …) |
| `internal.read` | Admin lecture |
| `admin.write` | Admin écriture |

Les capabilities affinent **à l'intérieur** de `society.read` ; elles ne
remplacent pas le scope JWT client `society`.
