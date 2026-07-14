# PROCÉDURE — Bascule trimestrielle des listes KB-Cumul

**ResidentApp (Fedasil)** · document d'exploitation · à dérouler à chaque
clôture de trimestre. **Mise à jour du 14/7/2026 (v4) : `npm run sp:soldes --
--auto` ABSORBE la synchronisation** — la même commande, avant et après la
bascule, sans jamais taper une année. Elle a été validée par une **répétition
générale complète** sur le site de test (14/7 au soir). *(v3 du 13/7 : bascule
AUTOMATIQUE via la liste « Config » — les étapes « modifier les variables de la
Static Web App » et « redéployer » ont DISPARU. v2 du 12/7 : intégration de la
liste « Soldes ».)*

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
> des listes trimestrielles. **Depuis le 14/7, c'est aussi ce que le RÉSIDENT
> consulte** sur ses 3 trimestres antérieurs (§5.22) — une Soldes périmée est
> donc désormais visible du public, pas seulement du staff.

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

> 💡 **`sp:soldes --auto` n'a JAMAIS ce problème** : il déduit l'année de
> chacune des 4 listes depuis la ligne `ActiveQuarter` de Config
> (`q ≤ trimestre actif → année active`, sinon année précédente). Aucune année
> n'est jamais tapée à la main. Le piège de l'année ne subsiste donc que dans
> `sp:rotate`.

Exemple ci-dessous : **1er novembre 2026** — clôture de T3, ouverture de T4
(la liste T4 réutilisée contient encore les données de T4 **2025**).

## 2. Tableau de référence des listes

Relevé avec `npm run sp:provision` (qui affiche l'ID de chaque liste).
**Tenant de TEST (`Resident_Test`)** — à refaire sur le tenant Fedasil :

| Liste | ID (permanent, tenant de test) |
|---|---|
| KB-Cumul T1 | `462efd7c-9555-4601-b83f-cba677c57867` |
| KB-Cumul T2 | `cad4b15c-830a-4bdf-9e65-97b808a44787` |
| KB-Cumul T3 | `050b3e3e-7567-4dbd-8447-fff7cc7fc10d` |
| KB-Cumul T4 | `0894a6d7-55ff-4134-9b24-b489b8a998c9` |
| Soldes | `610bf274-1738-4323-af0a-8c108945a1d9` |
| Config | `bf254f87-7169-4db3-956b-4c6ae8658f51` |
| Residents List | `5f8da123-127d-4bfc-81e3-df9b972093b4` |
| ResidentApp Aidants | `de89feb8-b98d-45c6-a2b0-cc1ba2134e11` |
| KB-Paiements | `f3726038-c1ec-4414-8c65-23791c5f8563` |

> Depuis la bascule automatique, ce tableau sert surtout de **contrôle
> visuel** : c'est `sp:rotate` qui écrit l'ID de la liste courante dans
> Config, sans ressaisie manuelle.

## 3. Checklist de bascule (exemple : 1er novembre, T3 → T4)

### A. 🔴 SYNCHRONISER SOLDES — AVANT TOUTE DESTRUCTION

```bash
npm run sp:soldes -- --auto --dry-run    # prévisualiser
npm run sp:soldes -- --auto              # écrire
```

**Une seule commande couvre les DEUX besoins**, parce qu'elle traite les
4 listes :

1. la liste **qui va être vidée** (ici T4, données de l'an dernier) — des
   paiements tardifs ont pu mettre `Paid` à jour depuis la dernière
   synchronisation. Après le vidage, **il n'y aura plus rien à photographier** ;
2. le trimestre **qui va se clôturer** (ici T3, année en cours) — dès le
   `BASCULER`, le portail ira le lire dans **Soldes** et non plus dans
   KB-Cumul (§5.22). **S'il n'y est pas, le résident voit un trimestre VIDE :
   ni ses déclarations, ni son QR de paiement.**

> ⚠ **Le point 2 est né d'une faille réelle**, découverte pendant la répétition
> générale du 14/7 : la liste Soldes ne contenait **AUCUNE** ligne du trimestre
> courant (`1255 créé(s), 0 inchangé(s)`). Sans cette étape, la bascule aurait
> rendu invisible **100 %** du trimestre que les résidents venaient de déclarer.

- [ ] Récapitulatif attendu : essentiellement des « inchangé », plus les
      créations du trimestre courant s'il n'avait jamais été synchronisé.
      **Sur un système tenu à jour : `0 créé, 0 mis à jour`.**
- [ ] ⚠ Si la ligne `⚠ N ligne(s) rangée(s) dans la MAUVAISE liste
      trimestrielle` apparaît : **anomalie de données**, à investiguer avant de
      poursuivre (leur année dans Soldes est déduite de la liste, donc suspecte).

> Rejouable sans risque : upsert idempotent (`--dry-run` pour prévisualiser).
> Ne touche jamais aux colonnes qu'il ne possède pas (colonnes du futur moteur
> de rappels).

### B. Archiver + vider la liste réutilisée, puis BASCULER

- [ ] Vérifier d'abord que `archives/` figure dans `.gitignore`
      (données personnelles — ne JAMAIS commiter) : `grep -n archives .gitignore`
- [ ] Depuis la racine du dépôt (avec `api/local.settings.json` configuré) :
      `npm run sp:rotate -- T4 2025`
      *(« 2025 » = année des données archivées, utilisée dans le nom des fichiers)*
- [ ] Le script écrit `archives/KB-Cumul-T4-2025_<horodatage>.json` + `.csv`
      **avant** toute suppression. **Vérifier que les DEUX fichiers existent et
      ne sont pas vides AVANT de taper `VIDER`.**
- [ ] Taper `VIDER`. ⏱ Suppression élément par élément : compter **10-15 min
      pour ~4 000 lignes** (mesuré le 14/7).
- [ ] Après le vidage, le script propose la **bascule du trimestre actif** :
      « Activer “KB-Cumul T4” comme trimestre courant (T4 2026) ? » →
      **VÉRIFIER LE TRIMESTRE ET L'ANNÉE AFFICHÉS**, puis taper `BASCULER`.
      **C'est cette confirmation qui ferme les déclarations T3 et ouvre T4**
      (effective sur le portail en ≤ 5 minutes, cache mémoire des Functions).
      *Noter l'heure : les 5 minutes partent de là.*
- [ ] Ranger les deux fichiers d'archive dans l'emplacement prévu
      (`à confirmer : pratique d'archivage actuelle — SharePoint staff ?
      coffre ? autre ?`) puis les supprimer du poste local.

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
- [ ] Puis l'audit automatique : `npm run sp:provision`
      → **attendu : `0 création(s), 0 avertissement(s)`**. Toute colonne déclarée
      indexée dans `sharepoint-schema.json` qui ne l'est pas produit un ⚠.
      C'est cette sortie qui listera les index à poser sur le tenant Fedasil.
- [ ] ✅ **Vérifié le 14/7 : l'index SURVIT au vidage** (`KB-Cumul T3 →
      FedasilNumber (text, indexée)` sur liste vide). Sur les listes existantes,
      cette étape n'est donc qu'un contrôle. **Sur une liste RECRÉÉE**
      (provisioning neuf → tenant Fedasil), `sharepoint-schema.json` porte
      `"indexed": true` sur `FedasilNumber` : `sp:provision` crée la colonne
      déjà indexée.

### C. Vérifications sur le portail (compte de test)

> ⏱ Attendre jusqu'à **5 minutes** après le `BASCULER` (durée du cache
> mémoire des Functions). Aucun redéploiement n'est nécessaire.

- [ ] **Trimestre courant = T4, VIDE — mais la carte du trimestre S'AFFICHE**,
      les 3 mois (oct/nov/déc) en « + » et déclarables.
      *⚠ C'est LE contrôle : un bug (corrigé en v10) masquait la carte sur un
      trimestre vide — donc rendait toute déclaration impossible pour TOUS les
      résidents au lendemain de la bascule.*
- [ ] **Sélecteur de pilules** = les 4 trimestres de la fenêtre glissante
      (T4 2026 courant · T3 2026 · T2 2026 · T1 2026).
- [ ] **Trimestre fraîchement clôturé (T3)** : déclarations visibles, mois sans
      déclaration en gris non cliquables, **PAS de « + »**, **paiement possible**.
      *Si ce trimestre est VIDE : l'étape A n'a pas été faite → la refaire
      immédiatement (`npm run sp:soldes -- --auto`), effet en ≤ 5 min.*
- [ ] Déclarer un mois de test sur T4 → OK, puis corriger → OK.
      **⚠ Noter le FA et le mois : la ligne devra être supprimée.**
- [ ] Vérifier qu'on ne peut PAS déclarer sur un trimestre clôturé (aucun « + »).
- [ ] **Application Insights** → Journaux → requête :
      ```kusto
      traces
      | where timestamp > ago(1h)
      | where message contains "Trimestre actif" or message contains "REPLI"
      | project timestamp, message
      | order by timestamp desc
      ```
      **Attendu : `Trimestre actif : T4 2026 (liste « KB-Cumul T4 », source :
      Config).`** — et **AUCUN `⚠ REPLI`**. Un `⚠ REPLI` signifie que Config
      n'a pas été lue : le portail sert alors le trimestre des variables
      d'environnement, potentiellement périmé.
- [ ] Supprimer la ligne de test dans SharePoint **et** la ligne correspondante
      dans Soldes si une synchronisation a eu lieu entre-temps.

### D. Confirmer la photo du trimestre CLÔTURÉ

```bash
npm run sp:soldes -- --auto
```

**La même commande qu'à l'étape A.** Elle relit `Config` (désormais T4 2026) et
recalcule les années : le trimestre qui vient de se clôturer (T3, année en cours)
est resynchronisé, et la liste tout juste vidée (T4) est **ignorée sans erreur**
(« Liste vide : rien à synchroniser »).

- [ ] Récapitulatif attendu : **tout « inchangé »** (l'étape A avait déjà tout
      photographié). C'est la preuve d'idempotence — et le filet si l'étape A
      avait été oubliée.

> **Pendant la période de recouvrement** (jusqu'au vidage de la liste, ~13 mois
> plus tard), `sp:soldes --auto` doit tourner **au minimum une fois par semaine**
> (§5.20.1) : le lettrage met `Paid` à jour dans la KB-Cumul d'un trimestre clos,
> et le portail lit ce trimestre dans Soldes. Sans resynchronisation, on affiche
> « impayé » une dette réglée — et le futur moteur de rappels enverrait des mises
> en demeure pour rien. **Automatisation nocturne : chantier 2b.**

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

- **`sp:soldes --auto` AVANT `sp:rotate`** : l'ordre A → B n'est pas négociable.
  Une fois la liste vidée, il n'y a plus rien à synchroniser (seule l'archive
  JSON permettrait une reprise manuelle). Et le trimestre qui se clôture doit
  être dans Soldes AVANT le `BASCULER`, sans quoi le résident le voit vide.
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
  la doc d'état). ⚠ **C'est aussi ce qui plafonne la fenêtre du résident à
  4 trimestres** (`HISTORY_QUARTERS`, §5.22) : au 5ᵉ, deux mois d'avril
  porteraient la même communication.

## 5. En cas de problème

- **Le trimestre fraîchement clôturé apparaît VIDE sur le portail** → l'étape A
  a été oubliée : `npm run sp:soldes -- --auto` (effet en ≤ 5 min, le portail
  relit Soldes).
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
- **`sp:soldes --auto` échoue sur « Liste Config introuvable / ligne
  ActiveQuarter absente »** → contrairement à l'API (qui se replie sur les
  variables d'environnement), le traitement par lot **échoue franchement** :
  se tromper de trimestre en silence sur 15 000 lignes serait pire que ne rien
  faire. → `npm run sp:provision` puis `sp:rotate -- T<n> --config-only`.
- **`sp:soldes` → « La liste Soldes n'a pas les colonnes attendues »** → le
  schéma a évolué mais la liste n'a pas suivi : `npm run sp:provision`, puis
  relancer (upsert : rien n'est perdu). *Le contrôle a lieu AVANT toute
  écriture — plus de Graph 400 « Field not recognized » en cours de route.*
- **`sp:rotate` ou `sp:soldes` échoue au jeton** → secret Graph dans
  `api/local.settings.json` (et JSON strict : voir étape E). *NB :
  `sp:soldes` rafraîchit désormais son jeton tout seul en cours d'exécution —
  une exécution longue (~15 000 lignes) ne peut plus expirer en route.*
- **Suppression interrompue à mi-course** → sans gravité : relancer
  `npm run sp:rotate -- T4` (l'archive de la première passe reste valable ;
  la seconde passe archive le reliquat puis achève le vidage).
- **Synchronisation interrompue à mi-course** → sans gravité : relancer
  `npm run sp:soldes -- --auto` (upsert idempotent).

## 6. Répétition générale (obligatoire AVANT la première bascule réelle)

✅ **Faite le 14/7/2026 sur le site de test** (T2 2026 → T3 2026, puis retour).
À REFAIRE sur le tenant Fedasil avant la première bascule réelle.

Déroulé validé, avec les chiffres constatés :

| Étape | Commande | Résultat observé |
|---|---|---|
| A | `sp:soldes -- T3 2025` | `0 créé, 0 mis à jour, 4201 inchangé` → **point fixe : Soldes est l'image exacte de KB-Cumul** |
| A-bis | `sp:soldes -- T2 2026` | **`1255 créé, 0 inchangé`** → 🔴 le trimestre courant n'était PAS dans Soldes *(la raison d'être de l'étape A actuelle)* |
| B | `sp:rotate -- T3 2025` | archive JSON+CSV, `VIDER` (4 201 suppressions, ~12 min), `BASCULER` → T3 2026 |
| B-bis | `sp:provision` | `0 création(s), 0 avertissement(s)` → **l'index a survécu au vidage** |
| C | portail | trimestre vide déclarable ✅ · 4 pilules ✅ · T2 2026 payable non déclarable ✅ · `source : Config` ✅ |
| D | `sp:soldes -- T2 2026 --dry-run` | tout inchangé → idempotence |
| E | `sp:rotate -- T2 --config-only --annee=2026` + `sp:seed` | retour à l'état initial |
| Contrôle | `sp:soldes -- --auto --dry-run` | **`0 créé, 0 mis à jour, 14 799 inchangé`** sur les 4 listes → point fixe global |

⚠ **La répétition CONSOMME les données de simulation** du trimestre vidé
(regénérables par `npm run sp:seed`). Supprimer la déclaration de test **AVANT**
de rejouer le seed : les mois 7-9 appartiennent à la fois à T3 2025 et T3 2026 —
une fois la simulation restaurée, la ligne de test devient indistinguable.

> **Depuis la v4, les étapes A et A-bis ci-dessus sont remplacées par une seule
> commande : `npm run sp:soldes -- --auto`.**
