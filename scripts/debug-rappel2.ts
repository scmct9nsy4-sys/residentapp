/* ============================================================================
 *  scripts/debug-rappel2.ts — DIAGNOSTIC du rappel 2 (jetable, LECTURE SEULE)
 * ----------------------------------------------------------------------------
 *  Pourquoi ce fichier : le message « plus aucun mois à relancer » de
 *  runReminder2 confond DEUX cas très différents :
 *    (1) le mois a été TROUVÉ dans Soldes mais REJETÉ (payé / sous plan /
 *        déjà escaladé / pas encore au niveau 1) ;
 *    (2) le mois n'a PAS ÉTÉ TROUVÉ du tout (FA ou YearMonth qui ne
 *        correspondent pas entre Journal-Rappels et Soldes).
 *
 *  Ce script affiche, pour un FA donné, EXACTEMENT ce que voit le moteur :
 *  les lignes Queued du journal, les mois qu'elles couvrent, et chaque ligne
 *  Soldes du FA avec le verdict critère par critère.
 *
 *  Il n'écrit RIEN. Il peut être supprimé après usage (ou gardé : il resservira
 *  au premier « pourquoi ce dossier n'est-il pas parti ? » de la production).
 *
 *  Usage (depuis la RACINE du dépôt) :
 *    npx tsx scripts/debug-rappel2.ts FA00251472
 * ============================================================================ */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SoldesSyncError,
  SOLDES_LIST_NAME,
  createGraphClient,
  findListByName,
  getSiteId,
  type Settings,
} from "./lib/soldes-sync.js";

import { JOURNAL_LIST_NAME } from "./lib/rappels.js";

const REQUIRED_SETTINGS = [
  "TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "SP_SITE_HOSTNAME",
  "SP_SITE_PATH",
] as const;

type ListItem = { id: string; fields: Record<string, unknown> };

const log = (m: string): void => console.log(m);

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function loadSettings(): Settings {
  const path = resolve(process.cwd(), "api/local.settings.json");
  let values: Record<string, string> = {};
  try {
    const json = JSON.parse(readFileSync(path, "utf-8")) as {
      Values?: Record<string, string>;
    };
    values = json.Values ?? {};
  } catch {
    log("ℹ api/local.settings.json introuvable — variables d'environnement.");
  }
  for (const key of REQUIRED_SETTINGS) {
    const v = (process.env[key] ?? "").trim();
    if (v) values[key] = v;
  }
  const missing = REQUIRED_SETTINGS.filter((k) => !(values[k] ?? "").trim());
  if (missing.length > 0) fail(`Variable(s) manquante(s) : ${missing.join(", ")}.`);
  return {
    TENANT_ID: values["TENANT_ID"]!.trim(),
    GRAPH_CLIENT_ID: values["GRAPH_CLIENT_ID"]!.trim(),
    GRAPH_CLIENT_SECRET: values["GRAPH_CLIENT_SECRET"]!.trim(),
    SP_SITE_HOSTNAME: values["SP_SITE_HOSTNAME"]!.trim(),
    SP_SITE_PATH: values["SP_SITE_PATH"]!.trim(),
  };
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function esc(v: string): string {
  return v.replace(/'/g, "''");
}

/** Rend visibles les espaces parasites et le type réel de la valeur. */
function raw(v: unknown): string {
  if (v === undefined) return "(absent)";
  if (v === null) return "(null)";
  return `« ${String(v)} » [${typeof v}]`;
}

async function main(): Promise<void> {
  const fa = (process.argv[2] ?? "").trim();
  if (!fa) {
    fail(
      "Numéro FA attendu.\n  Exemple : npx tsx scripts/debug-rappel2.ts FA00251472"
    );
  }

  const cfg = loadSettings();
  const graph = createGraphClient(cfg, log);
  const siteId = await getSiteId(graph, cfg, log);

  const soldes = await findListByName(graph, siteId, SOLDES_LIST_NAME);
  const journal = await findListByName(graph, siteId, JOURNAL_LIST_NAME);
  if (!soldes) fail(`Liste « ${SOLDES_LIST_NAME} » introuvable.`);
  if (!journal) fail(`Liste « ${JOURNAL_LIST_NAME} » introuvable.`);

  // ---------------------------------------------------------------------
  //  1. Les lignes du journal pour ce FA (toutes, pas seulement Queued)
  // ---------------------------------------------------------------------
  log("");
  log("══════════════════════════════════════════════════");
  log(`  JOURNAL-RAPPELS — lignes du FA ${fa}`);
  log("══════════════════════════════════════════════════");

  const journalRows = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${journal.id}/items` +
      `?$expand=fields($select=Title,FedasilNumber,Level,Status,MonthsCovered,ValidatedBy)` +
      `&$filter=fields/FedasilNumber eq '${esc(fa)}'&$top=200`
  );

  if (journalRows.length === 0) {
    log("  ⚠ AUCUNE ligne pour ce FA.");
    log("    → Soit le FA du journal diffère de celui saisi ici,");
    log("      soit un espace parasite s'est glissé dans FedasilNumber.");
  }

  const wantedMonths: number[] = [];
  for (const it of journalRows) {
    const f = it.fields ?? {};
    const level = toNumber(f["Level"]);
    const status = String(f["Status"] ?? "").trim();
    const covered = String(f["MonthsCovered"] ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));

    log("");
    log(`  Title         : ${raw(f["Title"])}`);
    log(`  FedasilNumber : ${raw(f["FedasilNumber"])}`);
    log(`  Level         : ${raw(f["Level"])} -> lu comme ${level}`);
    log(`  Status        : ${raw(f["Status"])}`);
    log(`  MonthsCovered : ${raw(f["MonthsCovered"])}`);
    log(`     -> mois demandés (après découpage) : [${covered.join(", ")}]`);

    const retenue = status === "Queued" && level === 2;
    log(
      retenue
        ? "  ✓ Cette ligne EST prise dans le lot (Queued + niveau 2)."
        : "  ✗ Cette ligne n'est PAS dans le lot (il faut Status=Queued ET Level=2)."
    );
    if (retenue) wantedMonths.push(...covered);
  }

  // ---------------------------------------------------------------------
  //  2. Les lignes Soldes du FA, critère par critère
  // ---------------------------------------------------------------------
  log("");
  log("══════════════════════════════════════════════════");
  log(`  SOLDES — lignes du FA ${fa}`);
  log("══════════════════════════════════════════════════");

  const soldesRows = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${soldes.id}/items` +
      `?$expand=fields($select=Title,FedasilNumber,Year,Month,YearMonth,Balance,PayStatus,DueDate,ReminderLevel,Reminder1Date,PaymentPlanRef)` +
      `&$filter=fields/FedasilNumber eq '${esc(fa)}'&$top=200`
  );

  log(`  ${soldesRows.length} ligne(s) trouvée(s) par le MÊME filtre que le moteur.`);
  if (soldesRows.length === 0) {
    log("  ⚠ Le moteur ne voit AUCUNE ligne Soldes pour ce FA.");
    log("    → C'est la cause du « Skipped ». Vérifier le FA exact dans Soldes.");
  }

  const eligibles: number[] = [];
  for (const it of soldesRows) {
    const f = it.fields ?? {};
    const ym = toNumber(f["YearMonth"]);
    const payStatus = String(f["PayStatus"] ?? "").trim();
    const balance = toNumber(f["Balance"]);
    const level = toNumber(f["ReminderLevel"]);
    const plan = String(f["PaymentPlanRef"] ?? "").trim();

    const cPay = payStatus === "Unpaid" || payStatus === "Partial";
    const cBal = balance > 0.004;
    const cLvl = level === 1;
    const cPlan = plan === "";
    const ok = cPay && cBal && cLvl && cPlan;
    if (ok) eligibles.push(ym);

    // On n'affiche en détail que les lignes demandées, ou les éligibles :
    // sinon 10 trimestres de lignes noieraient le diagnostic.
    const demandee = wantedMonths.includes(ym);
    if (!demandee && !ok) continue;

    log("");
    log(`  ── YearMonth ${ym} ${demandee ? "(DEMANDÉ par le journal)" : ""}`);
    log(`     Title         : ${raw(f["Title"])}`);
    log(`     YearMonth     : ${raw(f["YearMonth"])} -> lu comme ${ym}`);
    log(`     ${cPay ? "✓" : "✗"} PayStatus     : ${raw(f["PayStatus"])} (attendu Unpaid ou Partial)`);
    log(`     ${cBal ? "✓" : "✗"} Balance       : ${raw(f["Balance"])} (attendu > 0)`);
    log(`     ${cLvl ? "✓" : "✗"} ReminderLevel : ${raw(f["ReminderLevel"])} -> lu comme ${level} (attendu EXACTEMENT 1)`);
    log(`     ${cPlan ? "✓" : "✗"} PaymentPlanRef: ${raw(f["PaymentPlanRef"])} (attendu vide)`);
    log(`     ${ok ? "✓ ÉLIGIBLE au rappel 2" : "✗ REJETÉ"}`);
  }

  // ---------------------------------------------------------------------
  //  3. Le verdict : appariement demandé <-> éligible
  // ---------------------------------------------------------------------
  log("");
  log("══════════════════════════════════════════════════");
  log("  VERDICT");
  log("══════════════════════════════════════════════════");
  log(`  Mois demandés par le journal : [${wantedMonths.join(", ") || "aucun"}]`);
  log(`  Mois éligibles dans Soldes   : [${eligibles.join(", ") || "aucun"}]`);

  const retenus = wantedMonths.filter((m) => eligibles.includes(m));
  log(`  Intersection (ce que le moteur enverrait) : [${retenus.join(", ") || "aucun"}]`);
  log("");

  if (retenus.length > 0) {
    log("  ✓ Le rappel 2 devrait partir. Si ce n'est pas le cas, relancer :");
    log("      npm run sp:rappels -- --rappel2 --sans-garde-fou");
  } else if (wantedMonths.length === 0) {
    log("  → CAUSE : aucune ligne Queued niveau 2 pour ce FA (voir section 1).");
  } else if (eligibles.length === 0) {
    log("  → CAUSE : aucun mois de ce FA n'est éligible (voir les ✗ ci-dessus).");
    log("    Le plus fréquent : ReminderLevel n'est pas EXACTEMENT 1.");
  } else {
    log("  → CAUSE : les mois demandés et les mois éligibles ne se recouvrent PAS.");
    log("    C'est un problème de VALEUR de MonthsCovered (format AAAAMM attendu,");
    log("    par exemple 202512 — ni 2025-12, ni 12, ni « T4 2025 »).");
  }
  log("");
}

main().catch((err) => {
  if (err instanceof SoldesSyncError) fail(err.message);
  console.error(err);
  process.exit(1);
});
