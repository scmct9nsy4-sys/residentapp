# CHANGELOG — Session du 13 juillet 2026

**Thème : jeu de données de simulation, index SharePoint, fiabilité des requêtes.**

Tout ce qui suit a été fait sur le **site de test** (`Resident_Test`).
Rien n'est répliqué en production Fedasil.

---

## 1. Jeu de données de simulation (`npm run sp:seed`)

**Nouveau fichier :** `scripts/seed-simulation.ts` (+ entrée `sp:seed` dans
`package.json`).

Reconstruction d'une **année complète d'activité** (janvier 2025 → 20 mai 2026,
« aujourd'hui simulé ») sur les 7 listes :

| Liste | Contenu généré |
|---|---|
| Residents List | 1 845 résidents — prénoms/noms francophones remplaçant les `*****` ; **NN, FA, Email et EntraOid conservés** ; 12 arrivées fictives (`FA99…`) |
| KB-Cumul T1–T4 | ~14 800 déclarations (T3 = T3 2025 · T4 = T4 2025 · T1 = T1 2026 · T2 = avril 2026 à 85 %, mai non déclaré) |
| Soldes | **20 113 lignes** (janv. 2025 → mars 2026 ; T1-T2 2025 n'existent QUE là) |
| KB-Paiements | **7 456 virements** : ponctuels, fractionnés, communications libres (file de lettrage) + 6 anomalies |
| `simulation/` (local) | 5 CSV BCSS trimestriels + **clé de correction** (module 5) + rapport |

**Garanties :** les 2 008 lignes réelles de KB-Cumul T4 sont intactes (base
statistique et population de départ) · **point fixe vérifié** (`--dry-run` après
génération = 0 opération) · **purge chirurgicale** (`--purge`, triple marquage
`SIM` / `SIM-` / `FA99`).

### Bugs trouvés et corrigés en cours de route

| Version | Bug | Correctif |
|---|---|---|
| v2 | Jeton Graph non rafraîchi → 401 en échec définitif sur les runs longs (40 000+ écritures) | Rafraîchissement auto (~40 min) + 401 traité comme **reprise** |
| v2 | Compteur de progression trompeur (« 7409/7450 » alors que tout était écrit) | **Bilan exact en fin de phase** |
| v2 | Résidents `FA99` relus depuis Residents List → second profil parasite | Exclusion + dédoublonnage |
| **v3** | **Génération NON reproductible** : le NN fictif consommait 4 tirages du PRNG au 1er run ; au 2ᵉ run le NN existait (donc lu, non généré) → **tout le profil décalé** | **Flux `mulberry32` DÉDIÉ au NN** → vrai point fixe |
| v3 | Valeurs réelles à 3 décimales recopiées telles quelles dans Soldes | `round2` (même convention que `sp:soldes`) |

---

## 2. Index SharePoint — fiabilité, pas performance

**Fichier modifié :** `sharepoint-schema.json` (`"indexed": true`).
**Index posés manuellement** sur toutes les listes du site de test.

| Liste | Colonnes indexées | Pourquoi |
|---|---|---|
| Residents List | `EntraOid`, `FedasilNumber`, `Title` | `EntraOid` = **chemin critique du login** (`/api/me` résout l'identité par oid à CHAQUE connexion) |
| KB-Cumul T1–T4 | `FedasilNumber` | Déclarations d'UN résident |
| KB-Paiements | `Status`, `FedasilNumber` | `Status` = LA requête du module 3 (file de lettrage) |
| Soldes | (déjà indexées le 12/7) | — |

### ⚠ Deux règles absolues

1. **Un index ne peut être créé que sous 5 000 éléments.** Pour une KB-Cumul
   (qui franchit le seuil au 3ᵉ mois du trimestre), la seule fenêtre est
   **juste après la rotation, sur liste vide** → étape **B-bis** ajoutée à
   `PROCEDURE-BASCULE-TRIMESTRE.md`.
2. **En production : index AVANT déploiement du code.** Le header ayant été
   retiré (§3), l'ordre inverse casserait le portail **immédiatement** pour tous
   les résidents.

---

## 3. Retrait du header `HonorNonIndexedQueriesWarningMayFailRandomly`

**Fichiers modifiés :** `api/src/functions/Me.ts`, `api/src/functions/Declare.ts`
(fonction `queryItems`).

**Correction d'une erreur d'analyse** : `Me.ts` et `Declare.ts` utilisaient
**déjà** `$filter` — il n'y a jamais eu de fetch-all dans ces fonctions. Le seul
fetch-all du projet est dans `Subscription.ts` (liste Aidants, petite liste,
justifié).

Le vrai problème était le header `Prefer:
HonorNonIndexedQueriesWarningMayFailRandomly`, qui autorise le filtrage sur
colonne **non indexée** au prix d'un échec **aléatoire** au-delà de 5 000
éléments. À ~1 700-2 000 déclarations/mois, cela signifiait :
**`/api/me` et `/api/declare` se seraient mis à échouer au 3ᵉ mois de chaque
trimestre, quand les résidents déclarent le plus.** Panne de production évitée.

- Header **retiré** (les colonnes sont désormais indexées) ;
- **Diagnostic explicite ajouté** : sur un statut 400/403/503, le log indique
  désormais « CAUSE PROBABLE : colonne de filtre NON INDEXÉE sur une liste de
  plus de 5 000 éléments ».

**Fail fast plutôt que fail random.**

**Testé :** portail fonctionnel sur une KB-Cumul de ~4 900 lignes — preuve que
la requête filtrée passe au-delà du seuil grâce à l'index. Ce test n'était pas
possible avant la simulation.

---

## 4. Volume de référence établi

| | Valeur | Nature |
|---|---|---|
| **Observé** | ~1 700 déclarations/mois | FAIT (octobre 2025 réel) |
| **Dimensionnement** | **~2 000 déclarations/mois** | MARGE de sécurité |

→ KB-Cumul ≈ **6 000 lignes/trimestre** (franchit les 5 000 sans marge) ;
**KB-Paiements ≈ 24 000 lignes/an et NE TOURNE JAMAIS → premier candidat à la
migration SQL**, avant les KB-Cumul. Chiffres à reprendre dans la note
d'arbitrage à la hiérarchie.

---

## 5. Décisions d'architecture (cadrées, NON commencées)

### Chantier suivant — bascule automatique du trimestre (liste `Config`)

Le trimestre affiché est aujourd'hui figé dans `SP_CUMUL_LIST_NAME` /
`SP_CUMUL_LIST_ID`. ⚠ **Piège vérifié : l'ID est PRIORITAIRE sur le nom** —
changer le seul nom n'a aucun effet, sans message d'erreur.

**Option B retenue** : liste `Config` (trimestre actif + année) écrite par
`sp:rotate` **à la fin** de la rotation, lue par le code avec cache mémoire et
repli sur les variables d'environnement. La bascule métier devient la rotation
elle-même.

**Option A écartée** (déduire le trimestre de la date) : le code basculerait le
1ᵉʳ avril sur une liste contenant encore les données de l'an dernier, tant que la
rotation n'a pas tourné. *La bascule doit suivre la ROTATION, pas le CALENDRIER.*

### Ensuite — historique multi-trimestres résident (≥ 4 trimestres)

Trimestre **courant → KB-Cumul** (fraîcheur : c'est là qu'on écrit) ;
trimestres **antérieurs → Soldes** (permanence, indexée, insensible aux
rotations). Touche aussi `Portail.tsx` (sélecteur de trimestres) → chantier
volontairement **découpé** du précédent.

---

## Fichiers touchés

| Fichier | Action |
|---|---|
| `scripts/seed-simulation.ts` | **créé** (v3) |
| `package.json` | script `sp:seed` |
| `sharepoint-schema.json` | index (`"indexed": true`) + alerte croissance KB-Paiements |
| `api/src/functions/Me.ts` | retrait du header + diagnostic 5 000 |
| `api/src/functions/Declare.ts` | idem |
| `simulation/` | 5 CSV BCSS + clé de correction + rapport |
| `ETAT-PROJET-ResidentApp.md` | **v8** (§6.0, §6.1, §7.4, §10.0, §11bis, prompt de relance) |
| `PROCEDURE-BASCULE-TRIMESTRE.md` | étape **B-bis** (index sur liste vide) + piège `SP_CUMUL_LIST_ID` |
| `CONCEPTION-STAFF-APP.md` | fixtures BCSS (module 5) + journal des décisions |
