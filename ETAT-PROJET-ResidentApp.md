# ÉTAT DU PROJET — ResidentApp (Fedasil)

**Version 9 — 13 juillet 2026 (soir)** (remplace la v8 du même jour — session « bascule automatique du trimestre : liste Config »)

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
**Depuis la v9 (13/7 au soir)** : la **bascule trimestrielle est AUTOMATIQUE**
— une liste SharePoint **`Config`** (ligne `ActiveQuarter`) écrite par
`sp:rotate` porte le trimestre actif, lue par `Me.ts`/`Declare.ts` (§5.21,
§10.0 TERMINÉ) : **plus aucune variable d'environnement à modifier, plus aucun
redéploiement** à chaque clôture. Le fail-fast introduit le matin a révélé et
fait corriger **deux pannes de production** (index manquant sur KB-Cumul T2 ;
`$filter` sur colonne `Month` non indexée → `/api/declare` en 500) — §11ter.
Depuis la v5 : **session ergonomie complète du 12/7**
(CHANGELOG-session-2026-07-12.md) — carte de paiement adaptée au **mobile**
(champs copiables d'abord, QR replié sur tactile), **statuts de paiement
colorés** avec règle d'échéance CONFIRMÉE (§5.18), boutons de paiement
intégrés aux tuiles, **montant libre** (acomptes), pastille d'activation
affichée une seule fois, aide « fiche de paie », pictogrammes de section,
boutons « Réessayer », session expirée → reconnexion, **NN formaté à la
volée + contrôle modulo 97** au formulaire (§5.19), et conformité ESLint
`react-hooks` v6. **Depuis la v6 (session Soldes du 12/7 après-midi)** : la
**liste permanente « Soldes »** est créée, indexée et synchronisée — mémoire
des soldes mensuels qui survit au vidage des listes trimestrielles (règle
§5.20, script `npm run sp:soldes`) ; c'est la **décision §3 de l'app staff**
(CONCEPTION-STAFF-APP.md v2), migration SQL différée sans blocage. Depuis la v4 : le **sélecteur de profils familiaux** est implémenté et validé
en production (le FA actif est propagé et vérifié serveur), la
**pré-inscription est réduite au minimum** (NN + e-mail + langue ; prénom/nom
lus depuis la liste resident), le **check-email est devenu informatif** (plus
jamais bloquant), le cas **aidant** (assistante sociale) est couvert comme
dérivé du cas famille avec un **garde-fou par liste d'adresses autorisées**
(règle 5.13), les **comptes internes (membres du tenant)** sont pris en charge
par liaison directe sans invitation B2B, la **bascule trimestrielle** est
outillée (procédure + script `sp:rotate`), et le **modèle paiements** est
documenté (liste KB-Paiements de test). Depuis la v3 : authentification
personnalisée Entra, matching par `oid` et provisioning déclaratif SharePoint
opérationnels. Migration SQL/Dataverse : analysée, **en attente de décision
hiérarchique** (§10).

---

## 2. Écrans et fichiers frontend

| Fichier | Rôle |
|---|---|
| `src/App.tsx` | Page publique : formulaire de pré-inscription **minimal (NN + e-mail + langue de contact ; prénom/nom et « nom d'utilisateur » supprimés)** + avis informatif bleu « adresse déjà connue » (jamais bloquant) + bandeau « Déjà inscrit ? » → /portail + avis post-déconnexion (trilingue). **v6 (12/7)** : NN **formaté à la volée** (`00.00.00-000.00`), séparateurs acceptés à la saisie ET au collage, **contrôle modulo 97** client (NN + BIS, §5.19) ; langue de contact synchronisée via gestionnaire d'événement (ESLint v6, plus d'effet) |
| `src/Portail.tsx` | **v9 (13/7 soir)** : les écrans d'erreur offrent enfin une ISSUE — boutons « Réessayer » (relance le même profil) et « Changer de personne » (familles) dans les états `error` ET `nodata` ; « Réessayer » aussi sur l'erreur du trimestre précédent (`showPrevious(force)`). Espace sécurisé : **sélecteur de profils familiaux** (écran « Qui êtes-vous ? » sur `needsProfile`, barre « Vous consultez le dossier de … » + « Changer de personne », FA actif propagé à /api/me et /api/declare), dernière déclaration en tuiles, carte du trimestre (mois cliquables, mois manquants déclarables via « + »), récapitulatif paiements, carte de paiement QR EPC, formulaire de déclaration/correction multi-fiches, bascule trimestre précédent (cache vidé au changement de personne). **v6 (12/7)** : ergonomie mobile (`useCoarsePointer`, QR replié sur tactile), statuts de paiement 4 couleurs + formes (§5.18), bouton « Payer X € » sur la tuile « Payé » et tuile « Reste à payer » cliquable (FIFO), **montant libre**, confirmation verte post-déclaration (mois maintenu sélectionné), aide `<details>` fiche de paie, pictogrammes de section, boutons « Réessayer », 401 → reconnexion (`window.location.assign`), pastille d'activation UNIQUE (localStorage `ra-activated-{oid}`), déconnexion aussi dans l'en-tête |
| `src/styles/fedasil.css` | Design tokens charte Fedasil (violet #644391, rouge #d1103b, gris #676362) + sections 10-17 (trimestre, paiement, déclaration, profils, littératie, statuts de paiement/montant libre). Aucun style inline (CSP `style-src 'self'`) |
| `src/main.tsx`, `src/i18n/*` | Inchangés. Libellés du portail locaux à `Portail.tsx` |
| `public/staticwebapp.config.json` | **Emplacement critique : `public/`** (voir §9). Bloc `auth` (fournisseur AAD personnalisé), routes protégées `/api/me` et `/api/declare`, fallback SPA, en-têtes de sécurité + CSP durcie |

## 3. API (Azure Functions v4, `api/src/functions/`)

| Fonction | Route | Rôle |
|---|---|---|
| `Subscription.ts` | POST /api/pre-inscription | Pré-inscription + invitation B2B. Après invitation réussie, écrit e-mail + `oid` sur la ligne resident (retrouvée par NN). **Nouveau v5 :** corps minimal `{ nationalId, email, contactLanguage }` ; **prénom/nom lus depuis la liste resident** (colonnes FirstName/LastName) pour le displayName de l'invitation et l'e-mail « Bonjour \<Prénom\> » — jamais renvoyés au navigateur (anti-oracle NN → nom). **Comptes internes (membres du tenant)** : détection par `findMemberByEmail` → liaison directe de l'oid SANS invitation (Graph la refuserait : domaine vérifié), e-mail avec lien vers le portail (`PORTAL_URL`) ; soumis au **garde-fou fail-closed** de la liste « ResidentApp Aidants » (lecture complète + comparaison normalisée, PAS de $filter — voir §11). Champs historiques (`firstName`, `lastName`, `username`) encore acceptés mais ignorés. Endpoint `/check-email` conservé (usage informatif côté front). |
| `Me.ts` | GET /api/me | Identité → profil(s) resident → déclarations du trimestre triées mois décroissant. `?quarter=previous`, `?fa=<FA>` (profil actif, vérifié serveur). Bloc `payment`, `structuredCom` par mois. Renvoie `needsProfile` + `profiles` si plusieurs personnes sur un même compte. |
| `Declare.ts` | POST /api/declare | Déclaration/correction : contribution recalculée serveur, communication structurée générée, mois limité au trimestre en cours, `Paid` préservé à la correction. Champ `fa` optionnel vérifié serveur (familles). |

**Module partagé `api/src/shared/quarterConfig.ts` (13/7)** : `getActiveQuarter()`
— trimestre actif lu dans la liste `Config` (§5.21), cache mémoire ~5 min,
repli variables d'environnement journalisé. Utilisé par `Me.ts` ET `Declare.ts`
(fini le « garder les deux synchronisées » pour cette partie).

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
  (prénom/nom/FA). Le portail affiche le **sélecteur de profil**
  (implémenté depuis la v5 : écran « Qui êtes-vous ? », barre de profil actif,
  « Changer de personne »).
- Le profil choisi est passé aux appels via `?fa=` / champ `fa`, **toujours
  vérifié côté serveur** : le FA doit appartenir aux profils liés à l'oid
  authentifié (sinon 403). Le navigateur ne choisit que parmi SES profils.
- Décision retenue : **pas de verrou par NN** à l'ouverture d'un profil
  (simple sélecteur). Les membres partageant une boîte reçoivent déjà les
  invitations les uns des autres.
- Le même mécanisme couvre les **aidants** (assistantes sociales) — voir §5.13.

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
Échéance, statuts colorés, accès au paiement et montant libre : voir §5.18.

### 5.12 Imputation (processus cible, non codé)

(1) Communication structurée valide → mois désigné ; (2) sinon → dette la plus
ancienne (FIFO, convention belge à valider juridiquement). Idée retenue :
préfixe réservé (ex. `9T0`) pour les communications d'apurement d'arriérés.

### 5.13 Aidants (assistantes sociales) — dérivé du cas famille

Un aidant (ex. assistante sociale en centre) s'inscrit avec **sa propre
adresse e-mail** + le **NN de chaque résident aidé**, puis gère leurs
déclarations depuis son compte via le sélecteur de profils. Aucun code
spécifique : c'est exactement le mécanisme famille (§5.2).

**RÈGLE FONDAMENTALE : un dossier resident = UN SEUL compte lié à la fois.**
La ré-inscription par NN **TRANSFÈRE** l'accès (remplace e-mail + oid sur la
ligne, §5.3) — elle ne le partage pas. Conséquences :

- Si un résident avait son propre accès et qu'un aidant s'inscrit avec son
  NN, le résident **perd** son accès (et inversement). C'est voulu : les
  résidents aidés sont précisément ceux qui ne gèrent pas d'e-mail.
- Si le résident reprend son autonomie, il refait simplement sa
  pré-inscription (§5.3) et redevient le compte lié. Coût nul.
- À former côté centres : *« s'inscrire avec le NN d'un résident = devenir
  SON accès »*.
- L'accès **simultané** résident + aidant n'est PAS supporté. **Chantier
  futur consigné (§10) :** modèle de délégation — colonne « DelegateOid »
  (ou liste « Delegates ») sur la liste resident, résolue par `Me.ts` /
  `Declare.ts` en plus de `EntraOid`, avec sélecteur inchangé côté portail.
- Point de vigilance : ce flux renforce le rôle du NN comme **seul secret
  d'accès** → les durcissements `NN_CHECKSUM_STRICT=true`, rate limiting
  robuste et CAPTCHA montent en priorité avant mise en service réelle.

**Garde-fou (implémenté, validé en prod) :** liste SharePoint
« **ResidentApp Aidants** » (colonne `Title` = adresse en minuscules,
`Label` = documentation staff). Toute pré-inscription avec une adresse
correspondant à un **membre interne du tenant** est refusée (403, message
neutre) si l'adresse n'y figure pas — **fail-closed** : liste introuvable,
vide ou erreur de lecture = refus. Gérée par le staff dans SharePoint, effet
immédiat (aucun redéploiement). Ne restreint PAS les adresses externes
(résidents/familles) : seule la voie « compte interne » est encadrée.

**Comptes internes (membres @fedasil / du tenant) :** Graph REFUSE d'inviter
une adresse d'un domaine vérifié du tenant. `Subscription.ts` détecte donc
les membres AVANT d'inviter (`findMemberByEmail`) et **relie directement leur
oid** à la ligne resident, sans invitation ; l'e-mail de confirmation
contient un lien vers le portail (`PORTAL_URL`) au lieu d'un lien
d'activation. Le portail (`Me.ts`/`Declare.ts`) ne fait aucune différence
membre/invité (matching par oid). Bonus : les membres bénéficient des
protections de l'organisation (MFA, accès conditionnel).

**À valider par le business :** confidentialité intra-famille (simple
sélecteur, pas de verrou), modèle de transfert pour les aidants, et
encadrement de la pratique côté centres (qui figure dans la liste garde-fou,
qui la maintient).

### 5.14 Prénom / nom : jamais saisis, toujours lus dans la liste

Le formulaire public ne demande plus ni prénom, ni nom, ni « nom
d'utilisateur » (jamais exploité). Motifs : données **non vérifiables** au
formulaire (fautes de frappe fréquentes, public parfois non scripteur) alors
que la liste Residents (retrouvée par NN) contient les valeurs officielles.

- `Subscription.ts` lit FirstName/LastName sur la ligne trouvée par NN et les
  utilise pour le `invitedUserDisplayName` de l'invitation B2B et le
  « Bonjour \<Prénom\> » de l'e-mail — lequel confirme au passage **quel
  profil vient d'être activé** (utile familles et aidants).
- Le nom n'est **jamais renvoyé au navigateur** après saisie du NN : ce
  serait un oracle d'énumération NN → nom (cohérent avec `GENERIC_INELIGIBLE`).
- Graph ne renomme pas un invité existant : le displayName Microsoft d'un
  compte partagé reste celui du premier NN inscrit — cosmétique uniquement,
  le portail identifie les personnes via le sélecteur de profils.

### 5.15 Adresse e-mail déjà connue = cas normal

`/api/check-email` n'est plus bloquant côté formulaire : une adresse déjà
présente dans Entra est un cas **normal** (familles §5.2, aidants §5.13,
changement d'adresse §5.3, réinscription §5.4). Le front affiche un avis
**informatif bleu** rassurant (jamais rouge) et la pré-inscription continue.

### 5.16 Calendrier de clôture trimestrielle

Un trimestre reste **déclarable pendant 1 mois après sa fin** (exceptions
rares sur justificatifs — processus staff à formaliser). La **bascule** a lieu
le 1er du 2ᵉ mois suivant la fin du trimestre ; les chiffres bruts **BCSS**
arrivent vers le **15** du même mois → phase de contrôle.

| Trimestre | Déclarable jusqu'au | Bascule | Contrôle BCSS |
|---|---|---|---|
| T1 (janv-mars) | 30 avril | 1er mai | ~15 mai |
| T2 (avril-juin) | 31 juillet | 1er août | ~15 août |
| T3 (juil-sept) | 31 octobre | 1er novembre | ~15 novembre |
| T4 (oct-déc) | 31 janvier N+1 | 1er février N+1 | ~15 février N+1 |

**Point d'architecture clé :** le « trimestre courant » de l'application est
le trimestre **en cours de déclaration** (décalé), PAS le trimestre
calendaire.

**Depuis le 13/7/2026 (§5.21, chantier §10.0 TERMINÉ), la clôture métier est
l'écriture de la ligne `ActiveQuarter` dans la liste SharePoint `Config`**,
proposée par `sp:rotate` à la fin de la rotation (confirmation `BASCULER`).
C'est elle qui ferme les déclarations de l'ancien trimestre et ouvre le
nouveau — **plus aucune variable d'environnement à modifier, plus aucun
redéploiement**. Les variables `SP_CUMUL_LIST_NAME` / `SP_CUMUL_LIST_ID` /
`SP_CUMUL_PREV_LIST_NAME` ne servent plus que de **repli**. Procédure
outillée : `PROCEDURE-BASCULE-TRIMESTRE.md` (v3) + `npm run sp:rotate` (§7).

### 5.17 Paiements — modèle

- **4 listes trimestrielles PERMANENTES** (KB-Cumul T1..T4) aux **ID fixes**,
  réutilisées chaque année : à la bascule, la liste réutilisée est **archivée
  puis vidée** (jamais recréée — les ID câblés en config ne changent jamais).
- La colonne **`Paid` est un CUMUL** : un mois peut être payé en **plusieurs
  virements** portant la même communication structurée (paiement en 3 fois,
  etc.). Le portail gère nativement : le QR EPC affiche toujours le **reste
  dû** (`contribution − payé`), avec la même communication.
- Le **détail des virements** vit dans une liste paiements alimentée par un
  **CSV bancaire hebdomadaire**. Aujourd'hui beaucoup de paiements ont une
  communication libre (processus manuel historique) ; **objectif : 100 % de
  communications structurées** grâce au QR — le ratio devient mesurable.
- Liste **KB-Paiements** (structure de TEST, à réconcilier avec la liste
  réelle Fedasil via `sp:inspect` à la reprise) : `Title` = référence bancaire
  unique (clé d'**idempotence** des imports), `PaymentDate`, `Amount`,
  `StructuredCom` / `FreeCom` (séparés : les libres = file du lettrage
  manuel), `CounterpartyName/IBAN`, `FedasilNumber` + `Month` (résolus après
  lettrage), `Status` (À traiter / Imputé / Anomalie).
- **Lettrage cible** : lignes « À traiter » avec communication structurée
  valide → décodage FA + mois (modulo 97 vérifiable) → addition dans `Paid` →
  « Imputé ». Candidat idéal pour **Power Automate** (licences Premium
  acquises). Depuis le 12/7, les impayés d'un trimestre vidé **survivent dans
  la liste « Soldes »** (règle de vérité §5.20) ; l'archive JSON/CSV reste la
  sauvegarde brute.

### 5.18 Échéance et statuts de paiement (confirmé le 10/7/2026)

La contribution d'un mois est **due pour la fin du mois suivant sa clôture**
(ex. avril → 31 mai). Le dépassement d'échéance est une **mise en évidence
visuelle uniquement** : aucune action, aucun blocage, le paiement reste
possible à l'identique. Règle codée dans `paymentDeadline()` (`Portail.tsx`) ;
l'année est déduite du trimestre applicatif décalé (§5.16).

- **4 statuts par mois** (`monthPayStatus()`, l'échéance dépassée PRIME sur
  l'acompte) : **violet** = à payer (état normal) · **ambre** = acompte
  versé · **vert** = entièrement payé · **rouge** = échéance dépassée.
- La couleur n'est **jamais seule** : libellé texte sur les tuiles, FORME
  distinctive + aria-label dans la carte trimestre (cercle vide /
  demi-cercle / coche / point d'exclamation). Le rouge n'est JAMAIS porté
  par un élément interactif (charte Fedasil).
- Statut du **trimestre** (tuile « Reste à payer », cliquable → sélectionne
  le mois impayé le plus ancien, FIFO) dérivé des mois : tout payé → vert ;
  une échéance dépassée → rouge ; un acompte → ambre ; sinon violet.
- **Accès au paiement** : bouton violet plein « Payer X € » intégré à la
  tuile « Payé » du mois affiché → défilement direct vers le QR et les
  informations de virement.
- **Montant libre** : par défaut le solde du mois (total, ou reste après
  acompte) ; champ optionnel borné 0,01 → solde ; le QR EPC et le champ
  « Montant » copiable suivent le montant saisi ; la communication
  structurée reste IMMUABLE (§5.17, `Paid` = cumul de virements).

### 5.19 Saisie du numéro national au formulaire

Le champ NN accepte la saisie et le collage **avec ou sans séparateurs**
(points/tirets/espaces) et se formate **à la volée** en `00.00.00-000.00` ;
l'API reçoit toujours **11 chiffres nus** (inchangé côté serveur). Un
contrôle **modulo 97** côté client (variantes « né·e avant 2000 » et
« à partir de 2000 » avec préfixe « 2 », donc **numéros BIS couverts** —
aucun faux rejet pour le public demandeur d'asile) signale les fautes de
frappe avant l'envoi, avec un message local trilingue.
⚠ Ce contrôle CLIENT ne remplace pas le durcissement SERVEUR
`NN_CHECKSUM_STRICT` (§10 point 4), qui reste prioritaire : le NN est le
seul secret d'accès.

### 5.20 Liste « Soldes » — mémoire permanente des soldes mensuels (créée le 12/7/2026)

Décision §3 de l'app staff (CONCEPTION-STAFF-APP.md v2). Liste permanente,
**une ligne par FA × année × mois déclaré** (photo complète, pas seulement
les impayés), alimentée par **`npm run sp:soldes -- T2 2026`** (upsert
idempotent depuis une liste KB-Cumul, clé `Title` = `<FA>-<année>-<mois>`,
mode `--dry-run`, ne touche jamais aux colonnes qu'il ne possède pas).

**Règle de vérité** : tant que la ligne KB-Cumul d'un mois existe (~9 mois
après la clôture du trimestre), **KB-Cumul reste la source** (le portail la
lit) et `sp:soldes` resynchronise (paiements tardifs) ; **après le vidage**
de la liste trimestrielle, **Soldes est la seule vérité** (le lettrage y
écrira directement).

Colonnes calculées à chaque sync : `Balance` (Contribution − Paid),
`PayStatus` (**codes techniques neutres** `Paid`/`Partial`/`Unpaid` — le
staff est FR/NL, l'interface traduit, la donnée ne porte aucune langue ;
l'état « échu » n'est jamais stocké : il se dérive de `DueDate` à
l'affichage), `DueDate` (échéance §5.18), `YearMonth` (AAAAMM, dimension de
découpe fine). **5 colonnes indexées** (`FedasilNumber`, `Year`, `Quarter`,
`YearMonth`, `PayStatus`) : toute requête doit commencer par l'une d'elles
et renvoyer moins de 5000 lignes (filtres composés — discipline « 5000 »,
CONCEPTION-STAFF-APP §6). Volumétrie constatée : ~2000 lignes/trimestre
(données de test T4), soit ~8000/an.

### 5.21 Liste « Config » — trimestre actif de l'application (créée le 13/7/2026)

Chantier §10.0. Liste permanente, **une ligne par clé de configuration**
(colonne `Title`). Ligne **`ActiveQuarter`** = trimestre courant du portail :
`Quarter` (1-4), `Year`, `CumulListId`, `CumulListName`, `RotationNote`
(traçabilité).

- **Écrite par `sp:rotate`** à la FIN de la rotation (après archivage et vidage
  réussis), sur confirmation SÉPARÉE en tapant **`BASCULER`** — le vidage et
  l'activation restent deux décisions distinctes. Mode **`--config-only`** :
  bascule seule, sans toucher aux données (initialisation, récupération).
  **`--annee=YYYY`** : année du trimestre ACTIVÉ (défaut : année courante,
  correcte pour les 4 dates du calendrier §5.16 — à ne pas confondre avec
  l'année des données ARCHIVÉES, passée en 2ᵉ argument positionnel).
- **Lue par `Me.ts` et `Declare.ts`** via le module partagé
  `api/src/shared/quarterConfig.ts` : **cache mémoire ~5 min** (les Functions
  restent chaudes), lecture **SANS `$filter`** (liste minuscule : aucun enjeu
  d'index ni de seuil des 5000), **repli** sur les variables d'environnement
  si la liste est absente ou la ligne invalide (journalisé `⚠ REPLI`, cache
  court de 60 s pour sortir vite du repli).
- **Le piège « l'ID prime sur le nom » disparaît structurellement** : l'ID et
  le nom sont écrits ENSEMBLE, par le même script, au même instant. Le
  trimestre précédent est DÉRIVÉ (T actif − 1, bouclage T1 → T4).
- **Source de vérité partagée** : la future app staff lira la même liste.
- ⚠ **Ne jamais éditer la ligne à la main** (sauf urgence) : passer par
  `sp:rotate --config-only`. `Quarter` (1-4) et `Year` sont validés à la
  lecture ; une ligne invalide déclenche le repli.

## 6. Données SharePoint

### 6.0 VOLUME DE RÉFÉRENCE (établi le 13/7/2026) — chiffre structurant

Deux chiffres, à ne jamais confondre :

| | Valeur | Nature |
|---|---|---|
| **Volume observé** | **~1 700 déclarations/mois** | FAIT — mesuré sur le mois d'octobre 2025 réel (extraction KB-Cumul T4) |
| **Hypothèse de dimensionnement** | **~2 000 déclarations/mois** | MARGE — retenue pour tout calcul de capacité |

Conséquences directes, à l'hypothèse de dimensionnement :

- une liste **KB-Cumul atteint ~6 000 lignes par trimestre** → elle franchit le
  seuil SharePoint des 5 000 éléments **dès le 3ᵉ mois de chaque trimestre**,
  sans marge ;
- **KB-Paiements** croît de **~24 000 lignes/an** et **ne tourne JAMAIS** :
  c'est la seule liste sans mécanisme de purge → **premier candidat à la
  migration SQL** (§10), avant les KB-Cumul qui bénéficient au moins de la
  rotation trimestrielle ;
- **Soldes** dépasse 20 000 lignes dès la première année (confirmé : 20 113
  lignes dans le jeu de simulation) — d'où ses cinq colonnes indexées.

Ces chiffres sont la base chiffrée de la note d'arbitrage SQL à présenter à la
hiérarchie.

### 6.1 INDEX SHAREPOINT (posés le 13/7/2026) — fiabilité, pas performance

⚠ **Ce ne sont pas des optimisations : ce sont les index qui empêchent le
portail de tomber en fin de trimestre.**

`Me.ts` et `Declare.ts` ont TOUJOURS utilisé `$filter` (contrairement à ce qui
avait pu être supposé : il n'y a jamais eu de fetch-all dans ces fonctions).
Mais ils l'utilisaient avec le header `Prefer:
HonorNonIndexedQueriesWarningMayFailRandomly`, qui autorise le filtrage sur
colonne **non indexée** — au prix, comme son nom l'indique littéralement, d'un
échec **aléatoire** dès que la liste dépasse 5 000 éléments. À ~1 700-2 000
déclarations/mois, cela signifiait : **`/api/me` et `/api/declare` se seraient
mis à échouer au 3ᵉ mois de chaque trimestre, exactement quand les résidents
déclarent le plus.** Panne de production évitée de justesse.

Index en place sur le site de test (`Resident_Test`) :

| Liste | Colonnes indexées | Pourquoi |
|---|---|---|
| **Residents List** | `EntraOid`, `FedasilNumber`, `Title` (NN) | `EntraOid` = **chemin critique du login** : `/api/me` résout l'identité par oid à CHAQUE connexion. `Title` = éligibilité par NN (`/api/pre-inscription`). |
| **KB-Cumul T1–T4** | `FedasilNumber` | Lecture des déclarations d'UN résident (portail). |
| **KB-Paiements** | `Status`, `FedasilNumber` | `Status` = LA requête du module 3 (file de lettrage). |
| **Soldes** | `FedasilNumber`, `Year`, `Quarter`, `YearMonth`, `PayStatus` | Posées dès la création (§5.20). |

Le schéma `sharepoint-schema.json` porte désormais `"indexed": true` sur ces
colonnes : toute liste **recréée** par `sp:provision` le sera avec ses index.

**⚠ TROIS RÈGLES ABSOLUES :**

1. 🔴 **RÈGLE CORRIGÉE LE 13/7 AU SOIR — Graph refuse un `$filter` sur colonne
   non indexée IMMÉDIATEMENT, quelle que soit la taille de la liste** (400),
   y compris sur une liste de 1 300 lignes. Le seuil des 5 000 n'est **pas** la
   condition du refus : c'était seulement le moment où l'ancien header
   `HonorNonIndexed…` cessait de masquer le problème. **Conséquence : TOUTE
   colonne apparaissant dans un `$filter` doit être indexée — ou ne pas
   apparaître dans le filtre.** (Deux pannes de production l'ont démontré le
   soir même : index manquant sur KB-Cumul T2, et filtre sur la colonne `Month`
   dans `Declare.ts` — voir §11ter.)
2. **Un index ne peut être créé que si la liste compte MOINS de 5 000
   éléments.** Au-delà, SharePoint refuse. Pour une KB-Cumul (qui atteint le
   seuil au 3ᵉ mois), **la seule fenêtre sûre est juste après la rotation
   trimestrielle, sur liste vide** → étape intégrée à
   PROCEDURE-BASCULE-TRIMESTRE.md.
3. **Lors du passage en production : poser les index sur les listes Fedasil
   AVANT de déployer le code.** Le header `HonorNonIndexed…` ayant été retiré
   (voir ci-dessous), déployer le code sur des listes non indexées casserait
   **immédiatement** le portail pour TOUS les résidents. L'ordre n'est pas
   négociable.

**🔴 Le schéma NE PORTAIT PAS les `"indexed": true` annoncés (corrigé le 13/7
au soir).** La v8 affirmait que `sharepoint-schema.json` portait ces flags :
c'était FAUX — seule la liste Soldes les avait. Les 9 flags manquants
(Residents List ×3, KB-Cumul T1-T4 ×1, KB-Paiements ×2) ont été ajoutés.
**`sp:provision` sert désormais d'AUDIT D'INDEX** : toute colonne déclarée
indexée qui ne l'est pas produit un ⚠ (il ne la modifie jamais — principe
« jamais de modification »). C'est l'outil qui listera les index à poser à la
main sur le tenant Fedasil, AVANT le déploiement du code.

**Retrait du header (13/7/2026)** : `Prefer:
HonorNonIndexedQueriesWarningMayFailRandomly` a été supprimé de `queryItems()`
dans `Me.ts` et `Declare.ts`. Raison : avec les index en place il est inutile,
et son absence transforme une panne **aléatoire et tardive** (la pire à
diagnostiquer) en panne **franche et immédiate**. Les deux fonctions
journalisent en outre explicitement la cause probable sur un statut 400/403/503
(« colonne de filtre NON INDEXÉE sur une liste de plus de 5 000 éléments »).
**Fail fast plutôt que fail random.**

### 6.2 Listes

Site : `giapplab.sharepoint.com/sites/Resident_Test` (tenant de TEST — à
répliquer sur le tenant Fedasil ; ⚠ vérifier alors les **paramètres régionaux
du site** : fuseau Bruxelles + locale fr-BE, le défaut SharePoint est le
Pacifique américain, ce qui décale tous les affichages d'horodatage).

- Liste **Residents List** (`SP_LIST_ID` = `5f8da123-127d-4bfc-81e3-df9b972093b4`) :
  colonnes `Title` (= NN), `FirstName`, `LastName`, `Email`, `FedasilNumber`,
  **`EntraOid`** (créée le 9/7 par provisioning), + autres (BirthDate,
  Nationality, Center, Language…). Noms internes propres (créés en anglais).
- Liste **ResidentApp Aidants** (`de89feb8-b98d-45c6-a2b0-cc1ba2134e11`) :
  garde-fou des comptes internes (§5.13). `Title` = adresse autorisée en
  minuscules, `Label` = documentation.
- Listes **KB-Cumul T1..T4** (permanentes, ID fixes, année implicite — §5.16
  et §5.17) : `FedasilNumber`, `Month`, `NetSalary`, `GrossSalary`,
  `Contribution`, `Paid` (CUMUL), `StructuredCom`, `StructuredText`.
  ID tenant de test : T1 `462efd7c-9555-4601-b83f-cba677c57867`,
  T2 `cad4b15c-830a-4bdf-9e65-97b808a44787`,
  T3 `050b3e3e-7567-4dbd-8447-fff7cc7fc10d`,
  T4 `0894a6d7-55ff-4134-9b24-b489b8a998c9`.
- Liste **KB-Paiements** (`f3726038-c1ec-4414-8c65-23791c5f8563`) : structure
  de test du modèle paiements (§5.17) — à aligner sur la liste réelle Fedasil.
- Contrôle trimestriel : brut BCSS (totaux trimestre) vs net déclaré ; net
  « vraisemblable » estimé via ratio Jobat. Recommandation : contrôle par
  exception (seuil d'écart).
- Liste **Soldes** (`610bf274-1738-4323-af0a-8c108945a1d9`, créée le
  12/7/2026 par provisioning) : mémoire permanente des soldes mensuels
  (règle §5.20). Colonnes : `Title` (clé `<FA>-<année>-<mois>`),
  `FedasilNumber`*, `Year`*, `Quarter`*, `Month`, `YearMonth`*, `NetSalary`,
  `GrossSalary`, `Contribution`, `Paid`, `Balance`, `PayStatus`* (choix
  `Paid`/`Partial`/`Unpaid`), `StructuredCom`, `DueDate` — les * sont
  **indexées**. Les colonnes du futur moteur de rappels (module 4 staff)
  s'y ajouteront par provisioning, protégées de la synchronisation.
- Lettrage cible : import CSV bancaire → rapprochement automatique → alimente
  `Paid` → base des **rappels automatiques** (par lots, validés par un humain).
- Liste **Config** (créée le 13/7/2026 par provisioning) : trimestre actif de
  l'application (règle §5.21). Une ligne par clé (`Title`), aujourd'hui la
  seule : `ActiveQuarter`. Colonnes : `Quarter`, `Year`, `CumulListId`,
  `CumulListName`, `RotationNote`. Aucune colonne indexée (liste minuscule,
  lue sans `$filter`).
- NB d'ergonomie : les listes créées par API n'apparaissent PAS dans le menu
  latéral du site — les ajouter au lancement rapide (paramètres de liste →
  « Nom, description et navigation », ou édition du menu).

## 7. Provisioning déclaratif et exploitation des listes

La structure SharePoint est décrite dans le dépôt et appliquée en une commande.

- **`sharepoint-schema.json`** (racine) : décrit les **8 listes** + colonnes
  voulues (Residents List, ResidentApp Aidants, KB-Cumul T1..T4,
  KB-Paiements, **Soldes**). `documentOnly: true` = colonne existante
  (vérifiée, jamais créée) ; les autres sont créées si absentes → le MÊME
  schéma vérifie le tenant Fedasil et provisionne un tenant de test vierge.
- **`scripts/provision-sharepoint.ts`** : script idempotent, ne supprime/modifie
  JAMAIS rien. Réutilise les identifiants Graph de `api/local.settings.json`.
  Types gérés : text, note, number, dateTime, boolean, **choice** (validé le
  9/7 : 37 créations dont la colonne `Status` à choix).
- **`scripts/rotate-quarter.ts`** : bascule trimestrielle — **archive**
  (JSON fidèle + CSV `;` pour Excel) TOUJOURS écrite AVANT le **vidage**,
  confirmation en tapant `VIDER`, mode `--export-only`, reprise sur
  limitation de débit Graph. ⚠ `archives/` contient des données personnelles
  → **doit figurer dans `.gitignore`**.
  **v2 (13/7, §10.0)** : après le vidage, écrit la ligne `ActiveQuarter` de la
  liste `Config` sur confirmation SÉPARÉE (`BASCULER`) — **c'est la bascule
  métier** (§5.21). Modes ajoutés : **`--config-only`** (bascule seule, sans
  toucher aux données : initialisation d'un site, récupération) et
  **`--annee=YYYY`** (année du trimestre ACTIVÉ ; défaut = année courante).
  `--export-only` ne bascule JAMAIS. Une liste déjà vide propose tout de même
  la bascule (clôturer un trimestre sans données reste une clôture). Si la
  liste `Config` est absente, la rotation N'ÉCHOUE PAS : le script indique la
  commande de rattrapage.
- **`scripts/snapshot-soldes.ts`** (12/7) : synchronisation KB-Cumul →
  **Soldes** (§5.20) — upsert idempotent (clé `Title`), `--dry-run`,
  colonnes calculées (`Balance`, `PayStatus`, `DueDate`, `YearMonth`),
  reprise sur limitation Graph, lignes source invalides ignorées avec ⚠,
  année OBLIGATOIRE en argument. Ne touche jamais aux colonnes qu'il ne
  possède pas. ⚠ Si le schéma a évolué : `sp:provision` AVANT `sp:soldes`
  (sinon Graph 400 « Field not recognized » — reprise automatique après).
- **Colonnes indexées** (12/7) : le schéma accepte `"indexed": true`
  (colonne créée indexée — tri/filtre efficaces, seuil des 5000). Fidèle au
  principe « jamais de modification » : une colonne existante non indexée
  est seulement signalée ⚠ (index à poser à la main). NB : SharePoint
  refuse d'indexer au-delà de ~20 000 éléments — poser les index tôt.
- **`scripts/tsconfig.json`** (12/7) : contexte TypeScript **Node** dédié
  au dossier `scripts/` (`types: ["node"]`, `noEmit`) — supprime les
  erreurs d'éditeur `node:fs`/`process` dues au tsconfig navigateur du
  projet Vite. `tsx` reste le seul exécutant.
- **`PROCEDURE-BASCULE-TRIMESTRE.md`** (racine) : checklist d'exploitation
  complète de la bascule (archivage → variables SWA → re-run du DERNIER
  workflow → vérifications portail → local) + calendrier (§5.16) + tableau
  des ID.
- **`package.json`** :
  - `npm run sp:inspect` → rapport de l'état RÉEL (listes, colonnes, **noms
    internes**, types) — aucune écriture.
  - `npm run sp:provision` → applique le schéma (créations uniquement).
  - `npm run sp:rotate -- T3 [2025] [--export-only]` → archivage/vidage.
  - `npm run sp:soldes -- T2 2026 [--dry-run]` → synchronisation vers Soldes
    (année OBLIGATOIRE). ⚠ Les scripts `sp:*` vivent dans le `package.json`
    **RACINE** (pas dans `api/package.json`).
- Nécessite `tsx` (`npm i -D tsx`) et, pour l'éditeur, `@types/node`
  (voir `scripts/tsconfig.json`).
- **A servi à créer** la colonne `EntraOid`, puis (9/7) les listes Aidants,
  T1-T3 et KB-Paiements sur le tenant de test.
- Bénéfice réalisé (12/7) : la liste « Soldes » est née d'une entrée de
  schéma + `sp:provision` (13 créations), et vit par `sp:soldes`.

### 7.4 `npm run sp:seed` — jeu de données de SIMULATION (créé le 13/7/2026)

`scripts/seed-simulation.ts` reconstruit **une année complète d'activité**
(janvier 2025 → 20 mai 2026, « aujourd'hui simulé ») pour développer les modules
de l'app staff sans attendre les données réelles.

**Ce qu'il génère** (site de test, chiffres du run du 13/7) :

- **1 845 résidents** (prénoms/noms francophones réalistes remplaçant les
  `*****` anonymisés ; NN, FA, Email et EntraOid réels CONSERVÉS) dont
  12 arrivées fictives ;
- **~14 800 déclarations** réparties sur les 4 KB-Cumul selon la chronologie
  simulée (T3 = T3 2025, T4 = T4 2025, T1 = T1 2026, T2 = avril 2026 déclaré à
  85 %, mai non déclaré) ;
- **20 113 lignes Soldes** (janv. 2025 → mars 2026 ; T1-T2 2025 n'existent QUE
  là, leurs listes ayant été « réutilisées » dans la chronologie) ;
- **7 456 virements** dans KB-Paiements : payeurs ponctuels (communication
  structurée), paiements fractionnés, communications libres (file de lettrage
  du module 3) et 6 anomalies ;
- **fixtures BCSS du module 5** dans `simulation/` : 5 CSV trimestriels (brut
  DMFA par NN) + `BCSS-cle-de-correction.csv` donnant la **classe attendue** par
  dossier × trimestre (Conforme / EcartAControler / BcssSansDeclaration /
  DeclareSansBCSS) → permet de valider objectivement le futur écran de contrôle.

**Garanties :**

- **Les 2 008 lignes réelles de KB-Cumul T4 ne sont JAMAIS touchées** — elles
  servent de base statistique (fourchette et distribution des nets) et de
  population de départ.
- **Point fixe vérifié** : un `--dry-run` après génération affiche **0 opération
  sur toutes les listes**. Le jeu est reproductible à l'identique (graine fixe).
- **Purge chirurgicale** (`npm run sp:seed -- --purge`, confirmation « PURGER ») :
  triple marquage `StructuredText = "SIM"` (KB-Cumul), Title préfixé `SIM-`
  (paiements), FA préfixé `FA99` (résidents fictifs). ⚠ Les prénoms/noms
  remplacés ne sont PAS restaurés (les originaux étaient anonymisés).

Commandes : `--dry-run` (aucune écriture SharePoint, mais les fichiers
`simulation/` sont générés) · `--purge` · `--seed=<n>`. Écritures par lots Graph
`$batch` (20 op./requête), jeton rafraîchi automatiquement, reprise sur 429/503
et 401.

⚠ Le jeu actuel tourne à ~1 480 déclarations/mois (dérivé du réel). Pour un test
de charge à l'**hypothèse de dimensionnement (2 000/mois, §6.0)**, il faudra
ajuster la constante et purger/regénérer (backlog §10).

## 8. Configuration (variables d'environnement)

Sur la SWA **et** dans `api/local.settings.json` (dev) :

- Graph (serveur → SharePoint, app « e-residentapp admin ») : `TENANT_ID`,
  `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SENDER_USER_ID`.
- **Auth résident (app « residentapp-frontend »)** : `AAD_CLIENT_ID`,
  `AAD_CLIENT_SECRET`. ⚠ **Uniquement en production** (le simulateur local
  n'appelle pas Entra). Le `<TENANT_ID>` de `openIdIssuer` dans
  `staticwebapp.config.json` doit être la vraie valeur
  (`c5f3f27c-2dde-4f56-b914-f1831522edae`).
- **Trimestre actif (13/7, §5.21)** : `SP_CONFIG_LIST_NAME` (déf. « Config »),
  `SP_CONFIG_LIST_ID` (optionnel, économise la résolution par nom).
  ⚠ **`SP_CUMUL_LIST_ID` / `SP_CUMUL_LIST_NAME` / `SP_CUMUL_PREV_LIST_NAME` ne
  pilotent PLUS le portail** : elles ne servent que de **repli** si la liste
  `Config` devient illisible. Les garder à jour reste souhaitable (un repli sur
  des valeurs périmées servirait un ancien trimestre) mais n'est plus urgent ni
  bloquant — étape E, optionnelle, de la procédure de bascule.
- SharePoint : `SP_SITE_HOSTNAME`, `SP_SITE_PATH`, `SP_LIST_ID`,
  `SP_EMAIL_FIELD`, `SP_RESIDENT_FA_FIELD`, **`SP_RESIDENT_OID_FIELD`
  (déf. `EntraOid`)**, **`SP_FIRSTNAME_FIELD` (déf. `FirstName`)**,
  **`SP_LASTNAME_FIELD` (déf. `LastName`)** — utilisées par `Me.ts` ET, depuis
  la v5, par `Subscription.ts` (noms officiels pour l'invitation), `SP_CUMUL_LIST_ID`,
  `SP_CUMUL_LIST_NAME` (déf. « KB-Cumul T4 »), `SP_CUMUL_PREV_LIST_NAME`
  (déf. « KB-Cumul T3 »), `SP_CUMUL_FA_FIELD`, `SP_MONTH_FIELD`, `SP_NET_FIELD`,
  `SP_GROSS_FIELD`, `SP_CONTRIB_FIELD`, `SP_PAID_FIELD`, `SP_STRUCTCOM_FIELD`,
  `SP_FA_IS_NUMBER`.
- Paiement : `PAYMENT_IBAN`, `PAYMENT_BENEFICIARY` (⚠ IBAN de test personnel —
  à remplacer par l'IBAN Fedasil avant mise en service réelle).
- **Garde-fou aidants (v5)** : `SP_STAFF_LIST_NAME` (déf. « ResidentApp
  Aidants »), `SP_STAFF_LIST_ID` (optionnel, économise la résolution par nom
  — tenant test : `de89feb8-b98d-45c6-a2b0-cc1ba2134e11`),
  `SP_STAFF_EMAIL_FIELD` (déf. `Title`).
- **Invitations / e-mails (v5)** : `INVITE_REDIRECT_URL` — ⚠ Graph refuse
  http et localhost ; en local, repli `https://myapps.microsoft.com`.
  **Recommandation : pointer directement sur `…/portail`** (l'invité activé
  atterrit sur ses données, pas sur « Mes applications » Microsoft).
  `PORTAL_URL` (optionnel) : lien du portail dans l'e-mail des MEMBRES
  internes ; défaut intelligent déduit d'`INVITE_REDIRECT_URL` (reprise
  telle quelle si elle finit déjà par `/portail`, sinon ajout du segment) —
  à définir seulement si différent.
- Local : `AzureWebJobsStorage: ""` (avertissement « unhealthy » bénin).
  ⚠ `local.settings.json` est du JSON STRICT : une virgule manquante/en trop
  empêche l'hôte Functions de démarrer (« Could not connect to :7071 » via
  SWA CLI) — valider avec
  `node -e "JSON.parse(require('fs').readFileSync('api/local.settings.json','utf8'))"`.

Dépendances ajoutées : `qrcode` (+ `@types/qrcode`), `tsx` (dev, provisioning
et rotation).

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

✅ **TERMINÉ (v5, validé en production)** : sélecteur de profils familiaux
dans `Portail.tsx` (FA actif propagé et vérifié serveur) ; assouplissement de
`App.tsx` (check-email informatif, formulaire minimal NN + e-mail + langue) ;
prénom/nom lus depuis la liste resident dans `Subscription.ts` ; règle métier
aidants (§5.13) ; **garde-fou « ResidentApp Aidants »** (fail-closed) ;
**comptes internes** (liaison directe sans invitation) ; provisioning des
7 listes sur le tenant de test ; outillage de **bascule trimestrielle**
(procédure + `sp:rotate`).

✅ **TERMINÉ (v6, 12/7)** : **session ergonomie complète** — voir
CHANGELOG-session-2026-07-12.md et §5.18/§5.19 (mobile, statuts de paiement
colorés, boutons de paiement intégrés aux tuiles, montant libre, pastille
d'activation unique, aide fiche de paie, « Réessayer », 401 → reconnexion,
NN formaté + modulo 97 client, conformité ESLint react-hooks v6).

✅ **TERMINÉ (v9, 13/7 soir) — CHANTIER §10.0 : bascule automatique du
trimestre** (liste `Config`, règle §5.21) : schéma, `sp:rotate` v2
(`BASCULER`, `--config-only`, `--annee`), module partagé `quarterConfig.ts`,
lecture dans `Me.ts`/`Declare.ts`, PROCEDURE-BASCULE-TRIMESTRE v3.
**Validé en production** (site de test) : ligne `ActiveQuarter` écrite,
trace `source : Config` confirmée dans Application Insights.
Corrigés dans la foulée : **deux pannes de production** révélées par le
fail-fast (index manquant sur KB-Cumul T2 ; `$filter` sur la colonne `Month`
non indexée dans `Declare.ts` → 500 à CHAQUE déclaration) et les **écrans
d'erreur sans issue** de `Portail.tsx`. Voir §11ter.

📅 **ÉCHÉANCE REQUALIFIÉE (13/7 soir) : la « bascule réelle du 1er août 2026 »
N'EST PLUS une échéance ferme.** L'application ne sera très probablement pas
validée métier ni répliquée sur le tenant Fedasil d'ici là : il n'y aura donc
rien à basculer en production ce jour-là. **La première bascule réelle sera
celle du premier trimestre suivant la mise en service, quelle qu'elle soit** —
la procédure est indifférente au trimestre.
⚠ **Mais la RÉPÉTITION GÉNÉRALE reste obligatoire AVANT cette première bascule
réelle** (backlog, point 12) : dérouler `sp:soldes` → `sp:rotate` (`VIDER` +
`BASCULER`) → index sur liste vide → vérification du portail, sur le site de
test.

0. 🔴 **CHANTIER OUVERT — Historique multi-trimestres pour le résident**
   *(ex-§10.0bis — devient le chantier prioritaire, le §10.0 étant terminé.)*
   *Décidé et cadré le 13/7, NON commencé.*

   **Besoin métier (confirmé le 13/7)** : le résident doit pouvoir consulter
   **au moins les 4 derniers trimestres, courant compris**.

   **Pourquoi ce n'est pas possible aujourd'hui** : le portail n'offre que deux
   fenêtres (`current` / `previous`), et surtout les KB-Cumul ne CONTIENNENT pas
   4 trimestres — la rotation vide la liste réutilisée (chaque trimestre survit
   ~9 mois, §5.16). Le 4ᵉ trimestre est toujours en sursis.

   **Architecture retenue** :
   - **trimestre COURANT → KB-Cumul** (lecture directe : c'est là qu'on écrit,
     fraîcheur immédiate ; lire Soldes ferait disparaître une déclaration
     jusqu'à la prochaine synchro — inacceptable) ;
   - **trimestres ANTÉRIEURS → Soldes** (mémoire permanente, indexée,
     insensible aux rotations, §5.20). Le portail peut alors offrir 4, 8 ou tout
     l'historique.

   Touche `Me.ts` (nouvelle lecture Soldes) **et le frontend** (`Portail.tsx` :
   le bouton « trimestre précédent » devient un sélecteur ; l'API doit indiquer
   les trimestres disponibles).

   **Questions à trancher AVANT de coder** : combien de trimestres exactement ?
   Que fait-on des mois sans déclaration (absents de Soldes) ? Le paiement
   reste-t-il possible sur un trimestre archivé (le QR EPC a-t-il un sens sur
   une dette ancienne) ?

1. **Gouvernance de l'ANNÉE** : modèle confirmé = 4 listes permanentes à ID
   fixes, archivées puis vidées à la bascule (§5.16-5.17). Reste : nommer les
   archives avec l'année (fait par `sp:rotate`), et trancher l'ambiguïté
   année de la communication structurée (virements tardifs → imputation
   manuelle, §5.12).
2. ✅ **Liste « Soldes »** : FAIT le 12/7 (règle §5.20, script `sp:soldes`,
   procédure de bascule mise à jour — étapes A et E). Reste de ce chantier :
   le **processus de rappels** lui-même (module 4 de l'app staff — colonnes
   d'escalade à ajouter à Soldes par provisioning) ; **améliorations
   consignées** pour `snapshot-soldes.ts` : lecture de la cible filtrée par
   `Year`+`Quarter` au lieu de la liste entière (indispensable avant la 2ᵉ
   année), et vérification des colonnes AVANT écriture (message clair
   « lancer sp:provision » au lieu d'un 400 Graph).
3. **Lettrage des paiements** : import CSV bancaire hebdo → liste paiements →
   imputation automatique des communications structurées dans `Paid`.
   Candidat **Power Automate** (licences Premium acquises) ; structure de
   test KB-Paiements prête (§5.17). Aligner d'abord le schéma sur la liste
   réelle Fedasil (`sp:inspect` à la reprise).
4. **Durcissements production :**
   - Remplacer `Sites.ReadWrite.All` + `Sites.FullControl.All` par
     **`Sites.Selected`** (contrôle limité au seul site ResidentApp) ;
   - IBAN Fedasil réel (remplacer l'IBAN de test) ;
   - `NN_CHECKSUM_STRICT=true` + rate limiting robuste + CAPTCHA — **priorité
     RENFORCÉE** : depuis le formulaire minimal, le NN est le seul secret
     d'accès (voir §5.13). NB : le contrôle modulo 97 CLIENT est fait
     (v6, §5.19) mais ne remplace pas le durcissement SERVEUR ;
   - question « Rester connecté ? » (KMSI) sur postes partagés ;
   - suppression secret expiré éventuel ; nettoyage comptes invités orphelins ;
   - décision suppression du code `DEBUG_ERRORS` ;
   - évaluation managed identity.
5. Design : logo officiel Fedasil (SVG), page d'accueil, parcours pas-à-pas.
6. **Variante d'e-mail pour les membres internes** dans `invitationEmail.ts`
   (« votre accès est prêt, connectez-vous » au lieu du wording
   « invitation ») — partager le fichier dans le projet Claude.
7. Nettoyage données de test (personas NN, lignes de test des trimestres) +
   clés orphelines de `translations.ts` (v6 : `firstNameLabel`,
   `lastNameLabel`, `errorFirstNameRequired`, `errorLastNameRequired`,
   `nationalIdHelper`).
8. Payconiq (alternative de paiement) à évaluer institutionnellement.
9. **[DÉCISION HIÉRARCHIE] Migration base de données** : quitter SharePoint
   pour **Azure SQL (recommandé)** ou Dataverse. Analyse du 10/7 :
   - Azure SQL : coût infrastructure (qq €/mois), AUCUNE question de licence
     par utilisateur externe, modèle relationnel qui règle année/Soldes/
     détail des fiches de paie/lettrage, marche basse côté Functions
     (l'architecture actuelle isole déjà l'accès aux données — le frontend
     ne bouge pas) ;
   - Dataverse : inclus dans les licences Power Apps Premium acquises
     (~10 Go tenant + 250 Mo/licence), MAIS ⚠ **risque licensing pour les
     utilisateurs EXTERNES** (résidents via portail custom = accès indirect /
     multiplexing ; le véhicule Microsoft prévu est Power Pages, packs par
     utilisateurs authentifiés) — **à faire vérifier par le revendeur
     Microsoft** avant tout choix Dataverse ;
   - Recommandation : SQL pour les données résidents, Power Apps/Automate
     (connecteur SQL Premium, couvert par les licences) pour l'outillage
     staff sur la MÊME base.
   - **Chiffres du 12/7 pour la note d'arbitrage** (à rédiger — voir
     CONCEPTION-STAFF-APP §5 point 10) : ~2000 lignes/trimestre constatées,
     ~8000/an dans Soldes, seuil SharePoint des 5000 dépassé dès la première
     année pleine — tenable une décennie par discipline (index, filtres
     composés, agrégats précalculés — CONCEPTION-STAFF-APP §6), là où SQL
     supprime la discipline. Soldes = source de reprise le jour venu.
10. **[CHANTIER CONSIGNÉ — non prioritaire] Modèle de délégation aidants** :
    permettre l'accès SIMULTANÉ résident + aidant à un même dossier
    (aujourd'hui la ré-inscription par NN TRANSFÈRE l'accès, §5.13). Piste
    retenue : colonne `DelegateOid` (ou liste « Delegates » : FA, oid délégué,
    rôle, échéance) sur/à côté de la liste resident, résolue par
    `Me.ts`/`Declare.ts` EN PLUS de `EntraOid` (l'union des deux donne les
    profils) ; sélecteur de profils inchangé côté portail. Créable via le
    provisioning (§7). Questions à trancher le moment venu : qui
    accorde/révoque la délégation (staff ?), échéance automatique, traçabilité
    des déclarations faites par un délégué (colonne « DeclaredBy » ?).
11. **Réplication sur le tenant Fedasil** (à la reprise) : `sp:inspect` puis
    alignement du schéma (surtout la liste paiements réelle), `sp:provision`,
    liste Aidants alimentée par le staff, variables SWA (dont
    `INVITE_REDIRECT_URL` → `/portail`), **paramètres régionaux du site**
    (fuseau Bruxelles + fr-BE — le défaut est le Pacifique), lancement rapide
    du menu, **listes « KB-Cumul Archives \<année\> »** (relever la structure
    avec `sp:inspect`, tester le contrat Soldes §5.20 — reprise d'historique
    vs succession, voir CONCEPTION-STAFF-APP §3.4), et validation business
    des règles §5.2/§5.13.

12. **Répétition générale de la bascule** (obligatoire AVANT la première
    bascule réelle, quelle qu'en soit la date) : sur le site de test, dérouler
    la procédure complète — `sp:soldes -- T3 2025` → `sp:rotate -- T3 2025`
    (`VIDER` puis `BASCULER`) → vérifier l'index `FedasilNumber` sur la liste
    vidée → portail sur T3 vide en ≤ 5 min → retour à T2 par `--config-only` et
    `sp:seed` pour restaurer la simulation. ⚠ Consomme les données de
    simulation T3 (regénérables).

13. 🟠 **[QUESTION MÉTIER — à trancher avec le business] TROP-PERÇU après
    correction à la baisse** *(constaté le 13/7 au soir)*. Un résident qui
    corrige sa déclaration **à la baisse APRÈS avoir payé** se retrouve avec
    `Paid > Contribution` — et **rien ne l'indique**, nulle part :
    - **portail** : `monthPayStatus()` ne connaît que 4 états (à payer /
      acompte / payé / échu) ; un solde négatif tombe dans « payé » (vert) ;
    - **donnée (Soldes)** : `Balance` devient négatif et `PayStatus` vaut
      `Paid` (règle `Balance ≤ 0 → Paid`, §5.20) : la donnée est juste mais ne
      distingue pas « soldé » de « trop-perçu ». Un état `Overpaid` réglerait
      l'affaire — **décision métier**.
    - **Questions pour le business** : que fait-on d'un trop-perçu (imputation
      sur une dette antérieure ? report sur le mois suivant ? remboursement ?),
      et **la correction à la baisse après paiement doit-elle rester libre** ?
      (Vecteur d'abus possible : déclarer haut, payer, corriger bas pour
      générer un crédit → contrôle staff à prévoir, module 2.)
    Aucune règle n'est codée aujourd'hui : le serveur recalcule la contribution
    et ne touche pas à `Paid` (§5.9) — comportement correct, mais le cas n'a
    jamais été pensé.

14. **Test de charge à l'hypothèse de dimensionnement** (2 000 déclarations/mois,
    §6.0) : le jeu de simulation actuel tourne à ~1 480/mois. Ajuster la
    constante de `seed-simulation.ts`, purger, regénérer.

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

**Ajouts session 2 du 9/7 (profils familiaux + formulaire minimal) :**

- **Chercher les champs jamais exploités avant d'en simplifier la saisie** :
  `username` était déclaré dans le type du body mais jamais lu ; prénom/nom ne
  servaient qu'à des usages remplaçables par la liste resident. Un `grep` côté
  API avant toute décision de formulaire.
- **Ne jamais renvoyer le nom après saisie du NN** (oracle d'énumération
  NN → nom) : la confirmation nominative passe par l'e-mail d'invitation.
- **Graph ne renomme pas un invité existant** lors d'une ré-invitation
  idempotente : le displayName reste celui de la première inscription.
- **Le sélecteur famille n'est PAS testable en local** : le simulateur SWA ne
  fournit pas d'oid, et le repli e-mail exige une correspondance UNIQUE (deux
  lignes même e-mail en local → message « refaire la pré-inscription », comportement
  prévu). Tester le cas famille/aidant uniquement en production.
- **Changement de personne au portail = vider le cache du trimestre
  précédent** (il appartient à l'ancien profil).
- **Formulaire minimal ⇒ le NN devient l'unique secret d'accès** : durcissements
  (`NN_CHECKSUM_STRICT`, rate limiting, CAPTCHA) en priorité renforcée.

**Ajouts session 3 du 9-10/7 (garde-fou, comptes internes, exploitation) :**

- **Préférer la lecture complète au `$filter` Graph pour les petites listes** :
  le garde-fou filtré par `$filter=fields/... eq` refusait à tort (indexation
  de colonne, casse, espaces) ; lire toute la liste (paginée) et comparer en
  code des valeurs NORMALISÉES (trim + minuscules) est plus robuste et
  auto-diagnostique (le log donne le nombre d'entrées lues).
- **Graph refuse d'inviter une adresse d'un domaine vérifié du tenant** → les
  membres internes se détectent AVANT l'invitation (`userType eq Member`) et
  se relient directement par leur oid.
- **`local.settings.json` est du JSON strict** : une virgule oubliée casse le
  démarrage de l'hôte Functions ; le SWA CLI n'affiche alors qu'un
  « Could not connect to :7071 » — lancer `func start` dans `api/` pour voir
  la vraie erreur (fichier + ligne).
- **Simulateur SWA** : identité visible sur `/.auth/me`, changement de compte
  via `/.auth/logout`. Rappel : pas d'oid en local → repli e-mail à
  correspondance UNIQUE (deux lignes même e-mail = 404 volontaire).
- **Jeux de test : un NN par persona** (résident autonome / résidents aidés)
  et ne jamais croiser les pré-inscriptions — chaque pré-inscription
  TRANSFÈRE la ligne vers le dernier compte utilisé.
- **Fuseau horaire SharePoint** : un site neuf est en Pacifique américain par
  défaut → horodatages décalés à l'affichage (stockage UTC, données saines).
  Paramètres régionaux du site → Bruxelles + fr-BE.
- **Les listes créées par API** n'apparaissent pas dans le menu latéral
  (lancement rapide) — réglage d'interface à faire à la main.
- **`INVITE_REDIRECT_URL` → pointer sur `/portail`** : l'invité activé
  atterrit sur ses données ; `PORTAL_URL` se déduit intelligemment (pas de
  double `/portail/portail`).

**Ajouts session 4 du 12/7 (ergonomie) :**

- **ESLint react-hooks v6 (lint du React Compiler)** : `window.location.href
  = …` interdit dans un composant → utiliser `window.location.assign(…)`
  (comportement identique) ; aucun `setState` SYNCHRONE dans le corps d'un
  effet → décider dans le flux asynchrone (init, réponse réseau) ou dans un
  gestionnaire d'événement.
- **Un QR ne se scanne pas sur l'écran qui l'affiche** : sur tactile
  (`matchMedia("(hover: none) and (pointer: coarse)")`), champs copiables
  d'abord, QR replié derrière un bouton (et généré à la demande seulement).
- **La couleur ne porte jamais l'information seule** : libellé texte ou
  forme distinctive (+ aria-label) systématiques ; le rouge jamais sur un
  élément interactif — l'affordance de clic reste violette même quand l'état
  est rouge.
- **Gare aux conflits sémantiques de couleur** : la coche verte « déclaré »
  entrait en collision avec vert = « payé » → remplacée par une icône d'état
  de paiement par mois (forme + couleur).
- **Pastille « une seule fois »** : clé localStorage par oid
  (`ra-activated-{oid}`) — par compte ET par appareil, donc compatible
  postes partagés ; localStorage indisponible (navigation privée) → ne pas
  afficher plutôt que ré-afficher en boucle.
- **Le modulo 97 du NN couvre aussi les numéros BIS** (mêmes deux variantes
  avant/à partir de 2000) : validation client sans faux rejet pour le public
  demandeur d'asile. L'exemple du texte d'aide (`85.07.30-033.28`) a un
  checksum réellement valide.
- **Formatage à la volée d'un champ masqué** : effacer un séparateur doit
  effacer aussi le chiffre précédent, sinon le reformatage ré-ajoute le
  séparateur et la touche retour semble cassée.
- **Resynchroniser les fichiers du projet Claude après CHAQUE session** :
  `App.tsx` était resté en v4 dans le projet, ce qui a failli faire
  régresser le formulaire minimal lors du chantier suivant.

**Ajouts session 5 du 12/7 (liste Soldes — décision §3 app staff) :**

- **« Soldes vs SQL » était un faux duel** : deux décisions, deux
  propriétaires, deux horizons — Soldes = continuité opérationnelle (à
  nous, tout de suite) ; SQL = cible structurelle (hiérarchie, sans
  blocage). Bâtir la solution minimale ET instruire la structurelle.
- **Le seuil SharePoint des 5000 est une limite de REQUÊTE, pas de
  stockage** : toute requête filtrée doit commencer par une colonne indexée
  ET renvoyer < 5000 lignes → filtres composés (`Year+Quarter`,
  `PayStatus+Year`, `YearMonth` AAAAMM comme dimension de découpe fine),
  jamais de filtre « qui grossit avec les années » seul. La lecture paginée
  SANS filtre n'est pas soumise au seuil (traitements de fond). Les index
  se posent AVANT ~20 000 éléments (fenêtre qui se ferme). Attention aussi
  aux limites de délégation du connecteur SharePoint de Power Apps
  (troncature silencieuse).
- **Codes techniques neutres, l'interface traduit** : public staff FR/NL →
  les valeurs stockées sont des codes anglais stables (`Paid`/`Partial`/
  `Unpaid`), la langue est une affaire d'affichage. (Le `Status` français
  de KB-Paiements suivra lors du module 3 staff.)
- **Un script de synchronisation possède SES colonnes et rien d'autre** :
  l'upsert idempotent (clé naturelle en `Title`) rend toute interruption
  bénigne et permet aux autres modules d'ajouter leurs colonnes sans
  risque. Recréer une liste jeune est souvent plus propre que la retoucher
  (l'ID change : le noter).
- **`sp:provision` AVANT `sp:soldes` quand le schéma évolue** — sinon Graph
  400 « Field not recognized » (sans gravité : relancer, reprise
  automatique).
- **Les scripts `sp:*` vivent dans le `package.json` RACINE** — pas dans
  `api/package.json`. Réflexes de vérification : `npm run` (liste les
  scripts du dossier courant) et « suis-je dans le bon dépôt ? » — la
  couche données vit dans le dépôt du PORTAIL, l'app staff ne fait que
  consommer les listes.
- **`scripts/` mérite son propre `tsconfig.json` Node** : VS Code applique
  le tsconfig le plus proche ; sans lui, les scripts Node sont vérifiés
  avec la config navigateur de Vite (fausses erreurs `node:fs`/`process`).
- **Récidive JSON strict** : `local.settings.json` a encore cassé sur une
  virgule (« Expected double-quoted property name » ligne N = virgule en
  trop à la fin de la ligne N−1). La commande de validation
  `node -e "JSON.parse(…)"` reste le premier réflexe.

---

## 11bis. Leçons de la session du 13/7 (simulation, index, fiabilité)

- **`HonorNonIndexedQueriesWarningMayFailRandomly` porte son nom
  littéralement.** Ce header n'est pas un contournement bénin : il autorise une
  requête filtrée sur colonne non indexée, qui **échouera aléatoirement** une
  fois les 5 000 éléments dépassés. Sur une liste qui franchit le seuil au 3ᵉ
  mois de chaque trimestre, c'est une panne de production programmée, au pire
  moment. **Indexer, puis retirer le header** : on préfère une panne franche et
  immédiate à une panne aléatoire et tardive. *Fail fast plutôt que fail
  random.*
  ⚠ **NUANCE APPORTÉE LE SOIR MÊME (voir §11ter et §6.1)** : la formulation
  « échouera une fois les 5 000 éléments dépassés » est INEXACTE. Sans le
  header, Graph refuse le `$filter` sur colonne non indexée **immédiatement,
  quelle que soit la taille de la liste**. Le seuil des 5 000 n'était que le
  moment où le header cessait de sauver la mise. La conclusion (indexer, puis
  retirer le header) reste juste ; le mécanisme, lui, est plus strict qu'écrit
  ici.

- **VÉRIFIER LE CODE AVANT DE RECOMMANDER UNE RÉÉCRITURE (leçon répétée).**
  Une recommandation de réécrire `Me.ts` « pour passer en `$filter` » a été
  formulée sur la base d'une supposition : or `Me.ts` et `Declare.ts`
  utilisaient DÉJÀ `$filter` depuis le début. Le seul fetch-all du projet est
  dans `Subscription.ts` (liste Aidants — petite liste, justifié et commenté).
  Le vrai problème était ailleurs (le header), et n'a été trouvé qu'en OUVRANT
  le fichier. *C'est la deuxième fois que cette erreur se produit sur ce même
  fichier.*

- **Un PRNG déterministe ne suffit PAS à rendre une simulation reproductible :
  il faut aussi que sa CONSOMMATION ne dépende pas de l'état qu'il a lui-même
  créé.** Bug réel rencontré : au 1er run, un NN fictif était généré (4 tirages
  consommés) pour les résidents absents de Residents List ; au 2ᵉ run ces
  résidents EXISTAIENT (créés au 1er run), leur NN était donc lu et non
  généré → 4 tirages en moins → **tout le profil suivant décalé** (salaires,
  rythme de travail). Correctif : **un flux `mulberry32(hash32("nn:"+seed+fa))`
  DÉDIÉ par donnée générée**. Test de non-régression : un `--dry-run` après
  génération doit afficher **0 opération** (point fixe).

- **Sur un run long (40 000+ écritures), le jeton Graph EXPIRE** (~60 min).
  Sans rafraîchissement, chaque lot répond 401, traité comme un échec définitif
  et noyé dans les logs. Tout script d'écriture massive doit **rafraîchir son
  jeton (~40 min) et traiter le 401 comme une REPRISE**, pas comme une erreur.

- **Un compteur de progression qui n'affiche qu'un lot sur N ment sur la fin.**
  « 7409/7450 » laissait croire à 41 lignes perdues alors que tout était écrit.
  Toujours afficher un **bilan exact en fin de phase** (`X/X écrit(s), N
  échec(s), N abandonnée(s)`).

- **L'ordre index → déploiement n'est pas négociable.** Le header retiré, du
  code déployé sur des listes non indexées casse le portail **immédiatement**
  pour tous les résidents. En production : **index d'abord, code ensuite.**

- **Distinguer volume OBSERVÉ et hypothèse de DIMENSIONNEMENT** (§6.0) : ~1 700
  déclarations/mois est un fait mesuré ; ~2 000 est une marge de sécurité.
  Confondre les deux dans une note à la hiérarchie coûterait en crédibilité ;
  les séparer la renforce.

## 11ter. Leçons de la session du 13/7 au SOIR (bascule Config — et ses deux pannes)

- 🔴 **La règle des index était MAL COMPRISE, et ça a coûté deux pannes.**
  On croyait : « colonne non indexée = risque AU-DELÀ de 5 000 éléments ».
  La réalité : **Graph refuse un `$filter` sur colonne non indexée
  IMMÉDIATEMENT (400), même sur une liste de 1 300 lignes.** Le seuil des 5 000
  n'était que le moment où l'ancien header `HonorNonIndexed…` cessait de
  masquer le problème. **Règle correcte : toute colonne d'un `$filter` doit
  être indexée — ou disparaître du filtre.**

- **Panne 1 — l'index manquant sur KB-Cumul T2.** Le portail est tombé
  (`/api/me` en 500) dès que Config a désigné T2 comme trimestre courant : T2
  était la SEULE des quatre KB-Cumul dont `FedasilNumber` n'était pas indexé.
  Personne ne l'avait vu, parce que les variables d'environnement pointaient
  ailleurs. **Leçon : avoir vérifié l'index sur LA liste servie ne dit rien des
  trois autres.** Et le fail-fast a fait exactement son travail : panne franche,
  message explicite, correction en 2 minutes — au lieu d'une panne aléatoire au
  3ᵉ mois du trimestre, avec 1 700 résidents dessus.

- **Panne 2 — `/api/declare` en 500 à CHAQUE déclaration.** Le filtre
  « déclaration déjà existante ? » portait sur DEUX colonnes :
  `FedasilNumber` (indexée) **et `Month` (non indexée)** → 400 → 500.
  Bug présent depuis le retrait du header le 13/7 au matin, resté invisible
  faute d'avoir rejoué une déclaration derrière. **Correctif : filtrer sur le
  SEUL `FedasilNumber` (indexé, ≤ 3 lignes par résident et par trimestre) et
  sélectionner le mois EN CODE.** Choisi PLUTÔT que d'indexer `Month` : on
  supprime la dépendance au lieu de la satisfaire — un index de moins à créer,
  à vérifier, et surtout à ne pas oublier lors de la réplication production.

- **Après un changement d'infrastructure, REJOUER LES TROIS CHEMINS
  CRITIQUES** : connexion (`/api/me`), consultation du trimestre précédent, et
  **déclaration/correction** (`/api/declare`). Le retrait du header a laissé
  passer DEUX régressions muettes faute de ce test. À faire systématiquement.

- **La documentation peut mentir — vérifier le fichier, pas la doc.**
  La v8 affirmait que `sharepoint-schema.json` portait les `"indexed": true` :
  c'était faux (seule Soldes les avait). Elle affirmait aussi que `Portail.tsx`
  avait des boutons « Réessayer » (v6) : il n'y en avait aucun. **Deux fois, la
  vérité était dans le fichier, pas dans l'état projet.** *(À rapprocher de la
  leçon du matin : ouvrir le code AVANT de recommander une réécriture.)*

- **Écrans d'erreur sans issue (corrigé)** : dans les états `error` et `nodata`,
  `Portail.tsx` n'affichait qu'une alerte — sans « Réessayer » ni « Changer de
  personne ». Un compte FAMILLE dont UN profil échouait était **entièrement
  bloqué** (seule la déconnexion restait), puisque la barre « Changer de
  personne » n'existe que dans l'état `ready`. **Toute impasse d'interface doit
  offrir une sortie.**

- **Piège React attrapé au passage** : `setPrevStatus("idle")` suivi d'un appel
  à `showPrevious()` ne fonctionne PAS — la fonction lit la valeur d'état de la
  closure du rendu COURANT (encore `"error"`), et son garde-fou annule la
  relance **en silence**. Correctif : paramètre explicite `showPrevious(force)`.
  Corollaire immédiat : `onClick={showPrevious}` devient dangereux (React passe
  l'objet événement en 1ᵉʳ argument → `force` truthy) → `onClick={() =>
  showPrevious()}`.

- **Le calendrier n'est pas une échéance.** La « bascule réelle du 1er août »
  n'en est pas une : sans validation métier ni réplication production, il n'y a
  rien à basculer ce jour-là. **Une date de procédure ne devient une échéance
  que si le système est en service** — distinction rappelée par le métier, pas
  par la technique.

- **UTC partout** : `sp:rotate` horodate en UTC (suffixe `Z`) et Application
  Insights stocke en UTC. Un écart de 2 h avec l'heure belge (été) est NORMAL,
  pas un bug. L'UTC est volontaire pour la traçabilité (sans ambiguïté de
  fuseau ni de passage heure d'été/hiver).

## 12. Prompt de relance (à coller au début de la prochaine conversation)

> Bonjour Claude. Je poursuis le développement de ResidentApp (portail Fedasil
> pour résidents, React + TypeScript + CSS pur, Azure Static Web Apps +
> Functions). CONTEXTE : tout l'état du projet est dans
> ETAT-PROJET-ResidentApp.md (**v9 du 13 juillet 2026, soir**) dans les
> fichiers du projet — lis-le d'abord, en particulier **§5.20 (liste Soldes)**,
> **§5.21 (liste Config)**, **§6.1 (index SharePoint — RÈGLE CORRIGÉE)** et
> **§11ter (leçons)**.
>
> EN RÉSUMÉ : le parcours résident complet est validé en production
> (authentification Entra personnalisée, matching par `oid`, sélecteur de
> profils familiaux et aidants). Le provisioning est déclaratif
> (`sharepoint-schema.json` + `sp:provision`, qui sert AUSSI d'audit d'index),
> la liste permanente « Soldes » existe (`sp:soldes`), et **la bascule
> trimestrielle est désormais AUTOMATIQUE** : une liste SharePoint `Config`
> (ligne `ActiveQuarter`) écrite par `sp:rotate` (confirmation `BASCULER`,
> modes `--config-only` / `--annee=`) porte le trimestre actif ; `Me.ts` et
> `Declare.ts` la lisent via `api/src/shared/quarterConfig.ts` (cache 5 min,
> repli variables d'env). Plus aucune variable ni redéploiement à la clôture.
>
> ⚠ RÈGLE À NE PAS OUBLIER (§6.1) : Graph refuse un `$filter` sur colonne NON
> INDEXÉE **immédiatement**, même sur une petite liste — le seuil des 5 000
> n'est pas la condition du refus. Toute colonne d'un filtre doit être indexée
> (ou disparaître du filtre). Deux pannes de production l'ont démontré.
>
> ⚠ TOUT EST SUR LE SITE DE TEST (`Resident_Test`), avec un jeu de simulation
> complet (~1 845 résidents, ~14 800 déclarations, 20 113 lignes Soldes,
> `sp:seed`). Rien n'est répliqué en production Fedasil : cela se fera après
> validation métier, et **les index devront y être posés AVANT de déployer le
> code** (`sp:provision` les liste). La « bascule du 1er août » n'est PLUS une
> échéance : sans mise en service, il n'y a rien à basculer (§10).
>
> OBJECTIF DE CETTE DISCUSSION — **chantier §10.0 (ex-10.0bis) : historique
> multi-trimestres pour le résident** (cadré le 13/7, NON commencé) : le
> résident doit voir **au moins les 4 derniers trimestres, courant compris**.
> Architecture retenue : **trimestre courant → KB-Cumul** (fraîcheur immédiate),
> **trimestres antérieurs → Soldes** (mémoire permanente, insensible aux
> rotations). Touche `Me.ts` (lecture Soldes + liste des trimestres
> disponibles) ET `Portail.tsx` (le bouton « trimestre précédent » devient un
> sélecteur).
> ⚠ AVANT DE CODER, on tranche ensemble : combien de trimestres exactement ?
> Que fait-on des mois sans déclaration (absents de Soldes) ? Le paiement
> reste-t-il possible sur un trimestre archivé ?
>
> Rappel de ma façon de travailler : je suis débutant confirmé, je préfère des
> fichiers complets copier-coller prêts plutôt que des patchs, un pas-à-pas
> pour les manipulations Azure/Entra/Power Platform, et je commite via
> l'interface Git de VS Code (donne-moi juste les messages de commit, **en UN
> SEUL commit**). Avant tout push : `npm run build` à la racine ET dans `api/`.
> ⚠ Consigne née d'erreurs répétées : **ouvre et lis les fichiers concernés
> AVANT de recommander une réécriture** — ne suppose pas ce que contient le
> code, et ne fais pas confiance à ce que la doc affirme du code (deux fois
> déjà, l'état projet décrivait des choses absentes des fichiers).
