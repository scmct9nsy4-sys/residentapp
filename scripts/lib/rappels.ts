/* ============================================================================
 *  scripts/lib/rappels.ts — MOTEUR DU RAPPEL 1 (module 4, chantier R2a)
 *                           (LOGIQUE PARTAGÉE — aucun argv, aucun exit)
 * ----------------------------------------------------------------------------
 *  POURQUOI CE FICHIER EXISTE (21/7/2026, décisions R2 de CONCEPTION v10 §7)
 *
 *  Le rappel 1 est le seul envoi AUTOMATIQUE du recouvrement (§4.3) : e-mail
 *  neutre à échéance dépassée, interrupteur global dans « Config », journal
 *  complet dans « Journal-Rappels ». Comme pour la synchronisation Soldes,
 *  la logique vit ICI, une fois :
 *    - scripts/run-rappels.ts        (CLI, dry-run par défaut)  -> ce module
 *    - la Function nocturne (R2b, après synchro + indicateurs)  -> ce module
 *
 *  LES CINQ DÉCISIONS DU 21/7 QUE CE CODE INCARNE :
 *   1. Garde-fou §4.4 paramétré dans Config (lignes Title/ParamValue) :
 *      Reminder1Enabled (OFF au déploiement), Reminder1MaxQueue,
 *      Reminder1MaxImportAgeDays. FAIL-SAFE : paramètre absent ou illisible
 *      = ABSTENTION, jamais de défaut permissif en dur.
 *   2. Journal-Rappels dès R2 : une ligne par TENTATIVE d'envoi (preuve
 *      §4.9, matière de l'export contentieux §4.11).
 *   3. Anti-double-envoi (philosophie du WAL de sp:paiements) : « Pending »
 *      écrit AVANT sendMail, « Sent » APRÈS. Une ligne Pending survivante =
 *      crash = QUARANTAINE du FA jusqu'à résolution humaine. L'idempotence
 *      d'ensemble vient des estampilles Soldes (ReminderLevel=1) : un mois
 *      estampillé n'est plus jamais candidat.
 *   4. La sélection lit Soldes COMME LA VUE « Recouvrement » (chantier R1) :
 *      une égalité YearMonth (indexée) par mois ÉCHU de la fenêtre des 4
 *      trimestres, sélection en code (§6.1 règle 1-bis). Mêmes requêtes que
 *      l'écran = chiffres comparables (le bouclage 4 015 = 4 015 du 21/7
 *      reste un test permanent), volume borné dans la durée. Amende la
 *      phrase « balayage sans filtre » de §4.5 (consigné en v10).
 *   5. Hors fenêtre = hors périmètre du rappel 1 (dettes 990, §4.7/§4.12).
 *
 *  ÉCRITURES (mode réel uniquement — le dry-run n'écrit RIEN) :
 *    - Journal-Rappels : ligne par tentative (Pending -> Sent/Failed) ;
 *    - Soldes : ReminderLevel=1 + Reminder1Date sur CHAQUE mois couvert
 *      (⚠ via Graph : Choice/valeurs en CHAÎNE — côté SDK staff ce serait
 *      { Value }, piège n°14 du SETUP — ici PAS de colonne choice écrite) ;
 *    - Indicateurs : estampille « LastReminder1Run » (y compris ABSTENTION,
 *      avec sa raison) — c'est la matière du tableau de bord R2b.
 *
 *  LANGUE (§4.7) : ContactLanguage de Residents List (« fr »/« nl »/« en »).
 *  Colonne vide ou invalide -> e-mail TRILINGUE (repli sûr). Le QR EPC dans
 *  l'e-mail est consigné pour R2b (dépendance image) : le rappel 1 v1 donne
 *  les informations de virement complètes + le lien du portail (où vit le QR).
 * ============================================================================ */

import {
  SoldesSyncError,
  SOLDES_LIST_NAME,
  findListByName,
  getSiteId,
  readActiveQuarter,
  type ActiveQuarter,
  type GraphClient,
  type Logger,
  type Settings,
} from "./soldes-sync.js";

// ---------------------------------------------------------------------------
//  Constantes de schéma (alignées sur sharepoint-schema.json)
// ---------------------------------------------------------------------------

export const JOURNAL_LIST_NAME = "Journal-Rappels";
export const CONFIG_LIST_NAME_R = "Config";
export const RESIDENTS_LIST_NAME = "Residents List";
export const PAIEMENTS_LIST_NAME = "KB-Paiements";
export const INDICATEURS_LIST_NAME = "Indicateurs";

/** Clés des lignes paramètres de Config (Title / ParamValue). */
export const PARAM_KEYS = {
  enabled: "Reminder1Enabled",
  maxQueue: "Reminder1MaxQueue",
  maxImportAgeDays: "Reminder1MaxImportAgeDays",
} as const;

/** Valeurs semées par --init-params (jamais modifiées si présentes). */
export const PARAM_DEFAULTS: Record<string, string> = {
  [PARAM_KEYS.enabled]: "false", // OFF au déploiement (décision du 21/7)
  [PARAM_KEYS.maxQueue]: "60", // ~1,5 semaine du débit mesuré (~42/sem)
  [PARAM_KEYS.maxImportAgeDays]: "9", // hebdo + lundi férié + battement
};

/** Indicateurs lus (garde-fou) et écrits (estampille du moteur). */
export const IND_LAST_IMPORT = "LastPaymentImport";
export const IND_LAST_SYNC = "LastSoldesSync";
export const IND_LAST_RUN = "LastReminder1Run";

/** Colonnes attendues — contrôlées AVANT tout travail (message clair plutôt
 *  que « Graph 400 Field not recognized » au milieu du traitement). */
const SOLDES_R2_COLUMNS = [
  "Title",
  "FedasilNumber",
  "Year",
  "Month",
  "YearMonth",
  "Balance",
  "PayStatus",
  "StructuredCom",
  "DueDate",
  "ReminderLevel",
  "Reminder1Date",
  "PaymentPlanRef",
] as const;

const JOURNAL_COLUMNS = [
  "Title",
  "FedasilNumber",
  "Level",
  "Channel",
  "SentDate",
  "MonthsCovered",
  "TotalDue",
  "Recipient",
  "Language",
  "ValidatedBy",
  "Status",
  "Note",
] as const;

// ---------------------------------------------------------------------------
//  Types publics
// ---------------------------------------------------------------------------

/** Contexte d'envoi (identifiants d'e-mail et de virement). En mode réel,
 *  tout est OBLIGATOIRE ; en dry-run, un champ vide devient un avertissement
 *  du rapport et un « [À CONFIGURER] » dans l'aperçu. */
export type ReminderMailContext = {
  /** GRAPH_SENDER_USER_ID — la boîte qui envoie déjà les invitations. */
  senderUserId: string;
  /** URL du portail résident (PORTAL_URL ou dérivée d'INVITE_REDIRECT_URL). */
  portalUrl: string;
  /** PAYMENT_IBAN — le compte bénéficiaire affiché par le portail. */
  paymentIban: string;
  /** PAYMENT_BENEFICIARY — le libellé bénéficiaire du portail. */
  paymentBeneficiary: string;
};

export type Reminder1Params = {
  enabled: boolean;
  maxQueue: number;
  maxImportAgeDays: number;
};

export type GuardCheck = {
  label: string;
  ok: boolean;
  /** false = simple avertissement (n'empêche jamais l'exécution). */
  blocking: boolean;
  detail: string;
};

export type CandidateMonth = {
  itemId: string;
  title: string;
  fa: string;
  year: number;
  month: number;
  yearMonth: number;
  balance: number;
  structuredCom: string;
  dueDateIso: string;
};

export type CandidateDossier = {
  fa: string;
  months: CandidateMonth[];
  totalDue: number;
  oldestDueIso: string;
  email: string | null;
  firstName: string;
  /** « fr » | « nl » | « en » | null (null -> trilingue). */
  language: string | null;
};

export type Reminder1Options = {
  dryRun: boolean;
  /** Dry-run uniquement : évalue le garde-fou mais ne s'y arrête pas. */
  skipGuard?: boolean;
  /** Nombre de dossiers détaillés dans le rapport (défaut 30). */
  maxDetail?: number;
  /** Date « aujourd'hui » injectable (tests) — défaut : maintenant. */
  now?: Date;
  log: Logger;
};

export type Reminder1Result = {
  dryRun: boolean;
  aborted: boolean;
  abortReasons: string[];
  guard: GuardCheck[];
  windowLabel: string;
  overdueYearMonths: number[];
  rowsRead: number;
  candidateMonths: number;
  excludedLevel: number;
  excludedPlan: number;
  dossiers: number;
  quarantined: string[];
  orphans: string[];
  noEmail: string[];
  sent: number;
  failed: number;
  monthsStamped: number;
};

type ListItem = { id: string; fields: Record<string, unknown> };

// ---------------------------------------------------------------------------
//  Petites briques communes
// ---------------------------------------------------------------------------

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Échéance §5.18 : dernier jour du mois SUIVANT le mois déclaré (même règle
 *  que sp:soldes — Date.UTC : jour 0 du mois d'index m = dernier jour du
 *  mois d'index m-1, donc du mois HUMAIN m). */
function dueDateUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0));
}

/** j***@domaine — les journaux ne portent jamais d'adresse en clair. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** 12 chiffres -> +++xxx/xxxx/xxxxx+++ (affichage belge standard). */
export function formatStructuredCom(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 12) return raw.trim();
  return `+++${d.slice(0, 3)}/${d.slice(3, 7)}/${d.slice(7)}+++`;
}

function euro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

function escapeODataString(v: string): string {
  return v.replace(/'/g, "''");
}

function htmlEscape(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
//  Garde-fou : les colonnes existent-elles AVANT de travailler ? (§10 point 2)
// ---------------------------------------------------------------------------

async function assertListColumns(
  graph: GraphClient,
  siteId: string,
  listId: string,
  listName: string,
  wanted: readonly string[]
): Promise<void> {
  const json = await graph.get<{
    value: Array<{ name?: string; displayName?: string }>;
  }>(`/sites/${siteId}/lists/${listId}/columns?$select=name,displayName`);

  const present = new Set<string>();
  for (const c of json.value ?? []) {
    if (c.name) present.add(c.name.toLowerCase());
    if (c.displayName) present.add(c.displayName.toLowerCase());
  }
  const missing = wanted.filter((c) => !present.has(c.toLowerCase()));
  if (missing.length > 0) {
    throw new SoldesSyncError(
      `La liste « ${listName} » n'a pas les colonnes attendues : ` +
        `${missing.join(", ")}.\n` +
        `  → Le schéma a évolué mais la liste n'a pas suivi. Lancer d'abord :\n` +
        `     npm run sp:provision\n` +
        `  puis relancer (le moteur n'a encore rien écrit).`
    );
  }
}

// ---------------------------------------------------------------------------
//  Paramètres (Config, lignes Title / ParamValue) — parsing STRICT, fail-safe
// ---------------------------------------------------------------------------

export async function loadReminder1Params(
  graph: GraphClient,
  siteId: string,
  configListId: string
): Promise<{ params: Reminder1Params | null; problems: string[] }> {
  const items = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${configListId}/items` +
      `?$expand=fields($select=Title,ParamValue)&$top=50`
  );

  const byKey = new Map<string, string>();
  for (const it of items) {
    const title = String(it.fields?.["Title"] ?? "").trim();
    if (title) byKey.set(title.toLowerCase(), String(it.fields?.["ParamValue"] ?? "").trim());
  }

  const problems: string[] = [];

  const rawOf = (key: string): string | null => {
    if (!byKey.has(key.toLowerCase())) {
      problems.push(
        `ligne « ${key} » absente de Config (→ npm run sp:rappels -- --init-params)`
      );
      return null;
    }
    return byKey.get(key.toLowerCase()) ?? "";
  };

  const enabledRaw = rawOf(PARAM_KEYS.enabled);
  const queueRaw = rawOf(PARAM_KEYS.maxQueue);
  const ageRaw = rawOf(PARAM_KEYS.maxImportAgeDays);

  let enabled = false;
  if (enabledRaw !== null) {
    const v = enabledRaw.toLowerCase();
    if (v === "true") enabled = true;
    else if (v === "false") enabled = false;
    else problems.push(`${PARAM_KEYS.enabled} = « ${enabledRaw} » (attendu : true ou false)`);
  }

  const intOf = (key: string, raw: string | null): number => {
    if (raw === null) return 0;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      problems.push(`${key} = « ${raw} » (entier strictement positif attendu)`);
      return 0;
    }
    return n;
  };
  const maxQueue = intOf(PARAM_KEYS.maxQueue, queueRaw);
  const maxImportAgeDays = intOf(PARAM_KEYS.maxImportAgeDays, ageRaw);

  if (problems.length > 0) return { params: null, problems };
  return { params: { enabled, maxQueue, maxImportAgeDays }, problems };
}

/** Résout le site et la liste Config en un appel — pour les gestes du CLI
 *  (--init-params) qui n'ont pas besoin du reste de l'orchestrateur. */
export async function findConfigListId(
  graph: GraphClient,
  cfg: Settings,
  log: Logger
): Promise<{ siteId: string; configListId: string }> {
  const siteId = await getSiteId(graph, cfg, log);
  const list = await findListByName(graph, siteId, CONFIG_LIST_NAME_R);
  if (!list) {
    throw new SoldesSyncError(
      `Liste « ${CONFIG_LIST_NAME_R} » introuvable.\n  → npm run sp:provision`
    );
  }
  return { siteId, configListId: list.id };
}

/** Sème les lignes paramètres MANQUANTES (ne modifie jamais une existante). */
export async function initReminder1Params(
  graph: GraphClient,
  siteId: string,
  configListId: string,
  log: Logger
): Promise<number> {
  const items = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${configListId}/items` +
      `?$expand=fields($select=Title)&$top=50`
  );
  const existing = new Set(
    items.map((it) => String(it.fields?.["Title"] ?? "").trim().toLowerCase())
  );

  let created = 0;
  for (const [key, value] of Object.entries(PARAM_DEFAULTS)) {
    if (existing.has(key.toLowerCase())) {
      log(`   · ${key} : déjà présent (valeur conservée telle quelle)`);
      continue;
    }
    await graph.write("POST", `/sites/${siteId}/lists/${configListId}/items`, {
      fields: { Title: key, ParamValue: value },
    });
    log(`   + ${key} = ${value}`);
    created++;
  }
  return created;
}

// ---------------------------------------------------------------------------
//  Lectures du garde-fou
// ---------------------------------------------------------------------------

async function countLettrageQueue(
  graph: GraphClient,
  siteId: string,
  paiementsListId: string
): Promise<number> {
  // Status est INDEXÉE (§6.1). On tolère le libellé FR historique par
  // prudence (la migration sp:paiements-status a tourné, mais un rejeu de
  // vieux flux resterait visible ici plutôt qu'invisible).
  let total = 0;
  for (const status of ["ToProcess", "À traiter"]) {
    const items = await graph.getAllPages<{ id: string }>(
      `/sites/${siteId}/lists/${paiementsListId}/items` +
        `?$expand=fields($select=Status)` +
        `&$filter=fields/Status eq '${escapeODataString(status)}'` +
        `&$top=500`
    );
    total += items.length;
  }
  return total;
}

async function readIndicateur(
  graph: GraphClient,
  siteId: string,
  indicateursListId: string,
  title: string
): Promise<{ computedAt: Date | null; textValue: string; itemId: string } | null> {
  const items = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${indicateursListId}/items` +
      `?$expand=fields($select=Title,TextValue,ComputedAt)&$top=100`
  );
  const row = items.find(
    (it) =>
      String(it.fields?.["Title"] ?? "").trim().toLowerCase() ===
      title.toLowerCase()
  );
  if (!row) return null;
  const raw = String(row.fields?.["ComputedAt"] ?? "").trim();
  const parsed = raw ? new Date(raw) : null;
  return {
    computedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    textValue: String(row.fields?.["TextValue"] ?? "").trim(),
    itemId: row.id,
  };
}

// ---------------------------------------------------------------------------
//  Fenêtre des 4 trimestres et sélection des candidats
// ---------------------------------------------------------------------------

export function windowQuarters(active: ActiveQuarter): Array<{ year: number; quarter: number }> {
  const out: Array<{ year: number; quarter: number }> = [];
  let q = active.quarter;
  let y = active.year;
  for (let i = 0; i < 4; i++) {
    out.push({ year: y, quarter: q });
    q -= 1;
    if (q < 1) {
      q = 4;
      y -= 1;
    }
  }
  return out.reverse(); // du plus ancien au plus récent
}

export function windowLabelOf(active: ActiveQuarter): string {
  const w = windowQuarters(active);
  const first = w[0]!;
  const last = w[w.length - 1]!;
  return `fenêtre T${first.quarter} ${first.year} → T${last.quarter} ${last.year}`;
}

/** Les AAAAMM de la fenêtre dont l'échéance (§5.18) est dépassée. */
export function overdueYearMonthsOf(active: ActiveQuarter, now: Date): number[] {
  const out: number[] = [];
  for (const { year, quarter } of windowQuarters(active)) {
    for (const month of [quarter * 3 - 2, quarter * 3 - 1, quarter * 3]) {
      if (dueDateUtc(year, month).getTime() < now.getTime()) {
        out.push(year * 100 + month);
      }
    }
  }
  return out;
}

type SelectionCounters = {
  rowsRead: number;
  candidateMonths: number;
  excludedLevel: number;
  excludedPlan: number;
};

async function selectCandidates(
  graph: GraphClient,
  siteId: string,
  soldesListId: string,
  yearMonths: number[],
  now: Date,
  log: Logger
): Promise<{ byFa: Map<string, CandidateMonth[]>; counters: SelectionCounters }> {
  const select = SOLDES_R2_COLUMNS.join(",");
  const byFa = new Map<string, CandidateMonth[]>();
  const counters: SelectionCounters = {
    rowsRead: 0,
    candidateMonths: 0,
    excludedLevel: 0,
    excludedPlan: 0,
  };

  for (const ym of yearMonths) {
    // La MÊME requête que la vue « Recouvrement » du chantier R1 :
    // une égalité sur YearMonth (indexée), sélection en code (§6.1, 1-bis).
    const items = await graph.getAllPages<ListItem>(
      `/sites/${siteId}/lists/${soldesListId}/items` +
        `?$expand=fields($select=${select})` +
        `&$filter=fields/YearMonth eq ${ym}` +
        `&$top=200`
    );
    counters.rowsRead += items.length;

    let kept = 0;
    for (const it of items) {
      const f = it.fields ?? {};
      const fa = String(f["FedasilNumber"] ?? "").trim();
      const balance = round2(toNumber(f["Balance"]));
      const payStatus = String(f["PayStatus"] ?? "").trim();
      if (!fa) continue;
      if (payStatus !== "Unpaid" && payStatus !== "Partial") continue;
      if (balance <= 0.004) continue;

      const dueRaw = String(f["DueDate"] ?? "").trim();
      const due = dueRaw ? new Date(dueRaw) : null;
      // Ceinture : le champ écrit par sp:soldes doit confirmer l'échéance.
      if (!due || Number.isNaN(due.getTime()) || due.getTime() >= now.getTime()) {
        continue;
      }

      if (toNumber(f["ReminderLevel"]) > 0) {
        counters.excludedLevel++;
        continue;
      }
      if (String(f["PaymentPlanRef"] ?? "").trim() !== "") {
        counters.excludedPlan++; // plan d'apurement = état suspensif (§4.6)
        continue;
      }

      const month: CandidateMonth = {
        itemId: it.id,
        title: String(f["Title"] ?? "").trim(),
        fa,
        year: toNumber(f["Year"]),
        month: toNumber(f["Month"]),
        yearMonth: ym,
        balance,
        structuredCom: String(f["StructuredCom"] ?? "").trim(),
        dueDateIso: due.toISOString(),
      };
      const list = byFa.get(fa) ?? [];
      list.push(month);
      byFa.set(fa, list);
      kept++;
    }
    counters.candidateMonths += kept;
    log(`   Soldes ${ym} : ${items.length} ligne(s), ${kept} candidate(s)`);
  }

  for (const months of byFa.values()) {
    months.sort((a, b) => a.yearMonth - b.yearMonth);
  }
  return { byFa, counters };
}

// ---------------------------------------------------------------------------
//  Résidents : FA -> contact (une seule lecture paginée, table en mémoire)
// ---------------------------------------------------------------------------

type ResidentContact = {
  email: string | null;
  firstName: string;
  language: string | null;
  hasOid: boolean;
};

async function readResidentContacts(
  graph: GraphClient,
  siteId: string,
  residentsListId: string,
  log: Logger
): Promise<Map<string, ResidentContact>> {
  const items = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${residentsListId}/items` +
      `?$expand=fields($select=FedasilNumber,FirstName,Email,ContactLanguage,EntraOid)` +
      `&$top=2000`
  );

  const map = new Map<string, ResidentContact>();
  let duplicates = 0;
  for (const it of items) {
    const f = it.fields ?? {};
    const fa = String(f["FedasilNumber"] ?? "").trim();
    if (!fa) continue;

    const langRaw = String(f["ContactLanguage"] ?? "").trim().toLowerCase();
    const contact: ResidentContact = {
      email: String(f["Email"] ?? "").trim() || null,
      firstName: String(f["FirstName"] ?? "").trim(),
      language: langRaw === "fr" || langRaw === "nl" || langRaw === "en" ? langRaw : null,
      hasOid: String(f["EntraOid"] ?? "").trim() !== "",
    };

    const existing = map.get(fa);
    if (!existing) {
      map.set(fa, contact);
      continue;
    }
    // Doublons de FA constatés en réel (61 lignes le 20/7) : on préfère la
    // ligne au compte ACTIVÉ (EntraOid), sinon celle qui a un e-mail.
    duplicates++;
    const better =
      (contact.hasOid && !existing.hasOid) ||
      (contact.hasOid === existing.hasOid && !existing.email && !!contact.email);
    if (better) map.set(fa, contact);
  }
  log(
    `   Residents List : ${items.length} ligne(s), ${map.size} FA distincts` +
      (duplicates > 0 ? ` (${duplicates} doublon(s) de FA arbitrés)` : "")
  );
  return map;
}

// ---------------------------------------------------------------------------
//  Journal-Rappels : quarantaine et écriture des tentatives
// ---------------------------------------------------------------------------

async function readQuarantinedFas(
  graph: GraphClient,
  siteId: string,
  journalListId: string
): Promise<Set<string>> {
  // Status est INDEXÉE À LA CRÉATION de la liste. Une ligne Pending = un
  // crash entre sendMail et l'estampillage : QUARANTAINE jusqu'à résolution
  // humaine (marquer Sent + estampiller Soldes à la main, ou Failed).
  const items = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${journalListId}/items` +
      `?$expand=fields($select=FedasilNumber,Title,Status)` +
      `&$filter=fields/Status eq 'Pending'&$top=200`
  );
  const set = new Set<string>();
  for (const it of items) {
    const fa = String(it.fields?.["FedasilNumber"] ?? "").trim();
    if (fa) set.add(fa);
  }
  return set;
}

/** Retrouve l'item d'une tentative par FA (indexée) + Title exact — le client
 *  Graph partagé ne renvoie pas le corps d'un POST, on relit donc. */
async function findJournalItemId(
  graph: GraphClient,
  siteId: string,
  journalListId: string,
  fa: string,
  attemptKey: string
): Promise<string | null> {
  const items = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${journalListId}/items` +
      `?$expand=fields($select=Title,FedasilNumber)` +
      `&$filter=fields/FedasilNumber eq '${escapeODataString(fa)}'&$top=200`
  );
  const row = items.find(
    (it) => String(it.fields?.["Title"] ?? "").trim() === attemptKey
  );
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
//  Composition de l'e-mail (ton NEUTRE — c'est le rappel 1, §4.1)
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, string[]> = {
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  nl: ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

type MailTexts = {
  greeting: (firstName: string) => string;
  intro: string;
  colMonth: string;
  colAmount: string;
  colCom: string;
  payWith: string;
  beneficiary: string;
  iban: string;
  portal: string;
  alreadyPaid: string;
  signature: string;
};

const TEXTS: Record<string, MailTexts> = {
  fr: {
    greeting: (n) => (n ? `Bonjour ${n},` : "Bonjour,"),
    intro:
      "Selon nos données, la contribution financière des mois suivants reste (partiellement) ouverte :",
    colMonth: "Mois",
    colAmount: "Montant restant dû",
    colCom: "Communication structurée",
    payWith:
      "Vous pouvez régler chaque mois par virement en utilisant SA communication structurée :",
    beneficiary: "Bénéficiaire",
    iban: "Compte (IBAN)",
    portal: "Vous retrouverez ces informations et le QR de paiement sur votre portail :",
    alreadyPaid:
      "Si vous avez effectué le paiement ces derniers jours, veuillez ne pas tenir compte de ce message.",
    signature: "Fedasil — contribution financière",
  },
  nl: {
    greeting: (n) => (n ? `Beste ${n},` : "Beste,"),
    intro:
      "Volgens onze gegevens staat de financiële bijdrage voor de volgende maanden nog (gedeeltelijk) open:",
    colMonth: "Maand",
    colAmount: "Openstaand bedrag",
    colCom: "Gestructureerde mededeling",
    payWith:
      "U kunt elke maand betalen per overschrijving met de BIJHORENDE gestructureerde mededeling:",
    beneficiary: "Begunstigde",
    iban: "Rekening (IBAN)",
    portal: "U vindt deze gegevens en de betaal-QR op uw portaal:",
    alreadyPaid:
      "Als u de afgelopen dagen al betaald hebt, mag u dit bericht als niet verzonden beschouwen.",
    signature: "Fedasil — financiële bijdrage",
  },
  en: {
    greeting: (n) => (n ? `Dear ${n},` : "Dear resident,"),
    intro:
      "According to our records, the financial contribution for the following months is still (partially) outstanding:",
    colMonth: "Month",
    colAmount: "Amount due",
    colCom: "Structured communication",
    payWith:
      "You can pay each month by bank transfer using ITS structured communication:",
    beneficiary: "Beneficiary",
    iban: "Account (IBAN)",
    portal: "You will find these details and the payment QR code on your portal:",
    alreadyPaid:
      "If you have made the payment in the past few days, please disregard this message.",
    signature: "Fedasil — financial contribution",
  },
};

const SUBJECTS: Record<string, string> = {
  fr: "Rappel — votre contribution financière",
  nl: "Herinnering — uw financiële bijdrage",
  en: "Reminder — your financial contribution",
  multi: "Rappel / Herinnering / Reminder — contribution financière",
};

function monthLabel(lang: string, month: number, year: number): string {
  const names = MONTH_NAMES[lang] ?? MONTH_NAMES["fr"]!;
  return `${names[month - 1] ?? String(month)} ${year}`;
}

function blockHtml(
  lang: string,
  firstName: string,
  months: CandidateMonth[],
  ctx: ReminderMailContext
): string {
  const t = TEXTS[lang]!;
  const rows = months
    .map(
      (m) =>
        `<tr><td style="padding:6px 10px;border:1px solid #ddd;">${htmlEscape(monthLabel(lang, m.month, m.year))}</td>` +
        `<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${euro(m.balance)}</td>` +
        `<td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;">${htmlEscape(formatStructuredCom(m.structuredCom))}</td></tr>`
    )
    .join("");

  return (
    `<p>${htmlEscape(t.greeting(firstName))}</p>` +
    `<p>${htmlEscape(t.intro)}</p>` +
    `<table style="border-collapse:collapse;margin:8px 0;">` +
    `<tr>` +
    `<th style="padding:6px 10px;border:1px solid #ddd;background:#644391;color:#fff;text-align:left;">${htmlEscape(t.colMonth)}</th>` +
    `<th style="padding:6px 10px;border:1px solid #ddd;background:#644391;color:#fff;text-align:right;">${htmlEscape(t.colAmount)}</th>` +
    `<th style="padding:6px 10px;border:1px solid #ddd;background:#644391;color:#fff;text-align:left;">${htmlEscape(t.colCom)}</th>` +
    `</tr>${rows}</table>` +
    `<p>${htmlEscape(t.payWith)}</p>` +
    `<p style="margin-left:12px;">${htmlEscape(t.beneficiary)} : <strong>${htmlEscape(ctx.paymentBeneficiary || "[À CONFIGURER]")}</strong><br/>` +
    `${htmlEscape(t.iban)} : <strong>${htmlEscape(ctx.paymentIban || "[À CONFIGURER]")}</strong></p>` +
    `<p>${htmlEscape(t.portal)}<br/><a href="${htmlEscape(ctx.portalUrl || "#")}">${htmlEscape(ctx.portalUrl || "[À CONFIGURER]")}</a></p>` +
    `<p style="color:#676362;">${htmlEscape(t.alreadyPaid)}</p>`
  );
}

/** Construit sujet + HTML. `language` null -> version TRILINGUE (repli sûr). */
export function buildReminder1Email(
  language: string | null,
  firstName: string,
  months: CandidateMonth[],
  ctx: ReminderMailContext
): { subject: string; html: string; languageUsed: string } {
  if (language && TEXTS[language]) {
    const html =
      blockHtml(language, firstName, months, ctx) +
      `<p style="color:#676362;">${htmlEscape(TEXTS[language]!.signature)}</p>`;
    return { subject: SUBJECTS[language]!, html, languageUsed: language };
  }
  const parts = (["fr", "nl", "en"] as const).map((lang) =>
    blockHtml(lang, firstName, months, ctx)
  );
  const html =
    parts.join(`<hr style="border:none;border-top:1px solid #ddd;margin:16px 0;"/>`) +
    `<p style="color:#676362;">${htmlEscape(TEXTS["fr"]!.signature)}</p>`;
  return { subject: SUBJECTS["multi"]!, html, languageUsed: "multi" };
}

// ---------------------------------------------------------------------------
//  Estampille « LastReminder1Run » (Indicateurs) — y compris l'ABSTENTION
// ---------------------------------------------------------------------------

async function stampLastRun(
  graph: GraphClient,
  siteId: string,
  indicateursListId: string,
  nowIso: string,
  numValue: number,
  textValue: string,
  scope: string,
  detail: string
): Promise<void> {
  const existing = await readIndicateur(graph, siteId, indicateursListId, IND_LAST_RUN);
  const fields = {
    Title: IND_LAST_RUN,
    NumValue: numValue,
    TextValue: textValue,
    Scope: scope,
    ComputedAt: nowIso,
    Detail: detail,
  };
  if (existing) {
    await graph.write(
      "PATCH",
      `/sites/${siteId}/lists/${indicateursListId}/items/${existing.itemId}/fields`,
      fields
    );
  } else {
    await graph.write("POST", `/sites/${siteId}/lists/${indicateursListId}/items`, {
      fields,
    });
  }
}

// ---------------------------------------------------------------------------
//  ORCHESTRATEUR
// ---------------------------------------------------------------------------

const SEND_PACE_MS = 2000; // ~30 envois/min max (limites Exchange Online)

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runReminder1(
  cfg: Settings,
  graph: GraphClient,
  mailCtx: ReminderMailContext,
  opts: Reminder1Options
): Promise<Reminder1Result> {
  const log = opts.log;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const maxDetail = opts.maxDetail ?? 30;

  const result: Reminder1Result = {
    dryRun: opts.dryRun,
    aborted: false,
    abortReasons: [],
    guard: [],
    windowLabel: "",
    overdueYearMonths: [],
    rowsRead: 0,
    candidateMonths: 0,
    excludedLevel: 0,
    excludedPlan: 0,
    dossiers: 0,
    quarantined: [],
    orphans: [],
    noEmail: [],
    sent: 0,
    failed: 0,
    monthsStamped: 0,
  };

  // --- Résolution du site et des listes -----------------------------------
  const siteId = await getSiteId(graph, cfg, log);

  const need = async (name: string): Promise<{ id: string }> => {
    const list = await findListByName(graph, siteId, name);
    if (!list) {
      throw new SoldesSyncError(
        `Liste « ${name} » introuvable.\n  → npm run sp:provision`
      );
    }
    return list;
  };

  const [soldes, config, residents, paiements, indicateurs, journal] =
    await Promise.all([
      need(SOLDES_LIST_NAME),
      need(CONFIG_LIST_NAME_R),
      need(RESIDENTS_LIST_NAME),
      need(PAIEMENTS_LIST_NAME),
      need(INDICATEURS_LIST_NAME),
      need(JOURNAL_LIST_NAME),
    ]);

  await assertListColumns(graph, siteId, soldes.id, SOLDES_LIST_NAME, SOLDES_R2_COLUMNS);
  await assertListColumns(graph, siteId, journal.id, JOURNAL_LIST_NAME, JOURNAL_COLUMNS);
  await assertListColumns(graph, siteId, config.id, CONFIG_LIST_NAME_R, ["Title", "ParamValue"]);
  await assertListColumns(graph, siteId, residents.id, RESIDENTS_LIST_NAME, [
    "FedasilNumber",
    "FirstName",
    "Email",
    "ContactLanguage",
  ]);

  // --- Garde-fou §4.4 (fail-safe : le doute vaut abstention) ---------------
  const { params, problems } = await loadReminder1Params(graph, siteId, config.id);

  result.guard.push({
    label: "Paramètres Config",
    ok: params !== null,
    blocking: true,
    detail:
      params !== null
        ? `enabled=${params.enabled} · maxQueue=${params.maxQueue} · maxImportAge=${params.maxImportAgeDays} j`
        : problems.join(" ; "),
  });

  result.guard.push({
    label: "Interrupteur Reminder1Enabled",
    ok: params?.enabled === true,
    blocking: true,
    detail:
      params === null
        ? "non évaluable (paramètres invalides)"
        : params.enabled
          ? "ON"
          : "OFF (normal tant que le moteur n'est pas mis en service)",
  });

  const queueCount = await countLettrageQueue(graph, siteId, paiements.id);
  result.guard.push({
    label: "File de lettrage (ToProcess)",
    ok: params !== null && queueCount <= params.maxQueue,
    blocking: true,
    detail:
      params === null
        ? `${queueCount} en file (seuil non évaluable)`
        : `${queueCount} en file (seuil ${params.maxQueue})`,
  });

  const lastImport = await readIndicateur(graph, siteId, indicateurs.id, IND_LAST_IMPORT);
  const importAgeDays =
    lastImport?.computedAt != null
      ? Math.floor((now.getTime() - lastImport.computedAt.getTime()) / 86_400_000)
      : null;
  result.guard.push({
    label: "Fraîcheur de l'import bancaire",
    ok: params !== null && importAgeDays !== null && importAgeDays <= params.maxImportAgeDays,
    blocking: true,
    detail:
      importAgeDays === null
        ? `aucun import réel journalisé (${IND_LAST_IMPORT} absent — le moteur ne relance PERSONNE sans preuve de fraîcheur)`
        : `dernier import il y a ${importAgeDays} j` +
          (lastImport?.textValue ? ` (${lastImport.textValue})` : "") +
          (params ? ` — seuil ${params.maxImportAgeDays} j` : ""),
  });

  const lastSync = await readIndicateur(graph, siteId, indicateurs.id, IND_LAST_SYNC);
  const syncAgeHours =
    lastSync?.computedAt != null
      ? Math.floor((now.getTime() - lastSync.computedAt.getTime()) / 3_600_000)
      : null;
  result.guard.push({
    label: "Fraîcheur de la synchro Soldes (avertissement)",
    ok: syncAgeHours !== null && syncAgeHours <= 48,
    blocking: false,
    detail:
      syncAgeHours === null
        ? `${IND_LAST_SYNC} absent — la nuit R2b enchaînera synchro puis moteur`
        : `dernière synchro il y a ${syncAgeHours} h`,
  });

  // Mode réel : e-mail impossible à composer proprement = abstention.
  const mailProblems: string[] = [];
  if (!mailCtx.senderUserId) mailProblems.push("GRAPH_SENDER_USER_ID");
  if (!mailCtx.paymentIban) mailProblems.push("PAYMENT_IBAN");
  if (!mailCtx.paymentBeneficiary) mailProblems.push("PAYMENT_BENEFICIARY");
  if (!mailCtx.portalUrl) mailProblems.push("PORTAL_URL / INVITE_REDIRECT_URL");
  result.guard.push({
    label: "Contexte d'envoi (identifiants e-mail/virement)",
    ok: mailProblems.length === 0,
    blocking: !opts.dryRun, // en dry-run : simple avertissement + [À CONFIGURER]
    detail:
      mailProblems.length === 0
        ? "complet"
        : `manquant : ${mailProblems.join(", ")}`,
  });

  let blockers = result.guard.filter((c) => c.blocking && !c.ok);
  if (opts.dryRun) {
    // L'interrupteur OFF n'empêche JAMAIS un dry-run : c'est précisément
    // l'outil d'observation AVANT la mise en service.
    blockers = blockers.filter((c) => c.label !== "Interrupteur Reminder1Enabled");
    if (opts.skipGuard) blockers = [];
  }

  const active = await readActiveQuarter(graph, siteId);
  result.windowLabel = windowLabelOf(active);

  if (blockers.length > 0) {
    result.aborted = true;
    result.abortReasons = blockers.map((c) => `${c.label} : ${c.detail}`);
    log("");
    log("⛔ ABSTENTION du moteur (garde-fou §4.4) :");
    for (const r of result.abortReasons) log(`   · ${r}`);
    if (!opts.dryRun) {
      await stampLastRun(
        graph,
        siteId,
        indicateurs.id,
        nowIso,
        0,
        `ABSTENTION : ${blockers[0]!.label}`,
        result.windowLabel,
        result.abortReasons.join("\n")
      );
      log(`   Estampille ${IND_LAST_RUN} posée (le tableau de bord R2b l'affichera).`);
    }
    return result;
  }

  // --- Sélection (mêmes requêtes que la vue Recouvrement du chantier R1) ---
  log("");
  log(`Fenêtre : ${result.windowLabel} (trimestre actif T${active.quarter} ${active.year})`);
  result.overdueYearMonths = overdueYearMonthsOf(active, now);
  log(`Mois échus de la fenêtre : ${result.overdueYearMonths.join(", ") || "aucun"}`);

  const { byFa, counters } = await selectCandidates(
    graph,
    siteId,
    soldes.id,
    result.overdueYearMonths,
    now,
    log
  );
  result.rowsRead = counters.rowsRead;
  result.candidateMonths = counters.candidateMonths;
  result.excludedLevel = counters.excludedLevel;
  result.excludedPlan = counters.excludedPlan;

  // --- Contacts, quarantaine ----------------------------------------------
  const contacts = await readResidentContacts(graph, siteId, residents.id, log);
  const quarantined = await readQuarantinedFas(graph, siteId, journal.id);

  const dossiers: CandidateDossier[] = [];
  for (const [fa, months] of byFa.entries()) {
    if (quarantined.has(fa)) {
      result.quarantined.push(fa);
      continue;
    }
    const contact = contacts.get(fa);
    if (!contact) {
      result.orphans.push(fa); // FA de Soldes absent de Residents List
      continue;
    }
    if (!contact.email) {
      result.noEmail.push(fa);
      continue;
    }
    const totalDue = round2(months.reduce((s, m) => s + m.balance, 0));
    dossiers.push({
      fa,
      months,
      totalDue,
      oldestDueIso: months[0]!.dueDateIso,
      email: contact.email,
      firstName: contact.firstName,
      language: contact.language,
    });
  }
  // Tri par urgence : échéance la plus ancienne d'abord (même règle que R1).
  dossiers.sort((a, b) => a.oldestDueIso.localeCompare(b.oldestDueIso));
  result.dossiers = dossiers.length;

  if (result.quarantined.length > 0) {
    log("");
    log(`⚠ QUARANTAINE (ligne(s) Pending dans ${JOURNAL_LIST_NAME}) : ${result.quarantined.join(", ")}`);
    log("   → Résolution HUMAINE requise : vérifier si l'e-mail est parti,");
    log("     puis marquer la ligne Sent (et estampiller Soldes) ou Failed.");
  }
  if (result.orphans.length > 0) {
    log(`⚠ FA orphelins (dans Soldes mais pas dans Residents List) : ${result.orphans.join(", ")}`);
  }
  if (result.noEmail.length > 0) {
    log(`⚠ Sans adresse e-mail (rappel papier hors périmètre v1) : ${result.noEmail.join(", ")}`);
  }

  // --- Envoi (ou aperçu) ---------------------------------------------------
  log("");
  log(
    opts.dryRun
      ? `DRY-RUN — ${dossiers.length} dossier(s) recevraient un rappel 1 :`
      : `ENVOI — ${dossiers.length} dossier(s) :`
  );

  let detailShown = 0;
  for (const d of dossiers) {
    const mail = buildReminder1Email(d.language, d.firstName, d.months, mailCtx);
    const monthsCovered = d.months.map((m) => String(m.yearMonth)).join(";");

    if (detailShown < maxDetail) {
      log(
        `   · ${d.fa} · ${d.months.length} mois (${monthsCovered}) · ` +
          `${euro(d.totalDue)} · ${maskEmail(d.email!)} · ${mail.languageUsed}`
      );
      detailShown++;
      if (detailShown === maxDetail && dossiers.length > maxDetail) {
        log(`   … et ${dossiers.length - maxDetail} autre(s) dossier(s)`);
      }
    }

    if (opts.dryRun) {
      result.sent++; // « envoyables » en dry-run
      result.monthsStamped += d.months.length;
      continue;
    }

    // 1) Journal AVANT l'envoi (anti-double-envoi).
    const stampDay = nowIso.slice(0, 10).replace(/-/g, "");
    const stampTime = nowIso.slice(11, 19).replace(/:/g, "");
    const attemptKey = `${d.fa}-R1-${stampDay}-${stampTime}`;
    await graph.write("POST", `/sites/${siteId}/lists/${journal.id}/items`, {
      fields: {
        Title: attemptKey,
        FedasilNumber: d.fa,
        Level: 1,
        Channel: "Email", // via Graph : la CHAÎNE (côté SDK staff : { Value })
        MonthsCovered: monthsCovered,
        TotalDue: d.totalDue,
        Recipient: d.email,
        Language: mail.languageUsed,
        ValidatedBy: "system",
        Status: "Pending",
      },
    });
    const journalItemId = await findJournalItemId(
      graph,
      siteId,
      journal.id,
      d.fa,
      attemptKey
    );

    // 2) sendMail (la même boîte que les invitations du portail, §4.10).
    let sendOk = true;
    let sendError = "";
    try {
      await graph.write(
        "POST",
        `/users/${encodeURIComponent(mailCtx.senderUserId)}/sendMail`,
        {
          message: {
            subject: mail.subject,
            body: { contentType: "HTML", content: mail.html },
            toRecipients: [{ emailAddress: { address: d.email } }],
          },
          saveToSentItems: false,
        }
      );
    } catch (err) {
      sendOk = false;
      sendError = err instanceof Error ? err.message : String(err);
    }

    // 3) Issue de la tentative.
    if (!sendOk) {
      result.failed++;
      log(`   ✗ ${d.fa} : échec sendMail — ${sendError.slice(0, 160)}`);
      if (journalItemId) {
        await graph.write(
          "PATCH",
          `/sites/${siteId}/lists/${journal.id}/items/${journalItemId}/fields`,
          { Status: "Failed", Note: sendError.slice(0, 2000) }
        );
      }
      // Les mois ne sont PAS estampillés : le dossier reviendra au prochain
      // passage (nouvelle tentative, nouvelle ligne de journal).
      await pause(SEND_PACE_MS);
      continue;
    }

    if (journalItemId) {
      await graph.write(
        "PATCH",
        `/sites/${siteId}/lists/${journal.id}/items/${journalItemId}/fields`,
        { Status: "Sent", SentDate: nowIso }
      );
    } else {
      // Introuvable après création : on n'estampille PAS (la ligne Pending
      // mettra le FA en quarantaine — résolution humaine, jamais silencieuse).
      log(`   ⚠ ${d.fa} : ligne de journal introuvable après création — quarantaine.`);
      result.failed++;
      await pause(SEND_PACE_MS);
      continue;
    }

    // 4) Estampilles Soldes : la machine à états avance (§4.9).
    for (const m of d.months) {
      await graph.write(
        "PATCH",
        `/sites/${siteId}/lists/${soldes.id}/items/${m.itemId}/fields`,
        { ReminderLevel: 1, Reminder1Date: nowIso }
      );
      result.monthsStamped++;
    }
    result.sent++;
    await pause(SEND_PACE_MS);
  }

  // --- Estampille du passage (mode réel) -----------------------------------
  if (!opts.dryRun) {
    const text =
      result.failed > 0
        ? `${result.sent} envoi(s), ${result.failed} échec(s)`
        : `${result.sent} envoi(s)`;
    await stampLastRun(
      graph,
      siteId,
      indicateurs.id,
      nowIso,
      result.sent,
      text,
      result.windowLabel,
      `Dossiers : ${result.dossiers} · mois estampillés : ${result.monthsStamped}` +
        ` · exclus plan : ${result.excludedPlan} · déjà rappelés : ${result.excludedLevel}` +
        (result.quarantined.length ? ` · quarantaine : ${result.quarantined.join(", ")}` : "") +
        (result.noEmail.length ? ` · sans e-mail : ${result.noEmail.length}` : "")
    );
    log("");
    log(`Estampille ${IND_LAST_RUN} posée : ${text}.`);
  }

  return result;
}

// ---------------------------------------------------------------------------
//  Résumé lisible (CLI et, en R2b, journal de la Function)
// ---------------------------------------------------------------------------

export function formatReminderSummary(r: Reminder1Result): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("──────────────────────────────────────────────────");
  lines.push(
    r.dryRun ? "RÉSUMÉ (DRY-RUN — rien n'a été écrit ni envoyé)" : "RÉSUMÉ DE L'ENVOI"
  );
  lines.push("──────────────────────────────────────────────────");
  for (const c of r.guard) {
    const mark = c.ok ? "✓" : c.blocking ? "✗" : "⚠";
    lines.push(` ${mark} ${c.label} — ${c.detail}`);
  }
  if (r.aborted) {
    lines.push("");
    lines.push(" ⛔ ABSTENTION — aucun envoi, aucune écriture de rappel.");
    return lines.join("\n");
  }
  lines.push("");
  lines.push(` Fenêtre           : ${r.windowLabel}`);
  lines.push(` Lignes Soldes lues: ${r.rowsRead} (${r.overdueYearMonths.length} mois échus)`);
  lines.push(` Mois candidats    : ${r.candidateMonths}`);
  lines.push(`   exclus (déjà rappelés) : ${r.excludedLevel}`);
  lines.push(`   exclus (plan §4.6)     : ${r.excludedPlan}`);
  lines.push(` Dossiers          : ${r.dossiers}`);
  if (r.quarantined.length) lines.push(` Quarantaine       : ${r.quarantined.length} (${r.quarantined.join(", ")})`);
  if (r.orphans.length) lines.push(` FA orphelins      : ${r.orphans.length}`);
  if (r.noEmail.length) lines.push(` Sans e-mail       : ${r.noEmail.length}`);
  lines.push(
    r.dryRun
      ? ` Envoyables        : ${r.sent} dossier(s), ${r.monthsStamped} mois`
      : ` Envoyés           : ${r.sent} dossier(s) · échecs : ${r.failed} · mois estampillés : ${r.monthsStamped}`
  );
  return lines.join("\n");
}
