©/* ============================================================================
 *  scripts/snapshot-soldes.ts — CLI de synchronisation KB-Cumul -> « Soldes »
 * ----------------------------------------------------------------------------
 *  ⚠ CE FICHIER NE CONTIENT PLUS AUCUNE RÈGLE MÉTIER (14/7/2026).
 *
 *  Toute la logique (client Graph, règles §5.20 Balance/PayStatus/DueDate,
 *  clé Title, mode auto, lecture ciblée de Soldes) vit dans
 *  scripts/lib/soldes-sync.ts — un module SANS argv ni process.exit, pour que
 *  la future Function nocturne (déclencheur timer, §5.20.1) puisse l'appeler
 *  TELLE QUELLE. Une seule définition des règles, donc aucune dérive possible
 *  entre la ligne de commande et l'automate.
 *
 *  Ce fichier ne fait plus que trois choses : lire les arguments, fournir les
 *  identifiants, afficher le résultat.
 *
 *  Usage (depuis la RACINE du dépôt) :
 *
 *    npm run sp:soldes -- --auto                 ⭐ RECOMMANDÉ
 *        Lit le trimestre actif dans la liste « Config », en déduit l'année de
 *        CHACUNE des 4 listes KB-Cumul, et les synchronise toutes.
 *        Aucune année à taper, aucune année codée en dur : la commande reste
 *        juste après chaque rotation trimestrielle.
 *
 *    npm run sp:soldes -- --auto --dry-run       prévisualise, n'écrit rien
 *
 *    npm run sp:soldes -- T2 2026                un seul trimestre (l'ANNÉE est
 *                                                obligatoire : les listes
 *                                                KB-Cumul ont une année
 *                                                IMPLICITE, Soldes la rend
 *                                                explicite)
 *    npm run sp:soldes -- T2 2026 --dry-run
 *
 *  Quand le lancer (en attendant l'automatisation nocturne) :
 *    - AU MINIMUM une fois par semaine (§5.20.1) : sans cela, un paiement
 *      tardif reste invisible sur les trimestres archivés du portail, et on
 *      relance un résident pour une dette déjà réglée ;
 *    - IMPÉRATIVEMENT juste AVANT tout vidage par sp:rotate — sur la liste qui
 *      va être vidée ET sur le trimestre qui va se clôturer (étapes A et A-bis
 *      de PROCEDURE-BASCULE-TRIMESTRE.md). Le mode --auto couvre les deux.
 *
 *  Identifiants : api/local.settings.json (Values), ou à défaut les VARIABLES
 *  D'ENVIRONNEMENT du même nom — c'est ce repli qui permettra à un automate de
 *  tourner sans fichier de configuration.
 * ============================================================================ */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SoldesSyncError,
  SOLDES_LIST_NAME,
  assertSoldesColumns,
  createGraphClient,
  findListByName,
  formatSummary,
  getSiteId,
  syncAuto,
  syncQuarter,
  type QuarterResult,
  type Settings,
} from "./lib/soldes-sync.js";

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
    // Absent = normal pour un automate : on se rabat sur l'environnement.
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

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dryRun = args.includes("--dry-run");
  const auto = args.includes("--auto");
  const positional = args.filter((a) => !a.startsWith("--"));

  if (!auto && positional.length < 2) {
    fail(
      "Usage :\n" +
        "  npm run sp:soldes -- --auto [--dry-run]        ⭐ les 4 trimestres,\n" +
        "                                                   années déduites de la\n" +
        "                                                   liste « Config »\n" +
        "  npm run sp:soldes -- T2 2026 [--dry-run]       un seul trimestre\n\n" +
        "En mode explicite, l'ANNÉE est obligatoire : les listes KB-Cumul ont une\n" +
        "année IMPLICITE (elles sont réutilisées chaque année), Soldes la rend\n" +
        "EXPLICITE. Ne pas se tromper pour un T4 synchronisé en janvier !"
    );
  }

  const cfg = loadSettings();
  const graph = createGraphClient(cfg, log);
  const siteId = await getSiteId(graph, cfg, log);

  let results: QuarterResult[];

  if (auto) {
    if (positional.length > 0) {
      fail(
        "--auto ne prend AUCUN argument : le trimestre et les années sont lus " +
          "dans la liste « Config ».\n" +
          "Pour forcer un trimestre précis : npm run sp:soldes -- T2 2026"
      );
    }
    const outcome = await syncAuto(graph, siteId, { dryRun, log });
    results = outcome.results;
  } else {
    const listArg = positional[0]!;
    const yearArg = positional[1]!;

    const match = /^t([1-4])$/i.exec(listArg);
    if (!match) {
      fail(
        `Trimestre invalide : « ${listArg} » (attendu : T1, T2, T3 ou T4).\n` +
          "Pour synchroniser les 4 d'un coup : npm run sp:soldes -- --auto"
      );
    }
    const quarter = Number(match[1]);

    const year = Number(yearArg);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      fail(`Année invalide : « ${yearArg} » (attendu : ex. 2026).`);
    }

    const soldes = await findListByName(graph, siteId, SOLDES_LIST_NAME);
    if (!soldes) {
      fail(
        `Liste « ${SOLDES_LIST_NAME} » introuvable sur le site.\n` +
          "La créer d'abord : npm run sp:provision (elle est décrite dans " +
          "sharepoint-schema.json)."
      );
    }
    await assertSoldesColumns(graph, siteId, soldes.id);

    if (dryRun) log("[MODE --dry-run : AUCUNE écriture]");

    results = [
      await syncQuarter(graph, siteId, soldes.id, {
        quarter,
        year,
        dryRun,
        log,
      }),
    ];
  }

  log(formatSummary(results, dryRun));
  log(
    "\nRejouable à volonté (upsert par Title). À relancer après chaque mise à " +
      "jour\nde Paid, et une DERNIÈRE fois avant tout vidage par sp:rotate."
  );
}

main().catch((error: unknown) => {
  if (error instanceof SoldesSyncError) fail(error.message);
  fail(error instanceof Error ? error.message : String(error));
});
