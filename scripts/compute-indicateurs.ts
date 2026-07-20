/* ============================================================================
 *  scripts/compute-indicateurs.ts — CLI du calcul des indicateurs (module 1)
 * ----------------------------------------------------------------------------
 *  ⚠ CE FICHIER NE CONTIENT AUCUNE RÈGLE MÉTIER (même principe que
 *  snapshot-soldes.ts depuis le 14/7/2026).
 *
 *  Toute la logique (agrégats du tableau de bord staff, upsert par Title dans
 *  la liste « Indicateurs », estampilles) vit dans scripts/lib/indicateurs.ts
 *  — un module SANS argv ni process.exit, que la Function nocturne
 *  residentapp-soldes-timer appelle TELLE QUELLE juste après syncAuto. Une
 *  seule définition des règles, aucune dérive possible entre la ligne de
 *  commande et l'automate.
 *
 *  Ce fichier ne fait que trois choses : lire les arguments, fournir les
 *  identifiants, afficher le résultat.
 *
 *  Usage (depuis la RACINE du dépôt) :
 *
 *    npm run sp:indicateurs -- --dry-run      ⭐ D'ABORD (prévisualise, n'écrit rien)
 *    npm run sp:indicateurs                   calcule et écrit les indicateurs
 *
 *  Quand le lancer :
 *    - normalement JAMAIS à la main : la Function nocturne s'en charge chaque
 *      nuit après la synchro Soldes (les agrégats sont alors cohérents avec la
 *      photo Soldes de la même nuit) ;
 *    - à la main pour VALIDER (simulation, première mise en service) ou pour
 *      RAFRAÎCHIR le tableau de bord sans attendre la nuit (après un lettrage
 *      massif, par exemple). Chaque ligne porte son ComputedAt : aucun risque
 *      de confusion sur la fraîcheur.
 *
 *  Identifiants : api/local.settings.json (Values), ou à défaut les VARIABLES
 *  D'ENVIRONNEMENT du même nom — même repli que snapshot-soldes.ts.
 * ============================================================================ */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SoldesSyncError,
  createGraphClient,
  getSiteId,
  type Settings,
} from "./lib/soldes-sync.js";
import {
  computeIndicateurs,
  formatIndicateursSummary,
} from "./lib/indicateurs.js";

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

/** api/local.settings.json > Values, complété/remplacé par process.env
 *  (même repli que snapshot-soldes.ts). */
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

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dryRun = args.includes("--dry-run");
  const unknown = args.filter((a) => a !== "--dry-run");

  if (unknown.length > 0) {
    fail(
      `Argument(s) inconnu(s) : ${unknown.join(", ")}.\n\n` +
        "Usage :\n" +
        "  npm run sp:indicateurs -- --dry-run    ⭐ D'ABORD (prévisualise)\n" +
        "  npm run sp:indicateurs                 calcule et écrit\n\n" +
        "Le trimestre actif et la fenêtre des 4 trimestres sont lus dans la\n" +
        "liste « Config » : rien à passer en argument, jamais."
    );
  }

  const cfg = loadSettings();
  const graph = createGraphClient(cfg, log);
  const siteId = await getSiteId(graph, cfg, log);

  const result = await computeIndicateurs(graph, siteId, { dryRun, log });

  log(formatIndicateursSummary(result, dryRun));
  log(
    "\nRejouable à volonté (upsert par Title). La nuit, la Function " +
      "residentapp-soldes-timer\nrefait ce calcul après la synchro Soldes — " +
      "lancer à la main = rafraîchir sans attendre."
  );
}

main().catch((error: unknown) => {
  if (error instanceof SoldesSyncError) fail(error.message);
  fail(error instanceof Error ? error.message : String(error));
});
