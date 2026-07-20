/* ============================================================================
 *  scripts/import-paiements.ts — Import hebdomadaire des virements bancaires
 *                                (remplace le flux Power Automate d'imputation)
 * ----------------------------------------------------------------------------
 *  CE QUE FAIT CE SCRIPT (décisions du 17/7/2026, option A validée par GI) :
 *
 *   1. Lit un (ou plusieurs) export CSV bancaire hebdomadaire (BNPPF, `;`,
 *      montants belges « 983,25 », dates DD-MM-YYYY, encodage cp1252/latin-1).
 *   2. Écarte ce qui n'est pas un paiement résident (ligne de compte, pied
 *      « Totaal bedrag : », débits) — mais le JOURNALISE dans le rapport :
 *      rien ne disparaît en silence.
 *   3. IDEMPOTENCE : la « Ref. v/d verrichting » (unique, vérifiée sur
 *      3 semaines réelles) devient le Title de KB-Paiements. Rejouer un
 *      fichier ne crée AUCUN doublon.
 *   4. RÉSOLUTION de la communication :
 *      - flag « Y » : la banque a validé le mod 97, PAS notre espace de
 *        préfixes (vu en réel : +++240/... valide mod 97, préfixe inconnu).
 *        On revalide donc TOUT : 12 chiffres, familles 01-12 / 91-94 / 99,
 *        FA existant dans Residents List ;
 *      - flag « N » : on cherche une fenêtre de 12 chiffres valide mod 97
 *        dans Mededeling 1 puis 2 (résident qui recopie sa communication
 *        structurée en communication libre — 230 cas sur 356 N constatés).
 *        Si trouvée : la communication NORMALISÉE est écrite dans
 *        StructuredCom, la libre reste TELLE QUELLE dans FreeCom.
 *   5. IMPUTATION AUTOMATIQUE (mêmes familles que le module 3 de l'app
 *      staff) : mois désigné (01-12), FIFO au sein du trimestre (9T0),
 *      FIFO toute ancienneté (990). Le plan doit consommer EXACTEMENT le
 *      montant ; trop-perçu, mois sans déclaration, FA introuvable,
 *      préfixe inconnu -> le virement est créé « ToProcess » : c'est la
 *      file de lettrage de l'app staff qui prend le relais.
 *   6. RE-TENTATIVE : à chaque exécution, les virements « ToProcess » déjà
 *      en liste sont re-tentés (une déclaration arrivée entre-temps
 *      débloque le virement tout seul, sans geste staff).
 *
 *  RÈGLE D'ÉCRITURE (⚠ alignée sur la DIRECTION de la synchro nocturne) :
 *
 *   | Le mois crédité est…            | On écrit dans…                     |
 *   |---------------------------------|------------------------------------|
 *   | dans la FENÊTRE des 4 trim.     | KB-Cumul (champ Paid seul) ET on   |
 *   | (sa ligne KB-Cumul existe)      | REFLÈTE la ligne Soldes si elle    |
 *   |                                 | existe (Paid+Balance+PayStatus)    |
 *   | HORS fenêtre (liste vidée)      | Soldes seul (seule vérité)         |
 *
 *   POURQUOI : sp:soldes --auto (nocturne) copie KB-Cumul -> Soldes pour les
 *   4 listes. Un crédit écrit dans Soldes SEUL pour un trimestre dont la
 *   ligne KB-Cumul existe encore serait ÉCRASÉ la nuit suivante par la
 *   resynchronisation. En écrivant KB-Cumul (et en reflétant Soldes pour la
 *   visibilité immédiate du portail), la synchro nocturne retrouve son point
 *   fixe : 0 création, 0 mise à jour. ⚠ Voir la note de session : le
 *   creditMonth du module 3 (app staff) écrit Soldes seul pour les
 *   trimestres clôturés de la fenêtre — à confronter à cette règle.
 *
 *  ROBUSTESSE AUX PANNES (SharePoint n'a pas de transaction) :
 *   - ORDRE pour un NOUVEAU virement imputable : journal local (WAL)
 *     « start » -> crédits des mois -> création de la ligne KB-Paiements
 *     déjà « Imputed » -> journal « done ». Un crash entre les crédits et
 *     la création laisserait la ref dans le WAL sans ligne SharePoint : au
 *     démarrage suivant, la ref est mise en QUARANTAINE (rapport) au lieu
 *     d'être ré-importée — AUCUN double crédit possible.
 *   - ORDRE pour une RE-TENTATIVE (ligne existante) : relecture du statut
 *     (garde-fou de concurrence avec l'app staff, comme le module 3) ->
 *     WAL « start » -> crédits -> PATCH « Imputed » -> WAL « done ».
 *   - Le WAL est scripts/import-paiements.wal.jsonl (append-only). Une fois
 *     les quarantaines vérifiées à la main, SUPPRIMER le fichier.
 *
 *  USAGE (depuis la RACINE du dépôt) :
 *
 *    npm run sp:paiements -- --dry-run chemin/vers/export.csv   ⭐ D'ABORD
 *    npm run sp:paiements -- chemin/vers/export.csv
 *    npm run sp:paiements -- fichier1.csv fichier2.csv          (rattrapage)
 *    npm run sp:paiements -- --retenter-seulement               (sans CSV :
 *                                     re-tente uniquement les « ToProcess »)
 *
 *  Un rapport est écrit à côté de chaque CSV traité
 *  (<fichier>.rapport-<horodatage>.txt) et récapitulé en console.
 *
 *  Identifiants : api/local.settings.json (Values) ou variables
 *  d'environnement — mêmes clés que sp:soldes.
 *
 *  ⚠ MÊMES RÈGLES que scripts/lib/soldes-sync.ts pour round2 / PayStatus
 *  (privées là-bas — toute évolution se fait DES DEUX CÔTÉS), et MÊME
 *  algorithme de communication structurée que Declare.ts et que l'app staff
 *  (structuredCom.ts / comDecode.ts) : préfixe (2) + « 0 » + 7 derniers
 *  chiffres du FA + contrôle mod 97 (0 -> 97).
 *
 *  ⚠ Colonnes Choice via GRAPH : on écrit la CHAÎNE du choix (« Imputed »).
 *  Le piège n°14 « { Value } » ne concerne QUE le SDK Power Apps de l'app
 *  staff — ne pas transposer ici, et réciproquement.
 * ============================================================================ */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  SoldesSyncError,
  SOLDES_LIST_NAME,
  createGraphClient,
  findListByName,
  getSiteId,
  readActiveQuarter,
  yearOfCumulList,
  type ActiveQuarter,
  type GraphClient,
  type Logger,
  type Settings,
} from "./lib/soldes-sync.js";
import { INDICATOR, stampIndicator } from "./lib/indicateurs.js";

// ---------------------------------------------------------------------------
//  Constantes de schéma
// ---------------------------------------------------------------------------

const PAIEMENTS_LIST_NAME = "KB-Paiements";
const RESIDENTS_LIST_NAME = "Residents List";
const WAL_PATH = "scripts/import-paiements.wal.jsonl";

/** Colonnes de KB-Paiements écrites par l'import (garde-fou au démarrage). */
const PAIEMENTS_COLUMNS = [
  "Title",
  "PaymentDate",
  "Amount",
  "StructuredCom",
  "FreeCom",
  "CounterpartyName",
  "CounterpartyIBAN",
  "FedasilNumber",
  "Month",
  "Status",
  "ImportFile",
  "BankSeq",
] as const;

/** Codes neutres attendus dans la colonne Choice « Status » (post-migration
 *  sp:paiements-status). Le garde-fou refuse de démarrer s'ils manquent. */
const STATUS_CODES = ["ToProcess", "Imputed", "Anomaly"] as const;

/** En-têtes du CSV bancaire réellement utilisées (relevées sur 3 fichiers
 *  réels du 29/9 au 19/10/2025 — en-têtes identiques sur les 3). */
const CSV = {
  seq: "Nr v/d verrichting",
  amount: "Bedrag v/d verrichting",
  valueDate: "Valutadatum",
  counterpartyIban: "Rekening tegenpartij",
  counterpartyName: "Naam tegenpartij",
  com1: "Mededeling 1",
  com2: "Mededeling 2",
  ref: "Ref. v/d verrichting",
  structFlag: "Gestructureerde mededeling",
} as const;

const AMOUNT_TOLERANCE = 0.005;

// ---------------------------------------------------------------------------
//  Règles partagées (⚠ mêmes définitions que soldes-sync.ts, privées là-bas)
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Statut dérivé §5.20 — CODES NEUTRES (identique à soldes-sync.payStatus). */
function derivePayStatus(balance: number, paid: number): string {
  if (balance <= 0) return "Paid";
  return paid > 0 ? "Partial" : "Unpaid";
}

// ---------------------------------------------------------------------------
//  Communication structurée — décodage (⚠ même algorithme que comDecode.ts)
// ---------------------------------------------------------------------------

type Decoded =
  | { kind: "month"; month: number; fa7: string; digits: string }
  | { kind: "quarter"; quarter: number; fa7: string; digits: string }
  | { kind: "global"; fa7: string; digits: string }
  /** 12 chiffres valides mod 97 mais préfixe hors familles (ex. réel : 24). */
  | { kind: "unknownPrefix"; fa7: string; digits: string };

/** Valide 12 chiffres : 3ᵉ chiffre « 0 » + contrôle mod 97 (0 -> 97). */
function isValid12(digits: string): boolean {
  if (digits.length !== 12 || !/^\d{12}$/.test(digits)) return false;
  if (digits[2] !== "0") return false;
  const expected = Number(digits.slice(0, 10)) % 97 || 97;
  return expected === Number(digits.slice(10, 12));
}

function decode12(digits: string): Decoded {
  const prefix = Number(digits.slice(0, 2));
  const fa7 = digits.slice(3, 10);
  if (prefix >= 1 && prefix <= 12) return { kind: "month", month: prefix, fa7, digits };
  if (prefix >= 91 && prefix <= 94)
    return { kind: "quarter", quarter: prefix - 90, fa7, digits };
  if (prefix === 99) return { kind: "global", fa7, digits };
  return { kind: "unknownPrefix", fa7, digits };
}

/**
 * Cherche UNE fenêtre de 12 chiffres valide dans un texte libre (apostrophe
 * Excel, +++, espaces, texte autour : seuls les CHIFFRES comptent — vu en
 * réel : « +++090/0771/79920+++ fiche de paie aout 2025 recu … »).
 * Renvoie null si aucune fenêtre, « ambiguous » si PLUSIEURS fenêtres
 * DIFFÉRENTES sont valides (jamais vu sur 1 394 lignes, mais on ne devine
 * pas avec l'argent des gens).
 */
function extract12(raw: string): string | "ambiguous" | null {
  const digits = raw.replace(/\D/g, "");
  const found = new Set<string>();
  for (let i = 0; i + 12 <= digits.length; i++) {
    const cand = digits.slice(i, i + 12);
    if (isValid12(cand)) found.add(cand);
  }
  if (found.size === 0) return null;
  if (found.size > 1) return "ambiguous";
  return [...found][0]!;
}

/** +++xxx/xxxx/xxxxx+++ (même mise en forme que Declare.ts et l'app staff). */
function formatCom(digits: string): string {
  return `+++${digits.slice(0, 3)}/${digits.slice(3, 7)}/${digits.slice(7, 12)}+++`;
}

// ---------------------------------------------------------------------------
//  Lecture du CSV bancaire (cp1252, `;`, guillemets éventuels)
// ---------------------------------------------------------------------------

/** Découpe une ligne CSV `;` en gérant les champs entre guillemets (""). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** « 983,25 » / « -3.964,35 » -> nombre. null si illisible. */
function parseBelgianAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return round2(Number(s));
}

/** « 10-10-2025 » -> ISO UTC minuit. null si illisible. */
function parseBelgianDate(raw: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Un virement lu du CSV, avant résolution. */
type CsvPayment = {
  ref: string;
  seq: string;
  amount: number;
  paymentDateIso: string;
  counterpartyName: string;
  counterpartyIban: string;
  com1: string;
  com2: string;
  structFlag: boolean;
  importFile: string;
};

type CsvParseResult = {
  payments: CsvPayment[];
  /** Lignes écartées, JOURNALISÉES : [raison, détail lisible]. */
  excluded: Array<[string, string]>;
};

function parseCsvFile(path: string): CsvParseResult {
  // Encodage bancaire belge : cp1252 ⊃ latin-1 ; Node décode latin1
  // octet par octet — jamais d'exception, jamais de perte de chiffres.
  const text = readFileSync(path).toString("latin1");
  const lines = text.split(/\r?\n/);
  const importFile = basename(path);

  const result: CsvParseResult = { payments: [], excluded: [] };

  // L'en-tête est la ligne qui commence par la colonne séquence — la ligne
  // « Nr v/d rekening : » (compte) qui la précède est simplement ignorée.
  let headerIndex = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const cells = splitCsvLine(lines[i] ?? "").map((c) => c.trim());
    if (cells[0] === CSV.seq) {
      headerIndex = i;
      headers = cells;
      break;
    }
  }
  if (headerIndex < 0) {
    throw new SoldesSyncError(
      `${importFile} : ligne d'en-têtes introuvable (« ${CSV.seq} » attendu ` +
        `en première colonne). Le format bancaire a-t-il changé ?`
    );
  }

  const col = new Map<string, number>();
  headers.forEach((h, i) => col.set(h, i));
  const missing = Object.values(CSV).filter((name) => !col.has(name));
  if (missing.length > 0) {
    throw new SoldesSyncError(
      `${importFile} : colonne(s) manquante(s) dans le CSV : ` +
        `${missing.join(", ")}. Le format bancaire a changé — NE PAS forcer.`
    );
  }
  const cell = (cells: string[], name: string): string =>
    (cells[col.get(name)!] ?? "").trim();

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const seq = cell(cells, CSV.seq);

    // Pied « Totaal bedrag : » (et toute ligne non numérotée) : écarté.
    if (!/^\d+$/.test(seq)) {
      result.excluded.push(["hors-donnees", `ligne ${i + 1} : « ${seq || line.slice(0, 40)} »`]);
      continue;
    }

    const amount = parseBelgianAmount(cell(cells, CSV.amount));
    if (amount === null) {
      result.excluded.push([
        "montant-illisible",
        `n° ${seq} : montant « ${cell(cells, CSV.amount)} »`,
      ]);
      continue;
    }
    // Débits (ex. réel : « Globalisatie op debetzijde per lot », −3 964,35 €)
    // et montants nuls : pas des paiements résidents. Journalisés.
    if (amount <= 0) {
      result.excluded.push([
        "debit-ou-nul",
        `n° ${seq} : ${amount.toFixed(2)} € (${cell(cells, CSV.counterpartyName) || "sans contrepartie"})`,
      ]);
      continue;
    }

    const ref = cell(cells, CSV.ref);
    if (!ref) {
      result.excluded.push([
        "sans-reference",
        `n° ${seq} : ${amount.toFixed(2)} € SANS « ${CSV.ref} » — import manuel requis`,
      ]);
      continue;
    }

    const dateIso = parseBelgianDate(cell(cells, CSV.valueDate));
    if (!dateIso) {
      result.excluded.push([
        "date-illisible",
        `n° ${seq} (ref ${ref}) : date « ${cell(cells, CSV.valueDate)} »`,
      ]);
      continue;
    }

    result.payments.push({
      ref,
      seq,
      amount,
      paymentDateIso: dateIso,
      counterpartyName: cell(cells, CSV.counterpartyName),
      counterpartyIban: cell(cells, CSV.counterpartyIban),
      com1: cell(cells, CSV.com1),
      com2: cell(cells, CSV.com2),
      structFlag: cell(cells, CSV.structFlag).toUpperCase() === "Y",
      importFile,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
//  Résolution d'un virement (communication -> famille + FA)
// ---------------------------------------------------------------------------

type Resolution =
  | {
      ok: true;
      decoded: Decoded & { kind: "month" | "quarter" | "global" };
      structuredCom: string;
      fedasilNumber: string;
    }
  | {
      ok: false;
      reason: string;
      /** Comm structurée à STOCKER quand même (flag Y ou 12 chiffres valides
       *  trouvés — l'app staff la décodera et l'affichera). */
      structuredCom: string | null;
      /** FA à stocker quand même si le fa7 désigne un résident unique
       *  (le virement apparaît alors dans la fiche 360°, non imputé). */
      fedasilNumber: string | null;
    };

function resolvePayment(
  com1: string,
  com2: string,
  structFlag: boolean,
  residentsByFa7: Map<string, string[]>
): Resolution {
  // 1. Trouver 12 chiffres valides : Mededeling 1 d'abord, puis 2.
  let digits: string | null = null;
  for (const source of [com1, com2]) {
    if (!source) continue;
    const found = extract12(source);
    if (found === "ambiguous") {
      return {
        ok: false,
        reason: "plusieurs communications valides différentes dans le libellé",
        structuredCom: null,
        fedasilNumber: null,
      };
    }
    if (found) {
      digits = found;
      break;
    }
  }

  if (!digits) {
    return {
      ok: false,
      reason: structFlag
        ? "flag Y mais aucune séquence de 12 chiffres valide (contrôler la ligne)"
        : "aucune communication exploitable (lettrage manuel)",
      structuredCom: null,
      fedasilNumber: null,
    };
  }

  const decoded = decode12(digits);
  const faMatches = residentsByFa7.get(decoded.fa7) ?? [];
  const fa = faMatches.length === 1 ? faMatches[0]! : null;

  if (decoded.kind === "unknownPrefix") {
    return {
      ok: false,
      reason: `préfixe « ${digits.slice(0, 2)} » hors familles 01-12 / 91-94 / 99`,
      structuredCom: formatCom(digits),
      fedasilNumber: fa,
    };
  }
  if (faMatches.length === 0) {
    return {
      ok: false,
      reason: `aucun résident dont le FA se termine par ${decoded.fa7}`,
      structuredCom: formatCom(digits),
      fedasilNumber: null,
    };
  }
  if (faMatches.length > 1) {
    return {
      ok: false,
      reason: `PLUSIEURS résidents partagent les 7 chiffres ${decoded.fa7} (${faMatches.join(", ")})`,
      structuredCom: formatCom(digits),
      fedasilNumber: null,
    };
  }

  return {
    ok: true,
    decoded,
    structuredCom: formatCom(digits),
    fedasilNumber: fa!,
  };
}

// ---------------------------------------------------------------------------
//  Contexte SharePoint : listes, résidents, mois imputables par FA
// ---------------------------------------------------------------------------

type ListItem = { id: string; fields: Record<string, unknown> };

/** Un mois imputable — la fenêtre vient de KB-Cumul, le reste de Soldes. */
type MoisImputable = {
  source: "cumul" | "soldes";
  /** id de l'item dans SA liste source (KB-Cumul T<q> ou Soldes). */
  itemId: string;
  /** 1-4 : liste KB-Cumul à écrire (source « cumul » uniquement). */
  cumulQuarter: number;
  year: number;
  month: number;
  yearMonth: number;
  contribution: number;
  paid: number;
  balance: number;
  /** id de la ligne Soldes MIROIR (source « cumul » : reflet immédiat). */
  soldesMirrorId: string | null;
  title: string; // FA-YYYY-MM (lisibilité rapport + WAL)
};

type SharePointContext = {
  graph: GraphClient;
  siteId: string;
  active: ActiveQuarter;
  paiementsListId: string;
  soldesListId: string;
  /** id de chaque liste KB-Cumul T1..T4 (index 1-4). */
  cumulListIds: Record<number, string>;
  /** fa7 -> FA complets correspondants (détection de collision). */
  residentsByFa7: Map<string, string[]>;
  /** « FA|yearMonth » -> ligne KB-Cumul de la fenêtre. */
  cumulByKey: Map<string, { itemId: string; cumulQuarter: number; year: number; month: number; contribution: number; paid: number }>;
  /** yearMonth appartenant à la fenêtre des 4 trimestres. */
  windowYearMonths: Set<number>;
  /** Refs (Title) déjà présentes dans KB-Paiements. */
  existingRefs: Set<string>;
  /** Cache des lectures Soldes par FA. */
  soldesCache: Map<string, ListItem[]>;
  /**
   * Cache des mois imputables par FA — INDISPENSABLE et pas seulement une
   * optimisation : creditMonth mute `paid`/`balance` de ces objets, et le
   * cache garantit qu'un 2ᵉ virement du même lot pour le même FA voit les
   * crédits du 1ᵉʳ (sinon : cumul recalculé sur une photo périmée = crédit
   * PERDU en cas de deux virements sur le même mois).
   */
  monthsCache: Map<string, MoisImputable[]>;
};

async function loadContext(
  graph: GraphClient,
  siteId: string,
  log: Logger
): Promise<SharePointContext> {
  const active = await readActiveQuarter(graph, siteId);
  log(
    `Trimestre actif (liste Config) : T${active.quarter} ${active.year} ` +
      `(« ${active.cumulListName} »)`
  );

  // --- Listes ---------------------------------------------------------------
  const paiements = await findListByName(graph, siteId, PAIEMENTS_LIST_NAME);
  if (!paiements) {
    throw new SoldesSyncError(`Liste « ${PAIEMENTS_LIST_NAME} » introuvable.`);
  }
  const soldes = await findListByName(graph, siteId, SOLDES_LIST_NAME);
  if (!soldes) {
    throw new SoldesSyncError(`Liste « ${SOLDES_LIST_NAME} » introuvable.`);
  }
  const residents = await findListByName(graph, siteId, RESIDENTS_LIST_NAME);
  if (!residents) {
    throw new SoldesSyncError(`Liste « ${RESIDENTS_LIST_NAME} » introuvable.`);
  }

  await assertPaiementsSchema(graph, siteId, paiements.id);

  // --- Résidents : fa7 -> FA (validation d'existence + collisions) ---------
  const residentItems = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${residents.id}/items` +
      `?$expand=fields($select=FedasilNumber)&$top=200`
  );
  const residentsByFa7 = new Map<string, string[]>();
  for (const it of residentItems) {
    const fa = String(it.fields?.["FedasilNumber"] ?? "").trim();
    const digits = fa.replace(/\D/g, "");
    if (digits.length < 7) continue;
    const fa7 = digits.slice(-7);
    const list = residentsByFa7.get(fa7) ?? [];
    list.push(fa);
    residentsByFa7.set(fa7, list);
  }
  log(`Résidents : ${residentItems.length} ligne(s), ${residentsByFa7.size} fa7 distincts`);

  // --- Fenêtre des 4 trimestres : les 4 listes KB-Cumul ---------------------
  const cumulListIds: Record<number, string> = {};
  const cumulByKey: SharePointContext["cumulByKey"] = new Map();
  const windowYearMonths = new Set<number>();

  for (const q of [1, 2, 3, 4]) {
    const year = yearOfCumulList(q, active);
    for (const m of [q * 3 - 2, q * 3 - 1, q * 3]) {
      windowYearMonths.add(year * 100 + m);
    }
    const list = await findListByName(graph, siteId, `KB-Cumul T${q}`);
    if (!list) {
      throw new SoldesSyncError(`Liste « KB-Cumul T${q} » introuvable.`);
    }
    cumulListIds[q] = list.id;

    const items = await graph.getAllPages<ListItem>(
      `/sites/${siteId}/lists/${list.id}/items` +
        `?$expand=fields($select=FedasilNumber,Month,Contribution,Paid)&$top=200`
    );
    let kept = 0;
    for (const it of items) {
      const fa = String(it.fields?.["FedasilNumber"] ?? "").trim();
      const month = Number(it.fields?.["Month"]);
      if (!fa || !Number.isInteger(month) || month < 1 || month > 12) continue;
      cumulByKey.set(`${fa}|${year * 100 + month}`, {
        itemId: it.id,
        cumulQuarter: q,
        year,
        month,
        contribution: round2(toNumber(it.fields?.["Contribution"])),
        paid: round2(toNumber(it.fields?.["Paid"])),
      });
      kept++;
    }
    log(`KB-Cumul T${q} (${year}) : ${kept} mois déclarés`);
  }

  // --- Idempotence : les refs déjà importées --------------------------------
  const paiementItems = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${paiements.id}/items` +
      `?$expand=fields($select=Title)&$top=200`
  );
  const existingRefs = new Set<string>();
  for (const it of paiementItems) {
    const t = String(it.fields?.["Title"] ?? "").trim();
    if (t) existingRefs.add(t);
  }
  log(`KB-Paiements : ${existingRefs.size} virement(s) déjà en liste`);

  return {
    graph,
    siteId,
    active,
    paiementsListId: paiements.id,
    soldesListId: soldes.id,
    cumulListIds,
    residentsByFa7,
    cumulByKey,
    windowYearMonths,
    existingRefs,
    soldesCache: new Map(),
    monthsCache: new Map(),
  };
}

/** Garde-fou : colonnes attendues + codes neutres dans le Choice Status
 *  (message clair AVANT toute écriture, comme assertSoldesColumns). */
async function assertPaiementsSchema(
  graph: GraphClient,
  siteId: string,
  listId: string
): Promise<void> {
  const json = await graph.get<{
    value: Array<{
      name?: string;
      displayName?: string;
      choice?: { choices?: string[] };
    }>;
  }>(`/sites/${siteId}/lists/${listId}/columns?$select=name,displayName,choice`);

  const present = new Set<string>();
  let statusChoices: string[] = [];
  for (const c of json.value ?? []) {
    if (c.name) present.add(c.name.toLowerCase());
    if (c.displayName) present.add(c.displayName.toLowerCase());
    if ((c.name === "Status" || c.displayName === "Status") && c.choice?.choices) {
      statusChoices = c.choice.choices;
    }
  }

  const missing = PAIEMENTS_COLUMNS.filter((c) => !present.has(c.toLowerCase()));
  if (missing.length > 0) {
    throw new SoldesSyncError(
      `La liste « ${PAIEMENTS_LIST_NAME} » n'a pas les colonnes attendues : ` +
        `${missing.join(", ")}.\n` +
        `  → ImportFile et BankSeq sont NOUVELLES (session du 17/7/2026) : ` +
        `les créer d'abord (pas-à-pas de la session), puis relancer.`
    );
  }

  const missingCodes = STATUS_CODES.filter((c) => !statusChoices.includes(c));
  if (missingCodes.length > 0) {
    throw new SoldesSyncError(
      `La colonne Choice « Status » de ${PAIEMENTS_LIST_NAME} ne propose pas ` +
        `le(s) code(s) neutre(s) : ${missingCodes.join(", ")} ` +
        `(choix actuels : ${statusChoices.join(", ") || "aucun"}).\n` +
        `  → Terminer la migration sp:paiements-status (préalable du module 3) ` +
        `avant tout import.`
    );
  }
}

/** Lecture Soldes d'UN FA (colonne FedasilNumber INDEXÉE — §6.1), en cache. */
async function soldesOfFa(ctx: SharePointContext, fa: string): Promise<ListItem[]> {
  const cached = ctx.soldesCache.get(fa);
  if (cached) return cached;
  const items = await ctx.graph.getAllPages<ListItem>(
    `/sites/${ctx.siteId}/lists/${ctx.soldesListId}/items` +
      `?$expand=fields($select=Title,FedasilNumber,Year,Month,YearMonth,Contribution,Paid,Balance)` +
      `&$filter=fields/FedasilNumber eq '${fa.replace(/'/g, "''")}'` +
      `&$top=200`
  );
  ctx.soldesCache.set(fa, items);
  return items;
}

/** Tous les mois imputables d'un FA, du plus ancien au plus récent :
 *  fenêtre = KB-Cumul (avec miroir Soldes), hors fenêtre = Soldes seul. */
async function monthsOfFa(
  ctx: SharePointContext,
  fa: string
): Promise<MoisImputable[]> {
  const cached = ctx.monthsCache.get(fa);
  if (cached) return cached;

  const soldesItems = await soldesOfFa(ctx, fa);
  const soldesByYearMonth = new Map<number, ListItem>();
  for (const it of soldesItems) {
    const ym = Number(it.fields?.["YearMonth"]);
    if (Number.isInteger(ym)) soldesByYearMonth.set(ym, it);
  }

  const months: MoisImputable[] = [];

  // Fenêtre : les lignes KB-Cumul du FA (source d'écriture), miroir Soldes.
  for (const ym of ctx.windowYearMonths) {
    const row = ctx.cumulByKey.get(`${fa}|${ym}`);
    if (!row) continue;
    const balance = round2(row.contribution - row.paid);
    months.push({
      source: "cumul",
      itemId: row.itemId,
      cumulQuarter: row.cumulQuarter,
      year: row.year,
      month: row.month,
      yearMonth: ym,
      contribution: row.contribution,
      paid: row.paid,
      balance,
      soldesMirrorId: soldesByYearMonth.get(ym)?.id ?? null,
      title: `${fa}-${row.year}-${String(row.month).padStart(2, "0")}`,
    });
  }

  // Hors fenêtre : Soldes est la seule vérité (liste KB-Cumul vidée).
  for (const it of soldesItems) {
    const ym = Number(it.fields?.["YearMonth"]);
    if (!Number.isInteger(ym) || ctx.windowYearMonths.has(ym)) continue;
    const year = Math.floor(ym / 100);
    const month = ym % 100;
    const contribution = round2(toNumber(it.fields?.["Contribution"]));
    const paid = round2(toNumber(it.fields?.["Paid"]));
    months.push({
      source: "soldes",
      itemId: it.id,
      cumulQuarter: 0,
      year,
      month,
      yearMonth: ym,
      contribution,
      paid,
      balance: round2(contribution - paid),
      soldesMirrorId: null,
      title: `${fa}-${year}-${String(month).padStart(2, "0")}`,
    });
  }

  months.sort((a, b) => a.yearMonth - b.yearMonth);
  ctx.monthsCache.set(fa, months);
  return months;
}

// ---------------------------------------------------------------------------
//  Plan FIFO (⚠ mêmes règles que comDecode.allocateFifo de l'app staff)
// ---------------------------------------------------------------------------

type Allocation = { mois: MoisImputable; amount: number };

function allocateFifo(
  candidates: MoisImputable[],
  amount: number
): { allocations: Allocation[]; remainder: number } {
  const allocations: Allocation[] = [];
  let remaining = round2(amount);
  for (const mois of candidates) {
    if (remaining <= AMOUNT_TOLERANCE) break;
    if (mois.balance <= 0) continue;
    const take = round2(Math.min(mois.balance, remaining));
    allocations.push({ mois, amount: take });
    remaining = round2(remaining - take);
  }
  return { allocations, remainder: remaining };
}

/** Le périmètre FIFO d'une communication décodée, dans la fenêtre. */
function scopeOf(
  decoded: Decoded & { kind: "month" | "quarter" | "global" },
  months: MoisImputable[],
  active: ActiveQuarter
): MoisImputable[] {
  if (decoded.kind === "global") return months;
  if (decoded.kind === "quarter") {
    const year = yearOfCumulList(decoded.quarter, active);
    return months.filter(
      (m) => m.year === year && Math.ceil(m.month / 3) === decoded.quarter
    );
  }
  // Mois désigné : dans la fenêtre, chaque numéro de mois n'apparaît qu'UNE
  // fois (§5.22 déc. 1) — l'année se DÉDUIT du trimestre du mois.
  const q = Math.ceil(decoded.month / 3);
  const year = yearOfCumulList(q, active);
  return months.filter((m) => m.month === decoded.month && m.year === year);
}

// ---------------------------------------------------------------------------
//  WAL — journal local anti-double-crédit (append-only, JSONL)
// ---------------------------------------------------------------------------

type WalEntry = {
  ref: string;
  action: "start" | "done";
  allocations?: Array<{ title: string; amount: number }>;
  at: string;
};

function walAppend(entry: WalEntry): void {
  appendFileSync(resolve(process.cwd(), WAL_PATH), JSON.stringify(entry) + "\n", "utf-8");
}

/** Refs « start » sans « done » : crédits peut-être appliqués sans trace
 *  SharePoint complète -> QUARANTAINE (jamais retraitées automatiquement). */
function walQuarantine(): Map<string, WalEntry> {
  const path = resolve(process.cwd(), WAL_PATH);
  const open = new Map<string, WalEntry>();
  if (!existsSync(path)) return open;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as WalEntry;
      if (e.action === "start") open.set(e.ref, e);
      else open.delete(e.ref);
    } catch {
      // Ligne corrompue (crash en pleine écriture) : ignorée — les refs
      // « start » précédentes restent couvertes.
    }
  }
  return open;
}

// ---------------------------------------------------------------------------
//  Écritures
// ---------------------------------------------------------------------------

/** Crédite UN mois selon la règle d'écriture (voir l'en-tête du fichier). */
async function creditMonth(
  ctx: SharePointContext,
  mois: MoisImputable,
  amount: number
): Promise<void> {
  const newPaid = round2(mois.paid + amount);
  const newBalance = round2(mois.contribution - newPaid);

  if (mois.source === "cumul") {
    // KB-Cumul : Paid SEUL (Balance/PayStatus y sont dérivés, §5.17).
    await ctx.graph.write(
      "PATCH",
      `/sites/${ctx.siteId}/lists/${ctx.cumulListIds[mois.cumulQuarter]}/items/${mois.itemId}/fields`,
      { Paid: newPaid }
    );
    // Miroir Soldes (visibilité immédiate du portail pour les trimestres
    // clôturés ; la synchro nocturne retrouvera un point fixe).
    if (mois.soldesMirrorId) {
      await ctx.graph.write(
        "PATCH",
        `/sites/${ctx.siteId}/lists/${ctx.soldesListId}/items/${mois.soldesMirrorId}/fields`,
        {
          Paid: newPaid,
          Balance: newBalance,
          PayStatus: derivePayStatus(newBalance, newPaid),
        }
      );
    }
  } else {
    // Hors fenêtre : Soldes est la seule vérité — Paid + dérivés.
    await ctx.graph.write(
      "PATCH",
      `/sites/${ctx.siteId}/lists/${ctx.soldesListId}/items/${mois.itemId}/fields`,
      {
        Paid: newPaid,
        Balance: newBalance,
        PayStatus: derivePayStatus(newBalance, newPaid),
      }
    );
  }

  // L'état en mémoire suit l'écriture : un 2ᵉ virement du même lot pour le
  // même mois part du BON cumul (Paid est un cumul, §5.17).
  mois.paid = newPaid;
  mois.balance = newBalance;
}

/** Champs d'une ligne KB-Paiements (création). Choice = CHAÎNE via Graph. */
function paymentFields(
  p: CsvPayment,
  status: (typeof STATUS_CODES)[number],
  structuredCom: string | null,
  fedasilNumber: string | null,
  month: number | null
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: p.ref,
    PaymentDate: p.paymentDateIso,
    Amount: p.amount,
    CounterpartyName: p.counterpartyName,
    CounterpartyIBAN: p.counterpartyIban,
    Status: status,
    ImportFile: p.importFile,
    BankSeq: p.seq,
  };
  if (structuredCom) fields["StructuredCom"] = structuredCom;
  // La communication LIBRE reste TELLE QUELLE (décision GI). Flag Y :
  // Mededeling 1 EST la structurée (déjà dans StructuredCom) — SAUF si elle
  // n'a pas pu être résolue : on la préserve alors dans FreeCom plutôt que
  // de perdre de l'information (rien ne disparaît en silence).
  if (!p.structFlag || !structuredCom) {
    const free = [p.com1, p.com2].filter(Boolean).join(" / ");
    if (free) fields["FreeCom"] = free;
  }
  if (fedasilNumber) fields["FedasilNumber"] = fedasilNumber;
  if (month !== null) fields["Month"] = month;
  return fields;
}

// ---------------------------------------------------------------------------
//  Rapport
// ---------------------------------------------------------------------------

type Report = {
  lines: string[];
  counters: Map<string, number>;
};

function newReport(): Report {
  return { lines: [], counters: new Map() };
}

function count(r: Report, key: string): void {
  r.counters.set(key, (r.counters.get(key) ?? 0) + 1);
}

function say(r: Report, log: Logger, message: string): void {
  r.lines.push(message);
  log(message);
}

function reportSummary(r: Report): string {
  const order = [
    "importé-imputé",
    "importé-corrigé-imputé",
    "importé-àtraiter",
    "retenté-imputé",
    "retenté-resté",
    "doublon-ignoré",
    "écarté",
    "quarantaine",
  ];
  const parts: string[] = [];
  for (const k of order) {
    const v = r.counters.get(k);
    if (v) parts.push(`${k} : ${v}`);
  }
  return parts.join(" · ") || "rien à faire";
}

// ---------------------------------------------------------------------------
//  Traitement d'un virement (nouveau ou re-tenté)
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: "imputed"; corrected: boolean; month: number; fa: string }
  | { kind: "toProcess"; reason: string; structuredCom: string | null; fa: string | null };

/** Décide et (hors dry-run) CRÉDITE. Ne crée/patche PAS la ligne paiement. */
async function tryImpute(
  ctx: SharePointContext,
  amount: number,
  resolution: Resolution,
  dryRun: boolean,
  walId: string
): Promise<Outcome> {
  if (!resolution.ok) {
    return {
      kind: "toProcess",
      reason: resolution.reason,
      structuredCom: resolution.structuredCom,
      fa: resolution.fedasilNumber,
    };
  }

  const { decoded, fedasilNumber, structuredCom } = resolution;
  const months = await monthsOfFa(ctx, fedasilNumber);
  const scope = scopeOf(decoded, months, ctx.active);
  const plan = allocateFifo(scope, amount);

  if (plan.allocations.length === 0) {
    return {
      kind: "toProcess",
      reason:
        decoded.kind === "month"
          ? `aucun solde dû pour le mois ${decoded.month} (pas de déclaration, ou déjà payé)`
          : "aucun mois avec un solde dû dans le périmètre",
      structuredCom,
      fa: fedasilNumber,
    };
  }
  if (plan.remainder > AMOUNT_TOLERANCE) {
    return {
      kind: "toProcess",
      reason: `trop-perçu : ${plan.remainder.toFixed(2)} € non imputable sur le périmètre`,
      structuredCom,
      fa: fedasilNumber,
    };
  }

  if (dryRun) {
    // Simulation EN MÉMOIRE seulement : deux virements du même lot sur le
    // même mois se prévisualisent comme ils s'imputeraient en réel.
    for (const a of plan.allocations) {
      a.mois.paid = round2(a.mois.paid + a.amount);
      a.mois.balance = round2(a.mois.contribution - a.mois.paid);
    }
  } else {
    walAppend({
      ref: walId,
      action: "start",
      allocations: plan.allocations.map((a) => ({ title: a.mois.title, amount: a.amount })),
      at: new Date().toISOString(),
    });
    for (const a of plan.allocations) {
      await creditMonth(ctx, a.mois, a.amount);
    }
  }

  return {
    kind: "imputed",
    corrected: false, // affiné par l'appelant (flag N + résolu = corrigé)
    month: plan.allocations[0]!.mois.month, // convention module 3 : le plus ancien
    fa: fedasilNumber,
  };
}

// ---------------------------------------------------------------------------
//  Passe 1 : re-tentative des « ToProcess » existants
// ---------------------------------------------------------------------------

async function retryToProcess(
  ctx: SharePointContext,
  dryRun: boolean,
  quarantine: Map<string, WalEntry>,
  report: Report,
  log: Logger
): Promise<void> {
  // $filter sur Status : colonne INDEXÉE de KB-Paiements (§6.1, créée pour
  // la file de lettrage du module 3).
  const items = await ctx.graph.getAllPages<ListItem>(
    `/sites/${ctx.siteId}/lists/${ctx.paiementsListId}/items` +
      `?$expand=fields($select=Title,Amount,StructuredCom,FreeCom,Status,FedasilNumber)` +
      `&$filter=fields/Status eq 'ToProcess'&$top=200`
  );
  if (items.length === 0) {
    say(report, log, "\nRe-tentative : aucun virement « ToProcess » en liste.");
    return;
  }
  say(report, log, `\nRe-tentative : ${items.length} virement(s) « ToProcess » en liste…`);

  for (const it of items) {
    const ref = String(it.fields?.["Title"] ?? "").trim() || `item-${it.id}`;
    if (quarantine.has(ref)) {
      count(report, "quarantaine");
      say(report, log, `   ⚠ ${ref} : EN QUARANTAINE (WAL) — vérification manuelle requise`);
      continue;
    }
    const amount = round2(toNumber(it.fields?.["Amount"]));
    if (amount <= 0) continue;

    const resolution = resolvePayment(
      String(it.fields?.["StructuredCom"] ?? ""),
      String(it.fields?.["FreeCom"] ?? ""),
      false,
      ctx.residentsByFa7
    );

    if (dryRun) {
      const outcome = await tryImpute(ctx, amount, resolution, true, ref);
      if (outcome.kind === "imputed") {
        count(report, "retenté-imputé");
        say(report, log, `   ~ [dry-run] ${ref} deviendrait imputable (FA ${outcome.fa}, mois ${outcome.month})`);
      } else {
        count(report, "retenté-resté");
      }
      continue;
    }

    // Garde-fou de concurrence (comme le module 3), AVANT tout crédit :
    // l'app staff a pu imputer ce virement entre notre lecture et maintenant.
    const fresh = await ctx.graph.get<{ fields?: Record<string, unknown> }>(
      `/sites/${ctx.siteId}/lists/${ctx.paiementsListId}/items/${it.id}?$expand=fields($select=Status)`
    );
    if (String(fresh.fields?.["Status"] ?? "").trim() !== "ToProcess") {
      say(report, log, `   · ${ref} : plus « ToProcess » (traité entre-temps) — ignoré`);
      continue;
    }

    // WAL start -> crédits -> PATCH « Imputed » -> WAL done.
    const real = await tryImpute(ctx, amount, resolution, false, ref);
    if (real.kind !== "imputed") {
      count(report, "retenté-resté");
      continue; // toujours pas imputable : la file de lettrage garde la main
    }
    await ctx.graph.write(
      "PATCH",
      `/sites/${ctx.siteId}/lists/${ctx.paiementsListId}/items/${it.id}/fields`,
      {
        Status: "Imputed",
        FedasilNumber: real.fa,
        Month: real.month,
        ...(resolution.ok ? { StructuredCom: resolution.structuredCom } : {}),
      }
    );
    walAppend({ ref, action: "done", at: new Date().toISOString() });
    count(report, "retenté-imputé");
    say(report, log, `   ✓ ${ref} imputé (FA ${real.fa}, mois ${real.month})`);
  }
}

// ---------------------------------------------------------------------------
//  Passe 2 : import d'un fichier CSV
// ---------------------------------------------------------------------------

async function importFile(
  ctx: SharePointContext,
  path: string,
  dryRun: boolean,
  quarantine: Map<string, WalEntry>,
  report: Report,
  log: Logger
): Promise<void> {
  const fileName = basename(path);
  say(report, log, `\n── ${fileName} ──`);

  const parsed = parseCsvFile(path);
  say(
    report,
    log,
    `   ${parsed.payments.length} paiement(s) lisible(s), ${parsed.excluded.length} ligne(s) écartée(s)`
  );
  for (const [reason, detail] of parsed.excluded) {
    count(report, "écarté");
    say(report, log, `   · écarté (${reason}) : ${detail}`);
  }

  // Plus anciens d'abord (comme la file de lettrage : FIFO du stock).
  const payments = [...parsed.payments].sort((a, b) =>
    a.paymentDateIso.localeCompare(b.paymentDateIso)
  );

  const seenThisRun = new Set<string>();
  let processed = 0;

  for (const p of payments) {
    processed++;

    if (quarantine.has(p.ref)) {
      count(report, "quarantaine");
      say(report, log, `   ⚠ ${p.ref} : EN QUARANTAINE (WAL) — vérification manuelle requise, NON réimporté`);
      continue;
    }
    if (ctx.existingRefs.has(p.ref) || seenThisRun.has(p.ref)) {
      count(report, "doublon-ignoré");
      continue;
    }
    seenThisRun.add(p.ref);

    const resolution = resolvePayment(p.com1, p.com2, p.structFlag, ctx.residentsByFa7);
    const outcome = await tryImpute(ctx, p.amount, resolution, dryRun, p.ref);

    if (outcome.kind === "toProcess") {
      count(report, "importé-àtraiter");
      say(
        report,
        log,
        `   → ${p.ref} (${p.amount.toFixed(2)} €) EN FILE : ${outcome.reason}`
      );
      if (!dryRun) {
        await ctx.graph.write(
          "POST",
          `/sites/${ctx.siteId}/lists/${ctx.paiementsListId}/items`,
          {
            fields: paymentFields(p, "ToProcess", outcome.structuredCom, outcome.fa, null),
          }
        );
        ctx.existingRefs.add(p.ref);
      }
      continue;
    }

    // Imputé : crédits déjà appliqués (hors dry-run) — création « Imputed ».
    const corrected = !p.structFlag && resolution.ok;
    if (!dryRun) {
      await ctx.graph.write(
        "POST",
        `/sites/${ctx.siteId}/lists/${ctx.paiementsListId}/items`,
        {
          fields: paymentFields(
            p,
            "Imputed",
            resolution.ok ? resolution.structuredCom : null,
            outcome.fa,
            outcome.month
          ),
        }
      );
      walAppend({ ref: p.ref, action: "done", at: new Date().toISOString() });
      ctx.existingRefs.add(p.ref);
    }
    count(report, corrected ? "importé-corrigé-imputé" : "importé-imputé");
    say(
      report,
      log,
      corrected
        ? `   ✓ ${p.ref} : comm libre corrigée -> ${resolution.ok ? resolution.structuredCom : ""} (FA ${outcome.fa}, mois ${outcome.month}, ${p.amount.toFixed(2)} €)`
        : `   ✓ ${p.ref} imputé (FA ${outcome.fa}, mois ${outcome.month}, ${p.amount.toFixed(2)} €)`
    );

    if (processed % 100 === 0 || processed === payments.length) {
      log(`   ${processed}/${payments.length} traité(s)…`);
    }
  }

  // Rapport écrit à côté du CSV : la mémoire de ce qui a été fait.
  if (!dryRun) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const reportPath = `${path}.rapport-${stamp}.txt`;
    writeFileSync(reportPath, report.lines.join("\n") + "\n", "utf-8");
    log(`   Rapport écrit : ${reportPath}`);
  }
}

// ---------------------------------------------------------------------------
//  CLI
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

const log: Logger = (message) => console.log(message);

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
    log("ℹ api/local.settings.json introuvable — lecture des variables d'environnement.");
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
        "l'environnement.\nRappel : lancer la commande depuis la RACINE du dépôt."
    );
  }
  return values as Settings;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dryRun = args.includes("--dry-run");
  const retryOnly = args.includes("--retenter-seulement");
  const files = args.filter((a) => !a.startsWith("--"));

  if (files.length === 0 && !retryOnly) {
    fail(
      "Usage :\n" +
        "  npm run sp:paiements -- --dry-run export.csv     ⭐ D'ABORD (prévisualise)\n" +
        "  npm run sp:paiements -- export.csv               importe + impute\n" +
        "  npm run sp:paiements -- f1.csv f2.csv            plusieurs fichiers\n" +
        "  npm run sp:paiements -- --retenter-seulement     re-tente les « ToProcess »\n\n" +
        "Le rapport est écrit à côté de chaque CSV. Les lignes écartées (débits,\n" +
        "pieds de fichier) y sont JOURNALISÉES : rien ne disparaît en silence."
    );
  }
  for (const f of files) {
    if (!existsSync(resolve(process.cwd(), f))) {
      fail(`Fichier introuvable : ${f}`);
    }
  }

  const cfg = loadSettings();
  const graph = createGraphClient(cfg, log);
  const siteId = await getSiteId(graph, cfg, log);
  const ctx = await loadContext(graph, siteId, log);

  const quarantine = walQuarantine();
  if (quarantine.size > 0) {
    log(
      `\n⚠ ${quarantine.size} référence(s) EN QUARANTAINE (WAL ${WAL_PATH}) : crédits\n` +
        `  peut-être appliqués sans enregistrement complet. À VÉRIFIER À LA MAIN\n` +
        `  (les allocations prévues sont dans le WAL), puis SUPPRIMER le fichier :`
    );
    for (const [ref, e] of quarantine) {
      log(
        `    - ${ref} : ${e.allocations?.map((a) => `${a.title} +${a.amount.toFixed(2)} €`).join(", ") ?? "?"}`
      );
    }
  }

  if (dryRun) log("\n[MODE --dry-run : AUCUNE écriture, ni crédits ni lignes]");

  const report = newReport();

  // Passe 1 : re-tenter le stock (une déclaration arrivée débloque toute
  // seule un virement en attente) — sauf si on ne fait qu'importer à vide.
  await retryToProcess(ctx, dryRun, quarantine, report, log);

  // Passe 2 : les fichiers.
  for (const f of files) {
    await importFile(ctx, resolve(process.cwd(), f), dryRun, quarantine, report, log);
  }

  log(`\nTOTAL${dryRun ? " (dry-run, AUCUNE écriture)" : ""} : ${reportSummary(report)}`);

  // Estampille « LastPaymentImport » (liste Indicateurs, tableau de bord
  // staff — module 1) : chaque acteur estampille son propre passage. JAMAIS
  // en dry-run (une répétition n'est pas un import). Une estampille qui
  // échoue ne doit JAMAIS faire échouer l'import qu'elle documente : on
  // journalise et on continue.
  if (!dryRun) {
    const counter = (k: string): number => report.counters.get(k) ?? 0;
    const imported =
      counter("importé-imputé") +
      counter("importé-corrigé-imputé") +
      counter("importé-àtraiter");
    try {
      await stampIndicator(
        graph,
        siteId,
        {
          title: INDICATOR.lastPaymentImport,
          numValue: imported,
          textValue:
            files.map((f) => basename(f)).join(", ") || "--retenter-seulement",
          scope: new Date().toISOString().slice(0, 10),
          detail: reportSummary(report),
        },
        log
      );
    } catch (err) {
      log(
        `⚠ Estampille LastPaymentImport NON écrite (${
          err instanceof Error ? err.message.split("\n")[0] : String(err)
        }) — l'import, lui, est terminé et intact.`
      );
    }
  }

  log(
    "\nRejouable à volonté (idempotence par référence bancaire). Les virements\n" +
      "« ToProcess » restants sont dans la file de lettrage de l'app staff."
  );
}

main().catch((error: unknown) => {
  if (error instanceof SoldesSyncError) fail(error.message);
  fail(error instanceof Error ? error.message : String(error));
});
