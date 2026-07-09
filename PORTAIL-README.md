# Espace sécurisé du résident — guide technique

**Version 4 du 9 juillet 2026** — reflète le portail en production avec
**authentification personnalisée Entra** et **matching par `oid`**.
(Pour l'état global, les règles métier détaillées et le « reste à faire », voir
`ETAT-PROJET-ResidentApp.md` v4, qui fait autorité — en particulier §5 Règles
métier et §4 Architecture Azure vs Entra.)

## 1. Ce que voit le résident sur `/portail`

1. **Sa dernière déclaration** (ou le mois sélectionné) : brut, net (mis en
   avant), contribution, payé.
2. **Le trimestre en cours** : une ligne par mois, cliquable — coche verte si
   déclaré, « + » violet si le mois reste à déclarer. Total du trimestre.
3. **Paiements du trimestre** : à payer / déjà payé / **reste à payer**.
4. **Payer ma contribution** (si `PAYMENT_*` configurés) : QR bancaire EPC +
   bénéficiaire, IBAN, montant et communication structurée copiables. Suit le
   mois sélectionné ; avertit si un mois plus ancien reste dû (guidage FIFO).
5. **Déclarer / corriger** : formulaire brut + net (plusieurs fiches de paie
   additionnables, aperçu de contribution en direct) ; « Corriger ma
   déclaration » sous les tuiles d'un mois déclaré (pré-rempli, remplace les
   totaux, `Paid` intact).
6. **Trimestre précédent** : bascule en un bouton (liste SharePoint distincte).
7. Déconnexion → retour accueil avec l'avis « ordinateur partagé ».

**⚠ À venir :** sélecteur de profils quand plusieurs personnes partagent un
même e-mail (familles) — backend prêt (`needsProfile`/`profiles`/`fa`), frontend
à implémenter.

Tout est trilingue FR/NL/EN (libellés locaux à `Portail.tsx` ; `Intl`,
locales fr-BE / nl-BE / en-GB).

## 2. Fichiers

| Fichier | Rôle |
| --- | --- |
| `api/src/functions/Me.ts` | `GET /api/me` : résout l'identité (oid puis repli e-mail unique auto-réparant), renvoie les déclarations du trimestre du résident/profil. `?quarter=previous`, `?fa=<FA>`. Renvoie `needsProfile`+`profiles` si plusieurs personnes sur un compte. |
| `api/src/functions/Declare.ts` | `POST /api/declare` : crée **ou corrige** la déclaration d'un mois. Contribution recalculée serveur, communication structurée générée, mois limité au trimestre en cours, `Paid` jamais modifié. Champ `fa` vérifié serveur. |
| `api/src/functions/Subscription.ts` | `POST /api/pre-inscription` : invitation B2B + **liaison e-mail/oid** sur la ligne resident (par NN). |
| `src/Portail.tsx` | Page sécurisée (CSS pur, zéro MUI, zéro style inline — CSP). |
| `src/styles/fedasil.css` | Sections 10-13 : trimestre, paiement, déclaration. |
| `public/staticwebapp.config.json` | **Dans `public/`** (voir §7). Bloc `auth`, protège `/api/me` et `/api/declare`. |

Dépendance frontend : `qrcode` (`npm i qrcode` + `npm i -D @types/qrcode`).

## 3. Résolution d'identité ⚠️ IMPORTANT

L'identité vient exclusivement du jeton SWA (`x-ms-client-principal`) ; le
navigateur ne choisit jamais quelles données il reçoit. Ordre appliqué
(identique dans `Me.ts` et `Declare.ts`) :

1. **Par `oid`** : lignes resident dont `EntraOid` = oid du compte connecté.
   L'`oid` est lu depuis le claim `objectidentifier` OU, s'il est absent du
   header, depuis **`userId`** du principal (= l'oid pour AAD).
2. **Repli e-mail** transitoire : seulement si l'e-mail correspond à
   **exactement une** ligne. Succès → l'oid est **écrit au passage**
   (auto-réparation). Ambiguïté familiale → « refaire la pré-inscription ».

Puis : **FedasilNumber → lignes du trimestre** (liste KB-Cumul). Les montants
sont organisés par FA, jamais interrogés directement par e-mail. Chaque
personne ne voit que SES chiffres.

> ⚠️ **L'e-mail n'est plus une clé d'identité** (contrairement à la v3) : il
> peut être partagé (familles) et changer. Le FA est la clé maîtresse ; l'oid
> le lien de connexion. Voir ETAT-PROJET §5 (règles métier).

## 4. Règles métier codées (résumé)

Détail complet dans ETAT-PROJET §5. En bref :

- **Contribution** = tranches progressives sur le **net total** :
  0–264,99 : 0 % · 265–999,99 : 35 % · 1000–1499,99 : 45 % · 1500+ : 50 %.
  Vérité côté serveur (`Declare.ts`), aperçu dans `Portail.tsx` — **synchroniser**.
- **Communication structurée** = mois (2) + « 0 » + 7 derniers chiffres du FA +
  modulo 97 (0 → 97). Ex. FA00655210, mois 12 → `+++120/0655/21074+++`.
- **Fiches multiples** additionnées côté formulaire ; une ligne SharePoint par
  mois (totaux).
- **Correction** : remplace les totaux, `Paid` inchangé.
- **QR EPC** (EPC069-12) généré localement ; communication belge `+++…+++` en
  remittance non structurée (testé ING).

## 5. Variables d'environnement

Toutes ont un défaut sauf indication. Sur la SWA **et** `api/local.settings.json`.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `SP_LIST_ID` | ID de la liste *Residents List* | — (requis) |
| `SP_EMAIL_FIELD` / `SP_RESIDENT_FA_FIELD` | Colonnes resident | `Email` / `FedasilNumber` |
| `SP_RESIDENT_OID_FIELD` | Colonne oid | `EntraOid` |
| `SP_FIRSTNAME_FIELD` / `SP_LASTNAME_FIELD` | Colonnes prénom/nom (profils) | `FirstName` / `LastName` |
| `SP_CUMUL_LIST_ID` | ID liste trimestre en cours (sinon par nom) | — |
| `SP_CUMUL_LIST_NAME` / `SP_CUMUL_PREV_LIST_NAME` | Noms des listes trimestre | `KB-Cumul T4` / `KB-Cumul T3` |
| `SP_CUMUL_FA_FIELD` / `SP_MONTH_FIELD` | Colonnes FA et mois | `FedasilNumber` / `Month` |
| `SP_NET_FIELD` / `SP_GROSS_FIELD` / `SP_CONTRIB_FIELD` / `SP_PAID_FIELD` / `SP_STRUCTCOM_FIELD` | Colonnes montants | `NetSalary` / `GrossSalary` / `Contribution` / `Paid` / `StructuredCom` |
| `SP_FA_IS_NUMBER` | `true` si FedasilNumber est de type **Nombre** | `false` |
| `AAD_CLIENT_ID` / `AAD_CLIENT_SECRET` | Auth résident (app residentapp-frontend) — **prod uniquement** | — |
| `PAYMENT_IBAN` / `PAYMENT_BENEFICIARY` | Virement affiché (les deux requis) | — ⚠️ IBAN de test actuellement |

> ⚠️ **Pièges :** (1) noms **INTERNES** SharePoint sensibles à la casse (relever
> via `npm run sp:inspect`) ; (2) n° de trimestre déduit du nom de liste
> (« …T4 » → 4) — garder ce motif ; (3) `AAD_*` sans effet en local (simulateur).

## 6. Permissions Graph & auth

- App **« e-residentapp admin »** (serveur → SharePoint) : `User.Invite.All`,
  `Sites.ReadWrite.All`, `Sites.FullControl.All` (provisioning). Cible :
  `Sites.Selected`.
- App **« residentapp-frontend »** (auth résident) : `User.Read` + consentement
  admin ; URI de redirection **Web** `.../.auth/login/aad/callback` ; **« Jetons
  d'ID » coché** ; secret `AAD_CLIENT_SECRET`.

## 7. Tester en local (SWA CLI)

```
swa start http://localhost:5173 --run "npm run dev" --api-location api
```

Ouvrir **http://localhost:4280/portail** (jamais 5173). Le simulateur d'auth :
dans `Username`, saisir **l'e-mail exact** d'une fiche de Residents List de test.
L'auth est simulée (pas d'oid → **repli e-mail**, la colonne `EntraOid` ne se
remplit qu'en production) mais les appels Graph sont réels. Les `context.log`
s'affichent dans le terminal ; erreurs → `Erreur <étape>, statut: XXX`.
`AzureWebJobsStorage: ""` suffit (avertissement « unhealthy » bénin).

> ⚠️ **`staticwebapp.config.json` DOIT être dans `public/`** : avec Vite, seul
> `dist/` est déployé et `public/` y est copié. À la racine, le fichier n'est
> pas déployé → bloc `auth` ignoré → 401 sur `/.auth/login/aad`. Vérifier :
> `ls dist/staticwebapp.config.json` après `npm run build`.

## 8. Provisioning des listes SharePoint

Structure décrite dans `sharepoint-schema.json` (racine), appliquée par
`scripts/provision-sharepoint.ts` (nécessite `tsx`) :
- `npm run sp:inspect` → état réel (noms internes, types), aucune écriture.
- `npm run sp:provision` → crée ce qui manque (idempotent, ne supprime jamais).

## 9. En production

Authentification via l'app Entra dédiée **residentapp-frontend** (bloc `auth`,
plan Standard, `prompt=select_account` pour les postes partagés). Matching par
`oid` opérationnel avec auto-réparation. `INVITE_REDIRECT_URL` en production →
`https://kind-field-0ea1b8c10.3.azurestaticapps.net/portail`.
