# soldes-timer — synchronisation nocturne KB-Cumul → Soldes

Chantier **2b** (§5.20.1). Function App autonome à déclencheur **timer** qui lance
`syncAuto()` — le **même** code que `npm run sp:soldes -- --auto`. Aucune règle
métier ici : tout vit dans `scripts/lib/soldes-sync.ts`, importé tel quel.

**Statut : déployé et validé en production (tenant de test) le 16/07/2026.**
Point fixe global de 14 799 lignes reproduit à l'identique depuis Azure — mêmes
règles que la CLI locale (§7 vérifié en conditions réelles).

> Ce document est la **procédure de reconstruction de A à Z**. Il a été écrit
> après un déploiement laborieux : les pièges rencontrés sont consignés au §9,
> lis-les avant de recommencer ailleurs (réplication Fedasil notamment).

---

## 1. Ce que fait la Function

Chaque nuit à **01:30 UTC** (= 02:30 hiver / 03:30 été en Belgique), elle :

1. lit le trimestre actif dans la liste **`Config`** (même source que le portail) ;
2. en déduit l'année des 4 listes KB-Cumul (aucune année codée en dur) ;
3. resynchronise Soldes (upsert par `Title`) — création, mise à jour, ou inchangé.

Idempotent : rejouable à volonté. Un timer **ne rejoue pas** après un échec — ce
n'est pas grave, la nuit suivante resynchronise tout. Durée observée : ~45-50 s
pour ~14 800 lignes, très confortable sous le timeout de 10 min.

`SOLDES_DRY_RUN=true` → lecture seule, **aucune écriture**. Conservé (=false) en
production comme interrupteur de test réutilisable.

---

## 2. Architecture (et pourquoi elle est ainsi)

- **Dossier séparé de `api/`** : les Functions managées d'une Static Web App ne
  supportent QUE les déclencheurs HTTP. Un timer exige une Function App distincte.
- **Vit dans le dépôt `residentapp`** (pas un dépôt séparé) uniquement pour
  importer `scripts/lib/soldes-sync.ts` **par chemin relatif** — une seule
  définition des règles (§7), aucune dérive possible avec la CLI.
- **Bundle esbuild** : une Function déployée ne voit que son propre dossier, or la
  lib est un cran plus haut (`../scripts`). esbuild l'inline dans un seul fichier
  `dist/soldesNightly.js` autonome au moment du build local. Azure ne reçoit qu'un
  artefact self-contained (~17 kb). `@azure/functions` reste fourni par la
  plateforme (marqué externe).

Chemin d'import dans `src/functions/soldesNightly.ts` :
`../../../scripts/lib/soldes-sync` (3 crans jusqu'à la racine du dépôt). Si le
dossier est déplacé, ce chemin est à réajuster.

---

## 3. Coordonnées du déploiement de référence (tenant de test)

| Élément | Valeur |
|---|---|
| Function App | `residentapp-soldes-timer` |
| Domaine | `residentapp-soldes-timer-e0ephsbpejbkdnf9.francecentral-01.azurewebsites.net` |
| Groupe de ressources | `residentapp` |
| Région | **France Central** (⚠ voir §9 — PAS Belgium Central) |
| Plan | **Flex Consumption** (Consommation flexible) |
| Runtime | **Node.js 22**, Linux |
| Abonnement | Abonnement Azure 1 |
| App Insights | `soldes_timer_insight` (même région que l'app) |

---

## 4. Prérequis outils (Mac ARM, Homebrew `/opt/homebrew`)

```bash
node --version    # 20 ou 22
func --version    # Azure Functions Core Tools 4.x  (brew tap azure/functions && brew install azure-functions-core-tools@4)
az --version      # Azure CLI  — REQUIS par func pour l'authentification  (brew install azure-cli)
```

> `func` s'appuie sur `az` pour s'authentifier. Sans `az` connecté, la
> publication échoue avec *« Unable to connect to Azure »*.

---

## 5. Build local (obligatoire avant toute publication)

Depuis `soldes-timer/` :

```bash
npm install
npm run typecheck      # aucune erreur attendue
npm run build          # esbuild -> dist/soldesNightly.js (lib inline)
npm install --omit=dev # node_modules réduit à @azure/functions (prod)
```

`--target=node20` dans le build produit du JS compatible « Node 20 et au-delà » :
tourne sans souci sur le runtime Node 22 d'Azure. La version de Node utilisée pour
lancer le build n'a pas d'incidence sur le résultat.

---

## 6. Création de la Function App (portail Azure)

Recréation depuis zéro, via **portal.azure.com** (l'extension VS Code n'est pas
fiable ici, cf §9) :

1. Rechercher **Function App** → **+ Create**.
2. Type d'hébergement : **Flex Consumption**.
3. Bases : groupe de ressources `residentapp` ; nom `residentapp-soldes-timer` ;
   région **France Central** ; runtime **Node.js 22 LTS**.
4. Supervision : **Application Insights = activé** (même région que l'app pour
   éviter l'avertissement de résidence).
5. Review + create → Create.

---

## 7. Variables d'environnement (App Settings)

Portail → Function App → **Paramètres** → **Variables d'environnement** →
**Paramètres d'application**. Les 3 premières sont créées automatiquement à la
fabrication de l'app (ne pas y toucher). Ajouter les 6 suivantes :

| Nom | Valeur | Source |
|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | *(auto)* | Azure |
| `AzureWebJobsStorage` | *(auto)* | Azure |
| `DEPLOYMENT_STORAGE_CONNECTION_STRING` | *(auto)* | Azure |
| `TENANT_ID` | **⚠ valeur lue dans `api/local.settings.json`** | api/local.settings.json |
| `GRAPH_CLIENT_ID` | *(idem api/local.settings.json)* | api/local.settings.json |
| `GRAPH_CLIENT_SECRET` | *(idem api/local.settings.json)* | api/local.settings.json |
| `SP_SITE_HOSTNAME` | `giapplab.sharepoint.com` | api/local.settings.json |
| `SP_SITE_PATH` | `sites/Resident_Test` | api/local.settings.json |
| `SOLDES_DRY_RUN` | `true` au 1er lancement, puis `false` | — |

> **⚠ TENANT_ID** : la source de vérité est `api/local.settings.json`, PAS une
> valeur mémorisée ailleurs. L'ancienne note `610bf274-…` était erronée.
>
> **⚠ NE JAMAIS poser `SCM_DO_BUILD_DURING_DEPLOYMENT` ni `ENABLE_ORYX_BUILD`** :
> interdits sur le SKU Flex, ils font rejeter le déploiement (cf §9).

---

## 8. Déploiement — MÉTHODE RETENUE : ligne de commande

L'extension VS Code échoue sur Flex (§9). La méthode fiable est `func` en CLI.

```bash
# 1. Installer et connecter Azure CLI (une seule fois)
brew install azure-cli
az login                     # navigateur ; vérifier le bon abonnement

# 2. Publier (depuis soldes-timer/, après le build du §5)
cd soldes-timer
func azure functionapp publish residentapp-soldes-timer --no-build --javascript
```

Détail des drapeaux :
- `--no-build` : envoie le bundle **tel quel**, sans recompilation distante (Oryx)
  — indispensable, car la source de la lib (`../scripts`) n'est pas dans le paquet.
- `--javascript` : `func` ne peut pas deviner le langage (bundle déjà compilé, pas
  de `.ts` à la racine) ; on lui indique JavaScript, cohérent avec `--no-build`.

Succès attendu en fin de sortie : le pipeline Kudu déroule
`OryxBuildStep : Skipping (remotebuild = false)` puis `SyncTriggerStep : completed`.

Vérifier ensuite : portail → Function App → **Fonctions** → `soldesNightly`
(déclencheur *Minuteur*, état *Activé*). L'indexation prend 30-60 s.

---

## 9. Pièges rencontrés (à lire avant toute nouvelle tentative)

| Symptôme | Cause | Correctif |
|---|---|---|
| Déploiement échoue, `location: Belgium Central` | **Flex Consumption indisponible en Belgium Central** | Région **France Central** (ou West Europe). La résidence Belgique = décision production, plan autre que Flex à l'époque. |
| `Deploying "api" instead of selected folder "soldes-timer"` puis `No azure function project root could be found` | Deux projets Functions dans le workspace ; l'extension vise `api/` | Déployer en **CLI depuis `soldes-timer/`** (méthode §8). L'ambiguïté disparaît. |
| `Following app settings are not supported with this SKU: SCM_DO_BUILD_DURING_DEPLOYMENT` (validation Kudu) | Réglage interdit sur Flex, **réinjecté par l'extension VS Code** (défaut TypeScript = build distant) | Ne jamais poser ce setting. Si on passe malgré tout par l'extension : `.vscode/settings.json` → `"azureFunctions.scmDoBuildDuringDeployment": false`. En CLI, le souci n'existe pas. |
| `The operation was aborted. Rejecting from abort signal callback` (~55 s à l'étape « Build app in Azure ») | Extension VS Code **expire au SyncTrigger** sur Flex | Abandonner l'extension → **CLI `func … --no-build`** (méthode §8). |
| `func … : Unable to connect to Azure` | `az` non installé / non connecté | `brew install azure-cli` puis `az login`. |
| `func … : Can't determine project language` + `Worker runtime cannot be 'None'` | Bundle compilé : `func` ne devine pas le langage | Ajouter **`--javascript`** (avec `--no-build`). |

---

## 10. Validation (déclenchement à la demande)

Le timer ne part que la nuit ; pour tester tout de suite, on invoque l'endpoint
d'admin avec la clé maître (Portail → Function App → **Fonctions** →
**Clés d'application** → `_master`) :

```bash
curl -i -X POST "https://residentapp-soldes-timer-e0ephsbpejbkdnf9.francecentral-01.azurewebsites.net/admin/functions/soldesNightly" -H "x-functions-key: <CLE_MASTER>" -H "Content-Type: application/json" -d "{}"
```

Réponse attendue : **`HTTP/1.1 202 Accepted`** (corps vide, exécution en tâche de
fond). Écrire la commande **sur une seule ligne** (les `\` multi-lignes sont
fragiles dans zsh).

Lire le résultat : portail → Function App → `soldesNightly` → onglet **Journaux**
(pas « Code + test », qui ne montre que le direct). On y voit le récapitulatif :

```
Synchronisation Soldes — démarrage [MODE DRY-RUN : aucune écriture]
Trimestre actif (liste Config) : T2 2026 (« KB-Cumul T2 »)
Plan : KB-Cumul T1 → 2026 · T2 → 2026 · T3 → 2025 · T4 → 2025
...
TOTAL (dry-run, AUCUNE écriture) : 0 créé(s), 0 mis à jour, 14799 inchangé(s)
Synchronisation Soldes — terminée en 51s.
```

Séquence de mise en service :
1. `SOLDES_DRY_RUN=true` → déclencher → vérifier un résumé cohérent, **0 écriture**.
2. Passer `SOLDES_DRY_RUN=false` (ou supprimer) → **Appliquer** → redéclencher →
   vérifier la synchro réelle (0 écriture si les soldes sont déjà à jour = normal).
3. Laisser tourner ; vérifier une exécution planifiée nocturne le lendemain.

---

## 11. Fichier `.vscode/settings.json` (LOCAL, non versionné)

⚠ `.vscode/*` est ignoré par `.gitignore` (ligne 16) → ce fichier n'est PAS dans
le dépôt. Il ne servait qu'à faire fonctionner l'extension VS Code. **Puisque la
méthode de déploiement retenue est la CLI (§8), il est facultatif.** Conservé ici
pour reconstruction si l'on tient à l'extension (déconseillé sur Flex) :

```json
{
  "azureFunctions.deploySubpath": "soldes-timer",
  "azureFunctions.projectSubpath": "soldes-timer",
  "azureFunctions.projectLanguage": "TypeScript",
  "azureFunctions.projectRuntime": "~4",
  "azureFunctions.projectLanguageModel": 4,
  "azureFunctions.scmDoBuildDuringDeployment": false,
  "debug.internalConsoleOptions": "neverOpen"
}
```

---

## 12. Développement local (optionnel)

1. `cp local.settings.json.example local.settings.json` puis remplir le secret
   (ce fichier réel est git-ignoré).
2. Stockage pour l'état du timer : Azurite (`npm i -g azurite`, puis `azurite`),
   `AzureWebJobsStorage = UseDevelopmentStorage=true`.
3. `npm run start` (build + `func start`).
4. La validation la plus simple reste toutefois le déclenchement **en Azure** (§10).

---

## 13. Vers la production Fedasil

- **Résidence des données** : le code s'exécute où tourne la Function ; les données
  résident dans SharePoint/M365 (tenant Fedasil). Seuls le stockage technique et
  **les logs App Insights** (qui contiennent des numéros FA) suivent la région de
  l'app. Pour un hébergement belge : plan **Consommation classique** (disponible
  en Belgium Central, Flex non), et/ou expurger les FA des logs. Décision
  sécurité/DPO (§10.11).
- **Secret Graph** : en App Settings pour le prototype. Durcissement prévu →
  **managed identity** (§10.4) : la logique de `soldes-sync.ts` ne change pas, seul
  `createGraphClient` gagnerait un mode « assertion ».
- **Index** : les index doivent être posés sur le tenant Fedasil AVANT de déployer
  (`sp:provision` les liste). Cet automate lit les mêmes listes — mêmes exigences.
- Tant que l'automate n'est pas en place sur le tenant Fedasil : **lancement
  hebdomadaire manuel** de `npm run sp:soldes -- --auto`.
