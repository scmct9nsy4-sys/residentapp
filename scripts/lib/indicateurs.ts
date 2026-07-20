/* ============================================================================
 *  scripts/lib/indicateurs.ts — Indicateurs PRÉCALCULÉS du tableau de bord
 * ----------------------------------------------------------------------------
 *  Module 1 de CONCEPTION-STAFF-APP.md (décision du 20/7/2026) : SharePoint ne
 *  calcule aucun agrégat côté serveur (pas de SUM) et les requêtes par ABSENCE
 *  (« qui n'a pas déclaré ce trimestre ») sont impossibles en $filter. Tout se
 *  précalcule donc ICI, la nuit, et l'écran du tableau de bord ne recalcule
 *  JAMAIS : il lit la mini-liste « Indicateurs » (une ligne par indicateur,
 *  clé = Title, upsert idempotent).
 *
 *  Comme scripts/lib/soldes-sync.ts : AUCUN argv, AUCUN process.exit — ce
 *  module est appelé TEL QUEL par le wrapper CLI (scripts/
 *  compute-indicateurs.ts, commande npm run sp:indicateurs) ET par la Function
 *  nocturne residentapp-soldes-timer (juste APRÈS syncAuto : les agrégats
 *  sont alors cohérents avec la photo Soldes de la même nuit). Une seule
 *  définition des règles, aucune dérive possible.
 *
 *  Balayages : lectures PAGINÉES SANS FILTRE (discipline « 5000 », principe
 *  §6 point 5 de la conception — un traitement de fond n'est pas soumis au
 *  seuil). Volumes de référence (13/7) : Residents List ~2 000, KB-Cumul
 *  active ≤ 6 000, Soldes ~8 000/an, KB-Paiements ~24 000/an : quelques
 *  dizaines de pages Graph, négligeable pour un traitement nocturne.
 *
 *  TROIS ÉCRIVAINS de la liste « Indicateurs » :
 *    - computeIndicateurs()  (ce module)         : les agrégats nocturnes ;
 *    - sp:paiements                              : estampille LastPaymentImport
 *                                                  (fin d'un import RÉEL) ;
 *    - le timer nocturne                         : estampille LastSoldesSync
 *                                                  (après un syncAuto réussi).
 *  Les deux estampilles passent par stampIndicator() (exporté ici).
 *
 *  ⚠ La FILE DE LETTRAGE ne se précalcule PAS : elle se compte EN DIRECT à
 *  l'écran (Status indexée, ~200 lignes) — une valeur de la veille ferait un
 *  garde-fou menteur (conception, module 1).
 * ============================================================================ */

import {
  SoldesSyncError,
  SOLDES_LIST_NAME,
  findListByName,
  readActiveQuarter,
  type ActiveQuarter,
  type GraphClient,
  type Logger,
} from "./soldes-sync.js";

// ---------------------------------------------------------------------------
//  Constantes de schéma
// ---------------------------------------------------------------------------

export const INDICATEURS_LIST_NAME = "Indicateurs";
const RESIDENTS_LIST_NAME = "Residents List";
const PAIEMENTS_LIST_NAME = "KB-Paiements";

/** Colonnes de la liste Indicateurs écrites par ce module (garde-fou au
 *  démarrage, même principe qu'assertSoldesColumns). `Title` est la clé. */
export const INDICATEURS_COLUMNS = [
  "Title",
  "NumValue",
  "TextValue",
  "Scope",
  "ComputedAt",
  "Detail",
] as const;

/** Codes NEUTRES des indicateurs (clé Title — l'interface staff traduit). */
export const INDICATOR = {
  declaredResidents: "DeclaredResidents",
  notDeclaredResidents: "NotDeclaredResidents",
  quarterDueTotal: "QuarterDueTotal",
  quarterPaidTotal: "QuarterPaidTotal",
  overdueTotal: "OverdueTotal",
  overdueMonths: "OverdueMonths",
  overdueResidents: "OverdueResidents",
  overdueOutOfWindowTotal: "OverdueOutOfWindowTotal",
  structuredComRateQuarter: "StructuredComRateQuarter",
  lastPaymentImport: "LastPaymentImport",
  lastSoldesSync: "LastSoldesSync",
} as const;

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

type ListItem = { id: string; fields: Record<string, unknown> };

/** Une ligne à écrire (upsert par Title) dans la liste Indicateurs. */
export type IndicatorUpsert = {
  title: string;
  numValue?: number;
  textValue?: string;
  scope?: string;
  detail?: string;
};

export type ComputeOptions = {
  dryRun: boolean;
  log: Logger;
  /** « Maintenant » injectable (tests) — défaut : new Date(). */
  now?: Date;
};

export type ComputeResult = {
  active: ActiveQuarter;
  rows: IndicatorUpsert[];
  created: number;
  updated: number;
};

// ---------------------------------------------------------------------------
//  Petits utilitaires (mêmes conventions que soldes-sync.ts)
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function normFa(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

/** Les 4 trimestres de la fenêtre, du plus ANCIEN au plus récent (le courant
 *  en dernier) — même arithmétique que yearOfCumulList : q ≤ actif → année
 *  active, sinon année précédente. */
export function windowQuarters(
  active: ActiveQuarter
): Array<{ year: number; quarter: number }> {
  const out: Array<{ year: number; quarter: number }> = [];
  for (let i = 3; i >= 0; i--) {
    let q = active.quarter - i;
    let y = active.year;
    if (q < 1) {
      q += 4;
      y -= 1;
    }
    out.push({ year: y, quarter: q });
  }
  return out;
}

function euro(n: number): string {
  return `${round2(n).toFixed(2)} €`;
}

// ---------------------------------------------------------------------------
//  Garde-fou : les colonnes existent-elles AVANT d'écrire ?
// ---------------------------------------------------------------------------

export async function assertIndicateursColumns(
  graph: GraphClient,
  siteId: string,
  listId: string
): Promise<void> {
  const json = await graph.get<{
    value: Array<{ name?: string; displayName?: string }>;
  }>(`/sites/${siteId}/lists/${listId}/columns?$select=name,displayName`);

  const present = new Set<string>();
  for (const c of json.value ?? []) {
    if (c.name) present.add(c.name.toLowerCase());
    if (c.displayName) present.add(c.displayName.toLowerCase());
  }

  const missing = INDICATEURS_COLUMNS.filter(
    (c) => !present.has(c.toLowerCase())
  );
  if (missing.length > 0) {
    throw new SoldesSyncError(
      `La liste « ${INDICATEURS_LIST_NAME} » n'a pas les colonnes attendues : ` +
        `${missing.join(", ")}.\n` +
        `  → Le schéma a évolué mais la liste n'a pas suivi. Lancer d'abord :\n` +
        `     npm run sp:provision\n` +
        `  puis relancer (upsert : rien n'est perdu).`
    );
  }
}

// ---------------------------------------------------------------------------
//  Upsert par Title — la liste est minuscule : UNE lecture, puis POST/PATCH
// ---------------------------------------------------------------------------

async function openIndicateurs(
  graph: GraphClient,
  siteId: string
): Promise<{ listId: string; byTitle: Map<string, string> }> {
  const list = await findListByName(graph, siteId, INDICATEURS_LIST_NAME);
  if (!list) {
    throw new SoldesSyncError(
      `Liste « ${INDICATEURS_LIST_NAME} » introuvable. → npm run sp:provision`
    );
  }
  await assertIndicateursColumns(graph, siteId, list.id);

  const items = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${list.id}/items` +
      `?$expand=fields($select=Title)&$top=200`
  );
  const byTitle = new Map<string, string>();
  for (const it of items) {
    const title = String(it.fields?.["Title"] ?? "").trim();
    if (title) byTitle.set(title, it.id);
  }
  return { listId: list.id, byTitle };
}

function upsertBody(row: IndicatorUpsert, computedAtIso: string) {
  return {
    fields: {
      Title: row.title,
      NumValue: row.numValue ?? null,
      TextValue: row.textValue ?? "",
      Scope: row.scope ?? "",
      ComputedAt: computedAtIso,
      Detail: row.detail ?? "",
    },
  };
}

async function upsertRows(
  graph: GraphClient,
  siteId: string,
  listId: string,
  byTitle: Map<string, string>,
  rows: IndicatorUpsert[],
  computedAtIso: string,
  dryRun: boolean,
  log: Logger
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existingId = byTitle.get(row.title);
    const num =
      row.numValue === undefined ? "" : ` = ${round2(row.numValue)}`;
    const scope = row.scope ? ` [${row.scope}]` : "";

    if (dryRun) {
      log(
        `   ~ [dry-run] ${existingId ? "MAJ " : "créer"} ${row.title}${num}${scope}`
      );
      if (existingId) updated++;
      else created++;
      continue;
    }

    if (existingId) {
      await graph.write(
        "PATCH",
        `/sites/${siteId}/lists/${listId}/items/${existingId}/fields`,
        upsertBody(row, computedAtIso).fields
      );
      updated++;
    } else {
      await graph.write(
        "POST",
        `/sites/${siteId}/lists/${listId}/items`,
        upsertBody(row, computedAtIso)
      );
      created++;
    }
    log(`   ✓ ${row.title}${num}${scope}`);
  }

  return { created, updated };
}

// ---------------------------------------------------------------------------
//  Estampilles (LastPaymentImport, LastSoldesSync) — appelées par les ACTEURS
// ---------------------------------------------------------------------------
//
//  « Chaque acteur estampille son propre passage » : sp:paiements en fin
//  d'import réel, le timer après un syncAuto réussi. JAMAIS en dry-run (une
//  estampille de répétition serait un faux témoin de fraîcheur).
//  ⚠ Côté appelant : envelopper dans un try/catch — une estampille qui échoue
//  ne doit JAMAIS faire échouer le traitement qu'elle documente.

export async function stampIndicator(
  graph: GraphClient,
  siteId: string,
  stamp: IndicatorUpsert,
  log: Logger
): Promise<void> {
  const { listId, byTitle } = await openIndicateurs(graph, siteId);
  await upsertRows(
    graph,
    siteId,
    listId,
    byTitle,
    [stamp],
    new Date().toISOString(),
    false,
    log
  );
}

// ---------------------------------------------------------------------------
//  Le calcul nocturne
// ---------------------------------------------------------------------------

export async function computeIndicateurs(
  graph: GraphClient,
  siteId: string,
  opts: ComputeOptions
): Promise<ComputeResult> {
  const { dryRun, log } = opts;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  // -- 0. Trimestre actif (liste Config — la MÊME source que tout le monde) --
  const active = await readActiveQuarter(graph, siteId);
  const quarterScope = `T${active.quarter} ${active.year}`;
  const win = windowQuarters(active);
  const windowScope =
    `fenêtre T${win[0]!.quarter} ${win[0]!.year} → ` +
    `T${active.quarter} ${active.year}`;
  const inWindow = new Set(win.map((w) => `${w.year}-${w.quarter}`));
  log(
    `Trimestre actif (liste Config) : ${quarterScope} — ${windowScope}` +
      (dryRun ? "   [MODE --dry-run : AUCUNE écriture]" : "")
  );

  // -- 1. KB-Cumul active : déclarés + montants du trimestre courant ---------
  //    (règle de vérité §5.20 : le trimestre COURANT se lit dans KB-Cumul)
  const cumulItems = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${active.cumulListId}/items` +
      `?$expand=fields($select=FedasilNumber,Contribution,Paid)&$top=200`
  );
  const declaredFa = new Set<string>();
  let dueTotal = 0;
  let paidTotal = 0;
  for (const it of cumulItems) {
    const fa = normFa(it.fields?.["FedasilNumber"]);
    if (fa) declaredFa.add(fa);
    dueTotal += toNumber(it.fields?.["Contribution"]);
    paidTotal += toNumber(it.fields?.["Paid"]);
  }
  log(
    `KB-Cumul « ${active.cumulListName} » : ${cumulItems.length} mois déclarés, ` +
      `${declaredFa.size} FA distincts`
  );

  // -- 2. Residents List : la requête par ABSENCE ---------------------------
  //    Population de référence = TOUTE la liste (décision GI 20/7/2026 — la
  //    consolidation des désinscrits dans une liste unique viendra plus tard).
  const residentsList = await findListByName(graph, siteId, RESIDENTS_LIST_NAME);
  if (!residentsList) {
    throw new SoldesSyncError(
      `Liste « ${RESIDENTS_LIST_NAME} » introuvable sur le site.`
    );
  }
  const residents = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${residentsList.id}/items` +
      `?$expand=fields($select=FedasilNumber)&$top=200`
  );
  const populationFa = new Set<string>();
  for (const it of residents) {
    const fa = normFa(it.fields?.["FedasilNumber"]);
    if (fa) populationFa.add(fa); // FA DISTINCTS : un doublon de ligne ne compte qu'une fois
  }
  let notDeclared = 0;
  for (const fa of populationFa) {
    if (!declaredFa.has(fa)) notDeclared++;
  }
  // Garde-fou gratuit : des FA ont-ils déclaré SANS exister dans Residents List ?
  let orphanDeclared = 0;
  for (const fa of declaredFa) {
    if (!populationFa.has(fa)) orphanDeclared++;
  }
  log(
    `Residents List : ${residents.length} ligne(s), ${populationFa.size} FA distincts — ` +
      `${notDeclared} sans déclaration ce trimestre`
  );
  if (residents.length > populationFa.size) {
    log(
      `   ⚠ ${residents.length - populationFa.size} ligne(s) en DOUBLON de FA dans ` +
        `Residents List (comptées une seule fois).`
    );
  }
  if (orphanDeclared > 0) {
    log(
      `   ⚠ ${orphanDeclared} FA ont déclaré dans « ${active.cumulListName} » sans ` +
        `exister dans Residents List — anomalie de données à investiguer.`
    );
  }

  // -- 3. Soldes : les retards (fenêtre ET hors fenêtre, même balayage) ------
  //    Balance > 0 et DueDate dépassée. Les lignes du trimestre courant sont
  //    celles de la DERNIÈRE synchro nocturne : cohérentes quand ce calcul
  //    tourne juste après syncAuto (le timer), légèrement en retrait sinon —
  //    acceptable pour un tableau de bord, chaque ligne porte son ComputedAt.
  const soldesList = await findListByName(graph, siteId, SOLDES_LIST_NAME);
  if (!soldesList) {
    throw new SoldesSyncError(
      `Liste « ${SOLDES_LIST_NAME} » introuvable. → npm run sp:provision`
    );
  }
  const soldes = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${soldesList.id}/items` +
      `?$expand=fields($select=FedasilNumber,Year,Quarter,Balance,DueDate)&$top=200`
  );
  let overdueTotal = 0;
  let overdueMonths = 0;
  const overdueFa = new Set<string>();
  let overdueOutOfWindow = 0;
  for (const it of soldes) {
    const balance = toNumber(it.fields?.["Balance"]);
    if (balance <= 0) continue;
    const dueRaw = it.fields?.["DueDate"];
    const dueMs = dueRaw ? new Date(String(dueRaw)).getTime() : NaN;
    if (!Number.isFinite(dueMs) || dueMs >= nowMs) continue; // pas (encore) échu

    const key = `${toNumber(it.fields?.["Year"])}-${toNumber(it.fields?.["Quarter"])}`;
    if (inWindow.has(key)) {
      overdueTotal += balance;
      overdueMonths++;
      const fa = normFa(it.fields?.["FedasilNumber"]);
      if (fa) overdueFa.add(fa);
    } else {
      overdueOutOfWindow += balance;
    }
  }
  log(
    `Soldes : ${soldes.length} lignes balayées — ${overdueMonths} mois en retard ` +
      `(${euro(overdueTotal)}) dans la fenêtre, ${euro(overdueOutOfWindow)} hors fenêtre`
  );

  // -- 4. KB-Paiements : taux de communications structurées du trimestre -----
  //    Adoption du QR (§5.17, objectif 100 %). Compté sur la DATE VALEUR du
  //    virement (PaymentDate dans le trimestre actif). StructuredCom non vide
  //    = structurée D'ORIGINE ou récupérée par sp:paiements (comm libre à 12
  //    chiffres valides recopiée) — les deux témoignent d'une intention QR.
  const paiementsList = await findListByName(graph, siteId, PAIEMENTS_LIST_NAME);
  if (!paiementsList) {
    throw new SoldesSyncError(
      `Liste « ${PAIEMENTS_LIST_NAME} » introuvable sur le site.`
    );
  }
  const paiements = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${paiementsList.id}/items` +
      `?$expand=fields($select=PaymentDate,StructuredCom)&$top=200`
  );
  const qMonths = [active.quarter * 3 - 2, active.quarter * 3 - 1, active.quarter * 3];
  let payTotal = 0;
  let payStructured = 0;
  for (const it of paiements) {
    const raw = it.fields?.["PaymentDate"];
    if (!raw) continue;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) continue;
    if (d.getUTCFullYear() !== active.year) continue;
    if (!qMonths.includes(d.getUTCMonth() + 1)) continue;
    payTotal++;
    if (String(it.fields?.["StructuredCom"] ?? "").trim() !== "") payStructured++;
  }
  const ratePct =
    payTotal === 0 ? 0 : Math.round((payStructured / payTotal) * 1000) / 10;
  log(
    `KB-Paiements : ${payTotal} virement(s) datés du trimestre, ` +
      `${payStructured} structurés (${ratePct} %)`
  );

  // -- 5. Écriture (upsert par Title) ---------------------------------------
  const rows: IndicatorUpsert[] = [
    {
      title: INDICATOR.declaredResidents,
      numValue: declaredFa.size,
      scope: quarterScope,
      detail: `FA distincts ayant au moins un mois déclaré dans « ${active.cumulListName} ».`,
    },
    {
      title: INDICATOR.notDeclaredResidents,
      numValue: notDeclared,
      textValue: `sur ${populationFa.size} FA distincts`,
      scope: quarterScope,
      detail:
        "Requête par ABSENCE (croisement Residents List × KB-Cumul active, " +
        "en FA DISTINCTS — les doublons de ligne ne comptent qu'une fois). " +
        "Population = toute la Residents List (décision 20/7/2026 — " +
        "consolidation des désinscrits à venir).",
    },
    {
      title: INDICATOR.quarterDueTotal,
      numValue: round2(dueTotal),
      scope: quarterScope,
      detail: "Somme des contributions du trimestre courant (KB-Cumul active).",
    },
    {
      title: INDICATOR.quarterPaidTotal,
      numValue: round2(paidTotal),
      scope: quarterScope,
      detail: "Somme des paiements cumulés du trimestre courant (KB-Cumul active).",
    },
    {
      title: INDICATOR.overdueTotal,
      numValue: round2(overdueTotal),
      scope: windowScope,
      detail:
        "Somme des Balance > 0 à échéance dépassée (Soldes, fenêtre des 4 " +
        "trimestres) — l'assiette du recouvrement (module 4).",
    },
    {
      title: INDICATOR.overdueMonths,
      numValue: overdueMonths,
      scope: windowScope,
      detail: "Nombre de MOIS en retard (granularité créance, conception module 4).",
    },
    {
      title: INDICATOR.overdueResidents,
      numValue: overdueFa.size,
      scope: windowScope,
      detail: "Nombre de FA distincts ayant au moins un mois en retard.",
    },
    {
      title: INDICATOR.overdueOutOfWindowTotal,
      numValue: round2(overdueOutOfWindow),
      scope: "hors fenêtre",
      detail:
        "Dettes échues SORTIES de la fenêtre des 4 trimestres (Soldes seul) — " +
        "l'assiette des communications d'apurement global 990 (§4.12).",
    },
    {
      title: INDICATOR.structuredComRateQuarter,
      numValue: ratePct,
      textValue: `${payStructured}/${payTotal}`,
      scope: quarterScope,
      detail:
        "Adoption du QR (objectif 100 %) : part des virements datés du " +
        "trimestre portant une communication structurée (d'origine ou " +
        "récupérée d'une communication libre par sp:paiements).",
    },
  ];

  const { listId, byTitle } = await openIndicateurs(graph, siteId);
  log("");
  const { created, updated } = await upsertRows(
    graph,
    siteId,
    listId,
    byTitle,
    rows,
    now.toISOString(),
    dryRun,
    log
  );

  return { active, rows, created, updated };
}

/** Résumé lisible d'une exécution (CLI et journal de la Function). */
export function formatIndicateursSummary(
  result: ComputeResult,
  dryRun: boolean
): string {
  return (
    `\nTOTAL${dryRun ? " (dry-run, AUCUNE écriture)" : ""} : ` +
    `${result.rows.length} indicateur(s) calculé(s) — ` +
    `${result.created} créé(s), ${result.updated} mis à jour ` +
    `(T${result.active.quarter} ${result.active.year}).`
  );
}
