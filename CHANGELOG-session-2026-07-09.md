# CHANGELOG — Session du 9 juillet 2026 (option 1 + provisioning)

Résumé des changements de cette session, pour référence rapide. L'état complet
fait référence dans `ETAT-PROJET-ResidentApp.md` v4.

## Ajouté

- **Authentification personnalisée Entra** (app `residentapp-frontend`) : bloc
  `auth` dans `staticwebapp.config.json`, plan SWA passé en **Standard**,
  `prompt=select_account` (postes partagés), URI de retour post-déconnexion.
- **Matching par `oid`** dans `Me.ts` et `Declare.ts` : résolution d'identité
  par `EntraOid` avec repli e-mail unique **auto-réparant** (écrit l'oid au
  passage). `oid` lu depuis le claim `objectidentifier` OU depuis `userId` du
  principal (le header SWA ne transmet pas toujours les `claims`).
- **Liaison à l'invitation** dans `Subscription.ts` : écrit e-mail + oid sur la
  ligne resident (retrouvée par NN). Couvre inscription, changement d'e-mail et
  récupération après suppression de compte.
- **Support des profils familiaux côté backend** : `/api/me` renvoie
  `needsProfile`/`profiles` si plusieurs personnes partagent un compte ;
  paramètre `fa` vérifié serveur. (Frontend `Portail.tsx` à faire.)
- **Provisioning déclaratif SharePoint** : `sharepoint-schema.json`,
  `scripts/provision-sharepoint.ts`, scripts npm `sp:inspect` / `sp:provision`.
  A créé la colonne `EntraOid` sans manipulation manuelle.
- **Colonne `EntraOid`** dans Residents List.
- Variables : `SP_RESIDENT_OID_FIELD`, `SP_FIRSTNAME_FIELD`, `SP_LASTNAME_FIELD`,
  `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`.
- Permission `Sites.FullControl.All` sur « e-residentapp admin » (pour le
  provisioning). ⚠ à remplacer par `Sites.Selected` au durcissement.

## Modifié

- `staticwebapp.config.json` **déplacé de la racine vers `public/`** (sinon non
  déployé par Vite → 401 sur l'auth).
- `getOid()` : lit `userId` en repli du claim absent.

## Déplacé / renommé

- `staticwebapp.config.json` : racine → `public/`.

## Points de vigilance ouverts

- **Ne pas créer de cas famille réel** (2 lignes, même e-mail) avant le
  sélecteur de profils dans `Portail.tsx`.
- **Assouplir `App.tsx`** (`/check-email`) : e-mail déjà connu = cas normal.
- Secret AAD renouvelé en cours de session (l'ancien avait été exposé).
- IBAN de test toujours en place (remplacer par l'IBAN Fedasil).

## Messages de commit de la session (rappel)

- `feat(identite): matching par oid, profils familiaux et provisioning SharePoint`
- `fix(auth): deplacer staticwebapp.config.json dans public/ pour qu'il soit deploye`
- `fix(auth): tenant id dans openIdIssuer`
- `fix(identite): lire l'oid depuis userId du principal (claims absents du header SWA)`
