# PROCÉDURE — Bascule trimestrielle des listes KB-Cumul

**ResidentApp (Fedasil)** · document d'exploitation · à dérouler à chaque
clôture de trimestre.

> **Principe.** L'application repose sur 4 listes SharePoint **permanentes**
> (KB-Cumul T1..T4) aux **ID fixes**, réutilisées chaque année : à la bascule,
> la liste du trimestre réutilisé est **archivée puis vidée**, jamais recréée.
> Le « trimestre courant » de l'application n'est PAS le trimestre calendaire :
> c'est le **trimestre en cours de déclaration**, et la bascule des variables
> d'environnement ci-dessous **EST** la clôture métier.

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

## 2. Tableau de référence des 4 listes (à compléter UNE FOIS)

Relever les ID avec `npm run sp:inspect` (colonne `id`) et les consigner ici :

| Liste | ID (permanent) |
|---|---|
| KB-Cumul T1 | `à compléter` |
| KB-Cumul T2 | `à compléter` |
| KB-Cumul T3 | `à compléter` |
| KB-Cumul T4 | `à compléter` |

## 3. Checklist de bascule (exemple : 1er novembre, T3 → T4)

### A. Archiver + vider la liste réutilisée (T4, données de l'an dernier)

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

### B. Basculer les variables de la Static Web App (portail Azure)

Portail Azure → Static Web App `residentapp` → Configuration :

- [ ] `SP_CUMUL_LIST_NAME` → `KB-Cumul T4`
- [ ] `SP_CUMUL_LIST_ID` → ID de T4 (tableau §2)
- [ ] `SP_CUMUL_PREV_LIST_NAME` → `KB-Cumul T3`
- [ ] Enregistrer.

> Rappel : c'est cette bascule qui ferme les déclarations T3 et ouvre T4
> (`Declare.ts` déduit les mois autorisés du nom de la liste courante).

### C. Redéployer (variables d'env ⇒ redéploiement obligatoire)

- [ ] GitHub → Actions → **le workflow le PLUS RÉCENT uniquement** →
      « Re-run all jobs ». *(Ne jamais re-run un ancien workflow : il
      redéploierait du code périmé.)*

### D. Vérifications sur le portail (compte de test)

- [ ] Trimestre courant = T4, **vide**, les 3 mois (oct/nov/déc) en « + » ;
- [ ] « Voir le trimestre précédent » = T3 complet (lecture seule de fait) ;
- [ ] Déclarer un mois de test sur T4 → OK, puis corriger → OK ;
- [ ] (Optionnel) supprimer la ligne de test dans SharePoint.

### E. Mettre à jour l'environnement local (dev)

- [ ] Reporter les 3 mêmes variables dans `api/local.settings.json`.

### F. Vers le 15 : phase de contrôle (processus staff, hors application)

- [ ] Chiffres BCSS reçus → contrôle brut trimestre vs net déclaré sur la
      liste T3 (contrôle par exception, seuil d'écart) ;
- [ ] Suivi des impayés de T3 : `à confirmer / chantier « Soldes »` — voir §4.

## 4. Points de vigilance

- **Les impayés disparaissent du portail au vidage.** Quand T4 est vidée pour
  réutilisation, les dettes éventuelles de l'ancien T4 ne survivent que dans
  l'archive, que l'application ne lit pas. Le processus de rappels doit donc
  s'appuyer sur les archives **tant que la liste « Soldes » n'existe pas**
  (chantier consigné dans ETAT-PROJET §10).
- **Ne jamais renommer ni supprimer les 4 listes** : leurs ID sont câblés
  dans la configuration (tableau §2) — c'est l'avantage du modèle.
- **L'archive JSON fait foi** (types fidèles) ; le CSV (séparateur `;`,
  encodage Excel) est un confort de consultation.
- Une **communication structurée** encode le mois mais pas l'année : un
  virement tardif arrivant après la bascule concerne l'archive — imputation
  manuelle (processus cible §5.12 de la doc d'état).

## 5. En cas de problème

- Portail vide / erreurs après bascule → vérifier les 3 variables (faute de
  frappe dans le nom ou l'ID), puis re-run du dernier workflow.
- `sp:rotate` échoue au jeton → secret Graph dans `api/local.settings.json`.
- Suppression interrompue à mi-course → sans gravité : relancer
  `npm run sp:rotate -- T4` (l'archive de la première passe reste valable ;
  la seconde passe archive le reliquat puis achève le vidage).
