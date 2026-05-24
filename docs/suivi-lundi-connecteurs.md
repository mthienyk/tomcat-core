# Suivi lundi — connecteurs (Drive, HubSpot, Monday)

Checklist à traiter côté équipe / infra. Le code supporte déjà `GOOGLE_DRIVE_SHARED_DRIVE_ID` et le filtre HubSpot temporaire.

## Google Drive (prioritaire)

1. **Créer ou choisir** un [Shared Drive](https://support.google.com/a/users/answer/9310351) (Team Drive) pour les documents communs (board packs, etc.).
2. **Ajouter le compte de service** en membre du Shared Drive, rôle **Lecteur** (ou Contributeur si besoin d'écriture plus tard) :
   - `tomcat-ai-drive-reader@tomcat-ai-backend.iam.gserviceaccount.com`
3. **Récupérer l'ID du Shared Drive** (URL du drive ou API `drives.list`) et l'ajouter au `.env` :
   - `GOOGLE_DRIVE_SHARED_DRIVE_ID=<id>`
4. **Vérifier** qu'après déploiement, `listBoardPacksForCompany` retourne des fichiers pour une société test (nom dans le titre du fichier, aligné avec le nom Monday / HubSpot). Si vide : confirmer le nommage des fichiers ou ajuster la requête `q` dans `src/connectors/drive.ts`.

Sans Shared Drive : chaque fichier « My Drive » doit être partagé explicitement avec le compte de service (pénible à l'échelle). Avec Shared Drive + membre unique : tout le contenu présent et futur du drive est visible.

## HubSpot (suivi produit / CRM)

- Aujourd'hui le CRM **mélange startups et investisseurs** sur l'objet `companies`. Le connecteur applique un **filtre de contournement** : `lifecyclestage` dans dealflow / portfolio / alumni / exit + exclusion des `type_d_entreprise` investisseur.
- **Quand la réorganisation CRM sera faite** : revoir `src/connectors/hubspot.ts` (filtres, propriétés, mapping `Startup`) pour coller à la nouvelle structure sans heuristiques fragiles.

## Monday

- `listPortfolio` — référentiel portco (boards avec emoji 💗 / 👩‍🚀).
- `listSignals` et `listUpcomingEvents` renvoient `[]` **volontairement** : pas de rituel équipe, pas de board signaux. Digest et briefs s'appuient sur Signal Hub + HubSpot.
- Si un jour l'équipe veut des signaux Monday, définir board + process **avant** de câbler le connecteur. Voir [society.md](./society.md) §7.
