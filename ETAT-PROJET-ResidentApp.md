# ÉTAT DU PROJET — ResidentApp (Fedasil)

**Version 7 — 12 juillet 2026** (remplace la v6 du même jour — session « liste Soldes »)

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
| `src/Portail.tsx` | Espace sécurisé : **sélecteur de profils familiaux** (écran « Qui êtes-vous ? » sur `needsProfile`, barre « Vous consultez le dossier de … » + « Changer de personne », FA actif propagé à /api/me et /api/declare), dernière déclaration en tuiles, carte du trimestre (mois cliquables, mois manquants déclarables via « + »), récapitulatif paiements, carte de paiement QR EPC, formulaire de déclaration/correction multi-fiches, bascule trimestre précédent (cache vidé au changement de personne). **v6 (12/7)** : ergonomie mobile (`useCoarsePointer`, QR replié sur tactile), statuts de paiement 4 couleurs + formes (§5.18), bouton « Payer X € » sur la tuile « Payé » et tuile « Reste à payer » cliquable (FIFO), **montant libre**, confirmation verte post-déclaration (mois maintenu sélectionné), aide `<details>` fiche de paie, pictogrammes de section, boutons « Réessayer », 401 → reconnexion (`window.location.assign`), pastille d'activation UNIQUE (localStorage `ra-activated-{oid}`), déconnexion aussi dans l'en-tête |
| `src/styles/fedasil.css` | Design tokens charte Fedasil (violet #644391, rouge #d1103b, gris #676362) + sections 10-17 (trimestre, paiement, déclaration, profils, littératie, statuts de paiement/montant libre). Aucun style inline (CSP `style-src 'self'`) |
| `src/main.tsx`, `src/i18n/*` | Inchangés. Libellés du portail locaux à `Portail.tsx` |
| `public/staticwebapp.config.json` | **Emplacement critique : `public/`** (voir §9). Bloc `auth` (fournisseur AAD personnalisé), routes protégées `/api/me` et `/api/declare`, fallback SPA, en-têtes de sécurité + CSP durcie |

## 3. API (Azure Functions v4, `api/src/functions/`)

| Fonction | Route | Rôle |
|---|---|---|
| `Subscription.ts` | POST /api/pre-inscription | Pré-inscription + invitation B2B. Après invitation réussie, écrit e-mail + `oid` sur la ligne resident (retrouvée par NN). **Nouveau v5 :** corps minimal `{ nationalId, email, contactLanguage }` ; **prénom/nom lus depuis la liste resident** (colonnes FirstName/LastName) pour le displayName de l'invitation et l'e-mail « Bonjour \<Prénom\> » — jamais renvoyés au navigateur (anti-oracle NN → nom). **Comptes internes (membres du tenant)** : détection par `findMemberByEmail` → liaison directe de l'oid SANS invitation (Graph la refuserait : domaine vérifié), e-mail avec lien vers le portail (`PORTAL_URL`) ; soumis au **garde-fou fail-closed** de la liste « ResidentApp Aidants » (lecture complète + comparaison normalisée, PAS de $filter — voir §11). Champs historiques (`firstName`, `lastName`, `username`) encore acceptés mais ignorés. Endpoint `/check-email` conservé (usage informatif côté front). |
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
calendaire. La bascule des variables `SP_CUMUL_LIST_NAME` / `SP_CUMUL_LIST_ID`
/ `SP_CUMUL_PREV_LIST_NAME` (+ redéploiement) **EST** la clôture métier :
c'est elle qui ferme les déclarations de l'ancien trimestre et ouvre le
nouveau. Procédure outillée : `PROCEDURE-BASCULE-TRIMESTRE.md` +
`npm run sp:rotate` (§7). Toute automatisation future doit encoder ce
calendrier décalé.

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

## 6. Données SharePoint

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

📅 **ÉCHÉANCE PROCHE : première bascule réelle T2 → T3 le 1er août 2026**
(§5.16). Prévoir une **répétition à blanc** avant (archivage `--export-only`
sur les données réelles, relecture de PROCEDURE-BASCULE-TRIMESTRE.md,
checklist du jour J : variables SWA + re-run du DERNIER workflow).

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

## 12. Prompt de relance (à coller au début de la prochaine conversation)

> Bonjour Claude. Je poursuis le développement de ResidentApp (portail Fedasil
> pour résidents, React + TypeScript + CSS pur, Azure Static Web Apps +
> Functions). CONTEXTE : tout l'état du projet est dans
> ETAT-PROJET-ResidentApp.md (v6 du 12 juillet 2026) dans les fichiers du projet
> — lis-le d'abord, en particulier la section 5 « Règles métier » et la section
> 4 « Architecture Azure vs Entra ». En résumé : le parcours complet est validé
> en production, l'authentification personnalisée Entra et le matching par `oid`
> sont opérationnels, le sélecteur de profils familiaux (familles ET aidantes
> sociales avec garde-fou « ResidentApp Aidants », comptes internes liés
> directement, règle « un dossier = un compte lié ») est validé en production,
> le formulaire de pré-inscription est minimal (NN + e-mail + langue, formaté
> à la volée avec contrôle modulo 97 — §5.19), la session ergonomie du 12/7
> est terminée (statuts de paiement colorés + règle d'échéance §5.18, montant
> libre, adaptations mobiles — voir CHANGELOG-session-2026-07-12.md), la
> bascule trimestrielle est outillée
> (PROCEDURE-BASCULE-TRIMESTRE.md + npm run sp:rotate — PREMIÈRE BASCULE
> RÉELLE T2 → T3 le 1er août 2026, désormais avec les étapes sp:soldes A et
> E de la procédure), la liste permanente « Soldes » est créée et
> synchronisée (§5.20, npm run sp:soldes), et un provisioning
> déclaratif des 8 listes SharePoint est en place (npm run sp:inspect /
> sp:provision). La migration SQL/Dataverse est analysée mais en attente de
> décision hiérarchique.
> Les fichiers actuels du code sont dans le projet : App.tsx, Portail.tsx,
> fedasil.css, main.tsx, Subscription.ts, Me.ts, Declare.ts,
> public/staticwebapp.config.json, sharepoint-schema.json,
> scripts/provision-sharepoint.ts, scripts/rotate-quarter.ts,
> scripts/snapshot-soldes.ts.
> OBJECTIF DE CETTE DISCUSSION : [choisir dans la section 10 « Reste à faire »,
> par exemple :]
> * Répétition à blanc de la bascule T2 → T3 (échéance : 1er août — priorité) ;
> * Processus de rappels de paiement (la liste « Soldes » est FAITE — §5.20) ;
> * Lettrage des paiements (import CSV bancaire, candidat Power Automate) ;
> * Durcissements production (Sites.Selected, NN_CHECKSUM_STRICT, CAPTCHA…) ;
> * Réplication sur le tenant Fedasil (checklist §10 point 11).
> Rappel de ma façon de travailler : je suis débutant confirmé, je préfère des
> fichiers complets copier-coller prêts plutôt que des patchs, un pas-à-pas
> pour les manipulations Azure/Entra, et je commite via l'interface Git de
> VS Code (donne-moi juste les messages de commit). Avant tout push :
> npm run build à la racine ET dans api/.
