/* ============================================================================
 *  scripts/seed-simulation.ts — Jeu de données de SIMULATION (app staff)
 * ----------------------------------------------------------------------------
 *  OBJECTIF : reconstruire une année complète d'activité (janvier 2025 →
 *  20 mai 2026, « aujourd'hui simulé ») pour développer les modules de
 *  l'application staff sans attendre les données réelles.
 *
 *  CE QUE LE SCRIPT FAIT :
 *    1. Lit KB-Cumul T4 : les lignes RÉELLES (StructuredText ≠ "SIM") servent
 *       de base statistique (fourchette et distribution des salaires nets) et
 *       de population de départ (FA). Elles ne sont JAMAIS modifiées.
 *    2. Residents List : remplace FirstName/LastName par des prénoms-noms
 *       francophones réalistes (déterministes par FA). NN (Title), FA, Email
 *       et EntraOid sont CONSERVÉS. Crée les résidents manquants + quelques
 *       arrivées fictives 2026 (FA préfixé FA99…).
 *    3. Complète les listes :
 *         KB-Cumul T3 = T3 2025   ·   KB-Cumul T4 = octobre + décembre 2025
 *         KB-Cumul T1 = T1 2026   ·   KB-Cumul T2 = avril 2026 (mai en cours)
 *         Soldes      = janvier 2025 → mars 2026 (T1-T2 2025 n'existent QUE là)
 *         KB-Paiements = virements depuis octobre 2025 (mise en service de
 *                        l'import bancaire dans la chronologie simulée)
 *    4. Génère localement les fixtures BCSS (module 5) dans simulation/ :
 *         BCSS-2025-T1.csv … BCSS-2026-T1.csv  (brut DMFA trimestriel par NN)
 *         BCSS-cle-de-correction.csv           (classe attendue par dossier)
 *         RAPPORT-SIMULATION.md                (récapitulatif)
 *
 *  MARQUAGE (purge chirurgicale) :
 *    - lignes KB-Cumul générées   : StructuredText = "SIM"
 *    - paiements générés          : Title préfixé "SIM-"
 *    - résidents fictifs créés    : FedasilNumber préfixé "FA99"
 *    - Soldes : à la purge, seules les lignes correspondant à des lignes
 *      KB-Cumul RÉELLES sont conservées.
 *    ⚠ Les noms remplacés dans Residents List ne sont PAS restaurés par la
 *      purge (les originaux étaient anonymisés).
 *
 *  PROFILS SIMULÉS :
 *    - travail   : ~55 % continus, ~45 % intermittents (mois sans revenu) ;
 *    - paiement  : ~60 % ponctuels (com structurée), ~15 % partiels,
 *                  ~15 % impayés (candidats rappels), ~10 % communication
 *                  libre (file de lettrage) + quelques anomalies ;
 *    - BCSS      : ~80 % conformes, ~8 % sous-déclarants, ~4 % salariés BCSS
 *                  sans aucune déclaration (le cas grave), ~8 % déclarés sans
 *                  trace BCSS (intérim tardif — bénin).
 *
 *  USAGE (depuis la RACINE du dépôt) :
 *    npm run sp:seed -- --dry-run        montre ce qui serait fait, n'écrit
 *                                        rien dans SharePoint (les fichiers
 *                                        locaux simulation/ SONT générés)
 *    npm run sp:seed                     génère tout (rejouable : upsert /
 *                                        skip des lignes déjà présentes)
 *    npm run sp:seed -- --purge          supprime UNIQUEMENT la simulation
 *                                        (confirmation « PURGER » exigée)
 *    npm run sp:seed -- --seed=123       autre graine aléatoire (par défaut
 *                                        20260520 : deux exécutions donnent
 *                                        exactement les mêmes données)
 *
 *  Identifiants : réutilise api/local.settings.json (TENANT_ID,
 *  GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, SP_SITE_HOSTNAME, SP_SITE_PATH),
 *  comme provision-sharepoint.ts, rotate-quarter.ts et snapshot-soldes.ts.
 *  Écritures par lots Graph $batch (20 opérations/requête) avec reprise 429.
 *
 *  v2 (12/7/2026) — correctifs après le premier run à grande échelle :
 *    - le jeton Graph est RAFRAÎCHI automatiquement (toutes les ~40 min et
 *      sur 401) : un run long ne meurt plus à l'expiration du jeton ;
 *    - 401 est désormais traité comme une erreur de REPRISE, pas définitive ;
 *    - les FA99 créés lors d'un run précédent ne sont plus relus depuis
 *      Residents List (ils gardaient sinon un second profil parasite) ;
 *    - progression : total exact affiché en fin de chaque phase ;
 *    - dry-run : détail des 5 premières lignes Soldes divergentes.
 *
 *  v3 (12/7/2026) — STABILITÉ de la génération entre passages :
 *    - le NN fictif a son propre flux aléatoire : la présence du NN dans
 *      Residents List (créé à un run précédent) ne décale plus le profil
 *      du résident — la génération est désormais un vrai point fixe ;
 *    - les valeurs réelles à >2 décimales sont arrondies avant recopie
 *      dans Soldes (même convention round2 que sp:soldes).
 *    ⚠ Les données écrites par la v1 divergent de ce point fixe pour les FA
 *    qui manquaient dans Residents List : pour un jeu 100 % cohérent,
 *    PURGER puis regénérer une fois avec cette version.
 * ============================================================================ */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

// ---------- Chronologie simulée ----------

const SIM_TODAY = Date.UTC(2026, 4, 20); // 20 mai 2026
const FIRST_YM = 202501;                 // janvier 2025
const LAST_WORK_YM = 202605;             // mai 2026 (mois en cours, non déclaré)
const LAST_DECL_YM = 202604;             // dernier mois déclarable
const SOLDES_LAST_YM = 202603;           // Soldes synchronisée jusque T1 2026
const PAYMENTS_FROM_YM = 202510;         // début de l'import bancaire simulé

const SIM_TAG = "SIM";
const SIM_PAY_PREFIX = "SIM-";
const SIM_FA_PREFIX = "FA99";
const FICTIONAL_ARRIVALS = 12;           // nouveaux résidents 2026 (FA99…)
const APRIL_DECLARED_RATE = 0.85;        // avril 2026 : déclarations en cours

// ---------- Configuration (même mécanique que les autres scripts) ----------

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function loadSettings(): Record<string, string> {
  const path = resolve(process.cwd(), "api/local.settings.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    fail(
      `Impossible de lire ${path}.\n` +
        "Lance le script depuis la RACINE du dépôt (npm run sp:seed -- --dry-run)."
    );
  }
  const json = JSON.parse(raw!) as { Values?: Record<string, string> };
  return json.Values ?? {};
}

function requireSetting(values: Record<string, string>, key: string): string {
  const v = (values[key] ?? "").trim();
  if (!v) fail(`Variable manquante dans api/local.settings.json > Values : ${key}`);
  return v;
}

// ---------- Client Graph minimal (+ $batch) ----------

let graphToken = "";
let graphCfg: Record<string, string> = {};
let tokenIssuedAt = 0;
const TOKEN_MAX_AGE_MS = 40 * 60 * 1000; // rafraîchi bien avant l'expiration (~60 min)

// Garantit un jeton frais — indispensable sur les runs longs (40 000+ ops).
async function ensureToken(force = false): Promise<void> {
  if (force || !graphToken || Date.now() - tokenIssuedAt > TOKEN_MAX_AGE_MS) {
    graphToken = await getGraphToken(graphCfg);
    tokenIssuedAt = Date.now();
  }
}

async function getGraphToken(cfg: Record<string, string>): Promise<string> {
  const tenantId = requireSetting(cfg, "TENANT_ID");
  const clientId = requireSetting(cfg, "GRAPH_CLIENT_ID");
  const clientSecret = requireSetting(cfg, "GRAPH_CLIENT_SECRET");
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );
  if (!res.ok) {
    fail(`Échec du jeton Graph (statut ${res.status}). Vérifie le secret dans local.settings.json.`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

async function graphGet<T>(url: string): Promise<T> {
  await ensureToken();
  const full = url.startsWith("https://")
    ? url
    : `https://graph.microsoft.com/v1.0${url}`;
  const res = await fetch(full, {
    headers: { Authorization: `Bearer ${graphToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    fail(`Graph GET ${url} -> statut ${res.status}\n${text}`);
  }
  return (await res.json()) as T;
}

type BatchOp = {
  method: "POST" | "PATCH" | "DELETE";
  url: string; // relatif à /v1.0
  body?: unknown;
  label: string; // pour les messages d'erreur
};

// Exécute des opérations d'écriture par lots de 20.
// Reprise automatique : 429/503 (limitation) ET 401 (jeton expiré -> rafraîchi).
async function graphBatch(ops: BatchOp[], phase: string): Promise<number> {
  let queue = [...ops];
  let done = 0;
  let failures = 0;
  let chunkCount = 0;
  for (let pass = 1; pass <= 5 && queue.length > 0; pass++) {
    const retry: BatchOp[] = [];
    for (let i = 0; i < queue.length; i += 20) {
      await ensureToken(); // jeton frais garanti sur toute la durée du run
      const chunk = queue.slice(i, i + 20);
      const payload = {
        requests: chunk.map((op, idx) => ({
          id: String(idx),
          method: op.method,
          url: op.url,
          ...(op.body !== undefined
            ? { body: op.body, headers: { "Content-Type": "application/json" } }
            : {}),
        })),
      };
      const res = await fetch("https://graph.microsoft.com/v1.0/$batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${graphToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        console.log("   … jeton expiré, rafraîchissement et reprise du lot");
        await ensureToken(true);
        i -= 20; // rejoue le même lot
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        fail(`Graph $batch (${phase}) -> statut ${res.status}\n${text}`);
      }
      const json = (await res.json()) as {
        responses: Array<{ id: string; status: number; headers?: Record<string, string>; body?: unknown }>;
      };
      let waitSec = 0;
      let sawExpired = false;
      for (const r of json.responses) {
        const op = chunk[Number(r.id)];
        if (r.status >= 200 && r.status < 300) {
          done++;
        } else if (r.status === 429 || r.status === 503) {
          retry.push(op);
          waitSec = Math.max(waitSec, Number(r.headers?.["Retry-After"] ?? "5"));
        } else if (r.status === 401) {
          retry.push(op); // jeton expiré au niveau de l'opération : REPRISE
          sawExpired = true;
        } else {
          failures++;
          console.log(
            `   ✗ ${phase} : ${op.label} -> statut ${r.status} ${JSON.stringify(r.body ?? "").slice(0, 200)}`
          );
        }
      }
      if (sawExpired) await ensureToken(true);
      if (waitSec > 0) {
        console.log(`   … limitation Graph, pause ${waitSec}s`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
      } else {
        await new Promise((r) => setTimeout(r, 250)); // rythme prudent
      }
      chunkCount++;
      if (chunkCount % 10 === 0) {
        console.log(`   ${done}/${ops.length} écrit(s)…`);
      }
    }
    queue = retry;
    if (queue.length > 0) {
      console.log(`   … passe ${pass} terminée, ${queue.length} opération(s) à reprendre`);
    }
  }
  if (queue.length > 0) {
    console.log(`   ⚠ ${queue.length} opération(s) abandonnée(s) après 5 tentatives (${phase}).`);
  }
  if (failures > 0) {
    console.log(`   ⚠ ${failures} échec(s) définitif(s) dans la phase « ${phase} » (voir ci-dessus).`);
  }
  console.log(`   Phase « ${phase} » : ${done}/${ops.length} écrit(s), ${failures} échec(s), ${queue.length} abandonnée(s).`);
  return done;
}

async function getSiteId(cfg: Record<string, string>): Promise<string> {
  const hostname = requireSetting(cfg, "SP_SITE_HOSTNAME");
  const sitePath = requireSetting(cfg, "SP_SITE_PATH");
  const site = await graphGet<{ id: string; webUrl?: string }>(
    `/sites/${hostname}:/${sitePath}?$select=id,webUrl`
  );
  console.log(`Site : ${site.webUrl ?? hostname + "/" + sitePath}`);
  return site.id;
}

// ---------- Lecture des listes ----------

type ListItem = { id: string; fields: Record<string, unknown> };
type ListRef = { id: string; displayName: string };

async function findListByName(siteId: string, displayName: string): Promise<ListRef | null> {
  const json = await graphGet<{
    value: Array<{ id: string; displayName: string; list?: { hidden?: boolean } }>;
  }>(`/sites/${siteId}/lists?$select=id,displayName,list&$top=200`);
  return (
    json.value
      .filter((l) => !l.list?.hidden)
      .find((l) => l.displayName.toLowerCase() === displayName.toLowerCase()) ?? null
  );
}

async function getAllItems(siteId: string, listId: string): Promise<ListItem[]> {
  const items: ListItem[] = [];
  let url: string | undefined = `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=200`;
  while (url) {
    const page: {
      value: Array<{ id: string; fields?: Record<string, unknown> }>;
      "@odata.nextLink"?: string;
    } = await graphGet(url);
    for (const it of page.value) items.push({ id: it.id, fields: it.fields ?? {} });
    url = page["@odata.nextLink"];
  }
  return items;
}

// ---------- Règles métier (alignées sur l'état projet) ----------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Tranches Fedasil sur le NET (dupliquées de Declare.ts / Portail.tsx).
function calcContribution(net: number): number {
  const t2 = Math.max(0, Math.min(net, 1000) - 265) * 0.35;
  const t3 = Math.max(0, Math.min(net, 1500) - 1000) * 0.45;
  const t4 = Math.max(0, net - 1500) * 0.5;
  return round2(t2 + t3 + t4);
}

// Communication structurée belge (dupliquée de Declare.ts).
function buildStructuredCom(fedasilNumber: string, month: number): string {
  const digits = fedasilNumber.replace(/\D/g, "");
  const base = `${String(month).padStart(2, "0")}0${digits.slice(-7)}`;
  const check = Number(base) % 97 || 97;
  const full = `${base}${String(check).padStart(2, "0")}`;
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7, 12)}+++`;
}

// Échéance §5.18 : dernier jour du mois SUIVANT le mois déclaré.
function dueDateIso(year: number, month: number): string {
  return new Date(Date.UTC(year, month + 1, 0)).toISOString();
}

function payStatusOf(balance: number, paid: number): string {
  if (balance <= 0) return "Paid";
  return paid > 0 ? "Partial" : "Unpaid";
}

// Ratio brut/net « façon Jobat » (personne isolée) : plus le net est haut,
// plus la pression fiscale l'est. net 500 -> ~1,37 ; 1500 -> ~1,63.
function grossRatio(net: number): number {
  return 1.25 + Math.min(net, 2200) / 4000;
}

// ---------- Aléatoire DÉTERMINISTE (rejouable à l'identique) ----------

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const rInt = (rng: Rng, a: number, b: number): number => a + Math.floor(rng() * (b - a + 1));

// ---------- Calendrier ----------

const ymYear = (ym: number) => Math.floor(ym / 100);
const ymMonth = (ym: number) => ym % 100;
const ymQuarter = (ym: number) => Math.ceil(ymMonth(ym) / 3);
function ymAdd(ym: number, n: number): number {
  const idx = ymYear(ym) * 12 + (ymMonth(ym) - 1) + n;
  return Math.floor(idx / 12) * 100 + ((idx % 12) + 1);
}
function ymRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let ym = from; ym <= to; ym = ymAdd(ym, 1)) out.push(ym);
  return out;
}
const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

// Vers quelle liste KB-Cumul va un mois donné dans la chronologie simulée ?
// (T1-T2 2025 : listes déjà réutilisées pour 2026 -> Soldes uniquement.)
function targetKbList(ym: number): "T1" | "T2" | "T3" | "T4" | null {
  if (ym >= 202507 && ym <= 202509) return "T3";
  if (ym >= 202510 && ym <= 202512) return "T4";
  if (ym >= 202601 && ym <= 202603) return "T1";
  if (ym >= 202604 && ym <= 202606) return "T2";
  return null;
}

// ---------- Identités francophones ----------

const FIRST_NAMES = [
  "Nadia", "Karim", "Amélie", "Julien", "Sophie", "Mehdi", "Claire", "Antoine",
  "Leïla", "Nicolas", "Camille", "Youssef", "Élise", "Thomas", "Fatima", "Hugo",
  "Aïcha", "Maxime", "Charlotte", "Rachid", "Pauline", "Olivier", "Samira", "Louis",
  "Manon", "Bilal", "Justine", "Sébastien", "Yasmina", "Damien", "Laura", "Adam",
  "Céline", "Mathieu", "Inès", "Vincent", "Sarah", "Romain", "Nora", "Benjamin",
  "Émilie", "Khalid", "Aurélie", "Quentin", "Salima", "François", "Marine", "Ibrahim",
  "Chloé", "Grégory", "Anissa", "Cédric", "Valérie", "Nassim", "Delphine", "Pierre",
];
const LAST_NAMES = [
  "Moreau", "Lambert", "Dubois", "Lefebvre", "Martin", "Bernard", "Petit", "Durand",
  "Leroy", "Simon", "Laurent", "Michel", "Garcia", "Fontaine", "Rousseau", "Vincent",
  "Muller", "Mercier", "Blanc", "Guérin", "Boyer", "Garnier", "Chevalier", "François",
  "Legrand", "Gauthier", "Perrin", "Robin", "Clément", "Morin", "Nguyen", "Henry",
  "Roussel", "Mathieu", "Gautier", "Masson", "Marchand", "Duval", "Denis", "Dumont",
  "Marie", "Lemaire", "Noël", "Meyer", "Dufour", "Meunier", "Brun", "Blanchard",
  "Giraud", "Joly", "Rivière", "Lucas", "Brunet", "Gaillard", "Barbier", "Arnaud",
  "Gérard", "Roche", "Renard", "Schmitt", "Roy", "Colin", "Vidal", "Caron",
  "Picard", "Roger", "Fabre", "Aubert", "Lemoine", "Renaud", "Dumas", "Lacroix",
  "Olivier", "Philippe", "Bourgeois", "Pierre", "Benoit", "Rey", "Leclerc", "Payet",
];

function namesForFa(fa: string): { first: string; last: string } {
  const h = hash32("nom:" + fa);
  return {
    first: FIRST_NAMES[h % FIRST_NAMES.length],
    last: LAST_NAMES[Math.floor(h / 256) % LAST_NAMES.length],
  };
}

// NN belge fictif à checksum valide (naissance 1980-2004 ; règle « préfixe 2 »
// pour les naissances >= 2000).
function makeFakeNN(rng: Rng): string {
  const y = rInt(rng, 1980, 2004);
  const m = rInt(rng, 1, 12);
  const d = rInt(rng, 1, 28);
  const counter = rInt(rng, 5, 995);
  const base9 =
    String(y % 100).padStart(2, "0") +
    String(m).padStart(2, "0") +
    String(d).padStart(2, "0") +
    String(counter).padStart(3, "0");
  const forCheck = y >= 2000 ? "2" + base9 : base9;
  const mod = Number(forCheck) % 97;
  const check = mod === 0 ? 97 : 97 - mod;
  return base9 + String(check).padStart(2, "0");
}

// ---------- Modèle de simulation ----------

type PayerProfile = "bon" | "partiel" | "mauvais" | "libre";
type BcssProfile = "conforme" | "sous" | "noDecl" | "noBcss";

type SimResident = {
  fa: string;
  nn: string;
  first: string;
  last: string;
  isNew: boolean; // arrivée fictive 2026 (FA99…)
  activeFrom: number;
  activeTo: number;
  workRate: number;
  anchorNet: number;
  payer: PayerProfile;
  bcss: BcssProfile;
  suppressedQuarters: Set<string>; // "2026-1" : trimestres travaillés NON déclarés (cas noDecl)
};

type SimPayment = {
  title: string;
  dateIso: string;
  amount: number;
  structuredCom: string;
  freeCom: string;
  counterpartyName: string;
  counterpartyIban: string;
  fa: string; // vide si non imputé
  month: number | null;
  status: "À traiter" | "Imputé" | "Anomalie";
};

type SimMonth = {
  fa: string;
  ym: number;
  trueNet: number;      // le « vrai » salaire (base DMFA)
  declared: boolean;
  declaredNet: number;
  declaredGross: number;
  contribution: number;
  paid: number;
  structuredCom: string;
  payments: SimPayment[];
  fromRealRow: boolean; // ligne réelle existante : rien à écrire dans KB
};

function fakeIban(rng: Rng): string {
  const d = () => rInt(rng, 0, 9);
  return `BE${d()}${d()} ${d()}${d()}${d()}${d()} ${d()}${d()}${d()}${d()} ${d()}${d()}${d()}${d()}`;
}

function sampleNet(rng: Rng, realNets: number[]): number {
  const FALLBACK = [480, 620, 760, 890, 1020, 1150, 1280, 1420, 1560, 1700, 1850];
  const basePool = realNets.length >= 10 ? realNets : FALLBACK;
  const base = pick(rng, basePool);
  return round2(base * (0.92 + rng() * 0.16));
}

// ---------- Génération ----------

function buildPopulation(
  seed: number,
  realT4Rows: ListItem[],
  residents: ListItem[],
  realNets: number[]
): SimResident[] {
  // FA connus : lignes réelles T4 + Residents List existante.
  const faSet = new Map<string, { nn: string; realNet: number | null }>();
  const residentByFa = new Map<string, ListItem>();
  for (const r of residents) {
    const fa = String(r.fields.FedasilNumber ?? "").trim();
    // Les FA99 créés lors d'un run PRÉCÉDENT ne sont pas relus ici : ils sont
    // regénérés à l'identique par la boucle des arrivées fictives ci-dessous
    // (sinon ils recevraient un second profil parasite avec une autre graine).
    if (fa && !fa.startsWith(SIM_FA_PREFIX)) residentByFa.set(fa, r);
  }
  for (const row of realT4Rows) {
    const fa = String(row.fields.FedasilNumber ?? "").trim();
    if (!fa) continue;
    const net = toNumber(row.fields.NetSalary);
    const existing = faSet.get(fa);
    const nn = String(residentByFa.get(fa)?.fields.Title ?? "").trim();
    faSet.set(fa, { nn: existing?.nn || nn, realNet: net > 0 ? net : existing?.realNet ?? null });
  }
  for (const [fa, item] of residentByFa) {
    if (!faSet.has(fa)) faSet.set(fa, { nn: String(item.fields.Title ?? "").trim(), realNet: null });
  }

  const out: SimResident[] = [];
  for (const [fa, info] of faSet) {
    const rng = mulberry32(hash32(`res:${seed}:${fa}`));
    const { first, last } = namesForFa(fa);
    const payer: PayerProfile =
      rng() < 0.6 ? "bon" : rng() < 0.428 ? "partiel" : rng() < 0.6 ? "mauvais" : "libre";
    const bcssRoll = rng();
    const bcss: BcssProfile =
      bcssRoll < 0.8 ? "conforme" : bcssRoll < 0.88 ? "sous" : bcssRoll < 0.92 ? "noDecl" : "noBcss";
    const suppressed = new Set<string>();
    if (bcss === "noDecl") {
      suppressed.add(pick(rng, ["2025-3", "2025-4", "2026-1"]));
      if (rng() < 0.4) suppressed.add("2026-1");
    }
    out.push({
      fa,
      // NN : flux aléatoire DÉDIÉ. S'il partageait le rng du profil, la
      // présence/absence du NN dans Residents List (créé au run précédent)
      // décalerait tous les tirages suivants -> données différentes à chaque
      // passage (bug découvert au premier run à grande échelle).
      nn: info.nn || makeFakeNN(mulberry32(hash32(`nn:${seed}:${fa}`))),
      first,
      last,
      isNew: false,
      activeFrom: rng() < 0.6 ? 202501 : rInt(rng, 202502, 202510),
      activeTo: rng() < 0.92 ? LAST_WORK_YM : rInt(rng, 202601, 202604),
      workRate: rng() < 0.55 ? 1 : 0.55 + rng() * 0.2,
      anchorNet: info.realNet ?? sampleNet(rng, realNets),
      payer,
      bcss,
      suppressedQuarters: suppressed,
    });
  }

  // Arrivées fictives 2026 (jamais actives en novembre 2025 -> le mois réel
  // reste strictement intact).
  for (let i = 0; i < FICTIONAL_ARRIVALS; i++) {
    const fa = `${SIM_FA_PREFIX}${String(100001 + i)}`;
    const rng = mulberry32(hash32(`new:${seed}:${fa}`));
    const { first, last } = namesForFa(fa);
    out.push({
      fa,
      nn: makeFakeNN(rng),
      first,
      last,
      isNew: true,
      activeFrom: rInt(rng, 202512, 202603),
      activeTo: LAST_WORK_YM,
      workRate: rng() < 0.5 ? 1 : 0.6,
      anchorNet: sampleNet(rng, realNets),
      payer: rng() < 0.6 ? "bon" : rng() < 0.5 ? "partiel" : "libre",
      bcss: rng() < 0.85 ? "conforme" : "sous",
      suppressedQuarters: new Set(),
    });
  }
  // Garde-fou : jamais deux profils pour le même FA (le premier gagne).
  const dedup = new Map<string, SimResident>();
  for (const r of out) if (!dedup.has(r.fa)) dedup.set(r.fa, r);
  return [...dedup.values()];
}

// Génère l'activité mensuelle d'un résident (déterministe).
function buildMonths(
  seed: number,
  r: SimResident,
  realRowsByFaMonth: Map<string, Record<string, unknown>>
): SimMonth[] {
  const out: SimMonth[] = [];
  let paySeq = 0;

  for (const ym of ymRange(FIRST_YM, LAST_WORK_YM)) {
    if (ym < r.activeFrom || ym > r.activeTo) continue;
    const rng = mulberry32(hash32(`m:${seed}:${r.fa}:${ym}`));
    const month = ymMonth(ym);
    const quarterKey = `${ymYear(ym)}-${ymQuarter(ym)}`;

    // Ligne RÉELLE existante (T4 : octobre/novembre récupérés) : on la
    // respecte telle quelle — elle nourrit Soldes et la base DMFA.
    const realRow = ym >= 202510 && ym <= 202512 ? realRowsByFaMonth.get(`${r.fa}|${month}`) : undefined;
    if (realRow) {
      const declaredNet = round2(toNumber(realRow.NetSalary));
      const trueNet = r.bcss === "sous" ? round2(declaredNet / 0.65) : declaredNet;
      out.push({
        fa: r.fa,
        ym,
        trueNet,
        declared: true,
        declaredNet,
        declaredGross: round2(toNumber(realRow.GrossSalary)),
        contribution: round2(toNumber(realRow.Contribution)),
        paid: round2(toNumber(realRow.Paid)),
        structuredCom: String(realRow.StructuredCom ?? "").trim() || buildStructuredCom(r.fa, month),
        payments: [],
        fromRealRow: true,
      });
      continue;
    }

    const worked = r.workRate >= 1 || rng() < r.workRate;
    if (!worked) continue;

    const trueNet = round2(r.anchorNet * (0.9 + rng() * 0.2));
    const suppressed = r.suppressedQuarters.has(quarterKey);
    let declared = !suppressed && ym <= LAST_DECL_YM;
    if (declared && ym === 202604) declared = rng() < APRIL_DECLARED_RATE;
    if (!declared) {
      out.push({
        fa: r.fa, ym, trueNet, declared: false, declaredNet: 0, declaredGross: 0,
        contribution: 0, paid: 0, structuredCom: "", payments: [], fromRealRow: false,
      });
      continue;
    }

    const declaredNet = r.bcss === "sous" ? round2(trueNet * 0.65) : trueNet;
    const declaredGross = round2(declaredNet * grossRatio(declaredNet) * (0.98 + rng() * 0.04));
    const contribution = calcContribution(declaredNet);
    const structuredCom = buildStructuredCom(r.fa, month);
    const payments: SimPayment[] = [];
    let paid = 0;

    const mkPayment = (
      amount: number,
      monthsLater: number,
      opts: { free?: boolean; imputed?: boolean }
    ): boolean => {
      const payYm = ymAdd(ym, monthsLater);
      const day = rInt(rng, 2, 27);
      const date = Date.UTC(ymYear(payYm), ymMonth(payYm) - 1, day);
      if (date > SIM_TODAY) return false; // pas encore arrivé au 20 mai 2026
      paySeq++;
      const imputed = opts.imputed !== false;
      payments.push({
        title: `${SIM_PAY_PREFIX}${r.fa}-${ym}-${paySeq}`,
        dateIso: new Date(date).toISOString(),
        amount: round2(amount),
        structuredCom: opts.free ? "" : structuredCom,
        freeCom: opts.free
          ? pick(rng, [
              `Contribution ${MONTHS_FR[month - 1]} ${r.last}`,
              `loyer ${MONTHS_FR[month - 1]}`,
              `${r.first} ${r.last} paiement centre`,
              `chambre ${MONTHS_FR[month - 1]} ${r.last}`,
            ])
          : "",
        counterpartyName: `${r.first} ${r.last}`,
        counterpartyIban: fakeIban(rng),
        fa: imputed ? r.fa : "",
        month: imputed ? month : null,
        status: imputed ? "Imputé" : "À traiter",
      });
      if (imputed) paid = round2(paid + amount);
      return true;
    };

    if (contribution > 0) {
      if (ym < PAYMENTS_FROM_YM) {
        // Avant l'import bancaire simulé : Paid porté directement (pas de
        // ligne KB-Paiements) — l'historique 2025 T1-T3 vit dans Soldes.
        if (r.payer === "bon" || r.payer === "libre") paid = contribution;
        else if (r.payer === "partiel") paid = round2(contribution * (0.4 + rng() * 0.3));
        else paid = rng() < 0.3 ? contribution : 0;
      } else if (r.payer === "bon") {
        mkPayment(contribution, 1, {});
      } else if (r.payer === "partiel") {
        const p1 = round2(contribution * (0.4 + rng() * 0.3));
        if (mkPayment(p1, 1, {}) && rng() < 0.5) {
          mkPayment(round2(contribution - p1), 2, {});
        }
      } else if (r.payer === "mauvais") {
        if (rng() < 0.4) mkPayment(contribution, rInt(rng, 2, 3), {}); // payé très tard, ou jamais
      } else {
        // « libre » : paie, mais sans communication structurée.
        // Jusqu'à février 2026 : déjà lettré à la main. Ensuite : file de lettrage.
        const alreadyMatched = ym <= 202602;
        mkPayment(contribution, 1, { free: true, imputed: alreadyMatched });
      }
    }

    out.push({
      fa: r.fa, ym, trueNet, declared: true, declaredNet, declaredGross,
      contribution, paid, structuredCom, payments, fromRealRow: false,
    });
  }
  return out;
}

// ---------- Fixtures BCSS (fichiers locaux) ----------

function writeBcssFixtures(
  outDir: string,
  residents: SimResident[],
  monthsByFa: Map<string, SimMonth[]>
): { files: string[]; keyRows: string[] } {
  const quarters: Array<{ y: number; q: number }> = [
    { y: 2025, q: 1 }, { y: 2025, q: 2 }, { y: 2025, q: 3 }, { y: 2025, q: 4 }, { y: 2026, q: 1 },
  ];
  const files: string[] = [];
  const keyRows: string[] = [
    "FA;NN;Nom;Prenom;Annee;Trimestre;BrutDMFA;NetReel;NetDeclare;EcartPct;ClasseAttendue",
  ];

  for (const { y, q } of quarters) {
    const lines: string[] = ["NN;Nom;Prenom;Annee;Trimestre;BrutTrimestriel"];
    for (const r of residents) {
      const months = (monthsByFa.get(r.fa) ?? []).filter(
        (m) => ymYear(m.ym) === y && ymQuarter(m.ym) === q
      );
      if (months.length === 0) continue;
      const rng = mulberry32(hash32(`bcss:${r.fa}:${y}-${q}`));
      const gross = round2(
        months.reduce((s, m) => s + m.trueNet * grossRatio(m.trueNet) * (0.97 + rng() * 0.06), 0)
      );
      const netReel = round2(months.reduce((s, m) => s + m.trueNet, 0));
      const netDecl = round2(months.filter((m) => m.declared).reduce((s, m) => s + m.declaredNet, 0));
      const inBcss = r.bcss !== "noBcss" && gross > 0;
      if (inBcss) {
        lines.push(`${r.nn};${r.last};${r.first};${y};${q};${gross.toFixed(2)}`);
      }
      // Clé de correction (classe attendue du module 5).
      let classe = "Conforme";
      const ecart = netReel > 0 ? (netReel - netDecl) / netReel : 0;
      if (!inBcss && netDecl > 0) classe = "DeclareSansBCSS";
      else if (inBcss && netDecl === 0) classe = "BcssSansDeclaration";
      else if (Math.abs(ecart) > 0.1) classe = "EcartAControler";
      keyRows.push(
        `${r.fa};${r.nn};${r.last};${r.first};${y};${q};${inBcss ? gross.toFixed(2) : ""};` +
          `${netReel.toFixed(2)};${netDecl.toFixed(2)};${(ecart * 100).toFixed(1)};${classe}`
      );
    }
    const file = resolve(outDir, `BCSS-${y}-T${q}.csv`);
    writeFileSync(file, lines.join("\n") + "\n", "utf-8");
    files.push(file);
  }
  const keyFile = resolve(outDir, "BCSS-cle-de-correction.csv");
  writeFileSync(keyFile, keyRows.join("\n") + "\n", "utf-8");
  files.push(keyFile);
  return { files, keyRows };
}

// ---------- PURGE ----------

async function purge(siteId: string, lists: Record<string, ListRef>, dryRun: boolean): Promise<void> {
  console.log("MODE PURGE : suppression des données de simulation UNIQUEMENT.\n");
  if (!dryRun) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('Tape "PURGER" pour confirmer : ')).trim();
    rl.close();
    if (answer !== "PURGER") fail("Confirmation refusée — aucune action effectuée.");
  }

  const ops: BatchOp[] = [];
  const keepSoldesTitles = new Set<string>();

  // 1) KB-Cumul : suppression des lignes StructuredText === "SIM" ;
  //    les lignes réelles alimentent la liste blanche de Soldes.
  const kbYear: Record<string, number> = { T3: 2025, T4: 2025, T1: 2026, T2: 2026 };
  for (const key of ["T1", "T2", "T3", "T4"]) {
    const list = lists[key];
    const items = await getAllItems(siteId, list.id);
    let sim = 0;
    for (const it of items) {
      if (String(it.fields.StructuredText ?? "").trim() === SIM_TAG) {
        sim++;
        ops.push({
          method: "DELETE",
          url: `/sites/${siteId}/lists/${list.id}/items/${it.id}`,
          label: `${list.displayName} id=${it.id}`,
        });
      } else {
        const fa = String(it.fields.FedasilNumber ?? "").trim();
        const month = Number(it.fields.Month);
        if (fa && Number.isInteger(month)) {
          keepSoldesTitles.add(`${fa}-${kbYear[key]}-${String(month).padStart(2, "0")}`);
        }
      }
    }
    console.log(`${list.displayName} : ${sim} ligne(s) SIM à supprimer, ${items.length - sim} conservée(s).`);
  }

  // 2) Soldes : on ne garde que les lignes correspondant à du RÉEL.
  const soldesItems = await getAllItems(siteId, lists.Soldes.id);
  let soldesDel = 0;
  for (const it of soldesItems) {
    const title = String(it.fields.Title ?? "").trim();
    if (!keepSoldesTitles.has(title)) {
      soldesDel++;
      ops.push({
        method: "DELETE",
        url: `/sites/${siteId}/lists/${lists.Soldes.id}/items/${it.id}`,
        label: `Soldes ${title}`,
      });
    }
  }
  console.log(`Soldes : ${soldesDel} ligne(s) à supprimer, ${soldesItems.length - soldesDel} conservée(s) (réel).`);

  // 3) KB-Paiements : Title préfixé SIM-.
  const payItems = await getAllItems(siteId, lists.Paiements.id);
  let payDel = 0;
  for (const it of payItems) {
    if (String(it.fields.Title ?? "").startsWith(SIM_PAY_PREFIX)) {
      payDel++;
      ops.push({
        method: "DELETE",
        url: `/sites/${siteId}/lists/${lists.Paiements.id}/items/${it.id}`,
        label: `Paiement ${String(it.fields.Title)}`,
      });
    }
  }
  console.log(`KB-Paiements : ${payDel} ligne(s) SIM- à supprimer.`);

  // 4) Residents List : uniquement les FA fictifs FA99…
  const resItems = await getAllItems(siteId, lists.Residents.id);
  let resDel = 0;
  for (const it of resItems) {
    if (String(it.fields.FedasilNumber ?? "").startsWith(SIM_FA_PREFIX)) {
      resDel++;
      ops.push({
        method: "DELETE",
        url: `/sites/${siteId}/lists/${lists.Residents.id}/items/${it.id}`,
        label: `Resident ${String(it.fields.FedasilNumber)}`,
      });
    }
  }
  console.log(`Residents List : ${resDel} résident(s) fictif(s) FA99 à supprimer.`);
  console.log("⚠ Les prénoms/noms remplacés ne sont PAS restaurés (originaux anonymisés).\n");

  if (dryRun) {
    console.log(`[dry-run] ${ops.length} suppression(s) au total — AUCUNE écriture effectuée.`);
    return;
  }
  const done = await graphBatch(ops, "purge");
  console.log(`\nPurge terminée : ${done}/${ops.length} suppression(s).`);
}

// ---------- Point d'entrée ----------

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dryRun = args.includes("--dry-run");
  const doPurge = args.includes("--purge");
  const seedArg = args.find((a) => a.startsWith("--seed="));
  const seed = seedArg ? Number(seedArg.split("=")[1]) : 20260520;
  if (!Number.isFinite(seed)) fail("Graine invalide (--seed=nombre).");

  const cfg = loadSettings();
  graphCfg = cfg;
  await ensureToken(true);
  const siteId = await getSiteId(cfg);

  // Résolution des 7 listes.
  const names: Record<string, string> = {
    Residents: "Residents List",
    T1: "KB-Cumul T1", T2: "KB-Cumul T2", T3: "KB-Cumul T3", T4: "KB-Cumul T4",
    Paiements: "KB-Paiements",
    Soldes: "Soldes",
  };
  const lists: Record<string, ListRef> = {};
  for (const [key, name] of Object.entries(names)) {
    const found = await findListByName(siteId, name);
    if (!found) fail(`Liste « ${name} » introuvable (npm run sp:provision d'abord ?).`);
    lists[key] = found;
  }

  if (doPurge) {
    await purge(siteId, lists, dryRun);
    return;
  }

  console.log(
    `\nSIMULATION — « aujourd'hui simulé » : 20 mai 2026 · graine ${seed}` +
      `${dryRun ? "   [MODE --dry-run : AUCUNE écriture SharePoint]" : ""}\n`
  );

  // ---------- Lecture de l'état existant ----------
  console.log("Lecture des listes existantes…");
  const residentsItems = await getAllItems(siteId, lists.Residents.id);
  const kbItems: Record<string, ListItem[]> = {};
  for (const key of ["T1", "T2", "T3", "T4"]) {
    kbItems[key] = await getAllItems(siteId, lists[key].id);
    console.log(`   ${names[key]} : ${kbItems[key].length} ligne(s).`);
  }
  const soldesItems = await getAllItems(siteId, lists.Soldes.id);
  const payItems = await getAllItems(siteId, lists.Paiements.id);
  console.log(`   Residents List : ${residentsItems.length} · Soldes : ${soldesItems.length} · KB-Paiements : ${payItems.length}\n`);

  // Lignes RÉELLES de T4 (base statistique + population + intouchables).
  const realT4Rows = kbItems.T4.filter(
    (it) => String(it.fields.StructuredText ?? "").trim() !== SIM_TAG
  );
  const realRowsByFaMonth = new Map<string, Record<string, unknown>>();
  const realNets: number[] = [];
  const realMonthsPresent = new Set<number>();
  for (const it of realT4Rows) {
    const fa = String(it.fields.FedasilNumber ?? "").trim();
    const month = Number(it.fields.Month);
    if (!fa || !Number.isInteger(month)) continue;
    realRowsByFaMonth.set(`${fa}|${month}`, it.fields);
    realMonthsPresent.add(month);
    const net = toNumber(it.fields.NetSalary);
    if (net > 0) realNets.push(net);
  }
  console.log(
    `Base réelle T4 : ${realT4Rows.length} ligne(s) (mois présents : ${[...realMonthsPresent].sort().join(", ") || "aucun"}) — ` +
      `distribution des nets : ${realNets.length} valeur(s)` +
      (realNets.length
        ? ` [min ${Math.min(...realNets)} € · max ${Math.max(...realNets)} €]`
        : " (repli sur la distribution par défaut)")
  );

  // ---------- Génération (pure, déterministe) ----------
  const population = buildPopulation(seed, realT4Rows, residentsItems, realNets);
  console.log(`Population : ${population.length} résident(s) dont ${FICTIONAL_ARRIVALS} arrivée(s) fictive(s) FA99.\n`);

  const monthsByFa = new Map<string, SimMonth[]>();
  for (const r of population) {
    monthsByFa.set(r.fa, buildMonths(seed, r, realRowsByFaMonth));
  }

  // ---------- Phase A : Residents List (renommage + créations) ----------
  const residentByFa = new Map<string, ListItem>();
  for (const it of residentsItems) {
    const fa = String(it.fields.FedasilNumber ?? "").trim();
    if (fa) residentByFa.set(fa, it);
  }
  const opsResidents: BatchOp[] = [];
  for (const r of population) {
    const existing = residentByFa.get(r.fa);
    if (existing) {
      const curFirst = String(existing.fields.FirstName ?? "").trim();
      const curLast = String(existing.fields.LastName ?? "").trim();
      if (curFirst !== r.first || curLast !== r.last) {
        opsResidents.push({
          method: "PATCH",
          url: `/sites/${siteId}/lists/${lists.Residents.id}/items/${existing.id}/fields`,
          body: { FirstName: r.first, LastName: r.last },
          label: `rename ${r.fa}`,
        });
      }
    } else {
      opsResidents.push({
        method: "POST",
        url: `/sites/${siteId}/lists/${lists.Residents.id}/items`,
        body: {
          fields: {
            Title: r.nn,
            FirstName: r.first,
            LastName: r.last,
            FedasilNumber: r.fa,
            Email: `${r.first}.${r.last}.sim@example.org`.toLowerCase().replace(/\s/g, ""),
          },
        },
        label: `create resident ${r.fa}`,
      });
    }
  }

  // ---------- Phase B : lignes KB-Cumul ----------
  const existingKbKeys: Record<string, Set<string>> = {};
  for (const key of ["T1", "T2", "T3", "T4"]) {
    existingKbKeys[key] = new Set(
      kbItems[key].map(
        (it) => `${String(it.fields.FedasilNumber ?? "").trim()}|${Number(it.fields.Month)}`
      )
    );
  }
  const opsKb: BatchOp[] = [];
  const kbCounts: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };
  for (const r of population) {
    for (const m of monthsByFa.get(r.fa)!) {
      if (!m.declared || m.fromRealRow) continue;
      const listKey = targetKbList(m.ym);
      if (!listKey) continue; // T1-T2 2025 : Soldes uniquement
      const kbKey = `${r.fa}|${ymMonth(m.ym)}`;
      if (existingKbKeys[listKey].has(kbKey)) continue; // déjà présent (réel ou exécution précédente)
      kbCounts[listKey]++;
      opsKb.push({
        method: "POST",
        url: `/sites/${siteId}/lists/${lists[listKey].id}/items`,
        body: {
          fields: {
            Title: r.fa,
            FedasilNumber: r.fa,
            Month: ymMonth(m.ym),
            NetSalary: m.declaredNet,
            GrossSalary: m.declaredGross,
            Contribution: m.contribution,
            Paid: m.paid,
            StructuredCom: m.structuredCom,
            StructuredText: SIM_TAG,
          },
        },
        label: `${listKey} ${r.fa}/${ymMonth(m.ym)}`,
      });
    }
  }

  // ---------- Phase C : Soldes (upsert, mêmes calculs que sp:soldes) ----------
  const soldesByTitle = new Map<string, ListItem>();
  for (const it of soldesItems) {
    const t = String(it.fields.Title ?? "").trim();
    if (t) soldesByTitle.set(t, it);
  }
  const opsSoldes: BatchOp[] = [];
  let soldesCreate = 0, soldesUpdate = 0, soldesSkip = 0;
  for (const r of population) {
    for (const m of monthsByFa.get(r.fa)!) {
      if (!m.declared || m.ym > SOLDES_LAST_YM) continue;
      const year = ymYear(m.ym);
      const month = ymMonth(m.ym);
      const balance = round2(m.contribution - m.paid);
      const fields = {
        FedasilNumber: r.fa,
        Year: year,
        Quarter: ymQuarter(m.ym),
        Month: month,
        YearMonth: m.ym,
        NetSalary: m.declaredNet,
        GrossSalary: m.declaredGross,
        Contribution: m.contribution,
        Paid: m.paid,
        Balance: balance,
        PayStatus: payStatusOf(balance, m.paid),
        StructuredCom: m.structuredCom,
        DueDate: dueDateIso(year, month),
      };
      const title = `${r.fa}-${year}-${String(month).padStart(2, "0")}`;
      const existing = soldesByTitle.get(title);
      if (!existing) {
        soldesCreate++;
        opsSoldes.push({
          method: "POST",
          url: `/sites/${siteId}/lists/${lists.Soldes.id}/items`,
          body: { fields: { Title: title, ...fields } },
          label: `Soldes ${title}`,
        });
      } else {
        const diffs: string[] = [];
        const numDiff = (k: "Contribution" | "Paid" | "NetSalary" | "GrossSalary" | "Balance") => {
          const cur = round2(toNumber(existing.fields[k]));
          if (cur !== fields[k]) diffs.push(`${k} ${cur} -> ${fields[k]}`);
        };
        numDiff("Contribution"); numDiff("Paid"); numDiff("NetSalary");
        numDiff("GrossSalary"); numDiff("Balance");
        if (String(existing.fields.PayStatus ?? "") !== fields.PayStatus) {
          diffs.push(`PayStatus ${String(existing.fields.PayStatus ?? "∅")} -> ${fields.PayStatus}`);
        }
        if (diffs.length === 0) {
          soldesSkip++;
        } else {
          if (dryRun && soldesUpdate < 5) {
            console.log(`   ~ [dry-run] Soldes ${title} diverge : ${diffs.join(" · ")}`);
          }
          soldesUpdate++;
          opsSoldes.push({
            method: "PATCH",
            url: `/sites/${siteId}/lists/${lists.Soldes.id}/items/${existing.id}/fields`,
            body: fields,
            label: `Soldes ${title}`,
          });
        }
      }
    }
  }

  // ---------- Phase D : KB-Paiements ----------
  const existingPayTitles = new Set(
    payItems.map((it) => String(it.fields.Title ?? "").trim())
  );
  const opsPay: BatchOp[] = [];
  const allPayments: SimPayment[] = [];
  for (const r of population) {
    for (const m of monthsByFa.get(r.fa)!) allPayments.push(...m.payments);
  }
  // Quelques anomalies (communication invalide, montant orphelin).
  const rngAno = mulberry32(hash32(`ano:${seed}`));
  for (let i = 1; i <= 6; i++) {
    allPayments.push({
      title: `${SIM_PAY_PREFIX}ANO-${i}`,
      dateIso: new Date(Date.UTC(2026, rInt(rngAno, 0, 4), rInt(rngAno, 2, 27))).toISOString(),
      amount: round2(20 + rngAno() * 300),
      structuredCom: i % 2 === 0 ? "+++123/4567/89012+++" : "",
      freeCom: i % 2 === 0 ? "" : pick(rngAno, ["remboursement ?", "virement famille", "???"]),
      counterpartyName: pick(rngAno, ["J. DERWAEL", "STE INTERIM PLUS", "C. VANDEN"]),
      counterpartyIban: fakeIban(rngAno),
      fa: "",
      month: null,
      status: "Anomalie",
    });
  }
  for (const p of allPayments) {
    if (existingPayTitles.has(p.title)) continue;
    opsPay.push({
      method: "POST",
      url: `/sites/${siteId}/lists/${lists.Paiements.id}/items`,
      body: {
        fields: {
          Title: p.title,
          PaymentDate: p.dateIso,
          Amount: p.amount,
          ...(p.structuredCom ? { StructuredCom: p.structuredCom } : {}),
          ...(p.freeCom ? { FreeCom: p.freeCom } : {}),
          CounterpartyName: p.counterpartyName,
          CounterpartyIBAN: p.counterpartyIban,
          ...(p.fa ? { FedasilNumber: p.fa } : {}),
          ...(p.month ? { Month: p.month } : {}),
          Status: p.status,
        },
      },
      label: `Paiement ${p.title}`,
    });
  }

  // ---------- Fichiers locaux (générés même en dry-run) ----------
  const outDir = resolve(process.cwd(), "simulation");
  mkdirSync(outDir, { recursive: true });
  const { keyRows } = writeBcssFixtures(outDir, population, monthsByFa);
  const classCounts = new Map<string, number>();
  for (const row of keyRows.slice(1)) {
    const c = row.split(";").pop()!;
    classCounts.set(c, (classCounts.get(c) ?? 0) + 1);
  }
  const toTreat = allPayments.filter((p) => p.status === "À traiter").length;
  const report = [
    "# RAPPORT DE SIMULATION — ResidentApp",
    "",
    `Généré le ${new Date().toISOString().slice(0, 10)} · graine ${seed} · « aujourd'hui simulé » : 20 mai 2026`,
    "",
    `- Population : **${population.length} résidents** (${FICTIONAL_ARRIVALS} arrivées fictives FA99)`,
    `- Lignes réelles T4 respectées : **${realT4Rows.length}** (mois ${[...realMonthsPresent].sort().join(", ")})`,
    `- KB-Cumul générées : T3 ${kbCounts.T3} · T4 ${kbCounts.T4} · T1 ${kbCounts.T1} · T2 ${kbCounts.T2}`,
    `- Soldes : ${soldesCreate} création(s), ${soldesUpdate} mise(s) à jour (janv. 2025 → mars 2026)`,
    `- Paiements : ${opsPay.length} virement(s) dont ${toTreat} « À traiter » (file de lettrage) et 6 anomalies`,
    `- Fixtures BCSS : 5 fichiers trimestriels + clé de correction`,
    "",
    "## Classes BCSS attendues (dossier × trimestre)",
    ...[...classCounts.entries()].map(([c, n]) => `- ${c} : ${n}`),
    "",
    "Purge : `npm run sp:seed -- --purge` (supprime UNIQUEMENT la simulation ;",
    "les noms remplacés dans Residents List ne sont pas restaurés).",
  ].join("\n");
  writeFileSync(resolve(outDir, "RAPPORT-SIMULATION.md"), report + "\n", "utf-8");
  console.log(`Fixtures BCSS + rapport écrits dans ${outDir}/\n`);

  // ---------- Récapitulatif + écritures ----------
  const total = opsResidents.length + opsKb.length + opsSoldes.length + opsPay.length;
  console.log("Écritures SharePoint prévues :");
  console.log(`   Residents List : ${opsResidents.length} (renommages + créations)`);
  console.log(`   KB-Cumul       : ${opsKb.length}  (T3 ${kbCounts.T3} · T4 ${kbCounts.T4} · T1 ${kbCounts.T1} · T2 ${kbCounts.T2})`);
  console.log(`   Soldes         : ${opsSoldes.length}  (${soldesCreate} créations, ${soldesUpdate} maj, ${soldesSkip} inchangées)`);
  console.log(`   KB-Paiements   : ${opsPay.length}`);
  console.log(`   TOTAL          : ${total} opération(s) — ~${Math.ceil(total / 20)} requêtes $batch\n`);

  if (dryRun) {
    console.log("[dry-run] AUCUNE écriture SharePoint effectuée. Relance sans --dry-run pour générer.");
    return;
  }

  console.log("Phase A — Residents List…");
  await graphBatch(opsResidents, "Residents");
  console.log("Phase B — KB-Cumul…");
  await graphBatch(opsKb, "KB-Cumul");
  console.log("Phase C — Soldes…");
  await graphBatch(opsSoldes, "Soldes");
  console.log("Phase D — KB-Paiements…");
  await graphBatch(opsPay, "Paiements");

  console.log(
    "\nTerminé. Rejouable à volonté (mêmes données : graine fixe, upsert/skip).\n" +
      "Vérifie simulation/RAPPORT-SIMULATION.md, puis ouvre les listes dans SharePoint."
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
