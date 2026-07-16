/* ============================================================================
 *  scripts/migrate-paiements-status.ts — Codes neutres pour KB-Paiements
 * ----------------------------------------------------------------------------
 *  PRÉALABLE DU MODULE 3 (file de lettrage) — conception staff §6 :
 *  « Codes techniques neutres, l'interface traduit. » La colonne `Status` de
 *  KB-Paiements porte historiquement des valeurs FRANÇAISES ; ce script les
 *  migre vers les codes neutres, en deux temps :
 *
 *    À traiter  ->  ToProcess
 *    Imputé     ->  Imputed
 *    Anomalie   ->  Anomaly
 *
 *  POURQUOI UN SCRIPT DÉDIÉ : `sp:provision` ne modifie JAMAIS une colonne
 *  existante (par conception — aucune écriture destructrice). Changer les
 *  valeurs d'une colonne choice ET réécrire les lignes existantes est donc
 *  hors de son périmètre.
 *
 *  DÉROULEMENT (idempotent — relançable sans risque) :
 *    A. La définition de la colonne reçoit l'UNION des choix (neutres +
 *       français) : les anciennes lignes restent valides pendant la
 *       réécriture, aucune fenêtre d'incohérence.
 *    B. Toutes les lignes sont balayées en LECTURE PAGINÉE SANS FILTRE
 *       (principe §6 point 5 : non soumise au seuil des 5000) ; chaque
 *       valeur française est réécrite en code neutre.
 *    C. Quand plus AUCUNE valeur française ne subsiste, la définition de la
 *       colonne est resserrée sur les trois codes neutres seuls.
 *
 *  L'app staff tolère LES DEUX écritures (src/data/paiements.ts) : la
 *  migration peut se faire avant ou après son déploiement, sans coordination.
 *
 *  ⚠ TENANT FEDASIL : la liste KB-Paiements réelle existe déjà là-bas
 *  (schéma « STRUCTURE DE TEST » — relever ses noms internes avec sp:inspect
 *  et ALIGNER sharepoint-schema.json avant d'y lancer quoi que ce soit).
 *  Ce script s'exécute sur le site désigné par api/local.settings.json.
 *
 *  Usage (depuis la RACINE du dépôt) :
 *    npm run sp:paiements-status -- --dry-run   prévisualise, n'écrit RIEN
 *    npm run sp:paiements-status                applique (A + B + C)
 *
 *  Identifiants : api/local.settings.json (Values), ou à défaut les
 *  variables d'environnement du même nom — même convention que sp:soldes.
 * ============================================================================ */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SoldesSyncError,
  createGraphClient,
  findListByName,
  getSiteId,
  type GraphClient,
  type Settings,
} from "./lib/soldes-sync.js";

// ---------------------------------------------------------------------------
//  Constantes de la migration
// ---------------------------------------------------------------------------

/** Nom d'affichage de la liste (surchargeable pour un tenant qui diffère). */
const LIST_NAME = process.env["SP_PAIEMENTS_LIST_NAME"] ?? "KB-Paiements";

/** Nom INTERNE de la colonne à migrer. */
const COLUMN_NAME = "Status";

/** Valeurs françaises historiques -> codes techniques neutres. */
const MAPPING: Record<string, string> = {
  "À traiter": "ToProcess",
  "Imputé": "Imputed",
  "Anomalie": "Anomaly",
};

/** Les trois codes neutres cibles (état final de la colonne). */
const NEUTRAL_CHOICES = ["ToProcess", "Imputed", "Anomaly"];

// ---------------------------------------------------------------------------
//  Configuration (même convention que snapshot-soldes.ts)
// ---------------------------------------------------------------------------

const REQUIRED_SETTINGS = [
  "TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "SP_SITE_HOSTNAME",
  "SP_SITE_PATH",
] as const;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const log = (message: string): void => console.log(message);

/** api/local.settings.json > Values, complété/remplacé par process.env. */
function loadSettings(): Settings {
  const path = resolve(process.cwd(), "api/local.settings.json");
  let fromFile: Record<string, string> = {};

  try {
    const raw = readFileSync(path, "utf-8");
    const json = JSON.parse(raw) as { Values?: Record<string, string> };
    fromFile = json.Values ?? {};
  } catch {
    log(
      "ℹ api/local.settings.json introuvable — lecture des variables d'environnement."
    );
  }

  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const key of REQUIRED_SETTINGS) {
    const v = (process.env[key] ?? fromFile[key] ?? "").trim();
    if (!v) missing.push(key);
    values[key] = v;
  }

  if (missing.length > 0) {
    fail(
      `Variable(s) manquante(s) : ${missing.join(", ")}.\n` +
        "Les renseigner dans api/local.settings.json > Values, ou dans " +
        "l'environnement.\n" +
        "Rappel : lancer la commande depuis la RACINE du dépôt."
    );
  }

  return values as Settings;
}

// ---------------------------------------------------------------------------
//  Types Graph (sous-ensemble utile)
// ---------------------------------------------------------------------------

type GraphColumn = {
  id: string;
  name: string;
  choice?: {
    allowTextEntry?: boolean;
    displayAs?: string;
    choices?: string[];
  };
};

type ListItem = {
  id: string;
  fields?: { Status?: string };
};

// ---------------------------------------------------------------------------
//  Étape A — union des choix sur la définition de colonne
// ---------------------------------------------------------------------------

async function findStatusColumn(
  graph: GraphClient,
  siteId: string,
  listId: string
): Promise<GraphColumn> {
  const json = await graph.get<{ value: GraphColumn[] }>(
    `/sites/${siteId}/lists/${listId}/columns?$top=200`
  );
  const col = json.value.find(
    (c) => c.name.toLowerCase() === COLUMN_NAME.toLowerCase()
  );
  if (!col) {
    throw new SoldesSyncError(
      `Colonne « ${COLUMN_NAME} » introuvable dans la liste « ${LIST_NAME} ». ` +
        "Vérifier avec : npm run sp:inspect"
    );
  }
  if (!col.choice) {
    throw new SoldesSyncError(
      `La colonne « ${col.name} » n'est pas de type choice (relevé : autre). ` +
        "Vérifier avec : npm run sp:inspect"
    );
  }
  return col;
}

async function widenChoices(
  graph: GraphClient,
  siteId: string,
  listId: string,
  col: GraphColumn,
  dryRun: boolean
): Promise<void> {
  const current = col.choice?.choices ?? [];
  const union = [...NEUTRAL_CHOICES, ...Object.keys(MAPPING)].filter(
    (c, i, all) => all.indexOf(c) === i
  );
  const missing = union.filter((c) => !current.includes(c));

  log(`   Choix actuels de la colonne : ${current.join(" · ") || "(aucun)"}`);

  if (missing.length === 0) {
    log("   ✓ étape A : la colonne accepte déjà tous les choix nécessaires.");
    return;
  }
  if (dryRun) {
    log(`   [dry-run] étape A : ajouterait les choix ${missing.join(" · ")}`);
    return;
  }

  await graph.write("PATCH", `/sites/${siteId}/lists/${listId}/columns/${col.id}`, {
    choice: {
      allowTextEntry: false,
      displayAs: "dropDownMenu",
      choices: [...current, ...missing],
    },
  });
  log(`   + étape A : choix ajoutés (${missing.join(" · ")}).`);
}

// ---------------------------------------------------------------------------
//  Étape B — réécriture des lignes (balayage paginé sans filtre)
// ---------------------------------------------------------------------------

type RewriteResult = {
  total: number;
  rewritten: number;
  alreadyNeutral: number;
  empty: number;
  unknown: Map<string, number>;
};

async function rewriteRows(
  graph: GraphClient,
  siteId: string,
  listId: string,
  dryRun: boolean
): Promise<RewriteResult> {
  const items = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${listId}/items` +
      `?$select=id&$expand=fields($select=${COLUMN_NAME})&$top=200`
  );

  const result: RewriteResult = {
    total: items.length,
    rewritten: 0,
    alreadyNeutral: 0,
    empty: 0,
    unknown: new Map(),
  };
  log(`   ${result.total} ligne(s) à examiner.`);

  let done = 0;
  for (const item of items) {
    const value = (item.fields?.Status ?? "").trim();

    if (value === "") {
      result.empty++;
    } else if (NEUTRAL_CHOICES.includes(value)) {
      result.alreadyNeutral++;
    } else if (value in MAPPING) {
      if (!dryRun) {
        await graph.write(
          "PATCH",
          `/sites/${siteId}/lists/${listId}/items/${item.id}/fields`,
          { [COLUMN_NAME]: MAPPING[value] }
        );
      }
      result.rewritten++;
    } else {
      result.unknown.set(value, (result.unknown.get(value) ?? 0) + 1);
    }

    done++;
    if (done % 500 === 0) {
      log(`   … ${done}/${result.total} examinées (${result.rewritten} réécrites)`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
//  Étape C — resserrer la colonne sur les codes neutres seuls
// ---------------------------------------------------------------------------

async function tightenChoices(
  graph: GraphClient,
  siteId: string,
  listId: string,
  colId: string
): Promise<void> {
  await graph.write("PATCH", `/sites/${siteId}/lists/${listId}/columns/${colId}`, {
    choice: {
      allowTextEntry: false,
      displayAs: "dropDownMenu",
      choices: NEUTRAL_CHOICES,
    },
  });
  log(`   ✓ étape C : colonne resserrée sur ${NEUTRAL_CHOICES.join(" · ")}.`);
}

// ---------------------------------------------------------------------------
//  Point d'entrée
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dryRun = args.includes("--dry-run");

  log(
    `Migration des statuts « ${LIST_NAME} » -> codes neutres` +
      (dryRun ? "   [DRY-RUN : aucune écriture]" : "")
  );

  const cfg = loadSettings();
  const graph = createGraphClient(cfg, log);
  const siteId = await getSiteId(graph, cfg, log);

  const list = await findListByName(graph, siteId, LIST_NAME);
  if (!list) {
    fail(
      `Liste « ${LIST_NAME} » introuvable sur le site. ` +
        "Vérifier le nom (variable SP_PAIEMENTS_LIST_NAME pour surcharger)."
    );
  }
  log(`■ Liste « ${list.displayName} » (id: ${list.id})\n`);

  // A — élargir la définition (anciennes lignes valides pendant la réécriture)
  const col = await findStatusColumn(graph, siteId, list.id);
  await widenChoices(graph, siteId, list.id, col, dryRun);

  // B — réécrire les lignes
  const r = await rewriteRows(graph, siteId, list.id, dryRun);

  log("");
  log(`   ${r.rewritten} ligne(s) ${dryRun ? "à réécrire" : "réécrite(s)"}`);
  log(`   ${r.alreadyNeutral} déjà en codes neutres · ${r.empty} sans statut`);
  for (const [value, count] of r.unknown) {
    log(`   ⚠ ${count} ligne(s) avec la valeur INCONNUE « ${value} » — non touchée(s).`);
  }

  // C — resserrer, seulement quand tout est propre
  if (dryRun) {
    log("\n[dry-run] étape C : resserrerait la colonne sur les codes neutres.");
  } else if (r.unknown.size > 0) {
    log(
      "\n⚠ étape C REPORTÉE : des valeurs inconnues subsistent (ci-dessus). " +
        "Les corriger, puis relancer le script."
    );
  } else {
    await tightenChoices(graph, siteId, list.id, col.id);
  }

  log(
    dryRun
      ? "\nTerminé (dry-run). Relancer SANS --dry-run pour appliquer."
      : "\nTerminé. Relançable sans risque (idempotent)."
  );
}

main().catch((error) => {
  if (error instanceof SoldesSyncError) fail(error.message);
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
