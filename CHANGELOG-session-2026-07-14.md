# CHANGELOG — Session du 14 juillet 2026

**Thème : historique multi-trimestres pour le résident (chantier §10.0) — et
restauration d'une session de travail effacée par erreur la veille.**

Tout ce qui suit a été fait sur le **site de test** (`Resident_Test`).
Rien n'est répliqué en production Fedasil.

---

## 0. ⚠ L'INCIDENT : la session v6 avait été effacée par le commit `ac587a5`

**À lire en premier : c'est la leçon la plus importante de la journée.**

### Ce qui s'est passé

Le **13/7 au soir**, le commit `ac587a5` (« issues de secours sur les écrans
d'erreur — Réessayer + Changer de personne ») a livré un `Portail.tsx` **complet,
reconstruit sur une base antérieure au 12/7**. Bilan mesuré :

```
git show --stat ac587a5
 src/Portail.tsx | 1026 +++++-------------------------------------------------
 1 file changed, 164 insertions(+), 862 deletions(-)
```

Le fichier est passé de **~2 186 à 1 488 lignes**. **Cinq commits de la session
ergonomie du 12/7 (v6) ont été effacés** — pour ajouter deux boutons :

| SHA | Commit effacé |
|---|---|
| `c2cba7d` | aide fiche de paie, confirmation après déclaration, pictogrammes, bouton Réessayer |
| `75516c8` | statuts colorés (payé / acompte / échéance), tuile solde cliquable, **montant libre** |
| `f8e5d46` | pastille d'activation unique, bouton « Payer » intégré à la tuile du mois |
| `c3ad08d` | icônes d'état de paiement par mois dans la carte trimestre |
| `9190e89` | NN formaté à la volée, séparateurs acceptés, contrôle modulo 97 |

**Rien n'a cassé.** Le fichier compilait, se déployait, et les deux boutons
ajoutés fonctionnaient. C'est précisément ce qui rend l'incident dangereux : il
n'a produit **aucun signal**.

### Comment il a été détecté

En début de session, la comparaison entre `Portail.tsx` et la documentation a
montré un écart : le CHANGELOG du 12/7 décrivait du code (`useCoarsePointer`,
`paymentDeadline()`, clé localStorage `ra-activated-{oid}`) **introuvable dans le
fichier**.

⚠ **Le premier diagnostic était FAUX** : « la doc décrit du code absent, elle a
menti une 3ᵉ fois ». C'est l'inverse. **La doc était exacte — c'est le code qui
avait disparu.**

### Comment il a été récupéré (Git avait tout)

```bash
# 1) La chaîne est-elle dans le code actuel ?
git grep -n "useCoarsePointer" -- src/Portail.tsx          # → vide

# 2) Existe-t-elle dans l'HISTORIQUE ? (pickaxe : ajout ET suppression)
git log --oneline --all -S "useCoarsePointer" -- src/Portail.tsx
#   ac587a5  ← l'a SUPPRIMÉE (13/7 soir)
#   c2cba7d  ← l'avait AJOUTÉE (12/7)

# 3) Étendue exacte des dégâts (1 seul fichier ? lesquels ?)
git show --stat ac587a5

# 4) Extraire le dernier état SAIN
git show 9190e89:src/Portail.tsx > ~/Desktop/portail-v6.tsx
```

**`fedasil.css` n'était PAS touché** (« 1 file changed ») : le CSS de la v6 était
intact dans le dépôt. Vérifié par `git grep -n "pay-anchor" -- src/styles/fedasil.css`.

### Les règles qui en découlent

1. **Un fichier complet livré doit TOUJOURS partir du fichier réel, lu
   intégralement.** Jamais de reconstruction de mémoire, jamais sur la base de ce
   que la doc décrit.
2. **Le contrôle coûte 10 secondes** : avant de livrer, chercher dans le fichier
   réel **une chaîne caractéristique de la session précédente**. Ici,
   `Cmd+F "useCoarsePointer"` aurait sauvé cinq commits.
3. **Face à un écart doc ↔ code, `git log -S "<chaîne>"` tranche** — pas
   l'intuition, pas la mémoire.
4. Corollaire : `ETAT-PROJET-ResidentApp.md` est désormais mis à jour par
   **éditions ciblées**, jamais réécrit en entier. Un document de 1 300 lignes
   court le même risque qu'un fichier de code.

Ces règles sont inscrites dans **§11quater** de l'état projet et **dans le prompt
de relance (§12)**.

---

## 1. Chantier §10.0 — historique multi-trimestres (règle §5.22)

Le résident consulte désormais une **fenêtre glissante de 4 trimestres, courant
compris**.

**Deux sources, une raison chacune :**

| Trimestre | Source | Pourquoi |
|---|---|---|
| **Courant** | KB-Cumul (via `Config`) | C'est là qu'on **écrit** : fraîcheur immédiate. Lire Soldes ferait disparaître une déclaration jusqu'à la prochaine synchro. |
| **Antérieurs (3)** | Liste `Soldes` | **Mémoire permanente**, insensible aux rotations. Porte l'année explicitement. |

### Les 4 décisions (tranchées avant d'écrire une ligne de code)

**1. Pourquoi EXACTEMENT 4 trimestres.** Ce n'est pas de l'ergonomie, c'est une
**contrainte de lettrage** : la communication structurée encode le mois et le FA,
**mais pas l'année** (§5.12). Sur 4 trimestres glissants, chaque mois n'apparaît
**qu'une seule fois** → aucun paiement ambigu. Au 5ᵉ trimestre, avril 2025 et
avril 2026 porteraient la **même communication**.
👉 `HISTORY_QUARTERS` **ne pourra augmenter qu'une fois l'année réglée dans la
communication structurée**.

**2. Mois sans déclaration dans un trimestre clôturé** → affichés **en gris, non
cliquables** (pas de « + »). Ni rouge (un mois sans revenus n'est pas une faute),
ni silence (les masquer laisserait croire que la photo est complète).

**3. Paiement sur un trimestre clôturé** → **OUI**. `Soldes` conserve
`Contribution`, `Paid` et la **communication structurée d'origine** : le QR EPC
est reconstitué à l'identique. Le module « rappels » de l'app staff courra de
toute façon après ces impayés — autant laisser payer qui veut payer.

**4. Cadence `sp:soldes`** → **hebdomadaire au minimum** (§5.20.1). Sinon : un
résident paie sa dette d'avril en août, le lettrage écrit dans KB-Cumul T2, mais
le portail lit T2 dans Soldes → il continue d'afficher « impayé » et **invite à
payer une dette déjà réglée**.

### Implémentation

**`api/src/functions/Me.ts`**
- Paramètres `?quarter=<1-4>&year=<AAAA>` — le trimestre demandé **doit** être
  dans la fenêtre, sinon **400**. `?quarter=previous` conservé (alias de
  compatibilité).
- Réponse enrichie : `year`, `archived`, `quarters: [{quarter, year}]` — **la
  fenêtre est décidée par le SERVEUR** ; le frontend ne la calcule jamais.
- ⚠ **Lecture de Soldes : `$filter` sur le SEUL `FedasilNumber`** (indexée).
  Année et trimestre **sélectionnés EN CODE**. `Year` et `Quarter` sont pourtant
  indexées — mais chaque colonne ajoutée à un filtre est **un index de plus à ne
  pas oublier de poser sur le tenant Fedasil**, et un `$filter` composé de plus à
  voir tomber en 400. Volume dérisoire (~12 lignes/résident/an).
  **On supprime la dépendance à l'index plutôt que de la satisfaire.**
- **Pagination `@odata.nextLink`** ajoutée à `queryItems` : un résident accumule
  ~12 lignes Soldes par an → l'ancien `$top=50` aurait été dépassé dès la
  **5ᵉ année**, **tronquant silencieusement l'historique**.

**`src/Portail.tsx`**
- Le bouton « trimestre précédent » devient un **sélecteur de 4 pilules**
  (`T3 2026`, `T2 2026`…), avec **cache par trimestre ET par profil** (vidé à
  chaque changement de personne).
- Trimestre clôturé : bandeau explicatif, mois déclarés cliquables (pour payer),
  mois manquants inertes, **pas de bouton « Corriger »**.
- Si l'API ne renvoie pas `quarters` (déploiement partiel), le sélecteur disparaît
  → **dégradation propre**.

**`src/styles/fedasil.css`** : une seule classe ajoutée, `.quarter-switch`
(pilules, même vocabulaire visuel que `.lang-switch`). Ajout pur, en fin de
fichier.

---

## 2. Bugs trouvés et corrigés en cours de route

### 2.1 ⚠ BLOQUANT — un trimestre VIDE rendait toute déclaration impossible

`Portail.tsx` (avant) :

```tsx
{current.months.length === 0 ? <alerte/> : <>… <QuarterCard/> …</>}
```

Aucune déclaration dans le trimestre → **la carte du trimestre n'était pas
affichée** → **aucun mois cliquable** → **impossible de déclarer**. Et rien ne
débloquait la situation.

**Or une liste KB-Cumul est VIDE au lendemain de chaque rotation.** Le jour de la
première bascule réelle, **plus aucun résident n'aurait pu déclarer** — tous en
même temps.

Invisible sur le jeu de simulation : tous les résidents y ont des déclarations.

**Correctif** : la carte du trimestre est **toujours** affichée en vue courante,
avec un message d'invite (« Choisissez un mois ci-dessous pour déclarer vos
revenus »).

**Leçon** : un jeu de simulation « complet » **masque les états vides**. Tester
aussi : liste vide, trimestre vide, profil sans donnée.
`sp:rotate --config-only` reproduit exactement le lendemain d'une rotation.

### 2.2 `paymentDeadline()` DEVINAIT l'année

La fonction déduisait l'année à partir de la date du jour et du trimestre affiché.
Acceptable tant qu'on n'affichait que le trimestre courant — **faux dès qu'on
affiche un trimestre de l'an dernier** : échéances calculées sur la mauvaise
année, donc des mois marqués « échéance dépassée » à tort (ou l'inverse).

**Correctif** : l'année vient de l'API (`year`), avec repli sur l'ancienne
déduction si absente.

**Leçon** : quand une donnée nouvelle devient disponible, **chercher tous les
endroits qui la devinaient**. Une déduction implicite est une bombe à retardement
— elle n'explose que lorsque le contexte s'élargit.

---

## 3. Réapplication du seul apport réel de `ac587a5`

Après restauration de la v6, un seul élément du commit fautif méritait d'être
conservé : **« Changer de personne » dans les états `error` ET `nodata`**.

Sans lui, un compte **famille** dont UN profil échoue reste bloqué : la barre de
profil n'existe que dans l'état `ready`, le sélecteur « Qui êtes-vous ? » devient
inatteignable, et **seule la déconnexion reste possible**.

En revanche, le `showPrevious(force)` du même commit **n'avait pas lieu d'être** :
la v6 avait déjà la bonne structure (`loadPrevious()` séparé de `showPrevious()`),
qui évite structurellement le piège React de la closure. Elle a été conservée
telle quelle (`loadArchive()` / `showQuarter()`).

---

## 4. Reste ouvert

📌 **Automatiser `sp:soldes`** (§5.20.1) — nocturne, via Power Automate ou timer
trigger Azure Function. **C'est la seule dette laissée par cette session**, et
elle touche des données que le résident VOIT. En attendant : **lancement
hebdomadaire manuel**.

📌 **Tester systématiquement les états VIDES** (§11quater.3) — voir 2.1.

---

## Fichiers touchés

| Fichier | Changement |
|---|---|
| `src/Portail.tsx` | **restauration v6 (9190e89)** + « Changer de personne » (error/nodata) + sélecteur de 4 trimestres + correctif trimestre vide + `paymentDeadline(year)` — 1 488 → **2 441 lignes** |
| `api/src/functions/Me.ts` | fenêtre de 4 trimestres, lecture `Soldes`, réponse `year`/`archived`/`quarters`, pagination `@odata.nextLink` |
| `src/styles/fedasil.css` | ajout de `.quarter-switch` (fin de fichier) |
| `ETAT-PROJET-ResidentApp.md` | **v10** (§5.20.1, §5.22, §10, §11quater, prompt de relance §12) |

## SHA à retenir

| SHA | Rôle |
|---|---|
| `c2cba7d` | premier commit de la session v6 (12/7) |
| `9190e89` | **dernier état SAIN de `Portail.tsx`** avant l'écrasement |
| `ac587a5` | **le commit fautif** (13/7 soir) — 862 suppressions |
