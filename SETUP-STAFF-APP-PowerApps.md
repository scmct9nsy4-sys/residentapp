# MODE D'EMPLOI — Application Staff (Power Apps Code App + React + SharePoint)

**Version 1 — 12 juillet 2026**
Projet : ResidentApp Staff (Fedasil) — outil interne de gestion du processus
de contribution financière des résidents.

Document compagnon de `ETAT-PROJET-ResidentApp.md` (portail résident).

---

## 1. Objet et positionnement

L'application **staff** est destinée aux collaborateurs Fedasil du service
gestion des processus. Elle couvre (à construire) : tableau de bord
trimestriel, fiche dossier 360°, lettrage des paiements, moteur de rappels /
mises en demeure / contentieux, contrôle trimestriel BCSS.

Elle est **distincte** du portail résident et le restera :

| | Portail résident (ResidentApp) | Application staff (ResidentApp Staff) |
|---|---|---|
| Public | Résidents (externes, invités B2B) | Collaborateurs Fedasil (internes) |
| Hébergement | Azure Static Web Apps | Power Platform (Code App) |
| Accès aux données | Azure Functions → Graph, sous l'identité **applicative** (`e-residentapp admin`) | Connecteur SharePoint, sous l'identité **du collaborateur connecté** |
| Licence | aucune (B2B) | Power Apps **Premium** par utilisateur |
| Dépôt / dossier | `~/residentapp` | `~/residentapp-staff` |

**Les deux applications lisent les MÊMES listes SharePoint.** C'est le seul
point de partage : aucun code commun, aucun dossier commun, aucun cycle de
déploiement commun.

### Pourquoi Power Apps Code Apps ?

- **GA depuis le 5 février 2026** : ce n'est plus une préversion.
- **Stack identique à celle déjà maîtrisée** : React + TypeScript + Vite.
- **Licence** : les collaborateurs sont des utilisateurs internes nommés → les
  licences Premium acquises couvrent le besoin. (Le risque de licensing
  *externe* qui pèse sur Dataverse/Power Pages pour les résidents ne concerne
  PAS l'app staff.)
- **Authentification et gouvernance offertes** : Entra, Conditional Access,
  DLP, isolation du tenant sont assurés par la plateforme. Aucun bloc `auth`
  à configurer, aucun secret client à faire tourner tous les 24 mois.
- **Traçabilité native** : chaque écriture SharePoint porte le vrai
  « Modifié par » du collaborateur → l'exigence d'audit du processus
  (imputations, rappels, régularisations) est satisfaite gratuitement.
- **Aucune consommation Azure** : les données restent sur SharePoint, le
  connecteur est inclus dans les licences.

### Limites à connaître

- **Pas de backend serveur.** La logique métier tourne côté client React ou
  dans des flux **Power Automate**. Acceptable pour un outil interne
  (contrairement au portail résident, où le serveur DOIT être la vérité pour
  le calcul de contribution).
- **Volumétrie du connecteur SharePoint** : prévoir pagination et colonnes
  indexées sur les listes qui grossissent (KB-Paiements). Argument
  supplémentaire pour la migration Azure SQL à terme — le jour venu, seule la
  couche données change (connecteur SQL Premium, couvert par les licences).
- **Le plan Développeur est un environnement de DEV**, non partageable et
  interdit en production (voir §3).

---

## 2. Les trois portails Microsoft (ne pas les confondre)

Piège majeur, symétrique de celui déjà documenté pour Azure vs Entra.

| Portail | Adresse | À quoi il sert ici |
|---|---|---|
| **Centre d'administration Microsoft 365** | `admin.microsoft.com` | Licences M365, facturation. **Rien à y faire pour les Code Apps.** ⚠️ La licence du plan Développeur Power Apps n'y apparaît PAS — ce n'est pas un bug. |
| **Power Apps (studio / maker)** | `make.powerapps.com` | Sélecteur d'**environnement** (en haut à droite), création des **connexions**, liste des apps. |
| **Centre d'administration Power Platform** | `admin.powerplatform.microsoft.com` | Gestion des **environnements**, activation de la fonctionnalité **Code Apps**. |

```
  make.powerapps.com                admin.powerplatform.microsoft.com
  ┌──────────────────────┐          ┌──────────────────────────────┐
  │ Sélecteur d'env.     │          │ Environnements               │
  │ Connexions  ─────────┼────┐     │  └ Paramètres → Produit      │
  │ (SharePoint)         │    │     │      → Fonctionnalités       │
  └──────────────────────┘    │     │          → Code apps : ON    │
                              │     └──────────────────────────────┘
                              │
                    connection ID
                              │
                        ┌─────▼──────────────────┐
                        │ Projet local (VS Code) │
                        │  power.config.json     │
                        │  src/generated/*       │
                        └────────────────────────┘
```

---

## 3. Licence : ce qui a réellement fonctionné

**Objectif** : accéder aux fonctionnalités Premium (dont les Code Apps).

Trois voies existent :

1. **Essai 30 jours Power Apps Premium** — prolongeable 2 × 30 jours (90 jours
   max). Peut être bloqué par l'administrateur du tenant (paramètre
   `AllowAdHocSubscriptions`).
2. **Plan Développeur Power Apps (gratuit, permanent)** — ✅ **voie retenue** :
   fournit un **environnement personnel** de type « Développeur » avec les
   capacités Premium. Idéal pour prototyper.
3. **Licence Premium assignée par l'administrateur** — la voie de la
   production réelle (à demander à Fedasil le moment venu).

⚠️ **À savoir** : le plan Développeur **n'apparaît pas** dans la liste des
licences du centre d'administration M365. C'est normal et déroutant. La
vérification se fait côté Power Platform (l'environnement de type
« Développeur » existe et est « Prêt »).

⚠️ **Limites du plan Développeur** : individuel (non partageable avec des
collègues), interdit en production. Pour le déploiement réel : environnement
d'entreprise + licences Premium pour chaque collaborateur.

---

## 4. Prérequis machine (macOS)

### 4.1 ⚠️ Piège Apple Silicon : Homebrew hérité d'un Mac Intel

**Symptôme rencontré** : `brew install --cask dotnet-sdk` installe un paquet
**x64** puis échoue au nettoyage (`Error: It seems the symlink source ... is
not there`), en supprimant au passage ce qu'il venait d'installer. Résultat :
un `dotnet --version` qui renvoie une version fantôme (2.0.0, datant de 2017).

**Cause** : lors de la migration Intel → M1, l'assistant Apple a transféré
Homebrew tel quel. Il vivait dans `/usr/local` (Intel) et tournait sous
Rosetta, installant donc des paquets x64 sur une puce ARM.

**Diagnostic** :

```bash
uname -m                                   # arm64 attendu sur M1/M2/M3
which brew                                 # /usr/local/bin/brew = Intel (mauvais)
brew config | grep -E "HOMEBREW_PREFIX|Rosetta"
node -p process.arch                       # vérifier aussi Node
```

**Correction** :

```bash
# 1. Installer le Homebrew NATIF (il se place dans /opt/homebrew)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Suivre les "Next steps" affichés : ils ajoutent le shellenv à ~/.zprofile
#    (.zprofile est lu AVANT .zshrc → le brew natif prime automatiquement)

# 3. Terminal NEUF, puis vérifier
which brew                                 # attendu : /opt/homebrew/bin/brew
brew config | grep Rosetta                 # attendu : false
```

**Principe retenu** : ne pas réinstaller préventivement les anciennes formules.
On installe dans le brew natif ce dont on a besoin *aujourd'hui* ; le reste se
réinstallera à la demande.

### 4.2 SDK .NET (prérequis du CLI `pac`)

```bash
brew install --cask dotnet-sdk     # AVEC le brew natif → paquet arm64
```

Vérification (terminal neuf) :

```bash
dotnet --version                   # attendu : 10.x.x
dotnet --list-sdks                 # une seule ligne
```

> Le chemin `/usr/local/share/dotnet` reste normal même sur ARM : c'est
> l'emplacement d'installation choisi par Microsoft, le binaire lui-même est
> natif.

### 4.3 CLI Power Platform (`pac`)

```bash
dotnet tool install --global Microsoft.PowerApps.CLI.Tool
```

Puis ajouter le dossier des outils au PATH (`~/.zprofile`) :

```bash
cat << \EOF >> ~/.zprofile
# Ajouter les outils du kit SDK .NET Core
export PATH="$PATH:$HOME/.dotnet/tools"
EOF
```

Terminal neuf, puis :

```bash
pac help                           # doit lister : admin, auth, code, env, solution…
```

> Avertissements bénins lors de l'installation : message de bienvenue .NET
> (télémétrie, certificat HTTPS de dev), « problème lors de la vérification
> des charges de travail » (les *workloads* concernent MAUI/mobile, inutiles
> ici). Seule compte la ligne finale : *« L'outil
> 'microsoft.powerapps.cli.tool' a été installé correctement »*.

### 4.4 Node

Node 20 ou 22 (LTS) via nvm. Vérifier qu'il est bien natif :

```bash
node -p process.arch               # attendu : arm64
```

---

## 5. Activation des Code Apps sur l'environnement

Sur **`admin.powerplatform.microsoft.com`** :

1. Menu **Gérer** → **Environnements** → sélectionner l'environnement
   (type « Développeur », état « Prêt ») ;
2. Dans la **barre d'outils du HAUT** : **⚙️ Paramètres**
   (⚠️ ce n'est PAS le menu latéral) ;
3. Déplier **Produit** → **Fonctionnalités** ;
4. Toggle **« Code apps »** → **Activé** → **Enregistrer**.

Relever au passage l'**ID de l'environnement** (visible dans le bloc
« Détails ») — il servira au CLI.

*Environnement de développement actuel :*
`c41ca91f-4c94-e516-951c-45716ac1b946`

---

## 6. Création de la connexion SharePoint

⚠️ **Étape obligatoire ET préalable** au branchement des données : elle ne peut
pas se faire en ligne de commande (écran de consentement Microsoft requis).

Sur **`make.powerapps.com`** :

1. ⚠️ **Vérifier l'environnement sélectionné** en haut à droite (piège
   classique : on atterrit par défaut dans l'environnement par défaut du
   tenant, et la connexion serait créée au mauvais endroit) ;
2. Menu de gauche → **Connexions** (parfois sous « … Plus ») ;
3. **+ Nouvelle connexion** → **SharePoint** (pas « SharePoint (Local) ») ;
4. **Se connecter directement (services cloud)** → **Créer** ;
5. S'authentifier.

Vérification et récupération de l'ID :

```bash
pac connection list
```

Sortie attendue :

```
Id                               Name                        API Id                                                      Status
f61227eef6594916afec6919722a81ef Jean-Yves.Claes@giapplab.be /providers/Microsoft.PowerApps/apis/shared_sharepointonline Connected
```

---

## 7. Création du projet

### 7.1 Authentification et sélection de l'environnement

```bash
pac auth create                    # ouvre le navigateur
pac env list                       # vérifier que l'environnement apparaît
pac env select --environment c41ca91f-4c94-e516-951c-45716ac1b946
pac env list                       # la colonne "Active" doit être marquée
```

### 7.2 Scaffolding depuis le template officiel

⚠️ Créer le projet **À CÔTÉ** de `residentapp`, jamais dedans :

```
~/
├── residentapp/          ← portail résident (inchangé)
└── residentapp-staff/    ← app staff (nouveau)
```

```bash
cd ~
npx degit github:microsoft/PowerAppsCodeApps/templates/vite residentapp-staff
cd residentapp-staff
npm install
```

Vérifier l'arborescence (`ls`) : on doit voir `package.json`, `vite.config.ts`,
`index.html`, `src/` — et **pas** `templates/`, `samples/` (qui signaleraient
que tout le dépôt a été cloné).

> Les warnings `npm` (dépendances dépréciées, vulnérabilités modérées) sont du
> bruit habituel. **NE PAS lancer `npm audit fix --force`** sur un template
> fraîchement cloné.

### 7.3 Enregistrement de l'app dans Power Platform

```bash
pac code init --displayname "ResidentApp Staff"
```

Génère **`power.config.json`** à la racine : le pont entre le projet local et
la plateforme (l'équivalent conceptuel du `staticwebapp.config.json` du portail
résident).

---

## 8. Branchement des données SharePoint

```bash
npx power-apps add-data-source
```

Dialogue interactif — réponses pour **Residents List** :

| Question | Réponse |
|---|---|
| API ID | `shared_sharepointonline` |
| Connection reference instead of connection ID ? | `n` (les *connection references* servent au déploiement multi-environnements via solutions — utile plus tard pour Fedasil, inutile en dev) |
| Connection ID | `f61227eef6594916afec6919722a81ef` (issu de `pac connection list`) |
| Dataset (le site) | `https://giapplab.sharepoint.com/sites/Resident_Test` |
| Resource name (la liste) | `Residents List` (ou son GUID `5f8da123-127d-4bfc-81e3-df9b972093b4`) |

### Ce qui est généré

```
src/generated/
├── index.ts
├── models/
│   ├── CommonModels.ts          ← IGetOptions, IGetAllOptions (select, filter, orderBy, top, skip…)
│   └── ResidentsListModel.ts    ← interfaces typées des colonnes
└── services/
    └── ResidentsListService.ts  ← create / update / delete / get / getAll
```

**Bénéfice inattendu** : le modèle généré est un **inventaire exact des colonnes
réelles** de la liste (`sp:inspect` en version typée et autocomplétée). Il a
révélé que la Residents List de production est bien plus riche que le schéma de
test : `Region`, `Gender`, `Center`, `Nationality`, `Network`,
`FamilyComposition`, `Municipalityfr`, `OutOfNetwork`, `Mirror_ID`… — autant de
filtres possibles pour l'app staff (par centre, par région).

**Colonnes à choix** : forme dédoublée — `Region#Id` en écriture,
`Region.Value` en lecture (idem `Gender`).

**Rappel métier (§5.1 de l'état projet)** : `Title` = numéro national (NN),
`FedasilNumber` = FA (clé maîtresse), `EntraOid` = lien vers le compte de
connexion.

### Sources de données à ajouter ensuite

Répéter la commande pour : `KB-Cumul T1..T4`, `KB-Paiements`,
`ResidentApp Aidants`.

---

## 9. Développement local

**Une seule commande suffit** — le template embarque un plugin Vite Power Apps
qui sert à la fois l'app et la configuration de connexion :

```bash
npm run dev
```

Sortie :

```
  Power Apps Vite Plugin
  ➜  Local Play:   https://apps.powerapps.com/play/e/<ENV_ID>/a/local?_localAppUrl=http://localhost:5173/&_localConnectionUrl=http://localhost:5173/__vite_powerapps_plugin__/power.config.json
  VITE v7.x  ready
  ➜  Local:   http://localhost:5173/
```

⚠️ **Toujours ouvrir la « Local Play URL »** (l'app s'exécute alors dans le
*player* Power Apps, avec le contexte d'authentification et le proxy de
connecteurs). **Ne jamais tester sur `http://localhost:5173` directement** : la
page s'affiche mais tous les appels SharePoint échouent. C'est l'exact pendant
du `localhost:4280` (SWA CLI) vs port Vite brut du portail résident.

→ **Mettre la Play URL en favori.** Tant que Vite redémarre sur le port 5173,
elle reste valable : il suffit de rafraîchir l'onglet.

Le **HMR fonctionne dans le player** : enregistrer un fichier met la page à
jour automatiquement.

### Diagnostic : « Nous n'avons pas pu récupérer votre application »

Message du player signifiant qu'il ne joint plus le serveur local. Dans
l'ordre :

1. **Le serveur Vite tourne-t-il encore ?** ⚠️ Ouvrir un dossier dans VS Code
   recharge la fenêtre et **tue les processus des terminaux** — cause n°1.
2. **Le port a-t-il changé ?** Si Vite démarre sur 5174 (5173 occupé), l'ancienne
   Play URL pointe dans le vide → utiliser celle qu'il vient d'afficher.
3. **VPN actif ?** Il peut bloquer la communication entre `apps.powerapps.com`
   et `localhost`.
4. `http://localhost:5173` répond-il ? Si oui, le code va bien : le problème
   est uniquement dans le pont player ↔ localhost.

---

## 10. Déploiement

```bash
npm run build          # vérification préalable, comme sur le portail résident
npx power-apps push    # publie l'app dans l'environnement Power Platform
```

L'app apparaît alors dans `make.powerapps.com` → **Applications**, et peut être
partagée avec les utilisateurs (qui doivent disposer d'une licence Premium).

> ⚠️ Le code source **n'est pas stocké dans la plateforme** : seule la version
> *buildée* y est poussée. Le dépôt Git local (ou GitHub) reste la seule source
> de vérité du code. Une Code App **ne s'édite pas** depuis
> `make.powerapps.com`.

---

## 11. Modèle de sécurité — différence essentielle avec le portail résident

| | Portail résident | App staff |
|---|---|---|
| Identité utilisée pour lire/écrire SharePoint | **applicative** (`e-residentapp admin`, permissions Graph) | **celle du collaborateur connecté** (connecteur SharePoint) |
| Conséquence | le résident n'a AUCUN droit SharePoint | chaque collaborateur DOIT avoir des droits sur le site SharePoint |
| Traçabilité | « Modifié par » = le compte applicatif | « Modifié par » = le vrai collaborateur ✅ |

**À prévoir dans la gouvernance Fedasil** : un groupe de sécurité donnant accès
au site SharePoint aux collaborateurs du service, et une réflexion sur les
rôles (gestionnaire / lecture seule). Le pattern de la liste
« ResidentApp Aidants » (garde-fou fail-closed) est réutilisable tel quel pour
une liste « ResidentApp Staff ».

---

## 12. Récapitulatif des pièges rencontrés (mémo)

1. **Trois portails Microsoft distincts** — le menu « Environnements » n'existe
   PAS dans `admin.microsoft.com`.
2. **Le plan Développeur n'apparaît pas dans les licences M365** — ce n'est pas
   un échec d'activation.
3. **Homebrew hérité d'un Mac Intel installe des paquets x64 sur ARM** — cause
   racine de l'échec d'installation du SDK .NET. Réinstaller le brew natif
   (`/opt/homebrew`).
4. **Le toggle Code Apps est dans la barre d'outils du HAUT** (Paramètres →
   Produit → Fonctionnalités), pas dans le menu latéral.
5. **La connexion SharePoint doit exister AVANT `add-data-source`** — elle se
   crée uniquement dans le navigateur.
6. **Vérifier l'environnement sélectionné** sur `make.powerapps.com` avant de
   créer la connexion.
7. **Toujours passer par la Play URL**, jamais par `localhost:5173` brut.
8. **Ouvrir un dossier dans VS Code tue les terminaux** → le player affiche
   alors « impossible de récupérer votre application ».
9. **Deux applications = deux dossiers, deux dépôts** — seules les données
   SharePoint sont partagées.
10. **`npm audit fix --force` sur un template neuf : à proscrire.**

---

## 13. État au 12 juillet 2026 et suite

✅ **Fait** : outillage installé (brew natif ARM, .NET 10, `pac` 2.9.3), Code
Apps activées sur l'environnement développeur, projet `residentapp-staff` créé
et enregistré, connexion SharePoint établie, **Residents List branchée**,
premier écran React (liste des résidents avec recherche) fonctionnel dans le
player.

⏭️ **Prochaine discussion — conception fonctionnelle de l'app staff.** Six
modules identifiés :

1. **Tableau de bord trimestriel** — dû / payé / en retard, taux de
   communications structurées, file de lettrage, dossiers en escalade.
2. **Fiche dossier 360°** — recherche par FA/NN/nom, déclarations (courant +
   historique), paiements détaillés, solde, historique des rappels, notes.
3. **File de lettrage manuel** — virements à communication libre → imputation
   sur FA + mois ; statut « Anomalie » pour les inconnus. (Le lettrage
   *automatique* des communications structurées est un candidat Power Automate.)
4. **Moteur de rappels — machine à états** : À jour → En retard → Rappel 1 →
   Rappel 2 → Mise en demeure → Contentieux. Génération par lots validée par un
   humain, courriers multilingues avec QR de paiement et communication
   d'apurement (préfixe `9T0`, §5.12). Export « dossier complet » pour le
   contentieux.
5. **Contrôle trimestriel BCSS** — import du brut trimestriel par NN → net
   estimé via **grille Jobat** (personne isolée, table de référence
   **versionnée par année**) → comparaison au net déclaré → **classement par
   exception** : conforme (sous seuil) / écart à contrôler / salarié BCSS sans
   déclaration (le plus grave) / déclaré sans trace BCSS (souvent bénin).
   Le **seuil d'écart absorbe l'imprécision** de la conversion brut→net : un
   écart de quelques pourcents est du bruit, pas une fraude.
6. **Transversal** — journalisation des actions (offerte par l'identité du
   connecteur), rôles et garde-fous.

⚠️ **Dépendance structurante** : les modules 2, 4 et 5 butent tous sur la même
limite — **l'historique multi-trimestres et les créances qui ne survivent pas
au vidage des listes KB-Cumul**. C'est exactement l'objet de la liste
« Soldes » (§10 point 2 de l'état projet) et l'argument le plus fort pour la
migration **Azure SQL** (§10 point 9). L'app staff est l'occasion de faire
trancher la hiérarchie.

**Ordre de priorité recommandé** : lettrage (3) d'abord — sans paiements
imputés, ni les statuts ni les rappels ne sont fiables — puis liste Soldes +
rappels (4), puis contrôle BCSS (5), dont la première échéance réelle serait
le ~15 août pour T2.

---

## 14. Prompt de relance (prochaine discussion)

> Bonjour Claude. Je poursuis le développement de l'**application STAFF** de
> ResidentApp (Fedasil) — outil interne de gestion du processus de contribution
> financière. CONTEXTE : lis d'abord `SETUP-STAFF-APP-PowerApps.md` (installation
> et architecture de l'app staff) et `ETAT-PROJET-ResidentApp.md` (le portail
> résident, en particulier §5 « Règles métier », §5.16 calendrier trimestriel,
> §5.17 modèle paiements). En résumé : l'app staff est une **Power Apps Code App**
> (React + TypeScript + Vite + SDK Power Apps) hébergée sur Power Platform,
> qui lit les MÊMES listes SharePoint que le portail résident, sous l'identité
> du collaborateur connecté. L'installation est terminée : environnement
> développeur, CLI `pac`, projet `residentapp-staff`, connexion SharePoint,
> Residents List branchée, premier écran (liste des résidents) fonctionnel.
> OBJECTIF DE CETTE DISCUSSION : concevoir puis développer les modules
> fonctionnels (voir §13) — commencer par [choisir : la fiche dossier 360° / la
> file de lettrage / le tableau de bord].
> Rappel de ma façon de travailler : je suis débutant confirmé, je préfère des
> fichiers complets copier-coller prêts plutôt que des patchs, un pas-à-pas pour
> les manipulations Azure/Entra/Power Platform, et je commite via l'interface
> Git de VS Code (donne-moi juste les messages de commit).
