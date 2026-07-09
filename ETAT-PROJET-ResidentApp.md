# ÉTAT DU PROJET — ResidentApp (Fedasil)

**Version 4 — 9 juillet 2026** (remplace la v3 du 9 juillet 2026)

---

## 1. Résumé

ResidentApp est le portail React + TypeScript (CSS pur, charte Fedasil) hébergé
sur Azure Static Web Apps (frontend Vite + API Azure Functions Node), permettant
aux résidents (public multilingue FR/NL/EN, invités via Entra B2B) de :

1. Se pré-inscrire (formulaire public, éligibilité via liste SharePoint) ;
2. Consulter leurs déclarations de revenus du **trimestre en cours** et du
   **trimestre précédent** (mois cliquables, totaux, récapitulatif des paiements) ;
3. **Payer leur contribution** par QR bancaire EPC ou virement manuel
   (IBAN + montant + communication structurée, champs copiables) ;
4. **Déclarer et corriger** leurs revenus mensuels (brut/net, plusieurs fiches
   de paie additionnées, contribution calculée automatiquement côté serveur).

**Statut : parcours complet VALIDÉ EN PRODUCTION de bout en bout.**
Depuis la v3, l'**authentification personnalisée Entra** et le **matching par
`oid`** sont opérationnels en production (option 1 de l'ancienne feuille de
route TERMINÉE), ainsi qu'un **provisioning déclaratif des listes SharePoint**.

---

## 2. Écrans et fichiers frontend

| Fichier | Rôle |
|---|---|
| `src/App.tsx` | Page publique : formulaire de pré-inscription + bandeau « Déjà inscrit ? » → /portail + avis post-déconnexion (démarches de déconnexion complète pour ordinateurs partagés, trilingue) |
| `src/Portail.tsx` | Espace sécurisé : dernière déclaration en tuiles, carte du trimestre (mois cliquables, mois manquants déclarables via « + »), récapitulatif paiements (à payer / payé / reste), carte de paiement QR EPC, formulaire de déclaration/correction multi-fiches, bascule trimestre précédent. **⚠ Ne gère pas encore le sélecteur de profils familiaux** (voir §8) |
| `src/styles/fedasil.css` | Design tokens charte Fedasil (violet #644391, rouge #d1103b, gris #676362) + sections 10-13 (trimestre, paiement, déclaration). Aucun style inline (CSP `style-src 'self'`) |
| `src/main.tsx`, `src/i18n/*` | Inchangés. Libellés du portail locaux à `Portail.tsx` |
| `public/staticwebapp.config.json` | **Emplacement critique : `public/`** (voir §9). Bloc `auth` (fournisseur AAD personnalisé), routes protégées `/api/me` et `/api/declare`, fallback SPA, en-têtes de sécurité + CSP durcie |

## 3. API (Azure Functions v4, `api/src/functions/`)

| Fonction | Route | Rôle |
|---|---|---|
| `Subscription.ts` | POST /api/pre-inscription | Pré-inscription + invitation B2B. **Nouveau v4 :** après invitation réussie, écrit e-mail + `oid` sur la ligne resident (retrouvée par numéro national). Endpoint `/check-email` conservé. |
| `Me.ts` | GET /api/me | Identité → profil(s) resident → déclarations du trimestre triées mois décroissant. `?quarter=previous`, `?fa=<FA>` (profil actif, vérifié serveur). Bloc `payment`, `structuredCom` par mois. Renvoie `needsProfile` + `profiles` si plusieurs personnes sur un même compte. |
| `Declare.ts` | POST /api/declare | Déclaration/correction : contribution recalculée serveur, communication structurée générée, mois limité au trimestre en cours, `Paid` préservé à la correction. Champ `fa` optionnel vérifié serveur (familles). |

Sécurité commune : identité via `x-ms-client-principal` uniquement ; **`oid`
résolu depuis les claims OU depuis `userId` du principal** (voir §9), FA résolu
côté serveur ; aucun montant/identifiant complet dans les logs (e-mails
masqués) ; messages d'erreur génériques côté client ; `context.log` par étape.

## 4. Architecture Azure vs Entra (deux mondes, un carrefour)

Point de confusion fréquent : **l'hébergement et l'identité vivent sur deux
portails différents**, et les apps Entra ne sont PAS dans le groupe de
ressources Azure.

- **Azure** (`portal.azure.com`) = l'hébergement. Groupe de ressources
  `residentapp` → **Static Web App `residentapp`** (site React + Functions +
  variables d'environnement). Plan **Standard** (requis pour le bloc `auth`).
- **Entra** (`entra.microsoft.com`) = les identités. Deux inscriptions
  d'applications (liste plate, sans groupe de ressources) :
  - **`residentapp-frontend`** → **connexion des résidents** au portail.
    Utilisée par le bloc `auth` de la SWA. Clés : `AAD_CLIENT_ID` /
    `AAD_CLIENT_SECRET`.
  - **`e-residentapp admin`** → **accès serveur à SharePoint** via Graph
    (lecture/écriture des déclarations, invitations, provisioning). Jamais vue
    par les résidents. Clés : `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET`.

**Le carrefour reliant les deux mondes = les variables d'environnement de la
Static Web App.** C'est le seul endroit où les identifiants des deux apps Entra
se retrouvent réunis. À la connexion, la SWA se présente à Microsoft comme
`residentapp-frontend` (identité du résident) ; pour lire SharePoint, la
fonction se présente à Graph comme `e-residentapp admin` (droit serveur).

```
  Azure (hébergement)                        Entra (identité)
  ┌─────────────────────────┐                ┌────────────────────────┐
  │ Groupe « residentapp »  │                │ residentapp-frontend   │
  │  ┌───────────────────┐  │  AAD_CLIENT_*  │  → connexion résidents │
  │  │ Static Web App    │──┼───────────────▶│                        │
  │  │  site + Functions │  │                └────────────────────────┘
  │  │  VARIABLES D'ENV  │──┼──GRAPH_CLIENT_*┐┌────────────────────────┐
  │  │  (le carrefour)   │  │                └▶ e-residentapp admin    │
  │  └───────────────────┘  │                │  → accès SharePoint     │
  └─────────────────────────┘                └───────────┬────────────┘
                                                          │ lit/écrit
                                              ┌───────────▼────────────┐
                                              │ SharePoint (données)   │
                                              │ Residents List, KB-Cumul│
                                              └────────────────────────┘
```

## 5. RÈGLES MÉTIER (documentation fonctionnelle)

Cette section consolide **toutes les contraintes métier** de l'application.
Elle fait référence pour la doc fonctionnelle et pour toute évolution.

### 5.1 Identité des personnes — trois identifiants, trois rôles

| Identifiant | Rôle | Propriétés |
|---|---|---|
| **Numéro national** (NN) | Clé d'**éligibilité** ET de **récupération** (ce que la personne connaît) | Unique, permanent. Stocké dans la colonne `Title` de Residents List. Sert UNIQUEMENT à vérifier l'éligibilité et à identifier une personne à l'inscription. |
| **Numéro FA** | **Clé maîtresse** de toutes les données (déclarations, paiements, historique) | Unique, permanent. C'est LUI (et non l'e-mail) qui rattache les données. |
| **E-mail** | Simple donnée de **contact** + adresse de connexion | **Modifiable** et **NON unique** (voir familles). Jamais un identifiant de personne. |
| **EntraOid** | **Lien technique** vers le compte de connexion Microsoft | Modifiable, non unique (familles = même compte). Écrit à l'invitation et auto-réparé à la connexion. |

**Principe fondateur :** l'historique suit le **FA**, jamais l'e-mail ni l'oid.
E-mail et oid ne sont que des *liens vers le compte de connexion*.

### 5.2 Familles — même e-mail, plusieurs personnes

Deux ou trois membres d'une même famille **peuvent partager une seule adresse
e-mail**, pour des personnes différentes (NN différents). Conséquences :

- Ils partagent le **même compte invité Microsoft** (l'invitation Graph est
  idempotente : le même e-mail renvoie le même invité, donc le même `oid`).
- Plusieurs lignes de Residents List portent alors le **même oid**.
- À la connexion, `/api/me` renvoie `needsProfile: true` + la liste des profils
  (prénom/nom/FA). Le portail doit afficher un **sélecteur de profil**
  (⚠ frontend pas encore implémenté — voir §8).
- Le profil choisi est passé aux appels via `?fa=` / champ `fa`, **toujours
  vérifié côté serveur** : le FA doit appartenir aux profils liés à l'oid
  authentifié (sinon 403). Le navigateur ne choisit que parmi SES profils.
- Décision retenue : **pas de verrou par NN** à l'ouverture d'un profil
  (simple sélecteur). Les membres partageant une boîte reçoivent déjà les
  invitations les uns des autres.

### 5.3 Changement d'adresse e-mail

Un résident dont l'e-mail change (changement de fournisseur, etc.) doit pouvoir
le mettre à jour **sans perdre son historique**. Procédure retenue :

- Il **refait simplement la pré-inscription** avec son NN + sa nouvelle adresse.
- Nouvelle invitation → nouveau compte invité → la ligne (retrouvée par NN)
  est mise à jour avec le nouvel e-mail et le nouvel oid.
- Le **FA ne bouge pas** → historique intact.
- Aucune interface « modifier mon e-mail » à développer.
- Résidu : l'ancien compte invité orphelin dans Entra (nettoyage staff,
  automatisable plus tard).

### 5.4 Compte supprimé puis ré-invité (récupération)

Une personne peut être provisoirement retirée de la liste des utilisateurs
(compte supprimé) puis ré-invitée. Elle doit être **« reconnectée » à son
précédent compte** comme si elle n'avait jamais été supprimée.

- **Même mécanisme que le changement d'e-mail** : le NN sert de clé de
  récupération. Refaire la pré-inscription avec le NN relie le nouveau compte
  invité à la ligne resident existante (donc au FA, donc à l'historique).
- Coût nul : c'est le même code que 5.3.

### 5.5 Ordinateurs partagés

Plusieurs résidents peuvent se connecter depuis un même poste partagé (centres).
Deux protections :

- **À l'entrée :** `prompt=select_account` dans le bloc `auth`
  (`loginParameters`) force l'écran de choix de compte à chaque connexion —
  pas de réutilisation silencieuse de la session du résident précédent.
- **À la sortie :** avis post-déconnexion (`App.tsx`) détaillant la
  déconnexion Microsoft complète ; l'étape « sélectionner son compte » sur la
  page Microsoft est explicitée (les utilisateurs la sautent sinon).
  `URL de déconnexion du canal avant` enregistrée dans Entra (retour à l'app).

### 5.6 Résolution d'identité côté serveur (matching)

Ordre appliqué dans `Me.ts` et `Declare.ts` (garder les deux synchronisées) :

1. **Par `oid`** (voie normale en production) : lignes resident dont `EntraOid`
   = oid du compte connecté.
2. **Repli e-mail transitoire** : UNIQUEMENT si l'e-mail correspond à
   **exactement une** ligne (jamais en cas d'ambiguïté familiale). En cas de
   succès, l'oid est **écrit sur la ligne au passage** (auto-réparation) : au
   fil des connexions, tous les comptes migrent vers l'oid sans intervention.
3. E-mail partagé sans oid → message « refaire la pré-inscription ».

⚠️ **`oid` lu depuis `userId` du principal** : avec l'auth SWA, le header
`x-ms-client-principal` ne transmet PAS toujours le tableau `claims` détaillé
(visible seulement sur `/.auth/me`). Mais `userId` EST l'oid pour AAD. Le code
lit donc : claim `objectidentifier` s'il est présent, sinon `userId` validé
comme GUID (voir §9, leçon clé).

### 5.7 Contribution (barème)

Tranches progressives sur le **net total** du mois :
- 0 – 264,99 € : **0 %**
- 265 – 999,99 € : **35 %**
- 1000 – 1499,99 € : **45 %**
- 1500 €+ : **50 %**

Validée contre 8 cas réels (ex. net 1569 → 516,75). Calculée **toujours côté
serveur** (`Declare.ts` = vérité) ; le client n'envoie jamais la contribution.
Dupliquée pour l'aperçu en direct dans `Portail.tsx` — **garder synchronisées**.

### 5.8 Fiches de paie multiples

Un mois = une ligne SharePoint (totaux). Le formulaire additionne jusqu'à 10
fiches ; la contribution est calculée sur le net **TOTAL** (les tranches ne
sont pas additives par fiche). Le détail des fiches n'est pas stocké (à prévoir
dans une future migration Dataverse/SQL).

### 5.9 Correction de déclaration

Re-déclaration d'un mois = remplacement des totaux + recalcul de la
contribution. Le champ **`Paid` n'est jamais modifié** par une correction.

### 5.10 Communication structurée belge

Base 10 chiffres = mois (2) + « 0 » + 7 derniers chiffres du FA + modulo 97
(convention 0 → 97). Ex. FA00655210 / mois 12 → `+++120/0655/21074+++`.
Générée côté serveur. IBAN belge `BE86340079483050` validé (mod 97 = 1).

### 5.11 Paiement

Suit le mois sélectionné ; mois payé → confirmation verte ; avertissement si un
mois plus ancien reste dû (guidage FIFO sans l'imposer). QR EPC (norme
EPC069-12) généré côté client (`qrcode` npm) ; communication belge `+++…+++` en
remittance non structurée (reconnue par les apps belges, testé avec ING).

### 5.12 Imputation (processus cible, non codé)

(1) Communication structurée valide → mois désigné ; (2) sinon → dette la plus
ancienne (FIFO, convention belge à valider juridiquement). Idée retenue :
préfixe réservé (ex. `9T0`) pour les communications d'apurement d'arriérés.

## 6. Données SharePoint

Site : `giapplab.sharepoint.com/sites/Resident_Test`.

- Liste **Residents List** (`SP_LIST_ID` = `5f8da123-127d-4bfc-81e3-df9b972093b4`) :
  colonnes `Title` (= NN), `FirstName`, `LastName`, `Email`, `FedasilNumber`,
  **`EntraOid`** (créée le 9/7 par provisioning), + autres (BirthDate,
  Nationality, Center, Language…). Noms internes propres (créés en anglais).
- Listes **KB-Cumul T\*** (une par trimestre, année implicite — voir §8) :
  `FedasilNumber`, `Month`, `NetSalary`, `GrossSalary`, `Contribution`, `Paid`,
  `StructuredCom`, `StructuredText`.
- Contrôle trimestriel : brut BCSS (totaux trimestre) vs net déclaré ; net
  « vraisemblable » estimé via ratio Jobat. Recommandation : contrôle par
  exception (seuil d'écart).
- **Recommandation structurante (non codée) :** liste permanente « Soldes »
  (FA, trimestre, dû, payé, statut, communication d'apurement) alimentée à la
  clôture de trimestre, pour que les impayés survivent à l'archivage.
- Lettrage cible : extraits CODA → rapprochement automatique → alimente `Paid`
  → base des **rappels automatiques** (par lots, validés par un humain).

## 7. Provisioning déclaratif des listes (« schéma comme code »)

Nouveau outil v4 : la structure SharePoint est décrite dans le dépôt et
appliquée en une commande.

- **`sharepoint-schema.json`** (racine) : décrit listes + colonnes voulues.
  `documentOnly: true` = colonne existante (vérifiée, jamais créée).
- **`scripts/provision-sharepoint.ts`** : script idempotent, ne supprime/modifie
  JAMAIS rien. Réutilise les identifiants Graph de `api/local.settings.json`.
- **`package.json`** :
  - `npm run sp:inspect` → rapport de l'état RÉEL (listes, colonnes, **noms
    internes**, types) — aucune écriture.
  - `npm run sp:provision` → applique le schéma (créations uniquement).
- Nécessite `tsx` (`npm i -D tsx`).
- **A servi à créer la colonne `EntraOid`** sans manipulation manuelle.
- Bénéfice futur : recréation des listes annuelles (option 2) et de la liste
  « Soldes » (option 3) deviennent une commande.

## 8. Configuration (variables d'environnement)

Sur la SWA **et** dans `api/local.settings.json` (dev) :

- Graph (serveur → SharePoint, app « e-residentapp admin ») : `TENANT_ID`,
  `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER_USER_ID`.
- **Auth résident (app « residentapp-frontend »)** : `AAD_CLIENT_ID`,
  `AAD_CLIENT_SECRET`. ⚠ **Uniquement en production** (le simulateur local
  n'appelle pas Entra). Le `<TENANT_ID>` de `openIdIssuer` dans
  `staticwebapp.config.json` doit être la vraie valeur
  (`c5f3f27c-2dde-4f56-b914-f1831522edae`).
- SharePoint : `SP_SITE_HOSTNAME`, `SP_SITE_PATH`, `SP_LIST_ID`,
  `SP_EMAIL_FIELD`, `SP_RESIDENT_FA_FIELD`, **`SP_RESIDENT_OID_FIELD`
  (déf. `EntraOid`)**, **`SP_FIRSTNAME_FIELD` (déf. `FirstName`)**,
  **`SP_LASTNAME_FIELD` (déf. `LastName`)**, `SP_CUMUL_LIST_ID`,
  `SP_CUMUL_LIST_NAME` (déf. « KB-Cumul T4 »), `SP_CUMUL_PREV_LIST_NAME`
  (déf. « KB-Cumul T3 »), `SP_CUMUL_FA_FIELD`, `SP_MONTH_FIELD`, `SP_NET_FIELD`,
  `SP_GROSS_FIELD`, `SP_CONTRIB_FIELD`, `SP_PAID_FIELD`, `SP_STRUCTCOM_FIELD`,
  `SP_FA_IS_NUMBER`.
- Paiement : `PAYMENT_IBAN`, `PAYMENT_BENEFICIARY` (⚠ IBAN de test personnel —
  à remplacer par l'IBAN Fedasil avant mise en service réelle).
- Local : `AzureWebJobsStorage: ""` (avertissement « unhealthy » bénin).

Dépendances ajoutées : `qrcode` (+ `@types/qrcode`), `tsx` (dev, provisioning).

## 9. Entra / permissions

- App **« e-residentapp admin »** (= `GRAPH_CLIENT_ID`) — accès serveur Graph :
  - `User.Invite.All`, lecture des sites ;
  - **`Sites.ReadWrite.All`** + consentement admin (écriture des déclarations,
    depuis le 9/7) ;
  - **`Sites.FullControl.All`** + consentement admin (ajouté le 9/7 pour
    permettre au provisioning de **créer des colonnes/listes** ;
    `Sites.ReadWrite.All` seule ne le permet pas). ⚠ **À retirer/remplacer par
    `Sites.Selected` le jour du durcissement production** (voir §11).
- App **« residentapp-frontend »** (= `AAD_CLIENT_ID`) — auth des résidents :
  - Type de comptes : mono-locataire ; permission `User.Read` (consentement
    admin accordé → aucun écran de consentement pour les résidents) ;
  - URI de redirection **plateforme Web** :
    `https://kind-field-0ea1b8c10.3.azurestaticapps.net/.auth/login/aad/callback`
    + URI racine `.../` (post-déconnexion) ;
  - **« Jetons d'ID » COCHÉ** (Authentication → Paramètres → Octroi implicite) —
    **requis** pour que la SWA construise le `clientPrincipal` ;
  - Secret `SWA auth` (24 mois). 📅 Noter l'échéance + rappel calendrier.
- Tenue d'un tableau « app | rôle | permissions | échéance secret | où stocké ».

## 10. Reste à faire (priorisé)

1. **Sélecteur de profils familiaux** dans `Portail.tsx` : le backend gère déjà
   `needsProfile`/`profiles` et le paramètre `fa` (vérifié serveur) ; le
   frontend doit afficher le choix et propager le `fa` actif à `/api/declare`.
   ⚠ **Ne pas créer de cas famille réel (2 lignes, même e-mail) avant.**
   En profiter pour **assouplir `App.tsx`** : une adresse déjà connue dans Entra
   est désormais un cas NORMAL (familles, changement d'e-mail) — ne pas bloquer
   la pré-inscription sur `/check-email`.
2. **Gouvernance de l'ANNÉE** (option 2) : `Month` sans année, listes sans
   année. Décider : colonne année ou nommage « KB-Cumul 2026-T4 ». Impacte la
   restriction « seul le mois précédent est déclarable ». Le provisioning (§7)
   facilitera la recréation annuelle des listes.
3. **Liste « Soldes »** (option 3) + processus rappels/lettrage CODA. Créable
   via le schéma de provisioning.
4. **Durcissements production :**
   - Remplacer `Sites.ReadWrite.All` + `Sites.FullControl.All` par
     **`Sites.Selected`** (contrôle limité au seul site ResidentApp) ;
   - IBAN Fedasil réel (remplacer l'IBAN de test) ;
   - `NN_CHECKSUM_STRICT=true` ;
   - question « Rester connecté ? » (KMSI) sur postes partagés ;
   - suppression secret expiré éventuel ; nettoyage comptes invités orphelins ;
   - décision suppression du code `DEBUG_ERRORS` ;
   - évaluation managed identity.
5. Design : logo officiel Fedasil (SVG), page d'accueil, parcours pas-à-pas.
6. Connecter `invitationEmail.ts` (si pas déjà fait).
7. Nettoyage données de test.
8. Payconiq (alternative de paiement) à évaluer institutionnellement.

## 11. Leçons de la session du 9/7 (option 1 + provisioning)

- **`staticwebapp.config.json` doit être dans `public/`** (pas à la racine) :
  avec Vite, seul le contenu de `dist/` est déployé, et `public/` est copié dans
  `dist/`. À la racine, le fichier n'est jamais déployé → bloc `auth` ignoré →
  **401 sur `/.auth/login/aad`** et `clientPrincipal: null`. Vérifier après
  build : `ls dist/staticwebapp.config.json`.
- **« Jetons d'ID » à cocher** dans residentapp-frontend (Authentication →
  Paramètres → Octroi implicite et flux hybrides) — sans quoi la SWA ne peut
  pas construire le `clientPrincipal` (symptôme : `clientPrincipal: null`).
- **L'`oid` n'est pas dans le header de la fonction** : le
  `x-ms-client-principal` transmis aux Functions ne contient pas toujours le
  tableau `claims` (visible seulement sur `/.auth/me`). MAIS `userId` = l'oid
  pour AAD. → `getOid()` lit le claim OU `userId` (validé GUID). Diagnostiqué
  via Application Insights (log `oid=absent` alors que `/.auth/me` montrait le
  claim).
- **Un secret ne doit jamais être collé en clair** (chat, ticket…). S'il fuite,
  le révoquer et le remplacer dans Entra + SWA. L'**ID secret** (GUID) reste
  visible en permanence — normal ; seule la **Valeur** disparaît après création.
- **Changement de variable d'env sur la SWA = redéploiement nécessaire**
  (Re-run all jobs). À l'inverse, une permission Graph (consentement admin) est
  **immédiate**, sans redéploiement.
- **Créer une colonne/liste** SharePoint via Graph exige plus que
  `Sites.ReadWrite.All` (qui ne couvre que le contenu) : il faut
  `Sites.FullControl.All` (ou `Sites.Selected` avec droit write).
- **Azure ≠ Entra** : hébergement sur `portal.azure.com` (plan, variables),
  identité sur `entra.microsoft.com` (les 2 apps). Les apps Entra ne sont pas
  dans le groupe de ressources Azure. Le carrefour = les variables d'env SWA.
- Rappels persistants : ne re-run QUE le workflow le plus récent ; `npm run
  build` racine ET `api/` avant chaque push ; noms internes SharePoint sensibles
  à la casse ; simulateur local sans oid → repli e-mail (colonne EntraOid ne se
  remplit qu'en production).

---

## 12. Prompt de relance (à coller au début de la prochaine conversation)

> Bonjour Claude. Je poursuis le développement de ResidentApp (portail Fedasil
> pour résidents, React + TypeScript + CSS pur, Azure Static Web Apps +
> Functions). CONTEXTE : tout l'état du projet est dans
> ETAT-PROJET-ResidentApp.md (v4 du 9 juillet 2026) dans les fichiers du projet
> — lis-le d'abord, en particulier la section 5 « Règles métier » et la section
> 4 « Architecture Azure vs Entra ». En résumé : le parcours complet est validé
> en production, l'authentification personnalisée Entra et le matching par `oid`
> sont opérationnels, et un provisioning déclaratif des listes SharePoint est en
> place (npm run sp:inspect / sp:provision).
> Les fichiers actuels du code sont dans le projet : App.tsx, Portail.tsx,
> fedasil.css, main.tsx, Subscription.ts, Me.ts, Declare.ts,
> public/staticwebapp.config.json, sharepoint-schema.json,
> scripts/provision-sharepoint.ts.
> OBJECTIF DE CETTE DISCUSSION : [choisir dans la section 10 « Reste à faire »,
> par exemple :]
> * Sélecteur de profils familiaux dans Portail.tsx + assouplir App.tsx
>   (check-email) ;
> * Gouvernance de l'année (colonne ou nommage des listes) + restriction du
>   mois déclarable ;
> * Liste « Soldes » et processus de rappels de paiement.
> Rappel de ma façon de travailler : je suis débutant confirmé, je préfère des
> fichiers complets copier-coller prêts plutôt que des patchs, un pas-à-pas
> pour les manipulations Azure/Entra, et je commite via l'interface Git de
> VS Code (donne-moi juste les messages de commit). Avant tout push :
> npm run build à la racine ET dans api/.
