# soldes-timer — synchronisation nocturne KB-Cumul → Soldes

Chantier **2b** (§5.20.1). Function App autonome à déclencheur **timer** qui
lance `syncAuto()` — le **même** code que `npm run sp:soldes -- --auto`. Aucune
règle métier ici : tout vit dans `scripts/lib/soldes-sync.ts`, importé tel quel.

> Ce dossier est un **projet Azure Functions séparé** de la SWA. Il vit dans le
> dépôt `residentapp` uniquement pour importer la lib par chemin relatif. Le
> workflow GitHub de la SWA ne le touche pas ; il se déploie **à la main**
> (extension VS Code), et le **secret Graph ne va jamais chez GitHub** (§10.11).

---

## 1. Ce que fait la Function

Chaque nuit à **01:30 UTC** (= 02:30 hiver / 03:30 été en Belgique), elle :

1. lit le trimestre actif dans la liste **`Config`** (même source que le portail) ;
2. en déduit l'année des 4 listes KB-Cumul (aucune année codée en dur) ;
3. resynchronise Soldes (upsert par `Title`) — création, mise à jour, ou
   inchangé.

Idempotent : rejouable à volonté. Un timer **ne rejoue pas** après un échec —
ce n'est pas grave, la nuit suivante resynchronise tout.

`SOLDES_DRY_RUN=true` → lecture seule, **aucune écriture** (à poser avant le
tout premier lancement en Azure).

---

## 2. Build (obligatoire avant tout déploiement)

Depuis `soldes-timer/` :

```bash
npm install
npm run typecheck   # vérifie les types (aucune erreur attendue)
npm run build       # esbuild -> dist/soldesNightly.js (lib inline)
```

`dist/soldesNightly.js` est **autonome** : la lib y est inlinée. Seul
`@azure/functions` reste externe (fourni par la plateforme / node_modules).

---

## 3. Déploiement Azure (extension VS Code « Azure Functions »)

Prérequis côté Azure (voir le pas-à-pas de la conversation) : Function App
**Flex Consumption**, Node 20, App Insights activé, et les App Settings :

| App Setting | Valeur |
|---|---|
| `TENANT_ID` | `610bf274-1738-4323-af0a-8c108945a1d9` (site de test) |
| `GRAPH_CLIENT_ID` | identique à `api/local.settings.json` |
| `GRAPH_CLIENT_SECRET` | identique à `api/local.settings.json` |
| `SP_SITE_HOSTNAME` | `giapplab.sharepoint.com` |
| `SP_SITE_PATH` | `sites/Resident_Test` |
| `SOLDES_DRY_RUN` | `true` **pour le premier run**, puis à retirer |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` (on déploie le bundle prêt) |

Déploiement : clic droit sur le dossier `soldes-timer` → **Deploy to Function
App…** → choisir l'app. On envoie `dist/` + `host.json` + `package.json` +
`node_modules/` (prod) ; la plateforme **ne rebuild pas** (d'où
`SCM_DO_BUILD_DURING_DEPLOYMENT=false` : elle ne peut de toute façon pas
recompiler, la lib est hors du dossier).

> Pour peupler `node_modules/` en prod avant déploiement :
> `npm install --omit=dev` (n'installe que `@azure/functions`).

---

## 4. Validation (déclenchement à la demande)

Le timer ne se déclenche que la nuit — pour tester tout de suite, on l'invoque
via l'endpoint d'admin avec la clé maître (Portail → Function App → **App keys**
→ `_master`) :

```bash
curl -X POST \
  "https://<NOM-DE-L-APP>.azurewebsites.net/admin/functions/soldesNightly" \
  -H "x-functions-key: <CLE-MASTER>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Puis observer les logs : Portail → Function App → **Application Insights** →
*Logs* (table `traces`) ou *Live Metrics* pendant l'appel. On doit voir le
récapitulatif `formatSummary` (`… créé(s), … mis à jour, … inchangé(s)`).

**Séquence recommandée :**
1. `SOLDES_DRY_RUN=true` → déclencher → vérifier un résumé cohérent, **0
   écriture**. Prouve la connexion Graph + le chemin de lecture.
2. Retirer `SOLDES_DRY_RUN` (ou `false`) → **Restart** de l'app → déclencher →
   vérifier les écritures réelles (comparable au `npm run sp:soldes -- --auto`).
3. Laisser tourner la nuit ; vérifier une exécution planifiée le lendemain
   (table `requests`/`traces`, ou onglet *Invocations* de la Function).

---

## 5. Développement local (optionnel)

1. `cp local.settings.json.example local.settings.json` puis remplir le secret.
2. Un stockage est requis pour l'état du timer : soit **Azurite**
   (`npm i -g azurite` puis `azurite` dans un terminal, `AzureWebJobsStorage` =
   `UseDevelopmentStorage=true`), soit pointer `AzureWebJobsStorage` sur une
   vraie chaîne de connexion.
3. `npm run start` (build + `func start`). Nécessite Azure Functions Core Tools
   v4 (`npm i -g azure-functions-core-tools@4`).
4. La validation la plus simple reste toutefois le déclenchement **en Azure**
   (§4) : pas d'Azurite à gérer.

---

## 6. Vers la production Fedasil

- Le secret en App Settings est bon pour le prototype. Durcissement prévu :
  **managed identity** (§10.4) — la logique de `soldes-sync.ts` ne change pas,
  seul `createGraphClient` gagnerait un mode « assertion » côté lib.
- La **chaîne de déploiement autorisée** par Fedasil et l'**ordonnanceur** sont
  la question ouverte §10.11 : ce prototype sert justement de démonstrateur
  concret pour cette discussion.
- Tant que l'automate n'est pas en place sur le tenant Fedasil : **lancement
  hebdomadaire manuel** de `npm run sp:soldes -- --auto` (§5.20.1).
