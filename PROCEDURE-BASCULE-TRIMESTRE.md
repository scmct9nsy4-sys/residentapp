# PROCÉDURE — Bascule trimestrielle des listes KB-Cumul

**ResidentApp (Fedasil)** · document d'exploitation · à dérouler à chaque
clôture de trimestre. **Mise à jour du 12/7/2026 : intégration de la liste
« Soldes »** (mémoire permanente des soldes mensuels — ETAT-PROJET §5.20).

> **Principe.** L'application repose sur 4 listes SharePoint **permanentes**
> (KB-Cumul T1..T4) aux **ID fixes**, réutilisées chaque année : à la bascule,
> la liste du trimestre réutilisé est **archivée puis vidée**, jamais recréée.
> Le « trimestre courant » de l'application n'est PAS le trimestre calendaire :
> c'est le **trimestre en cours de déclaration**, et la bascule des variables
> d'environnement ci-dessous **EST** la clôture métier.
> Depuis le 12/7/2026, la liste permanente **« Soldes »** conserve la photo
> mensuelle de tous les trimestres clos : les impayés **survivent** désormais
> au vidage des listes trimestrielles.

---

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

Exemple ci-dessous : **1er novembre** — clôture de T3, ouverture de T4
(la liste T4 réutilisée contient encore les données de T4 de l'an passé).

## 2. Tableau de référence des listes (à compléter UNE FOIS)

Relever les ID avec `npm run sp:inspect` (colonne `id`) et les consigner ici :

| Liste | ID (permanent) |
|---|---|
| KB-Cumul T1 | `à compléter` |
| KB-Cumul T2 | `à compléter` |
| KB-Cumul T3 | `à compléter` |
| KB-Cumul T4 | `à compléter` |
| Soldes | `à compléter` *(tenant de test : `610bf274-1738-4323-af0a-8c108945a1d9`)* |

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

### B. Archiver + vider la liste réutilisée (T4, données de l'an dernier)

- [ ] Depuis la racine du dépôt (avec `api/local.settings.json` configuré) :
      `npm run sp:rotate -- T4 2025`
      *(« 2025 » = année des données archivées, utilisée dans le nom des fichiers)*
- [ ] Le script écrit `archives/KB-Cumul-T4-2025_<horodatage>.json` + `.csv`
      **avant** toute suppression, puis demande de taper `VIDER`.
- [ ] Ranger les deux fichiers d'archive dans l'emplacement prévu
      (`à confirmer : pratique d'archivage actuelle — SharePoint staff ?
      coffre ? autre ?`) puis les supprimer du poste local.
- [ ] ⚠ Vérifier que `archives/` figure dans `.gitignore`
      (données personnelles — ne JAMAIS commiter).

> Alternative sans suppression : `npm run sp:rotate -- T4 2025 --export-only`
> pour n'exporter que l'archive (vidage manuel ensuite).
> L'archive JSON/CSV reste la sauvegarde « brute » ; la mémoire APPLICATIVE
> est la liste Soldes (étape A).

### C. Basculer les variables de la Static Web App (portail Azure)

Portail Azure → Static Web App `residentapp` → Configuration :

- [ ] `SP_CUMUL_LIST_NAME` → `KB-Cumul T4`
- [ ] `SP_CUMUL_LIST_ID` → ID de T4 (tableau §2)
- [ ] `SP_CUMUL_PREV_LIST_NAME` → `KB-Cumul T3`
- [ ] Enregistrer.

> Rappel : c'est cette bascule qui ferme les déclarations T3 et ouvre T4
> (`Declare.ts` déduit les mois autorisés du nom de la liste courante).

### D. Redéployer (variables d'env ⇒ redéploiement obligatoire)

- [ ] GitHub → Actions → **le workflow le PLUS RÉCENT uniquement** →
      « Re-run all jobs ». *(Ne jamais re-run un ancien workflow : il
      redéploierait du code périmé.)*

### E. Photographier dans Soldes le trimestre QUI VIENT DE SE CLÔTURER

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

### F. Vérifications sur le portail (compte de test)

- [ ] Trimestre courant = T4, **vide**, les 3 mois (oct/nov/déc) en « + » ;
- [ ] « Voir le trimestre précédent » = T3 complet (lecture seule de fait) ;
- [ ] Déclarer un mois de test sur T4 → OK, puis corriger → OK ;
- [ ] (Optionnel) supprimer la ligne de test dans SharePoint **et** la ligne
      correspondante dans Soldes si une synchronisation a eu lieu entre-temps.

### G. Mettre à jour l'environnement local (dev)

- [ ] Reporter les 3 mêmes variables dans `api/local.settings.json`.
      ⚠ JSON STRICT : valider avec
      `node -e "JSON.parse(require('fs').readFileSync('api/local.settings.json','utf8'))"`.

### H. Vers le 15 : phase de contrôle (processus staff)

- [ ] Chiffres BCSS reçus → contrôle brut trimestre vs net déclaré (contrôle
      par exception, seuil d'écart) — les nets déclarés du trimestre clos se
      lisent désormais dans **Soldes** (filtre `Year` + `Quarter`) ;
- [ ] Suivi des impayés du trimestre clos : liste Soldes, filtre
      `PayStatus = Unpaid` ou `Partial` (+ `Year`/`Quarter`) — base du futur
      moteur de rappels (module 4 de l'app staff).

## 4. Points de vigilance

- **Les impayés survivent désormais au vidage** — via la liste Soldes,
  À CONDITION que les étapes A et E aient été exécutées. La règle de vérité
  (ETAT-PROJET §5.20) : tant que la ligne KB-Cumul existe, elle est la source
  et `sp:soldes` resynchronise ; après vidage, **Soldes est la seule vérité**.
- **`sp:soldes` AVANT `sp:rotate`** : l'ordre A → B n'est pas négociable —
  une fois la liste vidée, il n'y a plus rien à synchroniser (seule l'archive
  JSON permettrait une reprise manuelle).
- **Ne jamais renommer ni supprimer les listes** : leurs ID sont câblés
  dans la configuration (tableau §2) — c'est l'avantage du modèle.
- **L'archive JSON fait foi** (types fidèles) ; le CSV (séparateur `;`,
  encodage Excel) est un confort de consultation.
- Une **communication structurée** encode le mois mais pas l'année : un
  virement tardif arrivant après la bascule concerne un mois désormais dans
  Soldes (`Year` explicite) — imputation manuelle (processus cible §5.12 de
  la doc d'état).

## 5. En cas de problème

- Portail vide / erreurs après bascule → vérifier les 3 variables (faute de
  frappe dans le nom ou l'ID), puis re-run du dernier workflow.
- `sp:rotate` ou `sp:soldes` échoue au jeton → secret Graph dans
  `api/local.settings.json` (et JSON strict : voir étape G).
- `sp:soldes` → erreur Graph 400 « Field '…' is not recognized » → le schéma
  a évolué mais la liste n'a pas suivi : lancer `npm run sp:provision`
  d'abord, puis relancer `sp:soldes` (reprise automatique, upsert).
- `sp:soldes` → « Liste « Soldes » introuvable » → `npm run sp:provision`.
- Suppression interrompue à mi-course → sans gravité : relancer
  `npm run sp:rotate -- T4` (l'archive de la première passe reste valable ;
  la seconde passe archive le reliquat puis achève le vidage).
- Synchronisation interrompue à mi-course → sans gravité : relancer
  `npm run sp:soldes` avec les mêmes arguments (upsert idempotent).
