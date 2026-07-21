# CONCEPTION FONCTIONNELLE — Application Staff (Fedasil)

**Version 10 — 21 juillet 2026 (soir)** (remplace la v9 du même jour —
session du soir : **module 4, chantier R2 (moteur du RAPPEL 1) LIVRÉ
(R2a + R2b)** — les 5 questions ouvertes R2 TRANCHÉES ; schéma portail
étendu (`ParamValue` sur `Config`, `ContactLanguage` sur Residents List,
liste **`Journal-Rappels`**), lib `scripts/lib/rappels.ts` + CLI
`sp:rappels`, branchement dans le timer nocturne `soldesNightly.ts`, tuile
« moteur de rappels » au dashboard (`LastReminder1Run`) ; **interrupteur
OFF au déploiement**, allumage = procédure d'allumage §4.13 ; **bouclage
4 015** reconfirmé par le dry-run réel ; garde-fou prouvé par ABSTENTION
effective. Voir ETAT-PROJET v18. Historique v9 : chantier R1 (socle) livré
et validé — voir journal du 21/7.)
Outil interne de gestion du processus de contribution financière des résidents.

Documents compagnons :
- `ETAT-PROJET-ResidentApp.md` — le portail résident (règles métier §5)
- `SETUP-STAFF-APP-PowerApps.md` — l'installation et l'architecture technique

> **Statut : modules 1 (tableau de bord), 2 (fiche 360°) et 3 (lettrage)
> LIVRÉS ; module 4 ENTAMÉ — chantier R1 (socle : colonnes machine à états
> + vue « candidats au rappel ») LIVRÉ ET VALIDÉ le 21/7/2026.** Suite du
> module 4 : R2 (rappel 1 automatique), R3 (rappel 2 en lot), R4 (mise en
> demeure, marche 1) — questions ouvertes à trancher AVANT R2 : journal du
> 21/7.

---

## 1. Le processus métier à outiller

Le service gestion des processus est responsable du cycle complet de la
contribution financière des résidents :

```
  Inscription     Déclaration      Paiement          Recouvrement            Contrôle
  du résident  →  du résident  →   et lettrage   →   (si impayé)        +    trimestriel
  ────────────    ────────────     ────────────      ─────────────           ────────────
  (portail,       (portail)        virement          rappel 1 (auto)         BCSS (brut)
  automatique ;                    imputation        rappel 2 (lot)            ↕ comparaison
  supervision                      sur le mois       mise en demeure         net déclaré
  staff — mod. 7)                                    contentieux             → régularisation
```

Aujourd'hui, ce processus est **outillé uniquement du côté résident** (le
portail). Tout ce qui suit la déclaration — imputation des paiements, relances,
contrôle — se fait manuellement, dans SharePoint et en dehors. Les mises en
demeure passent par un **fichier Excel** alimenté à la main, servant de source
à un **publipostage Word**, imprimé puis envoyé en recommandé.

**Le fil rouge de l'application staff : donner au collaborateur une vue et un
geste là où il n'a aujourd'hui que des listes et des exports.**

---

## 2. Les sept modules

### Module 1 — Tableau de bord trimestriel (page d'accueil) — ✅ LIVRÉ (v1) LE 20/7/2026

**Le besoin** : savoir chaque matin où agir, sans fouiller dans SharePoint.

**Contenu** :
- nombre de résidents ayant déclaré ce trimestre ;
- montants : **total dû / payé / en retard** ;
- **taux de communications structurées** — l'indicateur qui mesure l'adoption
  du QR (§5.17 : objectif 100 %, aujourd'hui beaucoup de communications libres
  héritées du processus manuel) ;
- nombre de paiements « À traiter » dans la file de lettrage ;
- nombre de dossiers par niveau d'escalade (rappel / mise en demeure /
  contentieux) ;
- **(v3)** état du garde-fou de fraîcheur du moteur de rappels (module 4) :
  date du dernier import CSV bancaire, taille de la file de lettrage,
  dernier passage de la synchro Soldes.

C'est la boussole : elle ne fait rien, elle **oriente**.

> **Note d'architecture (12/7)** : SharePoint ne calcule pas d'agrégats côté
> serveur (pas de SUM). Les indicateurs seront **précalculés** (flux Power
> Automate nocturne → mini-liste « Indicateurs » de quelques lignes) plutôt
> que recalculés à chaque ouverture d'écran. Voir principe §6.
> **(v3)** Même règle pour « les FA sans déclaration ce trimestre » : c'est
> une requête par ABSENCE, impossible en `$filter` — elle se précalcule
> (croisement Residents List × Soldes dans le traitement nocturne), elle ne
> se calcule jamais à l'écran.
> **Note d'architecture (20/7 — AMENDE celle du 12/7 et RÉALISE le module)** :
> le calcul ne vit PAS dans un flux Power Automate mais dans le **timer
> nocturne** `residentapp-soldes-timer`, juste après `syncAuto` (lib partagée
> `scripts/lib/indicateurs.ts` du dépôt portail + CLI `sp:indicateurs` —
> état projet v16 §5.23 et §7.5) : cohérence avec la photo Soldes de la même
> nuit, et une seule définition des règles. Liste **`Indicateurs`** : une
> ligne par code neutre (`Title`, clé d'upsert), `NumValue`/`TextValue`/
> `Scope`/`ComputedAt`/`Detail`. Neuf agrégats + deux ESTAMPILLES écrites par
> les acteurs eux-mêmes (`LastPaymentImport` par `sp:paiements`,
> `LastSoldesSync` par le timer — le garde-fou de fraîcheur du module 4 lira
> ces mêmes lignes ; seuil d'alerte à l'écran : 26 h). Réalisé côté staff :
> `src/data/indicateurs.ts` (codes en MIROIR de la lib portail) +
> `DashboardView.tsx` (vue par défaut ; un code absent s'affiche « — »,
> jamais un zéro inventé). **Exception voulue** : la file « À traiter » se
> compte EN DIRECT à l'écran. Les compteurs d'escalade attendront le
> module 4 (l'écran affiche « à venir », pas des zéros trompeurs).

---

### Module 2 — Fiche dossier 360°

**Le besoin** : l'écran qu'on ouvre cinquante fois par jour. Sans lui, chaque
appel téléphonique d'un résident coûte dix minutes de fouille dans quatre
listes.

**Recherche** par **FA**, **NN** ou **nom**.

**Vue unique du résident** :
- identité, centre, région, langue de contact ;
- déclarations du **trimestre en cours** ET des **trimestres clos** — la
  requête historique est UNE lecture de la liste « Soldes » filtrée sur
  `FedasilNumber` (indexée), quelle que soit l'ancienneté ;
- **paiements ligne par ligne** (détail KB-Paiements, pas seulement le cumul
  `Paid`) ;
- solde global ;
- historique des rappels envoyés (quel niveau, quelle date, quel canal —
  colonnes du module 4) ;
- **notes internes horodatées**.

**(v3) Geste staff : déclaration rétroactive / correction sur trimestre
clôturé.** Le portail l'interdit volontairement (état projet §5.22 décision 2 :
`Declare.ts` borne l'écriture au trimestre en cours). C'est donc un geste
**exclusivement staff**, régi par la règle de vérité §3.2 :
- trimestre **courant** → écrire dans **KB-Cumul** (le portail la lit),
  `sp:soldes` resynchronise ;
- trimestre **clos** → écrire **directement dans Soldes**.

Ce geste utilise le **même barème de contribution** que le portail (principe
§6 : module partagé, jamais une troisième copie). Il est aussi la porte
d'entrée des **régularisations BCSS** du module 5 — le construire proprement
ici le rend réutilisable là-bas.

> ✅ Le « point dur » historique de la v1 est levé : voir §3.

---

### Module 3 — File de lettrage manuel

**Le besoin** : imputer les virements dont la communication est libre.

**Contexte** (§5.17, actualisé le 18/7) : la liste **KB-Paiements** est
alimentée par un CSV bancaire hebdomadaire, traité par le script
**`sp:paiements`** (dépôt portail — il REMPLACE le flux Power Automate).
Le script résout et impute automatiquement les communications structurées
valides — y compris celles RECOPIÉES en communication libre (~91 % du volume
constaté sur 3 semaines réelles) — et re-tente les « ToProcess » à chaque
exécution. Le reste (~42 virements/semaine : communications vides, noms
seuls, préfixes inconnus, trop-perçus, FA introuvables) forme la file de
travail manuelle de ce module.

**L'écran** :
- à gauche : la ligne bancaire (montant, date, contrepartie, nom, IBAN,
  communication libre) ;
- à droite : une recherche de résident (FA, NN, nom) ;
- action : **« Imputer sur FA X, mois Y »** → alimente `Paid` (qui est un
  **cumul** : un mois peut être payé en plusieurs virements) → passe la ligne
  en **« Imputé »** ;
- statut **« Anomalie »** pour les cas sans correspondance (trop-perçus,
  virements d'inconnus).

**Règle d'imputation cible** (§5.12, à valider juridiquement) :
1. communication structurée valide → le mois désigné ;
2. sinon → la dette **la plus ancienne** (FIFO).

**(v4)** Le décodeur du lettrage — manuel comme automatique — reconnaît les
**trois familles** de communications structurées (§4.12) : `01`-`12` = mois
désigné ; `91`-`94` (« 9T0 ») = solde du trimestre T, imputation FIFO **au
sein du trimestre** ; `990` = apurement global, FIFO toute ancienneté.

**Cible de l'écriture** (règle de vérité §3.2, CORRIGÉE le 18/7/2026) :
trimestre **courant** → KB-Cumul active (`Paid` seul) ; mois **clôturé mais
encore DANS la fenêtre** des 4 trimestres → **KB-Cumul du trimestre**
(`Paid`) PUIS **reflet** de la ligne Soldes (`Paid`+`Balance`+`PayStatus`) ;
mois **hors fenêtre** (liste vidée) → Soldes seul. Voir §3.2 pour le
pourquoi — un crédit Soldes seul sur un trimestre de la fenêtre était DÉFAIT
par la synchro nocturne.

> ✅ Fait (16/7) : les valeurs de la colonne `Status` de KB-Paiements sont
> migrées vers les **codes neutres** (`sp:paiements-status`, principe §6) ;
> le schéma `sharepoint-schema.json` les porte depuis le 17/7 (indispensable
> à la réplication Fedasil).

**(v3)** Le module 3 conditionne directement le module 4 : le **garde-fou de
fraîcheur** du moteur de rappels s'appuie sur l'état de cette file (voir
module 4). Relancer un résident dont le paiement dort dans la file « À
traiter » est LE scénario à rendre impossible.

> **Validation (17/7/2026).** Les six cas de référence ont été déroulés sur
> la simulation et sont verts : (1) mois du trimestre courant → crédit
> KB-Cumul, (2) mois clôturé partiel → Soldes recalculé (Paid/Balance/
> PayStatus), (3) 9T0 multi-mois → FIFO au sein du trimestre, `Month` du
> virement = mois le plus ancien crédité, (4) communication invalide
> (checksum) → décodage refusé, geste Anomalie, aucun cumul touché, (5)
> trop-perçu → imputation bloquée (reliquat non nul), (6) garde-fou de
> concurrence → re-lecture du statut avant crédit, refus si le virement
> n'est plus « À traiter » (pas de double crédit). Le geste de rattrapage
> `markImputedOnly` reste validé par relecture du code (l'injection de
> panne réelle de l'étape 3 est en backlog).

> ⚠ **Correctif post-validation (18-19/7).** Le scénario (2) ci-dessus
> écrivait Soldes SEUL — correct à l'écran, mais DÉFAIT par la synchro
> nocturne tant que la ligne KB-Cumul du trimestre clôturé existait (les
> jeux de test ne couvraient pas la nuit suivante). Corrigé selon la règle
> §3.2 (KB-Cumul + reflet Soldes) et RE-validé le 19/7 : imputation réelle
> sur un mois de T1 clôturé, puis `sp:soldes --auto --dry-run` →
> `0 mis à jour` sur 14 800 lignes (point fixe).

**Suggestions de candidats (validé et livré le 19/7/2026).** Pour les
virements sans communication exploitable, le poste de travail propose des
candidats cliquables — **uniquement quand la communication ne résout pas**
(quand elle résout, elle reste la seule voix) :

1. **Mémoire des imputations passées du même IBAN**
   (`fetchImputedByIban`, colonne `CounterpartyIBAN` INDEXÉE le 19/7 dans la
   fenêtre unique) : virements `Imputed` du même compte, groupés par FA,
   classés par fréquence (« a déjà payé N× pour ce FA, dernier : date »,
   max 3). L'historique du flux Power Automate nourrit la mémoire dès le
   premier jour ;
2. **Même nom que le donneur d'ordre** : correspondance EXACTE de mots
   normalisés (accents/casse ignorés) avec l'annuaire, max 3 — pas de flou
   approximatif en v1.

Cliquer une suggestion = la sélection de résident habituelle : le plan FIFO
se prévisualise, le staff choisit et impute — ou pas.
🔴 **RÈGLE MÉTIER (validée par GI, gravée dans le code ET dans
`sharepoint-schema.json`) : l'IBAN identifie le PAYEUR, jamais l'intention —
suggestion à confirmer, JAMAIS d'imputation automatique sur cette seule
base.**

---

**Ergonomie (20/7/2026)** : la file gagne une **recherche locale** — un seul
champ qui filtre en mémoire (la file est déjà chargée en entier : zéro appel
SharePoint) sur le montant (virgule belge normalisée), la contrepartie (sans
casse ni accents), l'IBAN (avec ou sans espaces), la communication (avec ou
sans `+++`/`/`) et la référence bancaire ; compteur « n sur N » et pagination
sur le résultat filtré. Le bandeau « pas encore imputé » de la fiche 360° est
CLIQUABLE : il ouvre le lettrage **présélectionné** sur le virement (prop
`initialPaymentId`, consommée une fois, défilement automatique). Le message
de trop-perçu dit « marquer en anomalie, ou changer de résident » (le ciblage
manuel d'un mois reste disponible dans le plan). Backlog : message contextuel
quand AUCUN périmètre n'est possible pour le résident.

**Ergonomie (21/7/2026) — l'intention caduque.** Vécu en usage réel : des
résidents RÉUTILISENT leur première communication structurée mois après
mois (ou prennent celle d'un autre mois) — la communication est VALIDE,
identifie le bon résident, mais désigne un mois déjà soldé : le plan
sortait vide et l'écran n'affichait qu'un « trop-perçu » bloqué invitant à
« choisir un autre périmètre », sans montrer l'issue (le ciblage d'un mois
existait déjà mais était indevinable). Correctif : (1) **bandeau
explicite** quand une communication « mois » valide ne peut rien absorber
alors que d'autres mois sont dus — nomme la cause probable ET le geste
(« cliquez un mois ci-dessous pour le cibler ») ; (2) message de reliquat
réécrit avec les TROIS issues NOMMÉES (cibler un mois / Changer de
résident / Marquer en anomalie — le mot « périmètre » a disparu, comme
« changer de périmètre » avait déjà cédé à « changer de résident » la
veille) ; (3) **affordance** : les mois du plan sont visiblement
cliquables (`m-target` : violet, souligné pointillé, infobulle « Cibler ce
mois »). Questions ouvertes consignées pour R2 : un plan AUTOMATIQUE
« mois désigné d'abord, puis FIFO sur le reste » (proposition Claude,
`sp:paiements` inchangé — la réaffectation d'une intention caduque reste
un geste humain) ; même question pour une communication 9T0 dont le
trimestre est soldé.

### Module 4 — Moteur de rappels (machine à états) — SPÉCIFIÉ LE 16/7/2026 · CHANTIERS R1 (SOCLE) ✅ + R2 (RAPPEL 1) ✅ LIVRÉS LE 21/7/2026

**Le besoin** : le cœur du recouvrement, aujourd'hui entièrement manuel
(sélection à la main, Excel, publipostage Word, recommandés).

> ✅ **Chantier R1 — socle, LIVRÉ ET VALIDÉ le 21/7/2026.** (1) Les 6
> colonnes de la machine à états sont PROVISIONNÉES sur Soldes (§4.9,
> depuis le dépôt portail — `sp:provision`, 6 créations, 0 avertissement) ;
> (2) la vue **« Recouvrement »** (4ᵉ onglet staff, `RecouvrementView.tsx`
> + `src/data/recouvrement.ts`) donne les candidats au rappel de la
> fenêtre, en LECTURE SEULE : mois échus impayés groupés par résident,
> niveau du dossier DÉRIVÉ (max des mois, §4.2), tri par urgence (échéance
> la plus ancienne), filtres centre/niveau/recherche, ligne → fiche 360°,
> FA orphelins signalés, estampille `LastSoldesSync` en pied — la vue lit
> la PHOTO Soldes de la nuit (fraîcheur assumée et AFFICHÉE ; le MOTEUR,
> lui, tournera juste après la synchro : frais par position) ; (3) **test
> de bouclage validé** : les 3 cartes EN DIRECT coïncident avec les
> indicateurs nocturnes (4 015 mois échus par deux chemins de calcul
> indépendants — la leçon §11sexies-2 érigée en test permanent). Requêtes :
> une égalité `YearMonth` (indexée) par mois échu de la fenêtre, ~10
> lectures parallèles, sélection en code (état projet §6.1 règle 1-bis).

> ✅ **Chantier R2 — moteur du RAPPEL 1, LIVRÉ le 21/7/2026 (R2a + R2b).**
> Le seul envoi AUTOMATIQUE du recouvrement est en place, **interrupteur OFF
> au déploiement** (mise en service = geste humain de production, §4.13).
> **R2a** (dépôt portail) : schéma étendu — colonne générique `ParamValue` sur
> `Config` (3 paramètres du garde-fou en lignes clé/valeur, §4.4),
> `ContactLanguage` sur Residents List (§4.7 — repli trilingue tant qu'elle est
> vide), liste **`Journal-Rappels`** (une ligne par tentative, §4.9) ; lib
> **`scripts/lib/rappels.ts`** + CLI **`sp:rappels`** (dry-run par défaut,
> `--envoyer`, `--init-params`). **R2b** : branchement dans `soldesNightly.ts`
> (EN DERNIER — après synchro + indicateurs, échecs isolés) ; tuile **« moteur
> de rappels »** au dashboard (`LastReminder1Run` — verdict + raisons). Dry-run
> réel : **4 015 mois candidats** = le chiffre de la vue Recouvrement (le moteur
> LIT COMME LA VUE, amende §4.5). Garde-fou prouvé par ABSTENTION effective
> (file de test 675 > 60, `LastPaymentImport` absent) — fail-safe démontré.

#### 4.1 La machine à états, datée (décisions du 16/7)

```
  Mois M déclaré, impayé ou partiel
     │
     ├─ DueDate (fin de M+1) dépassée ──→  RAPPEL 1          e-mail, AUTOMATIQUE
     │                                      ton neutre, QR + communication structurée
     │
     ├─ DueDate + 1 mois ───────────────→  RAPPEL 2          e-mail, TOUJOURS
     │                                      lot nocturne validé d'un clic le matin
     │                                      ton ferme + annonce de la mise en demeure
     │
     ├─ Rappel 2 + 15 jours ────────────→  MISE EN DEMEURE   lettre recommandée papier
     │                                      validation INDIVIDUELLE par le CHEF DE SERVICE
     │
     └─ MD + délai À DÉFINIR ───────────→  CONTENTIEUX       export dossier complet PDF
                                            → service juridique

  État suspensif : PLAN D'APUREMENT (conception ultérieure — voir 4.6)
```

L'échéance est celle de l'état projet §5.18 : la contribution du mois M est
due pour la **fin du mois M+1** (`DueDate`, précalculée dans Soldes). L'état
« échu » n'est jamais stocké : il se dérive de `DueDate` à l'affichage et dans
le moteur.

#### 4.2 Granularité — TRANCHÉE (16/7) : traçabilité par MOIS, courrier par DOSSIER

La question ouverte de la v2 (« escalade par mois ou par dossier ? ») est
résolue par la pratique métier :

- **Chaque MOIS impayé porte sa propre trace** (`ReminderLevel`,
  `Reminder1Date`, `Reminder2Date`, `NoticeDate`, `NoticeChannel` sur sa
  ligne Soldes). Indispensable juridiquement : une mise en demeure doit
  prouver les rappels préalables **pour chaque créance**.
- **Chaque ENVOI regroupe tous les mois du FA au même niveau** : le résident
  reçoit UNE lettre listant ses trois mois en retard, pas trois lettres.
  L'envoi estampille sa date sur chacune des lignes qu'il couvre.
- **On ne saute jamais d'étape pour une créance donnée** : un mois qui devient
  exigible plus tard entre au rappel 1, même si le dossier est déjà en mise en
  demeure pour d'autres mois.
- Le « niveau du dossier » (tableau de bord, fiche 360°) est **dérivé** : le
  maximum des niveaux de ses mois. Il n'est stocké nulle part.

#### 4.3 Compromis d'automatisation — DÉCIDÉ (16/7, amende le principe §6)

| Niveau | Mode | Justification |
|---|---|---|
| **Rappel 1** | **Automatique** (e-mail), interrupteur global ON/OFF dans la liste `Config`, journal complet | Enjeu faible, réversible, équivalent d'un rappel de facture. C'est lui qui fait le volume. |
| **Rappel 2** | **Lot préparé la nuit, validé d'un clic le matin** — le collaborateur voit la liste, décoche les cas particuliers, clique « Envoyer » | E-mail toujours (décision 16/7), mais le ton annonce la MD : un regard humain avant l'envoi. |
| **Mise en demeure** | **Validation individuelle OBLIGATOIRE par le chef de service** (décision 16/7) | Acte juridique, coût du recommandé, irréversibilité. |
| **Contentieux** | Transmission manuelle (export dossier complet) | Hors du périmètre d'automatisation. |

Le principe historique « jamais d'envoi automatique sans validation humaine »
devient : **« l'automatisation est graduée par l'enjeu ; rien d'IRRÉVERSIBLE
ne part sans validation humaine »** (voir §6, principe amendé). Tout envoi —
automatique ou validé — est journalisé (quoi, quand, quel canal, quels mois,
qui a validé le cas échéant).

#### 4.4 Garde-fou de fraîcheur — NON NÉGOCIABLE

Le pire scénario du recouvrement : **relancer un résident qui a payé** (risque
n°1 de l'état projet §5.20.1 — appels au centre, perte de confiance). Le
moteur ne tourne donc que si les données sont fraîches :

1. il s'exécute **après** la synchronisation Soldes nocturne (Function App
   `residentapp-soldes-timer`, 01:30 UTC — chantier 2b TERMINÉ, v12) ;
2. il **s'abstient entièrement** (et le signale au tableau de bord) si :
   - la file « À traiter » dépasse `Reminder1MaxQueue` (**tranché le 21/7 :
     60** — ≈ 1,5 semaine du débit ~42/sem), ou
   - le dernier import CSV date de plus de `Reminder1MaxImportAgeDays` jours
     (**tranché : 9** — hebdo + férié + battement), ou
   - `Reminder1Enabled` n'est pas `true` (**OFF au déploiement**).

Les seuils sont des lignes clé/valeur de `Config` (colonne `ParamValue`),
modifiables sans redéploiement. Sont aussi exclus : un dossier sous plan
(`PaymentPlanRef` non vide) et un mois déjà rappelé (`ReminderLevel > 0` —
l'idempotence naît de la DONNÉE, pas d'un journal).

**Fail-safe NON NÉGOCIABLE (21/7)** : paramètre absent/illisible = ABSTENTION,
jamais de défaut permissif en dur ; `LastPaymentImport` absent = abstention
(pas de relance sans preuve de fraîcheur). Chaque abstention est estampillée
(`LastReminder1Run`, avec sa raison) — jamais silencieuse.

#### 4.5 Vue « candidats au rappel » et requêtes

Tous les mois échus impayés, groupés par résident, filtrables par **centre**
et par **niveau d'escalade**.

- Requête d'écran type sur Soldes : `PayStatus = Unpaid|Partial` (indexée)
  composée avec `Year`/`YearMonth` (discipline « 5000 », §6) ; `DueDate <
  aujourd'hui` évaluée à l'affichage.
- Le **moteur nocturne** LIT EXACTEMENT COMME CETTE VUE *(amendé le 21/7)* :
  une égalité `YearMonth` (indexée) par mois ÉCHU de la fenêtre, sélection en
  code (§6.1 règle 1-bis) — et NON un « balayage sans filtre » comme
  l'esquissait la v2. Les DEUX chemins (vue en direct, moteur nocturne)
  tombent sur le même ensemble : **le bouclage 4 015 = 4 015 est un test de
  non-régression permanent** entre implémentations.
- Les compteurs du tableau de bord (dossiers par niveau) sont **précalculés**
  par le même passage nocturne → liste « Indicateurs ».

#### 4.6 Plan d'apurement — état suspensif (conception ultérieure)

Décision 16/7 : un collaborateur pourra accorder un **plan d'apurement**
(plans standards envisagés : 3 ou 6 mois). Effets déjà actés :

- un dossier sous plan **sort automatiquement du circuit de rappels** tant que
  le plan est respecté — plus besoin de le « décocher » à chaque lot ;
- le non-respect du plan le réintègre (modalités à concevoir) ;
- le provisioning du module 4 **réserve la place** (le modèle de données
  prévoit l'extension : référence de plan, statut), sans rien coder du plan
  lui-même aujourd'hui.

#### 4.7 Contenu des courriers

- **Multilingues** (même public que le portail : FR / NL / EN — langue lue
  dans Residents List) ;
- pour chaque mois : montant restant dû et **sa communication structurée
  D'ORIGINE** (`StructuredCom`, conservée dans Soldes — état projet §5.22
  décision 3). Dans la fenêtre de 4 trimestres, ces communications sont **non
  ambiguës** : le lettrage automatique du module 3 imputera les paiements sans
  intervention. Le préfixe d'apurement **`9T0`** (§5.12) ne devient nécessaire
  que pour des dettes SORTIES de la fenêtre — hors périmètre v1 ;
- **QR de paiement** : le rappel 1 v1 donne les informations de virement
  complètes (bénéficiaire, IBAN, communication structurée par mois) + le lien
  vers le portail où vit le QR EPC. Le QR DANS l'e-mail est reporté (dépendance
  image) — backlog. *(langue : `ContactLanguage`, posée le 21/7 ; vide →
  e-mail TRILINGUE ; persistance par `Subscription.ts` au backlog.)*

#### 4.8 Mises en demeure — publipostage piloté depuis l'app, en TROIS MARCHES

Le processus actuel (Excel rempli à la main → publipostage Word → impression
→ recommandé) se pilote depuis l'app par paliers :

| Marche | Quoi | Statut |
|---|---|---|
| **1** | **L'app génère l'Excel du publipostage** : écran « candidats à la MD » → le chef de service valide dossier par dossier → un bouton produit EXACTEMENT le fichier Excel attendu par le modèle Word existant (génération client-side, SheetJS). Le modèle Word, les habitudes, l'imprimante : rien ne change — mais la sélection est tracée et `NoticeDate` estampillée sur chaque ligne Soldes couverte. | **Cible de la v1 du module 4** — quasi gratuit |
| **2** | **L'app fait générer les lettres elles-mêmes** : Power Automate + connecteur **Word Online (Business)** (« Populate a Microsoft Word template », Premium — licences acquises) : remplissage du modèle par résident (FR/NL/EN), conversion PDF, classement dans une bibliothèque SharePoint « Mises en demeure / <année> ». Le collaborateur imprime et poste. Plus d'Excel intermédiaire ; dossier archivé nativement (précieux pour l'export contentieux). | **Cible du module 4** (après la marche 1) |
| **3** | **Recommandé électronique** : API bpost (recommandé hybride/électronique), eBox fédérale. À instruire avec le contrat bpost de Fedasil. | **Backlog** — piste, pas engagement |

#### 4.9 La trace

Quel rappel, quelle date, quel canal, quels mois couverts, **qui a validé**
(lots du rappel 2 ; visa du chef de service pour chaque MD). Indispensable —
une mise en demeure exige de **prouver les rappels préalables**.

Les colonnes de la machine à états seront ajoutées à la liste Soldes **par
provisioning lors de ce module** — `sp:soldes` ne touche jamais aux colonnes
qu'il ne possède pas, elles sont donc à l'abri de la resynchronisation.
Colonnes POSÉES le 21/7/2026 (chantier R1, `sp:provision`) :
`ReminderLevel` (0–3), `Reminder1Date`, `Reminder2Date`, `NoticeDate`,
`NoticeChannel` (choice, codes neutres `Paper`/`Electronic`) et
`PaymentPlanRef` (RÉSERVÉE — §4.6, aucun code ne l'écrit en v1) — codes
neutres partout (principe §6). Pas de nouvel index (les requêtes d'écran
partent de `YearMonth`/`PayStatus`, le moteur balaiera en paginé, les
compteurs sont précalculés). ⚠ Ces colonnes vivent UNIQUEMENT dans Soldes :
le trimestre COURANT lu depuis KB-Cumul (fiche 360°) les rend au niveau 0
(`cumul.ts`) — la fiche FUSIONNERA depuis Soldes quand elle affichera
l'historique des rappels (module 2, avec R2 — backlog).

**Liste `Journal-Rappels` (21/7, R2a)** : les colonnes Soldes portent l'ÉTAT
par mois, ce journal porte l'HISTOIRE par envoi — une ligne par TENTATIVE
(`FedasilNumber`, `Status` indexés à la création). **Double rôle** : preuve
(§4.11) ET file du rappel 2 (lignes `Queued` du matin, envoyées la nuit N+1 par
le timer). **Anti-double-envoi** (façon WAL `sp:paiements`) : `Pending` avant
`sendMail`, `Sent` après ; `Pending` survivant = crash = **quarantaine du FA**
jusqu'à résolution humaine. Statuts : `Queued`/`Pending`/`Sent`/`Skipped`
(revalidation nocturne)/`Failed` (retenté, mois non estampillés).

#### 4.10 Où vit l'automatisation

L'envoi automatique ne peut PAS vivre dans la Code App (frontend sous
l'identité du collaborateur connecté, quand il est connecté). Il vit dans la
**Function App `residentapp-soldes-timer` déjà déployée** : un second timer
après la synchro Soldes, réutilisant le `sendMail` Graph qui envoie déjà les
invitations du portail. Architecture déjà validée par Fedasil (secret Graph
hors GitHub — état projet §10.11), **zéro nouvelle brique**. Les envois
automatiques sont journalisés comme « système » ; les validations humaines
(lots, visas MD) sont journalisées au nom du valideur (identité native de la
Code App, module 6).

#### 4.11 Export « dossier complet » (PDF) pour le contentieux

Déclarations, paiements, rappels, mises en demeure — prêt à transmettre au
service juridique. (La marche 2 du publipostage, qui archive les PDF dans une
bibliothèque, en fournit la moitié.)

#### 4.12 Espace des communications structurées — TROIS FAMILLES (cadré le 16/7 au soir)

Structure belge (état projet §5.10) : `MM 0 FFFFFFF CC` — champ « mois » sur
2 chiffres, « 0 », 7 derniers chiffres du FA, modulo 97 (0→97). Le champ
« mois » n'utilise que 01-12 : **l'espace 13-99 est réservé** et s'organise
ainsi :

| Préfixe | Signification | Imputation au lettrage | Ambiguïté d'année |
|---|---|---|---|
| `01`-`12` | le mois M (existant — QR du portail) | le mois désigné | aucune dans la fenêtre de 4 trimestres (§5.22 déc. 1) |
| `91`-`94` (« 9T0 ») | **solde du trimestre T** | FIFO **au sein du trimestre** (mois le plus ancien d'abord — `Paid` est un cumul, tout montant est accepté) | aucune non plus : dans la fenêtre de 4 trimestres, chaque numéro de trimestre n'apparaît qu'UNE fois — même propriété que les mois |
| `99` (« 990 ») | **apurement global** | FIFO toute ancienneté | **jamais** : elle ne désigne aucune période — insensible à l'année PAR CONSTRUCTION |

**Usages :**
- **`9T0`** — régulariser un trimestre d'un seul virement : générée par la
  **fiche 360°** (le collaborateur l'envoie par e-mail au résident) et par
  les **courriers de rappel** (une ligne par trimestre au lieu d'une par
  mois, au choix) ;
- **`990`** — la communication des **mises en demeure** (elles couvrent
  souvent des mois à cheval sur plusieurs trimestres) et des dettes **sorties
  de la fenêtre** : « payer le T2 de l'année dernière » via un `920` serait
  ambigu, via le `990` jamais. C'est l'aboutissement du « préfixe réservé »
  esquissé à l'état projet §5.12.

**À noter :** le portail résident ne change pas (ses QR mensuels restent la
voie normale) ; le modulo 97 fonctionne tel quel sur tout préfixe ; la règle
FIFO intra-trimestre rejoint la validation juridique du FIFO général
(question ouverte n°4) ; l'état projet §5.12 sera aligné côté dépôt portail.

#### 4.13 Mise en service du rappel 1 — procédure d'ALLUMAGE (production)

Livré interrupteur OFF : chaque nuit le moteur s'abstient et l'estampille.
L'allumage est un geste humain de PRODUCTION — jamais sur le tenant de test
(adresses de simulation d'apparence réelle). Le jour J :

1. **App Settings** de `residentapp-soldes-timer` : `GRAPH_SENDER_USER_ID`,
   `PAYMENT_IBAN`, `PAYMENT_BENEFICIARY`, `PORTAL_URL` (ou repli
   `INVITE_REDIRECT_URL`). Tant qu'ils manquent, le garde-fou « contexte
   d'envoi » bloque en mode réel.
2. **Garde-fou au vert** au dashboard : file < 60, dernier import < 9 j.
3. **`Reminder1Enabled = true`** dans `Config` (une ligne). La nuit suivante
   envoie ; retour arrière = `false`. Aucun redéploiement.
4. **Contrôle le lendemain** : `LastReminder1Run` = « N envois » ; lignes
   `Sent` de `Journal-Rappels`, `ReminderLevel = 1` sur Soldes. Une ligne
   `Pending` = quarantaine à résoudre.

⚠ **Rodage** : première nuit avec une file volontairement petite, pour observer
un envoi réel de bout en bout avant le plein régime.

---

### Module 5 — Contrôle trimestriel BCSS ↔ déclaré

**Le besoin** : vérifier les déclarations contre les données officielles.

**Le contexte, et son honnêteté assumée** : la BCSS (Banque Carrefour de la
Sécurité Sociale) fournit des **salaires BRUTS** trimestriels. Or les
contributions sont calculées sur le **NET** (§5.7). On ne peut donc pas
comparer directement : un résident pourrait déclarer 10 000 € de brut et 500 €
de net et passer le contrôle si l'on se fiait au brut déclaré.

**La solution retenue** : recalculer un **net estimé** à partir du brut BCSS,
via la **grille Jobat** (conversion brut → net pour une **personne isolée**).
C'est imparfait — mais c'est **mieux que rien**, et c'est opérationnellement
justifié.

**Le flux** (vers le 15 du mois de contrôle — §5.16) :

1. **Import du fichier BCSS** — brut trimestriel par NN → matching sur le
   `Title` de Residents List ;
2. **Calcul du net estimé** via la grille Jobat — la grille est stockée comme
   **table de référence versionnée** (elle change chaque année) ;
3. **Comparaison** : net estimé vs somme des nets déclarés du trimestre
   (lecture de Soldes filtrée `Year + Quarter`, ou mois par mois via
   `YearMonth` si le trimestre dépasse 5000 lignes) → **écart en € et en %** ;
4. **Classement par exception** (recommandation de l'état projet — on ne
   contrôle QUE les anomalies) :

| Classe | Signification | Suite |
|---|---|---|
| ✅ **Conforme** | écart **sous le seuil** | rien à faire |
| ⚠️ **Écart à contrôler** | écart au-dessus du seuil | examen humain |
| 🔴 **Salarié BCSS sans aucune déclaration** | **le cas le plus grave** | priorité absolue |
| ℹ️ **Déclaré sans trace BCSS** | souvent **bénin** (intérim tardif, autre régime) | vérification légère |

5. **Régularisation** : pour chaque écart confirmé, un bouton qui recalcule la
   contribution sur le net estimé, crée la **créance complémentaire** (une
   ligne Soldes) et bascule le dossier dans le circuit rappels (module 4).

> **Le seuil d'écart est la pièce maîtresse du dispositif** : il absorbe
> précisément l'imprécision de la conversion brut → net. **Un écart de quelques
> pourcents est du bruit de conversion, pas une fraude.** Le seuil doit être
> **paramétrable** (et le justifier par écrit protège autant le résident que le
> service).

#### ✅ FIXTURES DE TEST DISPONIBLES (13/7/2026)

Le script `npm run sp:seed` (§7.4 de l'état projet) génère dans `simulation/`
tout ce qu'il faut pour développer ce module **avant** de disposer du vrai flux
BCSS :

| Fichier | Contenu |
|---|---|
| `BCSS-2025-T1.csv` … `BCSS-2026-T1.csv` | 5 fichiers d'import trimestriels : **brut DMFA par NN** (`NN;Nom;Prenom;Annee;Trimestre;BrutTrimestriel`) |
| `BCSS-cle-de-correction.csv` | **La classe ATTENDUE** pour chaque dossier × trimestre, avec net réel, net déclaré et écart en % |

La clé de correction permet de **valider objectivement le classement** produit
par l'écran de contrôle : les quatre classes du tableau ci-dessus y sont
représentées (`Conforme`, `EcartAControler`, `BcssSansDeclaration`,
`DeclareSansBCSS`). Les données simulées incluent délibérément ~8 % de
sous-déclarants, ~4 % de salariés BCSS sans aucune déclaration (le cas grave) et
~8 % de déclarés sans trace BCSS (le cas bénin).

⚠ Le **format réel** du fichier BCSS reste à obtenir (question ouverte §5.7) :
ces fixtures suivent une structure plausible, pas la structure officielle. Elles
servent à développer la LOGIQUE de contrôle, pas le parseur définitif.

---

### Module 6 — Transversal : traçabilité et droits

- **Journalisation** de toute action (imputation, rappel, régularisation) avec
  son auteur.
  → **Offert par l'architecture** : la Code App accède à SharePoint sous
  l'identité **du collaborateur connecté**, donc le « Modifié par » natif de
  SharePoint est déjà le bon (voir §11 du document d'installation).
- **Garde-fou d'accès** : le pattern de la liste « ResidentApp Aidants »
  (fail-closed, lecture complète + comparaison normalisée) est réutilisable tel
  quel pour une liste **« ResidentApp Staff »**.
- **Rôles** à définir : *gestionnaire* (peut imputer, relancer, régulariser) vs
  *lecture seule* (consultation). **(v3)** S'y ajoute le rôle **chef de
  service** : seul habilité à valider une mise en demeure (décision 16/7) —
  le modèle de rôles doit porter cette distinction dès sa conception.

---

### Module 7 — Supervision des inscriptions (ajouté le 16/7/2026)

**Le besoin** : voir ce qui a échoué à l'inscription, et pourquoi — sans
fouiller Application Insights.

**Le principe, validé le 16/7 : ce n'est PAS une validation, c'est une
supervision.** La pré-inscription du portail est entièrement automatique par
conception (NN vérifié contre Residents List → invitation B2B ou liaison
directe d'un membre du tenant → e-mail). Aucun goulot humain n'est ajouté :
le module donne au staff la **visibilité** sur les échecs et les **gestes de
remédiation**.

#### 7.1 Taxonomie des raisons (codes neutres, principe §6)

| Code | Situation | Geste / traitement automatique |
|---|---|---|
| `Ineligible` | NN absent de Residents List | Aucun (c'est le garde-fou voulu). Statistique utile par période. |
| `InternalBlocked` | Adresse interne absente de la liste garde-fou Aidants (403 fail-closed, §5.13) | Bouton « ajouter à la liste Aidants » (tracé : qui, quand) |
| `InviteFailed` | Erreur Graph à la création de l'invitation | Bouton « relancer l'invitation » (idempotente) |
| `InviteNotAccepted` | Invitation envoyée mais `EntraOid` toujours vide après X jours | **Relance automatique** de l'e-mail d'invitation (idempotente — candidat au timer nocturne, même logique graduée que le rappel 1 : interrupteur `Config` + journal) |
| `EmailInvalid` | Adresse rejetée | Correction manuelle + relance |

`InviteNotAccepted` est détectable **sans rien construire** : `EntraOid` vide
sur Residents List + date d'invitation (colonnes mises à jour par
`Subscription.ts` après invitation — noms exacts à relever dans le code au
moment du build).

#### 7.2 Liste « Journal-Inscriptions » (côté dépôt PORTAIL)

Les autres cas ne vivent aujourd'hui QUE dans les logs Application Insights.
Il faut donc une petite liste **écrite par `Subscription.ts`** — une ligne par
tentative de pré-inscription :

- horodatage, code résultat (taxonomie 7.1), langue choisie ;
- `FedasilNumber` **si éligible** ;
- NN **MASQUÉ si inéligible** — ⚠ règle de confidentialité absolue : jamais le
  NN complet d'un inconnu dans la liste (le NN est le seul secret d'accès —
  état projet §5.13) ; même prudence pour l'adresse e-mail des tentatives
  échouées (masquée).

C'est une modification du **dépôt portail** (qui possède la couche données —
principe §6 « la couche données vit dans le dépôt ResidentApp ») : schéma
dans `sharepoint-schema.json`, création par `sp:provision`. L'app staff ne
fait que la lire. Spécification fine (colonnes, rétention) au moment du build.

#### 7.3 Écran

File des échecs récents (filtrable par code), compteurs par code sur la
période, et les gestes du tableau 7.1. Volume attendu faible : aucune
contrainte d'index particulière a priori (à confirmer au build — au pire,
un index sur le code résultat).

---

## 3. ✅ La dépendance structurante : l'historique multi-trimestres — TRANCHÉE (12/7/2026)

**Décision** : la voie 1 (liste permanente « Soldes ») est retenue et
**réalisée** ; la voie 2 (migration Azure SQL) reste la cible structurelle,
**différée sans blocage** — décision hiérarchique à instruire par une note
d'arbitrage (à rédiger, voir §5 point 10).

### 3.1 Le contrat de la liste « Soldes »

- **Granularité : le mois** (FA × année × mois), pas le trimestre — parce que
  l'échéance (§5.18), l'imputation FIFO (§5.12) et la communication structurée
  (§5.10) sont toutes mensuelles. Les contrôles trimestriels agrègent.
- **Photo complète** : tous les mois déclarés, pas seulement les impayés —
  elle sert la fiche 360° (module 2), les rappels (module 4) ET le contrôle
  BCSS (module 5).
- **Année explicite** (`Year`), là où les listes KB-Cumul ont une année
  implicite.
- **Clé d'unicité** : `Title` = `<FA>-<année>-<mois sur 2 chiffres>`
  (ex. `FA00655210-2026-04`) — clé d'idempotence de la synchronisation.
- **Colonnes calculées prêtes à filtrer** : `Balance` (Contribution − Paid),
  `PayStatus` (`Paid`/`Partial`/`Unpaid` — codes neutres, voir §6),
  `DueDate` (échéance §5.18), `YearMonth` (AAAAMM, dimension de découpe fine).
- **5 colonnes indexées** : `FedasilNumber`, `Year`, `Quarter`, `YearMonth`,
  `PayStatus` — chaque requête d'écran commence par l'une d'elles (voir la
  discipline §6).
- **Alimentation** : `npm run sp:soldes` (dépôt ResidentApp, couche données) —
  upsert idempotent depuis les listes KB-Cumul, rejouable à volonté, mode
  `--dry-run`. **Depuis le 14/7 : mode `--auto`** (déduit trimestre et années
  de la liste `Config`, synchronise les 4 listes — état projet §5.20.1) ;
  **depuis le 16/7 : exécution nocturne automatique** (Function App
  `residentapp-soldes-timer`, 01:30 UTC — chantier 2b TERMINÉ). Il ne touche
  **jamais** aux colonnes qu'il ne possède pas : le module 4 pourra ajouter
  les siennes sans risque.

### 3.2 La règle de vérité (CORRIGÉE le 18/7/2026)

> **Tant que la ligne KB-Cumul d'un mois existe (~9 mois après la clôture du
> trimestre), KB-Cumul reste la source — pour les LECTURES ET pour les
> ÉCRITURES** — et `sp:soldes` resynchronise. **Après le vidage de la liste
> trimestrielle, Soldes devient la seule vérité.**

Concrètement, un crédit de paiement s'écrit ainsi (`lettrage.ts` de l'app
staff ET `import-paiements.ts` du portail, MÊMES règles) :

| Le mois crédité est… | On écrit dans… |
|---|---|
| du trimestre **courant** | KB-Cumul active, `Paid` seul |
| **clôturé mais DANS la fenêtre** des 4 trimestres | **KB-Cumul du trimestre** (`Paid`), **puis reflet** de la ligne Soldes (`Paid`+`Balance`+`PayStatus`) |
| **hors fenêtre** (liste vidée) | Soldes seul |

⚠ **Pourquoi la correction** : la v6 écrivait Soldes SEUL pour tout trimestre
clôturé — or la synchro nocturne copie KB-Cumul → Soldes pour LES 4 LISTES :
le crédit était DÉFAIT la nuit suivante (virement « Imputed », `Paid` revenu
en arrière). C'est la restauration de l'invariant d'origine, que le module 3
avait involontairement enfreint. Détails et validation par point fixe : état
projet v15 §5.20.

### 3.3 Ce que Soldes ne règle pas (arguments de la note d'arbitrage SQL)

- La **redondance temporaire** KB-Cumul ↔ Soldes pendant la période de
  recouvrement (contrôlée par la règle de vérité, mais réelle) ;
- Le **seuil SharePoint des 5000** : ~2000 lignes/trimestre constatées sur les
  données de test ⇒ **~8000/an, seuil dépassé dès la première année pleine** —
  tenable une décennie par discipline (§6), là où SQL supprime la discipline
  (vrais index, agrégats serveur, pas de limites de délégation) ;
- Le **détail des fiches de paie** (non stocké, §5.8) et le **lettrage
  relationnel** ;
- Le jour de la migration, **Soldes est la source de reprise** (son modèle se
  mappe 1:1 sur une table SQL) et seule la couche connecteur change — rien de
  ce qui est construit n'est perdu.

### 3.4 Cas particulier relevé (tenant Fedasil réel) — à instruire à la transposition

Le processus manuel historique alimente des listes **« KB-Cumul Archives
\<année\> »** (une par année, transfert des T1..T4 — de mémoire, non vérifié :
GI n'y travaille plus depuis octobre 2025). À la transposition (checklist
ETAT-PROJET §10 point 11) :
- relever leur structure réelle (`sp:inspect`) et vérifier si elles remplissent
  le **contrat §3.1** (unicité, année explicite, rafraîchissement des
  paiements tardifs — une archive est normalement une photo figée) ;
- si oui : elles *deviennent* Soldes (le script change de cible) ; si
  partiellement : les compléter par provisioning ; sinon : les utiliser comme
  **source de reprise** de l'historique 2024-2025 dans Soldes ;
- trancher la **succession** : une fois Soldes en service, le transfert
  manuel annuel fait double emploi — documenter qui est la vérité (Soldes).

---

## 4. Ordre de priorité recommandé

| Rang | Module | Pourquoi |
|---|---|---|
| ✅ | **Liste Soldes (§3)** | **FAIT (12/7)** — le socle de données des modules 2, 4 et 5. Synchro nocturne automatique depuis le 16/7. |
| ✅ | **Socle app staff (S1-S3)** | **FAIT (16/7)** — 8 sources branchées, couche `src/data/`, écran recherche + fiche 360° lecture seule : l'embryon du module 2 existe. |
| **1** | **File de lettrage (3)** | Sans paiements correctement imputés, **ni les statuts ni les rappels ne sont fiables**. Tout le reste en dépend — c'est aussi la source du garde-fou de fraîcheur du module 4. |
| **2** | **Moteur de rappels (4)** | Le cœur métier du recouvrement — entièrement spécifié depuis le 16/7. Marche 1 du publipostage dans sa v1. |
| **3** | **Contrôle BCSS (5)** | Première échéance réelle : **~15 août** pour le T2. |
| — | Fiche 360° (2) et tableau de bord (1) | Se construisent naturellement **au fil** des trois précédents (ils en sont largement la vue de lecture). |
| — | Supervision des inscriptions (7) | Petit, faible risque (lecture + gestes idempotents) — à glisser opportunément ; sa liste Journal-Inscriptions est un chantier du dépôt PORTAIL, planifiable indépendamment. |

**Alternative défendable** : commencer par la **fiche dossier 360°** — lecture
seule (donc sans risque), valeur immédiate, banc d'essai de la couche de
données de l'app staff (branchement de Soldes + Residents List via
`add-data-source`, requêtes déléguées, affichage traduit des codes neutres).

---

## 5. Questions ouvertes (à trancher avec le service et la hiérarchie)

**Métier :**
1. **Seuil d'écart BCSS** : quelle valeur (en % ? en € ? les deux ?) ? Qui
   l'arbitre ? Est-il révisable chaque année avec la grille Jobat ?
2. ✅ ~~Délais du circuit de rappels~~ **TRANCHÉ le 16/7** (voir module 4.1) —
   **reste ouvert : le délai mise en demeure → contentieux.**
3. ✅ ~~Qui valide une mise en demeure ?~~ **TRANCHÉ le 16/7 : le chef de
   service**, individuellement, dossier par dossier. Impact acté sur le modèle
   de rôles (module 6).
4. **Imputation FIFO** : la convention « le paiement sans communication
   structurée apure la dette la plus ancienne » doit être **validée
   juridiquement** (§5.12) — y compris ses déclinaisons `9T0` (FIFO au sein
   du trimestre) et `990` (FIFO global) du §4.12.
5. **Ambiguïté de l'année** dans la communication structurée : un virement
   tardif portant la communication d'un trimestre déjà bouclé — imputation
   manuelle ? (§10 point 1.) NB : Soldes rend au moins la *donnée* non
   ambiguë (`Year` explicite) ; l'ambiguïté résiduelle est celle du virement.
6. **Grille Jobat** : où l'obtient-on officiellement, sous quelle forme, et qui
   la met à jour chaque année ?
7. **Format du fichier BCSS** : structure exacte, fréquence, canal de
   transmission.
8. **(nouveau 16/7) Plan d'apurement** : contenu des plans standards (3 mois /
   6 mois), qui l'accorde, conditions de rupture et de réintégration dans le
   circuit — conception ultérieure (module 4.6).
9. ✅ ~~**(16/7) Seuils du garde-fou de fraîcheur**~~ **TRANCHÉ le 21/7** :
   file ≤ **60**, import ≤ **9 jours**, `Reminder1Enabled` **OFF** — trois
   lignes `ParamValue` de `Config`. Fail-safe : tout paramètre douteux =
   abstention (§4.4).
10. **(nouveau 16/7) Délai de la relance automatique `InviteNotAccepted`**
    (module 7) : après combien de jours sans acceptation ? Combien de
    relances maximum ?

**Technique / gouvernance :**
11. **Droits SharePoint des collaborateurs** : un groupe de sécurité dédié est
    nécessaire (l'app staff lit sous l'identité de l'utilisateur, pas sous une
    identité applicative). NB : ce groupe devra couvrir la liste **Soldes**
    (et Journal-Inscriptions).
12. **Licences Premium** : combien de collaborateurs ? (Le plan Développeur
    actuel est individuel et interdit en production.)
13. **Décision base de données** : ✅ **levée opérationnellement le 12/7**
    (liste Soldes) — plus rien ne bloque les modules. La migration **Azure
    SQL** reste la cible structurelle : **note d'arbitrage à rédiger** pour la
    hiérarchie (statu quo SharePoint+Soldes / Azure SQL / Dataverse écarté
    sauf validation revendeur), avec les chiffres du 13/7 : ~2000
    lignes/trimestre, ~24 000 lignes/an pour KB-Paiements (premier candidat),
    seuil des 5000, discipline d'index comme coût récurrent. Décision de
    confort, pas d'urgence — mais plus la liste grossit, plus la reprise sera
    longue.
14. **Listes « KB-Cumul Archives \<année\> » du tenant Fedasil** : instruire
    leur devenir à la transposition (voir §3.4).

---

## 6. Principes de conception à respecter

Hérités du portail résident, et enrichis au fil des sessions :

- **Le calcul de contribution reste unique et testé.** Le barème (§5.7 :
  0 % / 35 % / 45 % / 50 %) est aujourd'hui dupliqué serveur + client sur le
  portail. Toute régularisation staff DOIT utiliser la même règle — prévoir un
  module partagé plutôt qu'une troisième copie.
- **La couleur ne porte jamais l'information seule** (libellé ou forme
  distinctive systématique). Charte Fedasil : **rouge (#d1103b) réservé à
  l'attention/erreur**, jamais décoratif ; **violet (#644391)** pour
  l'interactif.
- **(AMENDÉ le 16/7) L'automatisation est graduée par l'enjeu ; rien
  d'IRRÉVERSIBLE ne part sans validation humaine.** Formulation d'origine
  (12/7) : « rien d'irréversible sans validation humaine — surtout pour les
  envois de courriers et les régularisations ». L'amendement autorise
  l'automatisation des gestes à faible enjeu, réversibles et journalisés
  (rappel 1 par e-mail, relance d'invitation), toujours dotés d'un
  interrupteur global dans `Config`. Les lots (rappel 2) exigent une
  validation d'un clic ; les actes juridiques (mise en demeure) une
  validation individuelle par le chef de service.
- **Tout ce qui touche à l'argent est tracé** (auteur, date, montant, motif) —
  y compris les envois automatiques (journalisés « système »).
- **Contrôle par exception** : ne jamais imposer au collaborateur de relire ce
  qui est conforme.
- **(12/7) Codes techniques neutres, l'interface traduit.** Le public staff
  est FR/NL : les valeurs stockées (statuts, choix) sont des codes anglais
  stables (`Paid`, `Unpaid`, …) ; la traduction est une affaire d'affichage,
  jamais de données. S'applique à toute nouvelle colonne à choix (et,
  rétroactivement, au `Status` de KB-Paiements lors du module 3).
- **(12/7) Discipline SharePoint « 5000 »** — servitude d'architecture de la
  couche données, à respecter par tout écran et tout flux :
  1. toute requête filtrée commence par une **colonne indexée** — ⚠ rappel
     durci le 13/7 (état projet §6.1) : Graph refuse IMMÉDIATEMENT un
     `$filter` sur colonne non indexée, quelle que soit la taille de la
     liste ;
  1-bis. **être indexée ne suffit pas** *(14/7)* : la PREMIÈRE clause d'un
     filtre composé doit elle-même ramener moins de 5000 lignes (`Year eq
     2026` ≈ 8000 lignes → 400 malgré l'index ; `YearMonth eq 202604` ≈ 1700
     lignes → OK, pour toujours) ;
  2. le **résultat** de chaque requête reste sous 5000 lignes → filtres
     **composés** (`PayStatus+YearMonth`, `YearMonth`), jamais de filtre
     « qui grossit avec les années » seul ;
  3. les **agrégats se précalculent** (traitement nocturne → liste
     « Indicateurs »), ils ne se recalculent pas à l'écran — y compris les
     requêtes par ABSENCE (« qui n'a pas déclaré »), impossibles en
     `$filter` ;
  4. attention aux **limites de délégation** du connecteur SharePoint de
     Power Apps : une requête non délégable tronque silencieusement ;
  5. les traitements de fond peuvent balayer en **lecture paginée sans
     filtre** (non soumise au seuil).
- **(12/7) La couche données vit dans le dépôt ResidentApp.** Schéma
  (`sharepoint-schema.json`), provisioning, rotation, synchronisation Soldes :
  tout l'outillage des listes partagées appartient au dépôt du portail (qui
  détient les identifiants Graph). Le dépôt `residentapp-staff` ne fait que
  consommer les listes via ses connecteurs. S'applique à la future liste
  **Journal-Inscriptions** (module 7) et aux **colonnes du module 4** sur
  Soldes.
- **(16/7) Les paramètres d'exploitation vivent dans la liste `Config`**, pas
  dans le code : interrupteurs d'automatisation (rappel 1, relance
  d'invitation), seuils du garde-fou de fraîcheur. Modifiables sans
  redéploiement, à l'image de `ActiveQuarter` (état projet §5.21).

---

## 7. Journal des décisions

| Date | Décision |
|---|---|
| **21/7/2026 (soir)** | **Module 4 — chantier R2 (moteur du RAPPEL 1) LIVRÉ (R2a + R2b).** Les 5 questions ouvertes R2 sont TRANCHÉES. **R2a** : schéma étendu (colonne générique `ParamValue` sur `Config` — 3 paramètres du garde-fou en lignes clé/valeur ; `ContactLanguage` sur Residents List ; liste **`Journal-Rappels`**, une ligne par tentative, anti-double-envoi type WAL), lib **`scripts/lib/rappels.ts`** + CLI **`sp:rappels`** (dry-run par défaut). **R2b** : branchement dans `soldesNightly.ts` (en dernier, échecs isolés) + tuile **« moteur de rappels »** au dashboard (`LastReminder1Run`). Interrupteur **OFF au déploiement** ; allumage = geste de production (procédure §4.13). **Bouclage 4 015 = 4 015** reconfirmé par le dry-run réel (le moteur lit comme la vue Recouvrement, §4.5 amendé). Garde-fou prouvé par ABSTENTION effective (file de test 675 > 60, `LastPaymentImport` absent). **Arbitrages** : (1) seuils `Config` — file ≤ 60, import ≤ 9 j, `Reminder1Enabled` OFF ; (2) rappel 2 = lot du matin envoyé la nuit N+1 par le timer (pas de Function HTTP) ; (3) `Journal-Rappels` dès R2 ; (4) cascade FIFO « mois désigné d'abord » = plan pré-rempli côté app, `sp:paiements` INCHANGÉ (pré-remplissages lettrage différés) ; (5) 9T0 soldé = bandeau + plan FIFO, cascade auto = geste humain (différé). Backlogs : persistance `ContactLanguage` par `Subscription.ts`, QR EPC dans l'e-mail. |
| **21/7/2026** | **Module 4 — chantier R1 (socle) LIVRÉ ET VALIDÉ.** Schéma portail : 6 colonnes machine à états sur Soldes (`PaymentPlanRef` réservée, `NoticeChannel` `Paper`/`Electronic`) ET **restauration des 9 flags `indexed` du 13/7 PERDUS du schéma** (démasqués par l'audit chiffré de la photo — le tenant, lui, était resté correct ; l'audit d'index de `sp:provision` refonctionne). Staff : source Soldes régénérée (SETUP v7 §8bis), `SoldeMois` étendu, vue « Recouvrement » (lecture seule, tri urgence, niveau dérivé, FA orphelins signalés), **bouclage 4 015 = 4 015** avec les indicateurs nocturnes. Règles de PURETÉ React nouvellement actives : Recouvrement ET Dashboard mis en conformité (SETUP v7, pièges n°17-18). Cartes du tableau de bord alignées sur le langage visuel « halo » (retour d'usage). `pac code run` devenu inutile (dev local = `npm run dev` seul). |
| **21/7/2026** | **Ergonomie lettrage — intention caduque** (voir module 3) : bandeau explicite, reliquat aux issues nommées, affordance `m-target`. **Questions ouvertes R2 consignées** : seuils du garde-fou (proposition : file « ToProcess » ≤ 60, dernier import ≤ 9 j, interrupteur `Reminder1Enabled` OFF au départ — colonnes génériques à ajouter à `Config`), circuit du rappel 2 (lot approuvé le matin, ENVOYÉ la nuit N+1 par le timer — vs Function HTTP appelable, à trancher), liste `Journal-Rappels` dédiée (une ligne par ENVOI — recommandée dès R2 pour l'export contentieux §4.11), cascade FIFO après mois désigné, cas 9T0 soldé. |
| **20/7/2026** | **Module 1 LIVRÉ — les indicateurs sont précalculés par le TIMER NOCTURNE, pas par Power Automate** (amende la note du 12/7). Liste `Indicateurs` (clé `Title`, upsert idempotent) ; 9 agrégats calculés juste après `syncAuto` ; 2 estampilles « chaque acteur estampille son propre passage » (`LastPaymentImport`, `LastSoldesSync`), jamais en dry-run, toujours sous try/catch ; file de lettrage comptée EN DIRECT. Premier cycle nocturne complet validé (ComputedAt 03:30). Le dry-run a révélé 61 doublons de FA dans Residents List → population comptée en FA DISTINCTS ; consolidation au backlog. |
| **20/7/2026** | **Ergonomie du lettrage** : recherche locale dans la file (filtre mémoire — montant/contrepartie/IBAN/communication) ; bandeau « pas encore imputé » cliquable → lettrage présélectionné avec défilement ; message trop-perçu reformulé (« changer de résident »). |
| **18-19/7/2026** | **Règle de vérité §3.2 CORRIGÉE** (un mois clôturé encore dans la fenêtre se crédite dans KB-Cumul + reflet Soldes — l'écriture Soldes seule était défaite par la synchro nocturne). Découverte en écrivant `sp:paiements` ; corrigée dans `lettrage.ts`/`cumul.ts` (staff) ET `import-paiements.ts` (portail) ; validée le 19/7 par imputation réelle T1 + point fixe (`0 mis à jour` sur 14 800 lignes). |
| **17-19/7/2026** | **Le flux Power Automate d'import des paiements est REMPLACÉ par `sp:paiements`** (dépôt portail, état projet v15 §5.17) : résolution des communications (flag Y revalidé, comms libres récupérées), imputation automatique option A aux règles du module 3, WAL anti-double-crédit, re-tentative des « ToProcess », rapport journalisé. ~91 % d'imputation automatique mesurés sur 3 semaines réelles. 🔴 Désactiver le flux AVANT le premier import réel. |
| **19/7/2026** | **Suggestions de candidats au lettrage** (module 3) : mémoire des imputations passées par IBAN (`CounterpartyIBAN` indexée — fenêtre unique) + rapprochement exact du nom, UNIQUEMENT quand la communication ne résout pas. **Règle métier : l'IBAN identifie le payeur, jamais l'intention — jamais d'imputation automatique sur cette base.** |
| **19/7/2026** | **Procédure de bascule v5 — étape A0** : la file de lettrage doit être VIDE avant toute rotation (une communication mensuelle change de sens à la bascule — un « ToProcess » oublié serait imputé sur le MAUVAIS mois, silencieusement). `sp:paiements --retenter-seulement` puis vidage manuel. |
| **16/7/2026 (nuit)** | **Module 3 LIVRÉ (v1, chantier S5)** — premières ÉCRITURES de l'app staff. Couche `src/data/` : `comDecode.ts` (décodeur des 3 familles + `allocateFifo`, testés unitairement) et `lettrage.ts` (file « À traiter » sur `Status` indexée ; imputation avec cible KB-Cumul/Soldes selon la règle de vérité §3.2 ; SharePoint sans transaction → re-lecture anti-concurrence, crédits FIFO puis marquage `Imputed` EN DERNIER, erreurs typées `ImputationPartialError`/`MarkFailedError`, rattrapage `markImputedOnly`). Écran `LettrageView.tsx` : file + décodage + résident suggéré par les 7 chiffres + plan FIFO prévisualisé (mois ciblable) + trop-perçu bloqué → anomalie. Convention : `Month` du virement = mois le plus ancien crédité. Onglets Fiche 360° / Lettrage. **À valider en usage.** |
| **16/7/2026 (nuit)** | **Fiche 360° ENRICHIE (chantier S4) validée dans le player** : communication copiable par mois à solde > 0, carte `9T0` (copie + e-mail pré-rempli FR/NL, IBAN) **masquée par défaut** (bouton dans la ligne du sous-total — retour d'usage), sous-totaux par trimestre, détail des virements dépliable (rattachement mois + garde-fou de date, §5.22 déc. 1), bandeau « virements non imputés » (préfiguration du garde-fou module 4), bouton Rafraîchir. Préalable module 3 : `Status` migré (`sp:paiements-status`, 7 456 lignes) ; couche staff tolérante FR/EN. |
| **16/7/2026 (soir)** | **Chantiers S1-S3 LIVRÉS** : 8 sources SharePoint branchées ; couche de données `src/data/` en 7 modules (Config avec cache et fenêtre des 4 trimestres, Soldes filtrée sur le seul `FedasilNumber` avec pagination complète, règle de vérité assemblée dans `dossier.ts`, annuaire en mémoire pour la recherche par nom — `LastName` non indexée, volumétrie ≤ 6 000 validée métier) ; écran recherche + fiche 360° lecture seule validé dans le player sur les données de simulation. Piège documenté (SETUP v2 §12 n°11) : divergence de normalisation des noms de liste composés entre `dataSourcesInfo.ts` et `power.config.json`. |
| **16/7/2026 (soir)** | **Espace des communications structurées organisé en trois familles** (§4.12) : `01-12` = mois ; `91-94` (« 9T0 ») = solde du trimestre T (FIFO intra-trimestre — régularisation d'un trimestre en un virement, générable depuis la fiche 360° et les rappels) ; `990` = apurement global (FIFO toute ancienneté, insensible à l'année par construction — communication des mises en demeure et des dettes hors fenêtre). Le portail résident ne change pas. |
| **16/7/2026** | **Cadence du circuit de recouvrement TRANCHÉE** : rappel 1 à l'échéance dépassée (e-mail, automatique) ; rappel 2 à échéance + 1 mois (e-mail toujours, lot nocturne validé d'un clic) ; mise en demeure à rappel 2 + 15 jours (recommandé papier, **validation individuelle par le chef de service**). Délai MD → contentieux : à définir. |
| **16/7/2026** | **Granularité de l'escalade TRANCHÉE** : traçabilité par MOIS (colonnes sur chaque ligne Soldes — preuve juridique par créance), courrier par DOSSIER (un envoi regroupe tous les mois du FA au même niveau). On ne saute jamais d'étape pour une créance donnée. Le « niveau du dossier » est dérivé (max des mois), jamais stocké. |
| **16/7/2026** | **Compromis d'automatisation gradué** (amende le principe du 12/7) : automatique = faible enjeu + réversible + journalisé + interrupteur `Config` (rappel 1, relance d'invitation) ; lot validé d'un clic (rappel 2) ; validation individuelle (mise en demeure). Garde-fou de fraîcheur non négociable : pas de rappel si la file de lettrage déborde ou si l'import CSV est trop ancien (seuils dans `Config`). |
| **16/7/2026** | **Publipostage des mises en demeure piloté depuis l'app, en 3 marches** : (1) génération de l'Excel du publipostage Word existant (SheetJS, cible v1) ; (2) génération des lettres par Power Automate + Word Online Business → PDF archivés dans une bibliothèque SharePoint (cible module 4) ; (3) recommandé électronique bpost (backlog). |
| **16/7/2026** | **Plan d'apurement = état suspensif de la machine à états** : un dossier sous plan sort automatiquement du circuit de rappels. Plans standards envisagés 3/6 mois ; conception ultérieure ; le provisioning du module 4 réserve la place. |
| **16/7/2026** | **Module 7 « Supervision des inscriptions » créé** (périmètre validé) : supervision, PAS validation — la pré-inscription reste entièrement automatique. Taxonomie de codes neutres, gestes de remédiation, relance automatique `InviteNotAccepted` (graduée), liste **Journal-Inscriptions** à écrire par `Subscription.ts` (dépôt portail) avec NN/e-mail MASQUÉS pour les tentatives inéligibles. |
| **16/7/2026** | **L'automatisation du module 4 vit dans la Function App `residentapp-soldes-timer`** (second timer après la synchro Soldes, réutilise le `sendMail` Graph des invitations) — pas dans la Code App (frontend sous identité utilisateur), pas dans GitHub Actions (secret Graph refusé chez GitHub, état projet §10.11). |
| **13/7/2026** | **Jeu de données de simulation** créé sur le site de test (`npm run sp:seed`) : 1 845 résidents, ~14 800 déclarations, 20 113 lignes Soldes, 7 456 virements, + fixtures BCSS du module 5 (5 CSV + clé de correction). Les modules peuvent désormais se développer contre des données vivantes. |
| **13/7/2026** | **Index SharePoint posés** sur toutes les listes du site de test ; header `HonorNonIndexedQueriesWarningMayFailRandomly` RETIRÉ du code (fail fast). ⚠ En production : **index AVANT déploiement du code**, sans exception. |
| **13/7/2026** | **Volume de référence établi** : ~1 700 déclarations/mois observées, **~2 000 retenues pour le dimensionnement**. → KB-Cumul ≈ 6 000 lignes/trimestre (franchit les 5 000 au 3ᵉ mois) ; **KB-Paiements ≈ 24 000 lignes/an sans jamais tourner → PREMIER candidat SQL**, avant les KB-Cumul. Chiffres à reprendre dans la note d'arbitrage. |
| **13/7/2026** | **Bascule trimestrielle automatique — option B retenue** : liste `Config` (trimestre actif + année) écrite par `sp:rotate` en fin de rotation, lue par le code avec cache + repli. Option « déduire du calendrier » ÉCARTÉE : la bascule doit suivre la ROTATION, pas la DATE. `Config` est la **source de vérité partagée** entre portail et app staff. *(Réalisé le 13/7 au soir — état projet §5.21.)* |
| **13/7/2026** | **Historique multi-trimestres résident** (4 trimestres, courant compris) : trimestre COURANT lu dans KB-Cumul (fraîcheur), trimestres ANTÉRIEURS lus dans **Soldes** (permanence). Confirme le rôle de Soldes comme mémoire. *(Réalisé le 14/7 — état projet §5.22.)* |
| 12/7/2026 | **§3 tranchée** : liste « Soldes » (granularité mois, photo complète) créée et synchronisée sur le tenant de test (ID `610bf274-1738-4323-af0a-8c108945a1d9`) ; règle de vérité KB-Cumul ↔ Soldes ; migration Azure SQL différée sans blocage (note d'arbitrage à rédiger — §5 point 13). |
| 12/7/2026 | **Codes techniques neutres** pour toutes les valeurs stockées (`PayStatus` = `Paid`/`Partial`/`Unpaid`) ; la traduction FR/NL est une affaire d'affichage. |
| 12/7/2026 | **Discipline « 5000 »** érigée en principe de conception (index, filtres composés, `YearMonth`, agrégats précalculés, vigilance délégation). |
| 12/7/2026 | Colonnes de la **machine à états (module 4)** : à ajouter à Soldes par provisioning lors du module 4 (protégées de `sp:soldes`) ; ~~granularité escalade (mois vs dossier) à trancher alors~~ → **tranchée le 16/7** (voir ci-dessus). |

---

## 8. Prompt de relance (à coller au début de la prochaine discussion staff)

> Bonjour Claude. Je poursuis l'**application STAFF** de ResidentApp
> (Fedasil) — Power Apps Code App (React + TypeScript + Vite + SDK Power
> Apps). CONTEXTE : lis d'abord `CONCEPTION-STAFF-APP.md` (**v10** — modules
> 1-3 LIVRÉS ; **module 4 chantiers R1 (socle) + R2 (rappel 1) LIVRÉS** —
> moteur `scripts/lib/rappels.ts`, CLI `sp:rappels`, branché au timer,
> tuile au dashboard, interrupteur OFF ; **allumage = §4.13** ;
> communications 01-12 / 9T0 / 990 en §4.12), `SETUP-STAFF-APP-PowerApps.md`
> (**v7** — 9 sources ; pièges → **n°18** ; §8bis régénération de source ;
> `pac code run` DEVENU INUTILE) et `ETAT-PROJET-ResidentApp.md` (**v18** —
> §5.17, **§5.20 : 6 colonnes module 4 sur Soldes**, §5.23, **§5.24 :
> moteur de rappels R2**, **§6.1 : flags d'index**, §7.5, §11septies).
> OBJECTIF probable : **module 4, chantiers R3+ (rappel 2 : lot du matin
> validé d'un clic, envoi la nuit N+1 ; puis mise en demeure — publipostage
> §4.8)** — ou **module 7 (inscriptions)**, ou **écran Anomalies**, ou les
> **pré-remplissages du lettrage** (cascade FIFO « mois désigné d'abord »,
> différés le 21/7).
> ⚠ Horizon : 🔴 désactiver le flux Power Automate AVANT le premier
> `sp:paiements` réel ; **répétition générale de la bascule AVANT la
> première rotation réelle** (procédure v5, étape A0 : file de lettrage
> VIDE — l'échéance du 1ᵉʳ août est requalifiée).
> ⚠ RÈGLE (état projet §11quater) : avant de livrer un fichier complet, lire
> le fichier RÉEL en entier et vérifier une chaîne caractéristique — les
> fichiers du projet Claude sont une photo, et la comparaison vaut dans les
> DEUX sens (§11sexies ; le 21/7, la photo du SCHÉMA avait une semaine de
> retard : l'audit chiffré — compteurs `grep` — l'a démasquée AVANT le
> désastre). ⚠ FIN DE SESSION : committer les documents AVANT
> `sync-projet-claude.sh`. ⚠ tsconfig staff : `erasableSyntaxOnly`.
> ⚠ Colonnes Choice : écrire `{ Value }`, jamais une chaîne — SDK staff
> UNIQUEMENT (via Graph, côté portail, on écrit la CHAÎNE). ⚠ Lecture
> connecteur : `top: 5000` (pas de curseur en v1.2.5). ⚠ Dev local :
> `npm run dev` SEUL (plus de `pac code run`) + URL de lecture + **profil
> Chrome giapplab** (piège n°16). ⚠ React : règles de PURETÉ actives
> (pièges n°17-18 du SETUP).
> Rappel : débutant confirmé, fichiers complets copier-coller prêts,
> pas-à-pas pour Azure/Entra/Power Platform, UN SEUL commit par session et
> par dépôt (message fourni), `npm run build` avant tout push.
