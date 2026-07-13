# CONCEPTION FONCTIONNELLE — Application Staff (Fedasil)

**Version 2 — 12 juillet 2026** (remplace la v1 du 12 juillet 2026)
Outil interne de gestion du processus de contribution financière des résidents.

Documents compagnons :
- `ETAT-PROJET-ResidentApp.md` — le portail résident (règles métier §5)
- `SETUP-STAFF-APP-PowerApps.md` — l'installation et l'architecture technique

> **Statut : conception + première brique de données livrée.**
> Depuis la v1 : la **§3 est TRANCHÉE** (liste « Soldes » créée, synchronisée
> et validée sur le tenant de test — voir §3 et le journal des décisions §7).
> Aucun module applicatif n'est encore développé.

---

## 1. Le processus métier à outiller

Le service gestion des processus est responsable du cycle complet de la
contribution financière des résidents :

```
  Déclaration          Paiement            Recouvrement              Contrôle
  du résident    →     et lettrage    →    (si impayé)         +     trimestriel
  ─────────────        ────────────        ─────────────             ────────────
  (portail)            virement            rappel 1                  BCSS (brut)
                       imputation          rappel 2                    ↕ comparaison
                       sur le mois         mise en demeure           net déclaré
                                           contentieux               → régularisation
```

Aujourd'hui, ce processus est **outillé uniquement du côté résident** (le
portail). Tout ce qui suit la déclaration — imputation des paiements, relances,
contrôle — se fait manuellement, dans SharePoint et en dehors.

**Le fil rouge de l'application staff : donner au collaborateur une vue et un
geste là où il n'a aujourd'hui que des listes et des exports.**

---

## 2. Les six modules

### Module 1 — Tableau de bord trimestriel (page d'accueil)

**Le besoin** : savoir chaque matin où agir, sans fouiller dans SharePoint.

**Contenu** :
- nombre de résidents ayant déclaré ce trimestre ;
- montants : **total dû / payé / en retard** ;
- **taux de communications structurées** — l'indicateur qui mesure l'adoption
  du QR (§5.17 : objectif 100 %, aujourd'hui beaucoup de communications libres
  héritées du processus manuel) ;
- nombre de paiements « À traiter » dans la file de lettrage ;
- nombre de dossiers par niveau d'escalade (rappel / mise en demeure /
  contentieux).

C'est la boussole : elle ne fait rien, elle **oriente**.

> **Note d'architecture (12/7)** : SharePoint ne calcule pas d'agrégats côté
> serveur (pas de SUM). Les indicateurs seront **précalculés** (flux Power
> Automate nocturne → mini-liste « Indicateurs » de quelques lignes) plutôt
> que recalculés à chaque ouverture d'écran. Voir principe §6.

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
- historique des rappels envoyés (quel niveau, quelle date, quel canal) ;
- **notes internes horodatées**.

> ✅ Le « point dur » historique de la v1 est levé : voir §3.

---

### Module 3 — File de lettrage manuel

**Le besoin** : imputer les virements dont la communication est libre.

**Contexte** (§5.17) : la liste **KB-Paiements** est alimentée par un CSV
bancaire hebdomadaire. Les lignes portant une **communication structurée
valide** peuvent être imputées automatiquement (décodage FA + mois, modulo 97
vérifiable) — c'est le **candidat idéal pour Power Automate**. Le reste, les
**communications libres**, forme la file de travail manuelle.

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

**Cible de l'écriture** (règle de vérité §3) : pour un mois dont la ligne
KB-Cumul existe encore, l'imputation écrit dans KB-Cumul (le portail la lit)
puis `sp:soldes` resynchronise ; pour un mois dont la liste trimestrielle a
été vidée, l'imputation écrit **directement dans Soldes**.

> ⚠ À traiter lors de ce module : les valeurs de la colonne `Status` de
> KB-Paiements (`À traiter / Imputé / Anomalie`) sont en français — à
> convertir en **codes neutres** (principe §6) en même temps que l'alignement
> du schéma sur la liste réelle Fedasil.

---

### Module 4 — Moteur de rappels (machine à états)

**Le besoin** : le cœur du recouvrement, aujourd'hui entièrement manuel.

**Machine à états par dossier** :

```
  À jour  →  En retard  →  Rappel 1  →  Rappel 2  →  Mise en demeure  →  Contentieux
```

Chaque transition porte une **date d'envoi** et un **délai de réponse**.

**Fonctionnalités attendues** :

1. **Vue « candidats au rappel »** : tous les mois échus impayés, groupés par
   résident, filtrables par **centre** et par **niveau d'escalade**.
   Requête type sur Soldes : `PayStatus = Unpaid|Partial` (indexée) composée
   avec `Year`/`Quarter`, et `DueDate < aujourd'hui` évaluée à l'affichage.
   (Échéance = fin du mois suivant la clôture du mois concerné — §5.18,
   colonne `DueDate` précalculée.)

2. **Génération par lots validée par un humain** : le collaborateur coche,
   clique « Générer les rappels 1 », et l'application produit les courriers /
   e-mails :
   - **multilingues** (même public que le portail : FR / NL / EN) ;
   - avec le **QR de paiement** et la **communication structurée d'apurement**
     — c'est ici que le préfixe réservé **`9T0`** (§5.12) trouve son usage.

   ⚠ **Jamais d'envoi automatique sans validation humaine.**

3. **La trace** : quel rappel, quelle date, quel canal. Indispensable — une
   mise en demeure exige de **prouver les rappels préalables**.
   Les colonnes de la machine à états (niveau d'escalade, dates…) seront
   ajoutées à la liste Soldes par provisioning **lors de ce module** —
   `sp:soldes` ne touche jamais aux colonnes qu'il ne possède pas, elles
   sont donc à l'abri de la resynchronisation. Question de conception à
   trancher alors : escalade **par mois** ou **par dossier** (la machine à
   états est « par dossier » ; un dossier = l'ensemble des mois impayés
   d'un FA).

4. **Export « dossier complet »** (PDF) pour le contentieux : déclarations,
   paiements, rappels, mises en demeure — prêt à transmettre au service
   juridique.

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
  *lecture seule* (consultation).

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
- **Alimentation** : script `npm run sp:soldes -- T2 2026` (dépôt ResidentApp,
  couche données) — upsert idempotent depuis une liste KB-Cumul, rejouable à
  volonté, mode `--dry-run`. Il ne touche **jamais** aux colonnes qu'il ne
  possède pas : le module 4 pourra ajouter les siennes sans risque.

### 3.2 La règle de vérité

> **Tant que la ligne KB-Cumul d'un mois existe (~9 mois après la clôture du
> trimestre), KB-Cumul reste la source** — le portail résident la lit — et
> `sp:soldes` resynchronise (notamment les paiements tardifs qui alimentent
> `Paid`). **Après le vidage de la liste trimestrielle, Soldes devient la
> seule vérité** — le lettrage y écrit alors directement.

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
| ✅ | **Liste Soldes (§3)** | **FAIT (12/7)** — le socle de données des modules 2, 4 et 5. |
| **1** | **File de lettrage (3)** | Sans paiements correctement imputés, **ni les statuts ni les rappels ne sont fiables**. Tout le reste en dépend. |
| **2** | **Moteur de rappels (4)** | Le cœur métier du recouvrement — ajoute ses colonnes d'escalade à Soldes. |
| **3** | **Contrôle BCSS (5)** | Première échéance réelle : **~15 août** pour le T2. |
| — | Fiche 360° (2) et tableau de bord (1) | Se construisent naturellement **au fil** des trois précédents (ils en sont largement la vue de lecture). |

**Alternative défendable** : commencer par la **fiche dossier 360°** — lecture
seule (donc sans risque), valeur immédiate, banc d'essai de la couche de
données de l'app staff (branchement de Soldes + Residents List via
`add-data-source`, requêtes déléguées, affichage traduit des codes neutres).

---

## 5. Questions ouvertes (à trancher avec le service et la hiérarchie)

**Métier :**
1. **Seuil d'écart BCSS** : quelle valeur (en % ? en € ? les deux ?) ? Qui
   l'arbitre ? Est-il révisable chaque année avec la grille Jobat ?
2. **Délais du circuit de rappels** : combien de jours entre l'échéance et le
   rappel 1 ? Entre rappel 1 et rappel 2 ? Avant la mise en demeure ?
3. **Qui valide une mise en demeure ?** Un gestionnaire seul, ou une
   validation hiérarchique ? (Impacte le modèle de rôles du module 6.)
4. **Imputation FIFO** : la convention « le paiement sans communication
   structurée apure la dette la plus ancienne » doit être **validée
   juridiquement** (§5.12).
5. **Ambiguïté de l'année** dans la communication structurée : un virement
   tardif portant la communication d'un trimestre déjà bouclé — imputation
   manuelle ? (§10 point 1.) NB : Soldes rend au moins la *donnée* non
   ambiguë (`Year` explicite) ; l'ambiguïté résiduelle est celle du virement.
6. **Grille Jobat** : où l'obtient-on officiellement, sous quelle forme, et qui
   la met à jour chaque année ?
7. **Format du fichier BCSS** : structure exacte, fréquence, canal de
   transmission.

**Technique / gouvernance :**
8. **Droits SharePoint des collaborateurs** : un groupe de sécurité dédié est
   nécessaire (l'app staff lit sous l'identité de l'utilisateur, pas sous une
   identité applicative). NB : ce groupe devra couvrir la liste **Soldes**.
9. **Licences Premium** : combien de collaborateurs ? (Le plan Développeur
   actuel est individuel et interdit en production.)
10. **Décision base de données** : ✅ **levée opérationnellement le 12/7**
    (liste Soldes) — plus rien ne bloque les modules. La migration **Azure
    SQL** reste la cible structurelle : **note d'arbitrage à rédiger** pour la
    hiérarchie (statu quo SharePoint+Soldes / Azure SQL / Dataverse écarté
    sauf validation revendeur), avec les chiffres du 12/7 : ~2000
    lignes/trimestre, ~8000/an, seuil des 5000 dépassé en un an, discipline
    d'index comme coût récurrent. Décision de confort, pas d'urgence — mais
    plus la liste grossit, plus la reprise sera longue.
11. **Listes « KB-Cumul Archives \<année\> » du tenant Fedasil** : instruire
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
- **Rien d'irréversible sans validation humaine** — surtout pour les envois de
  courriers et les régularisations.
- **Tout ce qui touche à l'argent est tracé** (auteur, date, montant, motif).
- **Contrôle par exception** : ne jamais imposer au collaborateur de relire ce
  qui est conforme.
- **(12/7) Codes techniques neutres, l'interface traduit.** Le public staff
  est FR/NL : les valeurs stockées (statuts, choix) sont des codes anglais
  stables (`Paid`, `Unpaid`, …) ; la traduction est une affaire d'affichage,
  jamais de données. S'applique à toute nouvelle colonne à choix (et,
  rétroactivement, au `Status` de KB-Paiements lors du module 3).
- **(12/7) Discipline SharePoint « 5000 »** — servitude d'architecture de la
  couche données, à respecter par tout écran et tout flux :
  1. toute requête filtrée commence par une **colonne indexée** ;
  2. le **résultat** de chaque requête reste sous 5000 lignes → filtres
     **composés** (`Year+Quarter`, `PayStatus+Year`, `YearMonth`), jamais de
     filtre « qui grossit avec les années » seul ;
  3. les **agrégats se précalculent** (Power Automate nocturne → liste
     « Indicateurs »), ils ne se recalculent pas à l'écran ;
  4. attention aux **limites de délégation** du connecteur SharePoint de
     Power Apps : une requête non délégable tronque silencieusement ;
  5. les traitements de fond peuvent balayer en **lecture paginée sans
     filtre** (non soumise au seuil).
- **(12/7) La couche données vit dans le dépôt ResidentApp.** Schéma
  (`sharepoint-schema.json`), provisioning, rotation, synchronisation Soldes :
  tout l'outillage des listes partagées appartient au dépôt du portail (qui
  détient les identifiants Graph). Le dépôt `residentapp-staff` ne fait que
  consommer les listes via ses connecteurs.

---

## 7. Journal des décisions

| Date | Décision |
|---|---|
| **13/7/2026** | **Jeu de données de simulation** créé sur le site de test (`npm run sp:seed`) : 1 845 résidents, ~14 800 déclarations, 20 113 lignes Soldes, 7 456 virements, + fixtures BCSS du module 5 (5 CSV + clé de correction). Les 6 modules peuvent désormais se développer contre des données vivantes. |
| **13/7/2026** | **Index SharePoint posés** sur toutes les listes du site de test ; header `HonorNonIndexedQueriesWarningMayFailRandomly` RETIRÉ du code (fail fast). ⚠ En production : **index AVANT déploiement du code**, sans exception. |
| **13/7/2026** | **Volume de référence établi** : ~1 700 déclarations/mois observées, **~2 000 retenues pour le dimensionnement**. → KB-Cumul ≈ 6 000 lignes/trimestre (franchit les 5 000 au 3ᵉ mois) ; **KB-Paiements ≈ 24 000 lignes/an sans jamais tourner → PREMIER candidat SQL**, avant les KB-Cumul. Chiffres à reprendre dans la note d'arbitrage. |
| **13/7/2026** | **Bascule trimestrielle automatique — option B retenue** : liste `Config` (trimestre actif + année) écrite par `sp:rotate` en fin de rotation, lue par le code avec cache + repli. Option « déduire du calendrier » ÉCARTÉE : la bascule doit suivre la ROTATION, pas la DATE (sinon données vieilles d'un an affichées tant que la rotation n'a pas tourné). `Config` deviendra la **source de vérité partagée** entre portail et app staff. *Cadré, non commencé.* |
| **13/7/2026** | **Historique multi-trimestres résident** (≥ 4 trimestres, courant compris) : trimestre COURANT lu dans KB-Cumul (fraîcheur), trimestres ANTÉRIEURS lus dans **Soldes** (permanence). Confirme le rôle de Soldes comme mémoire. *Cadré, non commencé — à faire APRÈS le chantier `Config`.* |
| 12/7/2026 | **§3 tranchée** : liste « Soldes » (granularité mois, photo complète) créée et synchronisée sur le tenant de test (ID `610bf274-1738-4323-af0a-8c108945a1d9`) ; règle de vérité KB-Cumul ↔ Soldes ; migration Azure SQL différée sans blocage (note d'arbitrage à rédiger — §5 point 10). |
| 12/7/2026 | **Codes techniques neutres** pour toutes les valeurs stockées (`PayStatus` = `Paid`/`Partial`/`Unpaid`) ; la traduction FR/NL est une affaire d'affichage. |
| 12/7/2026 | **Discipline « 5000 »** érigée en principe de conception (index, filtres composés, `YearMonth`, agrégats précalculés, vigilance délégation). |
| 12/7/2026 | Colonnes de la **machine à états (module 4)** : à ajouter à Soldes par provisioning lors du module 4 (protégées de `sp:soldes`) ; granularité escalade (mois vs dossier) à trancher alors. |
