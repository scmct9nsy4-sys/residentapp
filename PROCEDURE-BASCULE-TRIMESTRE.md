# PROCÉDURE — Bascule trimestrielle des listes KB-Cumul

**ResidentApp (Fedasil)** · document d'exploitation · à dérouler à chaque
clôture de trimestre. **Mise à jour du 13/7/2026 (v3) : bascule AUTOMATIQUE
via la liste « Config »** (chantier §10.0 de l'état projet) — les étapes
« modifier les variables de la Static Web App » et « redéployer » ont
DISPARU. *(v2 du 12/7 : intégration de la liste « Soldes ».)*

> **Principe.** L'application repose sur 4 listes SharePoint **permanentes**
> (KB-Cumul T1..T4) aux **ID fixes**, réutilisées chaque année : à la bascule,
> la liste du trimestre réutilisé est **archivée puis vidée**, jamais recréée.
> Le « trimestre courant » de l'application n'est PAS le trimestre calendaire :
> c'est le **trimestre en cours de déclaration**.
>
> **Depuis le 13/7/2026, la clôture métier = l'écriture de la ligne
> « ActiveQuarter » dans la liste SharePoint « Config »**, proposée par
> `npm run sp:rotate` à la fin de la rotation (confirmation en tapant
> `BASCULER`). `/api/me` et `/api/declare` lisent cette ligne avec un cache
> mémoire de ~5 minutes : le portail bascule **sans modification de variable
> d'environnement et sans redéploiement**. Les variables `SP_CUMUL_*` ne
> servent plus que de **repli** si la liste Config est illisible.
>
> Depuis le 12/7/2026, la liste permanente **« Soldes »** conserve la photo
> mensuelle de tous les trimestres clos : les impayés **survivent** au vidage
> des listes trimestrielles.

---

## 0. Initialisation (UNE FOIS, avant la première bascule automatique)

À faire sur chaque site (test PUIS production Fedasil, le moment venu) :

- [ ] `npm run sp:provision` → crée la liste **Config** (6 colonnes) décrite
      dans `sharepoint-schema.json`.
- [ ] Écrire la ligne initiale avec le trimestre ACTUELLEMENT actif, par ex.
      en juillet 2026 (T2 encore déclarable jusqu'au 31/7) :
      `npm run sp:rotate -- T2 --config-only --annee=2026`
      → taper `BASCULER`. *(Mode `--config-only` : aucune donnée touchée —
      seule la ligne Config est écrite.)*
- [ ] Vérifier dans SharePoint : liste Config → 1 ligne `ActiveQuarter`
      avec `Quarter`, `Year`, `CumulListId`, `CumulListName` remplis.
- [ ] Déployer le code qui lit Config (Me.ts / Declare.ts /
      quarterConfig.ts) — **l'ordre init → déploiement est sans risque** :
      tant que Config n'existe pas, le code se replie sur les variables
      d'environnement actuelles (journalisé `⚠ REPLI`).

## 1. Calendrier

Un trimestre reste déclarable pendant **1 mois après sa fin** (exceptions
rares sur justificatifs — processus staff). La bascule a lieu le **1er du
2ᵉ mois** suivant la fin du trimestre. Les chiffres BCSS arrivent vers le
**15** du même mois pour la phase de contrôle.

| Trimestre clôturé | Mois couverts | Déclarable jusqu'au | **Bascule le** | Contrôle BCSS |
|---|---|---|---|---|
| T1 | janv – mars | 30 avril | **1er mai** | ~15 mai |
| T2 | avril – juin | 31 juillet | **1er août** | ~15 août |
| T3 | juil – sept | 31 octobre | **1er novembre** | ~15 novembre |
| T4 | oct – déc | 31 janvier N+1 | **1er février N+1** | ~15 février N+1 |

⚠ **L'année écrite dans Config est celle du trimestre ACTIVÉ** (déduite de la
date du jour par `sp:rotate`, forçable avec `--annee=YYYY`). Ne pas la
confondre avec l'année passée en 2ᵉ argument de `sp:rotate`, qui est celle
des données **archivées** (l'année précédente : la liste est réutilisée
annuellement).

Exemple ci-dessous : **1er novembre 2026** — clôture de T3, ouverture de T4
(la liste T4 réutilisée contient encore les données de T4 **2025**).

## 2. Tableau de référence des listes (à compléter UNE FOIS)

Relever les ID avec `npm run sp:inspect` (colonne `id`) et les consigner ici :

| Liste | ID (permanent) |
|---|---|
| KB-Cumul T1 | `à compléter` |
| KB-Cumul T2 | `à compléter` |
| KB-Cumul T3 | `à compléter` |
| KB-Cumul T4 | `à compléter` |
| Soldes | `à compléter` *(tenant de test : `610bf274-1738-4323-af0a-8c108945a1d9`)* |
| Config | `à compléter` |

> Depuis la bascule automatique, ce tableau sert surtout de **contrôle
> visuel** : c'est `sp:rotate` qui écrit l'ID de la liste courante dans
> Config, sans ressaisie manuelle.

## 3. Checklist de bascule (exemple : 1er novembre, T3 → T4)

### A. Dernière synchronisation Soldes de la liste QUI VA ÊTRE VIDÉE

Si la liste réutilisée (ici T4, données de l'an dernier) contient des
**données réelles**, capturer leur dernier état — les paiements tardifs ont pu
mettre `Paid` à jour depuis la dernière synchronisation :

- [ ] `npm run sp:soldes -- T4 2025`
      *(« 2025 » = l'année des données ENCORE PRÉSENTES dans la liste)*
- [ ] Récapitulatif attendu : des « mis à jour » (paiements tardifs) et des
      « inchangé » — **zéro création** si la synchronisation a été tenue à
      jour pendant l'année.

> Rejouable sans risque : le script est un upsert idempotent (`--dry-run`
> pour prévisualiser). Il ne touche jamais aux colonnes qu'il ne possède pas
> (colonnes du moteur de rappels).

### B. Archiver + vider la liste réutilisée, puis BASCULER

- [ ] Depuis la racine du dépôt (avec `api/local.settings.json` configuré) :
      `npm run sp:rotate -- T4 2025`
      *(« 2025 » = année des données archivées, utilisée dans le nom des fichiers)*
- [ ] Le script écrit `archives/KB-Cumul-T4-2025_<horodatage>.json` + `.csv`
      **avant** toute suppression, puis demande de taper `VIDER`.
- [ ] Après le vidage, le script propose la **bascule du trimestre actif** :
      « Activer “KB-Cumul T4” comme trimestre courant (T4 2026) ? » →
      vérifier le trimestre ET l'année affichés, puis taper `BASCULER`.
      **C'est cette confirmation qui ferme les déclarations T3 et ouvre T4**
      (effective sur le portail en ≤ 5 minutes, cache mémoire des Functions).
- [ ] Ranger les deux fichiers d'archive dans l'emplacement prévu
      (`à confirmer : pratique d'archivage actuelle — SharePoint staff ?
      coffre ? autre ?`) puis les supprimer du poste local.
- [ ] ⚠ Vérifier que `archives/` figure dans `.gitignore`
      (données personnelles — ne JAMAIS commiter).

> Alternative sans suppression : `npm run sp:rotate -- T4 2025 --export-only`
> pour n'exporter que l'archive (aucun vidage, **aucune bascule**).
> Bascule seule (récupération, ou vidage fait autrement) :
> `npm run sp:rotate -- T4 --config-only [--annee=2026]`.
> L'archive JSON/CSV reste la sauvegarde « brute » ; la mémoire APPLICATIVE
> est la liste Soldes (étape A).

### B-bis. 🔴 POSER L'INDEX SUR LA LISTE QUI VIENT D'ÊTRE VIDÉE — FENÊTRE UNIQUE

> ⚠ **C'EST LE SEUL MOMENT DE L'ANNÉE OÙ C'EST POSSIBLE.** SharePoint refuse de
> créer un index sur une liste de **plus de 5 000 éléments**. À ~1 700-2 000
> déclarations/mois (§6.0 de l'état projet), la liste franchit ce seuil **au 3ᵉ
> mois du trimestre**. Une fois franchie, l'index est impossible jusqu'à la
> rotation SUIVANTE — et entretemps `/api/me` et `/api/declare` échouent pour
> les résidents (le header `HonorNonIndexedQueriesWarningMayFailRandomly` a été
> RETIRÉ le 13/7 : les requêtes non indexées échouent désormais franchement).

- [ ] Ouvrir la liste qui vient d'être vidée (ex. `KB-Cumul T4`) dans
      SharePoint → **Paramètres de la liste** → **Colonnes indexées**.
- [ ] Vérifier / créer l'index sur **`FedasilNumber`**.
- [ ] Si l'index existe déjà (cas normal — les listes du site de test ont été
      indexées le 13/7 et l'index SURVIT au vidage) : ne rien faire, simplement
      cocher.
- [ ] ⚠ **Sur une liste RECRÉÉE** (provisioning neuf) : `sharepoint-schema.json`
      porte `"indexed": true` sur `FedasilNumber` → `sp:provision` crée la
      colonne déjà indexée. Rien à faire non plus.

### C. Vérifications sur le portail (compte de test)

> ⏱ Attendre jusqu'à **5 minutes** après le `BASCULER` (durée du cache
> mémoire des Functions). Aucun redéploiement n'est nécessaire.

- [ ] Trimestre courant = T4, **vide**, les 3 mois (oct/nov/déc) en « + » ;
- [ ] « Voir le trimestre précédent » = T3 complet (lecture seule de fait) ;
- [ ] Déclarer un mois de test sur T4 → OK, puis corriger → OK ;
- [ ] (Optionnel) supprimer la ligne de test dans SharePoint **et** la ligne
      correspondante dans Soldes si une synchronisation a eu lieu entre-temps.

### D. Photographier dans Soldes le trimestre QUI VIENT DE SE CLÔTURER

Les déclarations de T3 sont désormais figées (la bascule a fermé la saisie) :

- [ ] `npm run sp:soldes -- T3 2026`
      *(« 2026 » = l'année du trimestre clôturé — attention au T4, clôturé
      en février de l'année SUIVANTE : `sp:soldes -- T4 2026` lancé en
      février 2027)*
- [ ] Récapitulatif attendu : autant de « créé(s) » que de lignes déclarées
      (ou des « inchangé » si des synchronisations intermédiaires ont eu lieu).
- [ ] Relancer la même commande : tout « inchangé » (preuve d'idempotence).

> **Pendant la période de recouvrement** (jusqu'au vidage de la liste, ~9
> mois plus tard), relancer `sp:soldes` sur ce trimestre après chaque mise à
> jour de `Paid` (lettrage, saisie manuelle) — candidat à l'automatisation
> Power Automate. Règle de vérité : ETAT-PROJET §5.20.

### E. (Optionnel, sans urgence) Aligner les variables de REPLI

Les variables `SP_CUMUL_LIST_NAME` / `SP_CUMUL_LIST_ID` /
`SP_CUMUL_PREV_LIST_NAME` **ne pilotent plus le portail** : elles ne servent
que si la liste Config devenait illisible (repli, journalisé `⚠ REPLI` dans
les logs des Functions). Un repli sur des valeurs périmées servirait un
ANCIEN trimestre : autant les garder à jour, **quand c'est commode** —
p. ex. groupées avec le prochain déploiement de code (rappel : modifier les
variables d'une SWA exige un redéploiement pour être pris en compte).

- [ ] Portail Azure → Static Web App `residentapp` → Configuration :
      `SP_CUMUL_LIST_NAME`, `SP_CUMUL_LIST_ID`, `SP_CUMUL_PREV_LIST_NAME`.
- [ ] Reporter les mêmes valeurs dans `api/local.settings.json` (dev).
      ⚠ JSON STRICT : valider avec
      `node -e "JSON.parse(require('fs').readFileSync('api/local.settings.json','utf8'))"`.
- [ ] Au prochain déploiement de code : GitHub → Actions → **le workflow le
      PLUS RÉCENT uniquement** → « Re-run all jobs ».

> NB dev local : les Functions locales lisent la MÊME liste Config (mêmes
> identifiants Graph) — le poste de dev bascule donc automatiquement, lui
> aussi.

### F. Vers le 15 : phase de contrôle (processus staff)

- [ ] Chiffres BCSS reçus → contrôle brut trimestre vs net déclaré (contrôle
      par exception, seuil d'écart) — les nets déclarés du trimestre clos se
      lisent désormais dans **Soldes** (filtre `Year` + `Quarter`) ;
- [ ] Suivi des impayés du trimestre clos : liste Soldes, filtre
      `PayStatus = Unpaid` ou `Partial` (+ `Year`/`Quarter`) — base du futur
      moteur de rappels (module 4 de l'app staff).

## 4. Points de vigilance

- **`BASCULER` ferme immédiatement l'ancien trimestre** (≤ 5 min sur le
  portail) : ne confirmer qu'à la date de bascule du calendrier §1, jamais
  « en avance pour préparer ».
- **Toujours VÉRIFIER le trimestre ET l'année affichés** dans l'invite
  `BASCULER` avant de confirmer (l'année est déduite de la date du jour ;
  `--annee=YYYY` pour forcer un cas particulier).
- **Les impayés survivent au vidage** — via la liste Soldes, À CONDITION que
  les étapes A et D aient été exécutées. La règle de vérité (ETAT-PROJET
  §5.20) : tant que la ligne KB-Cumul existe, elle est la source et
  `sp:soldes` resynchronise ; après vidage, **Soldes est la seule vérité**.
- **`sp:soldes` AVANT `sp:rotate`** : l'ordre A → B n'est pas négociable —
  une fois la liste vidée, il n'y a plus rien à synchroniser (seule l'archive
  JSON permettrait une reprise manuelle).
- **Ne jamais renommer ni supprimer les listes** : leurs ID sont câblés
  (liste Config + tableau §2) — c'est l'avantage du modèle.
- **Ne jamais éditer la ligne ActiveQuarter à la main dans SharePoint**, sauf
  urgence : passer par `sp:rotate --config-only` (qui écrit ID + nom + note
  de traçabilité de façon cohérente). En cas d'édition manuelle : `Quarter`
  1-4 et `Year` sont validés à la lecture ; une ligne invalide déclenche le
  repli variables d'environnement (journalisé).
- **L'archive JSON fait foi** (types fidèles) ; le CSV (séparateur `;`,
  encodage Excel) est un confort de consultation.
- Une **communication structurée** encode le mois mais pas l'année : un
  virement tardif arrivant après la bascule concerne un mois désormais dans
  Soldes (`Year` explicite) — imputation manuelle (processus cible §5.12 de
  la doc d'état).

## 5. En cas de problème

- **Le portail affiche toujours l'ancien trimestre > 5 min après BASCULER** →
  ouvrir la liste Config dans SharePoint et vérifier la ligne `ActiveQuarter`
  (Quarter/Year/CumulListId) ; consulter les logs Application Insights des
  Functions : la ligne `Trimestre actif : T… (source : Config)` doit
  apparaître — si `⚠ REPLI` apparaît, la ligne Config est absente ou
  invalide → `npm run sp:rotate -- T4 --config-only --annee=2026`.
- **« Liste Config INTROUVABLE » affiché par sp:rotate** → la rotation
  (archive + vidage) est FAITE, seule la bascule manque :
  `npm run sp:provision` puis
  `npm run sp:rotate -- T4 --config-only --annee=2026`.
- **Bascule confirmée par erreur / mauvais trimestre** → rejouer simplement
  `npm run sp:rotate -- T<bon> --config-only --annee=<bonne>` (upsert : la
  ligne est réécrite, effective en ≤ 5 min).
- Portail vide / erreurs après bascule → vérifier la ligne Config (faute
  dans l'ID si édition manuelle), puis les logs (`⚠ REPLI`, erreurs 400/403).
- `sp:rotate` ou `sp:soldes` échoue au jeton → secret Graph dans
  `api/local.settings.json` (et JSON strict : voir étape E).
- `sp:soldes` → erreur Graph 400 « Field '…' is not recognized » → le schéma
  a évolué mais la liste n'a pas suivi : lancer `npm run sp:provision`
  d'abord, puis relancer `sp:soldes` (reprise automatique, upsert).
- `sp:soldes` → « Liste « Soldes » introuvable » → `npm run sp:provision`.
- Suppression interrompue à mi-course → sans gravité : relancer
  `npm run sp:rotate -- T4` (l'archive de la première passe reste valable ;
  la seconde passe archive le reliquat puis achève le vidage).
- Synchronisation interrompue à mi-course → sans gravité : relancer
  `npm run sp:soldes` avec les mêmes arguments (upsert idempotent).
