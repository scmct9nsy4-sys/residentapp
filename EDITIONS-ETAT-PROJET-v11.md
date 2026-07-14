# Éditions ciblées — ETAT-PROJET-ResidentApp.md → v11

**⚠ MÉTHODE (§11quater) : ne PAS reconstruire le fichier. Ouvrir le fichier
réel, faire un `Cmd+F` sur chaque ancre, remplacer le bloc.**

Contrôle préalable : `grep -c "" ETAT-PROJET-ResidentApp.md` → **1506**.

---

## Édition 1 — En-tête (lignes 3-5)

**CHERCHER :**

```
**Version 10 — 14 juillet 2026** (remplace la v9 du 13 juillet au soir — session
« historique multi-trimestres pour le résident », et **restauration de la session
v6 effacée par erreur** — voir §11quater)
```

**REMPLACER PAR :**

```
**Version 11 — 14 juillet 2026 (soir)** (remplace la v10 du même jour — session
« répétition générale de la bascule + automatisation de `sp:soldes` » : la
procédure de bascule a été DÉROULÉE EN ENTIER sur le site de test, une faille
de visibilité a été trouvée et bouchée, et `sp:soldes` sait désormais tourner
seul — voir §5.20.1, §7, §11quinquies)
```

---

## Édition 2 — Remplacer TOUT le §5.20.1

**CHERCHER** la ligne :

```
#### 5.20.1 Cadence de synchronisation (décidée le 14/7/2026)
```

**REMPLACER** depuis cette ligne **jusqu'à la ligne juste avant** `### 5.21 Liste « Config »`, par :

```
#### 5.20.1 Cadence de synchronisation (14/7/2026, revu le soir même)

Depuis que le résident consulte ses trimestres antérieurs DANS Soldes (§5.22),
la fraîcheur de Soldes n'est plus un détail d'exploitation : **c'est elle qui
détermine ce que le public voit** sur les trimestres clôturés.

**Deux risques, de gravité très différente :**

1. **Soldes en RETARD** (le lettrage a mis `Paid` à jour dans KB-Cumul, Soldes
   ne le sait pas encore) → le portail affiche « impayé » une dette déjà réglée.
   On relance un résident qui a payé : appels au centre, perte de confiance. Et
   le futur moteur de rappels (module 4) enverrait des mises en demeure pour
   rien.
2. 🔴 **Soldes ne contient PAS le trimestre qui vient de se clôturer** → le
   résident voit ce trimestre **entièrement VIDE** : ni ses déclarations, ni son
   QR de paiement. **Découvert le 14/7 pendant la répétition générale** : la
   liste Soldes ne contenait aucune ligne du trimestre courant
   (`1255 créé(s), 0 inchangé(s)` — voir §11quinquies).

**La parade est la même dans les deux cas : `npm run sp:soldes -- --auto`.**

Le mode `--auto` (14/7 au soir) lit le trimestre actif dans la liste `Config`,
**déduit l'année de chacune des 4 listes KB-Cumul** (`q ≤ trimestre actif →
année active`, sinon année précédente) et les synchronise toutes. **Aucune année
n'est jamais tapée ni codée en dur** : la commande reste juste après chaque
rotation, indéfiniment.

Conséquence sur PROCEDURE-BASCULE-TRIMESTRE.md (v4) : la même commande couvre
l'étape A (avant la rotation : elle photographie ET la liste qui va être vidée
ET le trimestre qui va se clôturer) et l'étape D (après : elle confirme). **Le
trou de visibilité devient structurellement impossible.**

**Cadence :**
- **Aujourd'hui** : lancement manuel, **au minimum une fois par semaine**, calé
  sur le rythme du lettrage — et **impérativement avant tout `sp:rotate`**.
- **Cible** : exécution **nocturne automatique** (chantier 2b, non commencé).

**Options d'automatisation (à trancher en 2b) :**

| | Mécanisme | Statut |
|---|---|---|
| **A** | GitHub Actions planifié + secret Graph dans GitHub Secrets | ❌ **EXCLU** — Fedasil refuse que le secret Graph vive chez GitHub. *(Le jeton de déploiement de la SWA, lui, est accepté : sa portée se limite à un site, là où le secret Graph ouvre `Sites.FullControl.All` sur tout le tenant.)* |
| **B** | **Azure Function App séparée** (timer trigger), secret en app settings, puis **managed identity** au durcissement (§10.4) | 🎯 candidat principal |
| **C** | GitHub Actions + **identité fédérée OIDC** (aucun secret stocké nulle part) | possible ; exige `client_assertion` dans la lib + un *federated credential* Entra |

⚠ **Le déclencheur timer ne peut PAS vivre dans `api/`** : les Functions
*managées* d'une Static Web App ne supportent **que les déclencheurs HTTP**
(documentation Microsoft). Il faut une Function App distincte.
⚠ Sur un plan **Consumption Linux**, `WEBSITE_TIME_ZONE` n'est pas supporté : le
cron sera en **UTC** (2 h UTC = 3 h ou 4 h en Belgique selon la saison).

**Le risque de dérive est déjà neutralisé** : toutes les règles métier vivent
dans `scripts/lib/soldes-sync.ts`, un module **sans `argv` ni `process.exit`**
que la Function importera **tel quel** (§7). Quelle que soit l'option retenue,
il n'y aura jamais deux définitions de `Balance`, `PayStatus` ou `DueDate`.
```

---

## Édition 3 — §6.1 : la nuance qui manquait sur les filtres composés

**CHERCHER :**

```
2. **Un index ne peut être créé que si la liste compte MOINS de 5 000
```

**INSÉRER JUSTE AVANT** cette ligne :

```
1-bis. 🔴 **ÊTRE INDEXÉE NE SUFFIT PAS — la PREMIÈRE clause d'un `$filter`
   composé doit elle-même ramener moins de 5 000 lignes** *(établi le 14/7)*.
   SharePoint évalue un filtre composé en partant de la première colonne, puis
   affine. Sur la liste Soldes, `Year` ET `Quarter` sont pourtant indexées —
   mais `Year eq 2026` ramène à lui seul ~8 000 lignes (§6.0), soit **au-delà
   du seuil** : `Year eq 2026 and Quarter eq 2` échouerait en 400 dès la
   première année pleine, alors même que les deux colonnes sont indexées.
   **La parade : filtrer sur `YearMonth` (indexée), qui ramène ~1 700 lignes —
   un chiffre qui NE GROSSIT PAS avec les années.** C'est le seul découpage qui
   tienne dans la durée. Appliqué dans `scripts/lib/soldes-sync.ts` (3 requêtes
   par trimestre) ; `Me.ts` évite le problème autrement, en filtrant sur le seul
   `FedasilNumber` (§5.22).
```

---

## Édition 4 — §7 : la description de `snapshot-soldes.ts`

**CHERCHER :**

```
- **`scripts/snapshot-soldes.ts`** (12/7) : synchronisation KB-Cumul →
```

**REMPLACER** ce bullet **entier** (jusqu'à la ligne `  d'abord (sinon Graph 400 « Field not recognized » — reprise automatique après).`) par :

```
- **`scripts/lib/soldes-sync.ts`** (14/7 au soir) — **TOUTE la logique de
  synchronisation KB-Cumul → Soldes**, dans un module **sans `argv` ni
  `process.exit`** : client Graph (jeton **auto-rafraîchi**, reprise 401/429/503),
  règles §5.20 (`Balance`, `PayStatus`, `DueDate`, `YearMonth`, clé `Title`),
  lecture CIBLÉE de Soldes (3 requêtes `YearMonth eq AAAAMM` par trimestre —
  colonne indexée, §6.1), garde-fou `assertSoldesColumns()` (message clair
  « lancer sp:provision » **avant** toute écriture, au lieu d'un Graph 400
  opaque), mode `syncAuto()` (lit `Config`, déduit l'année des 4 listes,
  `yearOfCumulList()`), compteur `outOfQuarter` (ligne rangée dans la mauvaise
  liste trimestrielle → son année serait fausse : signalé bruyamment).
  ⚠ **Ce module est LA seule définition des règles métier de Soldes dans tout le
  dépôt.** La future Function nocturne (§5.20.1, chantier 2b) l'importera TEL
  QUEL — c'est ce qui rend toute dérive impossible entre la ligne de commande et
  l'automate.
- **`scripts/snapshot-soldes.ts`** (12/7, réécrit le 14/7 : 430 → 200 lignes) :
  **CLI mince** — lit les arguments, fournit les identifiants
  (`api/local.settings.json` **ou, à défaut, les variables d'environnement** —
  c'est ce repli qui permettra à un automate de tourner sans fichier), affiche le
  résultat. **Aucune règle métier.** Commandes :
  `npm run sp:soldes -- --auto [--dry-run]` (⭐ les 4 trimestres, années déduites)
  ou `npm run sp:soldes -- T2 2026 [--dry-run]` (un seul trimestre, année
  obligatoire). Idempotent : rejouable à volonté.
```

---

## Édition 5 — §10 : le chantier `sp:soldes`

**CHERCHER :**

```
📌 **À FAIRE (non bloquant)** : automatiser `sp:soldes` (nocturne — Power Automate
ou timer trigger), voir §5.20.1. En attendant : **lancement hebdomadaire manuel**.
```

**REMPLACER PAR :**

```
✅ **TERMINÉ (v11, 14/7 soir) — CHANTIER 2a : `sp:soldes` autonome.**
Découpage `scripts/lib/soldes-sync.ts` (logique, importable) + `scripts/
snapshot-soldes.ts` (CLI mince). Mode **`--auto`** (années des 4 listes déduites
de `Config` — aucune année codée en dur), **lecture ciblée par `YearMonth`**
(~13 000 lignes lues au lieu de ~85 000), **vérification des colonnes avant
écriture**, **jeton auto-rafraîchi**. Validé : `--auto --dry-run` →
**`0 créé, 0 mis à jour, 14 799 inchangé`** sur les 4 listes (point fixe global).

🔧 **CHANTIER 2b — OUVERT : exécution NOCTURNE de `sp:soldes --auto`.**
Voir §5.20.1 pour les trois options (A exclue : Fedasil refuse le secret Graph
chez GitHub · **B = Azure Function App + timer, candidat principal** · C =
GitHub Actions + identité fédérée OIDC). ⚠ Le timer **ne peut pas** vivre dans
`api/` (les Functions managées d'une SWA ne supportent que le HTTP).
La lib est prête : la Function n'aura qu'à appeler `syncAuto()`.
**En attendant : lancement hebdomadaire manuel de `npm run sp:soldes -- --auto`.**
```

---

## Édition 6 — §10, point 12 : la répétition générale est FAITE

**CHERCHER :**

```
12. **Répétition générale de la bascule** (obligatoire AVANT la première
```

**REMPLACER** ce point 12 **entier** (jusqu'à `    simulation (regénérables).`) par :

```
12. ✅ **Répétition générale de la bascule — FAITE le 14/7/2026 sur le site de
    test** (T2 2026 → T3 2026, puis retour à l'état initial). Déroulé complet,
    chiffres et enseignements : PROCEDURE-BASCULE-TRIMESTRE.md §6 et
    §11quinquies ci-dessous. **À REFAIRE sur le tenant Fedasil** avant la
    première bascule réelle (le déroulé est identique ; c'est la première
    exécution sur des listes recréées, donc le premier vrai test des index posés
    par `sp:provision`).
```

---

## Édition 7 — §10 : nouveau point 15

**CHERCHER** (fin du point 14) :

```
    §6.0) : le jeu de simulation actuel tourne à ~1 480/mois. Ajuster la
    constante de `seed-simulation.ts`, purger, regénérer.
```

**AJOUTER JUSTE APRÈS :**

```

15. 🟠 **[QUESTION MÉTIER] Détacher un profil d'un compte** *(constaté le 14/7)*.
    Le rattachement d'une personne à un compte est **automatique** (même e-mail
    → même invitation → même `oid`, §5.2) et le détachement **volontaire** l'est
    aussi (la personne se ré-inscrit avec SON adresse → nouvelle invitation →
    son nouvel `oid` écrase celui de la famille sur SA ligne → elle disparaît du
    sélecteur, §5.3). **Mais rien ne permet au staff de détacher un profil**
    d'un compte auquel il ne devrait plus être lié (personne vulnérable qui ne
    se ré-inscrira pas, dossier clos, erreur de saisie). Le geste = **vider
    `EntraOid`** sur la ligne resident : aucun écran, aucune trace, aucun
    contrôle.
    - ⚠ **Ne JAMAIS diagnostiquer un lien familial en regardant `Email`** : la
      serrure est l'`oid` (jeton signé par Entra), pas l'e-mail (colonne
      SharePoint éditable à la souris). `Me.ts` ne lit jamais `Email`.
    - **Détecteur associé** (rapport staff, module 1) : lignes partageant un
      `oid` avec des e-mails **divergents** → la ligne n'est pas passée par
      `Subscription.ts` (édition manuelle, ou reliquat d'anonymisation).
    - ⚠ **Ne PAS transformer « même `oid` ⇒ même e-mail » en contrainte** : c'est
      déjà une CONSÉQUENCE du code (Subscription.ts écrit les deux colonnes
      ensemble), et la graver interdirait le modèle `DelegateOid` (point 10),
      où l'`oid` d'une aidante couvre des résidents qui **gardent chacun leur
      e-mail**.
    - À trancher : qui a le droit de détacher, par quel écran, faut-il tracer ?
```

---

## Édition 8 — §10, point 11 : la contrainte GitHub

**CHERCHER :**

```
11. **Réplication sur le tenant Fedasil** (à la reprise) : `sp:inspect` puis
```

**AJOUTER**, en fin de ce point 11 (juste avant le point 12) :

```
    ⚠ **CONTRAINTE DÉCOUVERTE LE 14/7 : Fedasil refusera que le secret Graph
    (`e-residentapp admin`, `Sites.FullControl.All` sur tout le tenant) soit
    stocké chez GitHub.** Le jeton de déploiement de la SWA, lui, est accepté
    (sa portée se limite à un site). **À vérifier auprès de Fedasil : quelle
    chaîne de déploiement et quel ordonnanceur sont autorisés** (Azure DevOps ?
    Azure Function App + managed identity ?). C'est le prérequis de la décision
    du chantier 2b (§5.20.1).
```

---

## Édition 9 — Nouvelle section §11quinquies

**CHERCHER :**

```
## 12. Prompt de relance (à coller au début de la prochaine conversation)
```

**INSÉRER JUSTE AVANT :**

```
## 11quinquies. Leçons de la session du 14/7 au SOIR (répétition générale + sp:soldes --auto)

### 1. La faille que seule une VRAIE répétition pouvait révéler

Avant la bascule, tout semblait cohérent : le portail affichait ses 4 trimestres,
Soldes contenait 20 113 lignes, la procédure était écrite. Puis, à l'étape de
contrôle, ce chiffre :

```
npm run sp:soldes -- T2 2026 --dry-run
Terminé (dry-run) : 1255 créé(s), 0 mis à jour, 0 inchangé(s), 0 ignoré(s).
```

**Zéro « inchangé ».** Pas une seule ligne du trimestre COURANT n'était dans
Soldes — elle n'avait aucune raison d'y être : Soldes n'était alimentée qu'APRÈS
la clôture d'un trimestre (étape D de la procédure v3).

Or le portail lit les trimestres antérieurs **dans Soldes** (§5.22). À la seconde
du `BASCULER`, le trimestre que les résidents venaient de déclarer serait devenu
**entièrement invisible** : ni déclarations, ni QR de paiement. Pour **tous** les
résidents, d'un coup.

**Leçon** : ajouter une dimension (le résident lit Soldes) crée des dépendances
là où il n'y en avait pas. La procédure d'exploitation, écrite AVANT ce
changement, était devenue fausse **sans que rien ne le signale**. Une procédure
n'est vérifiée que par un déroulé complet, en conditions réelles.

### 2. Le bon correctif n'était pas une étape de plus, mais une commande qui l'absorbe

Réflexe initial : ajouter une « étape A-bis » à la checklist. Mauvaise réponse —
une étape de plus, c'est une étape de plus à oublier, un soir de bascule, sous
pression.

Le mode `--auto` (lecture de `Config`, déduction de l'année des 4 listes) fait
**disparaître le problème** : la même commande, avant et après la bascule,
photographie tout ce qui doit l'être. **On ne documente pas un piège, on le
supprime.**

C'est le même mouvement que la liste `Config` (§5.21) : elle n'a pas *documenté*
le piège « l'ID prime sur le nom », elle l'a rendu structurellement impossible.

### 3. Un point fixe est le meilleur test qui soit

`sp:soldes -- --auto --dry-run` → **`0 créé, 0 mis à jour, 14 799 inchangé`** sur
les 4 listes.

Cette seule ligne valide, d'un coup : la déduction des années (une erreur d'un an
aurait produit 4 000 créations, les clés `Title` ne se retrouvant plus), les
règles de calcul (`Balance`, `PayStatus`, `DueDate`), la cohérence du jeu de
simulation, et la lecture ciblée par `YearMonth`.

**Leçon** : quand un traitement est idempotent, **« 0 opération » est une
assertion de test**, pas une non-information. Le concevoir idempotent, c'est se
donner un test gratuit et permanent.

### 4. Indexée ≠ filtrable

`Year` et `Quarter` sont toutes deux indexées sur Soldes. Et pourtant
`Year eq 2026 and Quarter eq 2` **échouerait** : SharePoint part de la première
clause, et `Year eq 2026` ramène à lui seul ~8 000 lignes — au-delà du seuil.

**Leçon** (§6.1, règle 1-bis) : l'index est nécessaire, pas suffisant. **La
première clause doit ELLE-MÊME ramener moins de 5 000 lignes.** Choisir une
colonne dont la sélectivité ne se dégrade pas avec le temps (`YearMonth` :
~1 700 lignes, pour toujours) plutôt qu'une colonne qui grossit chaque année
(`Year`).

### 5. Les fichiers du projet Claude sont une PHOTO, pas le dépôt

En début de session, les copies de `Portail.tsx`, `Me.ts` et `fedasil.css` dans
le projet Claude étaient **antérieures à la v10** — et `Portail.tsx` y était dans
sa version **amputée de 1 488 lignes** (celle de `ac587a5`).

**Leçon** : la règle §11quater (« lire le fichier RÉEL ») vaut aussi pour les
fichiers du projet Claude. Le contrôle est le même et coûte 10 secondes :
`grep -c "" <fichier>` + une chaîne caractéristique de la dernière session.
**Tenir ces copies à jour fait partie de la clôture de session.**
```

---

## Édition 10 — §12 : prompt de relance

**REMPLACER** tout le contenu qui suit
`## 12. Prompt de relance (à coller au début de la prochaine conversation)` par :

```
> Bonjour Claude. Je poursuis le développement de ResidentApp (portail Fedasil
> pour résidents, React + TypeScript + CSS pur, Azure Static Web Apps +
> Functions). CONTEXTE : tout l'état du projet est dans
> ETAT-PROJET-ResidentApp.md (**v11 du 14 juillet 2026, soir**) — lis-le
> d'abord, en particulier **§5.20 + §5.20.1 (liste Soldes, cadence et
> automatisation)**, **§5.21 (Config)**, **§5.22 (fenêtre de 4 trimestres)**,
> **§6.1 (index — DEUX règles)** et **§11quater + §11quinquies (leçons)**.
>
> EN RÉSUMÉ : le parcours résident est validé de bout en bout. Le provisioning
> est déclaratif (`sp:provision`, qui sert AUSSI d'audit d'index) ; la bascule
> trimestrielle est automatique (liste `Config`) ; le résident consulte une
> fenêtre de 4 trimestres (courant → KB-Cumul, antérieurs → Soldes) ; et
> **`npm run sp:soldes -- --auto` synchronise les 4 listes en déduisant les
> années de `Config`** — plus aucune année tapée à la main. **La répétition
> générale de la bascule a été DÉROULÉE EN ENTIER sur le site de test le 14/7**
> (§11quinquies) : elle a révélé et fait boucher une faille de visibilité.
>
> ⚠ INDEX (§6.1) — DEUX règles : (1) Graph refuse un `$filter` sur colonne NON
> INDEXÉE **immédiatement**, même sur une petite liste ; (2) **être indexée ne
> suffit pas** — la PREMIÈRE clause d'un filtre composé doit elle-même ramener
> moins de 5 000 lignes (`Year eq 2026` = ~8 000 lignes → 400, malgré l'index ;
> `YearMonth eq 202604` = ~1 700 lignes → OK, pour toujours).
>
> ⚠ RÈGLE NÉE D'UN DÉSASTRE (§11quater) : avant de me livrer un fichier complet,
> ouvre le fichier RÉEL et lis-le EN ENTIER, puis vérifie qu'il contient une
> chaîne caractéristique de la session précédente. **Cela vaut AUSSI pour les
> fichiers du projet Claude, qui sont une photo et peuvent être périmés** (le
> 14/7, `Portail.tsx` y était encore dans sa version amputée). `grep -c ""` et
> `git log -S "<chaîne>"` tranchent.
>
> ⚠ FENÊTRE DE 4 TRIMESTRES (§5.22) : `HISTORY_QUARTERS` ne peut PAS augmenter
> tant que la communication structurée n'encode pas l'année.
>
> ⚠ TOUT EST SUR LE SITE DE TEST (`Resident_Test`), avec un jeu de simulation
> complet (`sp:seed`). Rien n'est répliqué en production Fedasil : les index
> devront y être posés AVANT de déployer le code (`sp:provision` les liste).
> ⚠ Fedasil refusera que le **secret Graph** soit stocké chez GitHub (§10.11).
>
> OBJECTIF DE CETTE DISCUSSION : [À COMPLÉTER — pistes ouvertes : **chantier 2b,
> exécution nocturne de `sp:soldes --auto`** (Azure Function App + timer — la lib
> `scripts/lib/soldes-sync.ts` est prête à être importée, §5.20.1) ; **reprendre
> l'app staff** (CONCEPTION-STAFF-APP.md, six modules) ; préparer la réplication
> production.]
>
> Rappel de ma façon de travailler : je suis débutant confirmé, je préfère des
> fichiers complets copier-coller prêts plutôt que des patchs, un pas-à-pas pour
> les manipulations Azure/Entra/Power Platform, et je commite via l'interface Git
> de VS Code (donne-moi juste les messages de commit, en UN SEUL commit). Avant
> tout push : `npm run build` à la racine ET dans `api/`.
```
