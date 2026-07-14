/* ============================================================================
 *  scripts/lib/soldes-sync.ts — Synchronisation KB-Cumul -> liste « Soldes »
 *                               (LOGIQUE PARTAGÉE — aucun argv, aucun exit)
 * ----------------------------------------------------------------------------
 *  POURQUOI CE FICHIER EXISTE (14/7/2026, chantier §5.20.1)
 *
 *  La liste « Soldes » est la MÉMOIRE PERMANENTE des soldes mensuels (§5.20) :
 *  une ligne par FA × année × mois. Les listes KB-Cumul, elles, sont des
 *  TAMPONS de ~13 mois, vidés puis réutilisés à chaque rotation annuelle.
 *
 *  Depuis que le résident consulte ses trimestres antérieurs DANS Soldes
 *  (§5.22), la fraîcheur de Soldes n'est plus un détail d'exploitation : un
 *  paiement tardif non resynchronisé, c'est un résident relancé pour une dette
 *  déjà réglée. La synchronisation doit donc devenir AUTOMATIQUE (nocturne).
 *
 *  Or l'automate (Azure Function à déclencheur timer) est un projet SÉPARÉ de
 *  la ligne de commande. Si chacun portait sa copie des règles métier
 *  (Balance, PayStatus, DueDate, clé Title), elles divergeraient — c'est la
 *  famille de bug qui a coûté cinq commits le 13/7 (§11quater).
 *
 *  D'où ce module : TOUTE la logique vit ici, UNE fois.
 *    - scripts/snapshot-soldes.ts  (CLI)          -> importe ce module
 *    - la future Function timer     (nocturne)    -> importera ce module
 *  Aucune dépendance à Azure, à process.argv ou à process.exit : le module est
 *  appelable depuis n'importe où. Les messages sortent par le callback `log`.
 *
 *  RÈGLE DE VÉRITÉ (§5.20) : tant que la ligne KB-Cumul existe (~13 mois),
 *  KB-Cumul est la source et ce module resynchronise. Après le vidage par
 *  sp:rotate, Soldes est la seule vérité.
 *
 *  ⚠ INDEX (§6.1) : Graph refuse un $filter sur colonne NON INDEXÉE
 *  IMMÉDIATEMENT, quelle que soit la taille de la liste. Toute colonne d'un
 *  filtre doit être indexée. Ici : `YearMonth` (indexée sur Soldes) est la
 *  SEULE colonne filtrée — voir readSoldesRowsForQuarter().
 * ============================================================================ */

// ---------------------------------------------------------------------------
//  Constantes de schéma (alignées sur sharepoint-schema.json)
// ---------------------------------------------------------------------------

export const CONFIG_LIST_NAME = "Config";
export const ACTIVE_QUARTER_KEY = "ActiveQuarter";
export const SOLDES_LIST_NAME = "Soldes";

/** Colonnes de Soldes POSSÉDÉES par la synchronisation : elle seule les écrit,
 *  et elle n'écrit JAMAIS rien d'autre (les colonnes du futur moteur de
 *  rappels — module 4 de l'app staff — sont à l'abri). `Title` est la clé. */
export const OWNED_SOLDES_COLUMNS = [
  "Title",
  "FedasilNumber",
  "Year",
  "Quarter",
  "Month",
  "YearMonth",
  "NetSalary",
  "GrossSalary",
  "Contribution",
  "Paid",
  "Balance",
  "PayStatus",
  "StructuredCom",
  "DueDate",
] as const;

/** Colonnes lues dans la liste source KB-Cumul. */
const SOURCE_COLUMNS = [
  "FedasilNumber",
  "Month",
  "NetSalary",
  "GrossSalary",
  "Contribution",
  "Paid",
  "StructuredCom",
] as const;

// ---------------------------------------------------------------------------
//  Types publics
// ---------------------------------------------------------------------------

/** Identifiants Graph + site (api/local.settings.json OU variables d'env.). */
export type Settings = {
  TENANT_ID: string;
  GRAPH_CLIENT_ID: string;
  GRAPH_CLIENT_SECRET: string;
  SP_SITE_HOSTNAME: string;
  SP_SITE_PATH: string;
};

/** Sortie des messages : console.log en CLI, context.log dans une Function. */
export type Logger = (message: string) => void;

/** Erreur métier « attendue » : message déjà lisible, pas de pile à afficher. */
export class SoldesSyncError extends Error {}

export type QuarterResult = {
  quarter: number;
  year: number;
  listName: string;
  sourceCount: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  /** Lignes dont le mois n'appartient PAS au trimestre de la liste source.
   *  Toujours 0 sur des données saines. Non nul = anomalie de données. */
  outOfQuarter: number;
};

export type ActiveQuarter = {
  quarter: number;
  year: number;
  cumulListId: string;
  cumulListName: string;
};

// ---------------------------------------------------------------------------
//  Client Graph — jeton auto-rafraîchi + reprise sur 401/429/503
// ---------------------------------------------------------------------------
//
//  ⚠ LEÇON (seed-simulation) : un script qui tourne longtemps voit son jeton
//  EXPIRER en cours de route (durée de vie ~1 h). En mode --auto, on traite
//  4 listes et jusqu'à ~15 000 lignes : l'expiration est certaine. Le client
//  rafraîchit donc le jeton AVANT chaque requête si nécessaire, et rejoue une
//  fois la requête en cas de 401.

export type GraphClient = {
  get<T>(url: string): Promise<T>;
  write(method: "POST" | "PATCH", url: string, body: unknown): Promise<void>;
  /** Suit @odata.nextLink jusqu'au bout (les $top ne suffisent jamais). */
  getAllPages<T>(url: string): Promise<T[]>;
};

type ListItem = { id: string; fields: Record<string, unknown> };

export function createGraphClient(cfg: Settings, log: Logger): GraphClient {
  let token = "";
  let expiresAt = 0;

  async function refreshToken(): Promise<void> {
    const res = await fetch(
      `https://login.microsoftonline.com/${cfg.TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cfg.GRAPH_CLIENT_ID,
          client_secret: cfg.GRAPH_CLIENT_SECRET,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }),
      }
    );
    if (!res.ok) {
      throw new SoldesSyncError(
        `Échec du jeton Graph (statut ${res.status}). Vérifier TENANT_ID, ` +
          `GRAPH_CLIENT_ID et GRAPH_CLIENT_SECRET.`
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    token = json.access_token;
    // Marge de 5 min : on rafraîchit avant l'expiration réelle.
    const lifetime = (json.expires_in ?? 3600) * 1000;
    expiresAt = Date.now() + lifetime - 5 * 60 * 1000;
  }

  async function ensureToken(): Promise<void> {
    if (!token || Date.now() >= expiresAt) await refreshToken();
  }

  function absolute(url: string): string {
    return url.startsWith("https://")
      ? url
      : `https://graph.microsoft.com/v1.0${url}`;
  }

  // Une requête, avec reprise : 401 -> nouveau jeton ; 429/503 -> pause.
  async function request(
    method: string,
    url: string,
    body?: unknown
  ): Promise<Response> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await ensureToken();
      const res = await fetch(absolute(url), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      if (res.ok) return res;

      if (res.status === 401 && attempt < 3) {
        log("   … jeton expiré (401), renouvellement");
        expiresAt = 0;
        continue;
      }
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const wait = Number(res.headers.get("retry-after") ?? "5");
        log(`   … limitation Graph (statut ${res.status}), pause ${wait}s`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }

      const text = await res.text();
      // Le seuil de vue de liste et les colonnes non indexées sortent en 400 :
      // on nomme la cause probable pour ne PLUS jamais chercher pendant des
      // heures (§6.1).
      const hint =
        res.status === 400 || res.status === 403 || res.status === 503
          ? "\n  CAUSE PROBABLE : colonne de $filter NON INDEXÉE, ou colonne " +
            "absente du schéma.\n  → Vérifier les index (Paramètres de la " +
            "liste > Colonnes indexées) puis lancer « npm run sp:provision »."
          : "";
      throw new SoldesSyncError(
        `Graph ${method} ${url} -> statut ${res.status}${hint}\n${text}`
      );
    }
    throw new SoldesSyncError(`Graph ${method} ${url} : échec après 3 essais.`);
  }

  return {
    async get<T>(url: string): Promise<T> {
      const res = await request("GET", url);
      return (await res.json()) as T;
    },
    async write(method, url, body) {
      await request(method, url, body);
    },
    async getAllPages<T>(url: string): Promise<T[]> {
      const out: T[] = [];
      let next: string | undefined = url;
      while (next) {
        const res: Response = await request("GET", next);
        const page = (await res.json()) as {
          value?: T[];
          "@odata.nextLink"?: string;
        };
        if (page.value) out.push(...page.value);
        next = page["@odata.nextLink"];
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
//  Résolution du site et des listes
// ---------------------------------------------------------------------------

export async function getSiteId(
  graph: GraphClient,
  cfg: Settings,
  log: Logger
): Promise<string> {
  const site = await graph.get<{ id: string; webUrl?: string }>(
    `/sites/${cfg.SP_SITE_HOSTNAME}:/${cfg.SP_SITE_PATH}?$select=id,webUrl`
  );
  log(`Site : ${site.webUrl ?? cfg.SP_SITE_HOSTNAME + "/" + cfg.SP_SITE_PATH}`);
  return site.id;
}

export async function findListByName(
  graph: GraphClient,
  siteId: string,
  displayName: string
): Promise<{ id: string; displayName: string } | null> {
  const json = await graph.get<{
    value: Array<{ id: string; displayName: string; list?: { hidden?: boolean } }>;
  }>(`/sites/${siteId}/lists?$select=id,displayName,list&$top=200`);
  return (
    json.value
      .filter((l) => !l.list?.hidden)
      .find((l) => l.displayName.toLowerCase() === displayName.toLowerCase()) ??
    null
  );
}

// ---------------------------------------------------------------------------
//  Trimestre actif (liste Config, §5.21) — la MÊME source que Me.ts/Declare.ts
// ---------------------------------------------------------------------------
//
//  Liste minuscule (une ligne par clé) : lecture SANS $filter — aucun enjeu
//  d'index ni de seuil des 5000. Contrairement à quarterConfig.ts (côté API),
//  il n'y a PAS de repli sur les variables d'environnement : pour un traitement
//  par lot, se tromper de trimestre en silence serait pire que ne rien faire.
//  On échoue franchement.

export async function readActiveQuarter(
  graph: GraphClient,
  siteId: string
): Promise<ActiveQuarter> {
  const configList = await findListByName(graph, siteId, CONFIG_LIST_NAME);
  if (!configList) {
    throw new SoldesSyncError(
      `Liste « ${CONFIG_LIST_NAME} » introuvable : impossible de savoir quel ` +
        `trimestre est actif.\n  → npm run sp:provision, puis ` +
        `npm run sp:rotate -- T<n> --config-only --annee=<AAAA>`
    );
  }

  const items = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${configList.id}/items` +
      `?$expand=fields($select=Title,Quarter,Year,CumulListId,CumulListName)` +
      `&$top=50`
  );

  const row = items.find(
    (it) =>
      String(it.fields?.["Title"] ?? "").trim().toLowerCase() ===
      ACTIVE_QUARTER_KEY.toLowerCase()
  );
  if (!row) {
    throw new SoldesSyncError(
      `Liste « ${CONFIG_LIST_NAME} » trouvée mais SANS ligne ` +
        `« ${ACTIVE_QUARTER_KEY} ».\n  → npm run sp:rotate -- T<n> ` +
        `--config-only --annee=<AAAA>`
    );
  }

  const quarter = Number(row.fields["Quarter"]);
  const year = Number(row.fields["Year"]);
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new SoldesSyncError(
      `Ligne ${ACTIVE_QUARTER_KEY} invalide : Quarter = « ${String(
        row.fields["Quarter"]
      )} » (entier 1-4 attendu).`
    );
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new SoldesSyncError(
      `Ligne ${ACTIVE_QUARTER_KEY} invalide : Year = « ${String(
        row.fields["Year"]
      )} ».`
    );
  }

  return {
    quarter,
    year,
    cumulListId: String(row.fields["CumulListId"] ?? "").trim(),
    cumulListName:
      String(row.fields["CumulListName"] ?? "").trim() || `KB-Cumul T${quarter}`,
  };
}

/**
 * Année des données CONTENUES dans la liste « KB-Cumul T<q> », déduite du
 * trimestre actif.
 *
 * Modèle (§5.16) : 4 listes permanentes réutilisées chaque année. À la bascule
 * vers T<n>, c'est la liste T<n> qui est vidée (elle portait le T<n> de l'année
 * précédente). Donc, à tout instant :
 *
 *   - q <= trimestre actif  -> la liste porte l'année ACTIVE ;
 *   - q >  trimestre actif  -> la liste porte l'année PRÉCÉDENTE.
 *
 * Vérifié sur le jeu de test (actif = T2 2026) :
 *   T1 -> 2026 ✓ · T2 -> 2026 ✓ · T3 -> 2025 ✓ · T4 -> 2025 ✓
 *
 * C'est CE calcul qui permet au mode --auto de survivre aux rotations sans
 * qu'aucune année ne soit jamais codée en dur nulle part.
 */
export function yearOfCumulList(
  quarter: number,
  active: ActiveQuarter
): number {
  return quarter <= active.quarter ? active.year : active.year - 1;
}

// ---------------------------------------------------------------------------
//  Garde-fou : les colonnes de Soldes existent-elles AVANT d'écrire ?
// ---------------------------------------------------------------------------
//
//  Sans ce contrôle, un schéma non appliqué produit un « Graph 400 : Field
//  'Balance' is not recognized » au bout de plusieurs minutes de traitement —
//  message opaque, cause introuvable. Ici : message clair, AVANT toute
//  écriture (§10 point 2).

export async function assertSoldesColumns(
  graph: GraphClient,
  siteId: string,
  soldesListId: string
): Promise<void> {
  const json = await graph.get<{
    value: Array<{ name?: string; displayName?: string }>;
  }>(`/sites/${siteId}/lists/${soldesListId}/columns?$select=name,displayName`);

  const present = new Set<string>();
  for (const c of json.value ?? []) {
    if (c.name) present.add(c.name.toLowerCase());
    if (c.displayName) present.add(c.displayName.toLowerCase());
  }

  const missing = OWNED_SOLDES_COLUMNS.filter(
    (c) => !present.has(c.toLowerCase())
  );
  if (missing.length > 0) {
    throw new SoldesSyncError(
      `La liste « ${SOLDES_LIST_NAME} » n'a pas les colonnes attendues : ` +
        `${missing.join(", ")}.\n` +
        `  → Le schéma a évolué mais la liste n'a pas suivi. Lancer d'abord :\n` +
        `     npm run sp:provision\n` +
        `  puis relancer la synchronisation (upsert : rien n'est perdu).`
    );
  }
}

// ---------------------------------------------------------------------------
//  Règles métier (§5.7, §5.18, §5.20) — la SEULE définition dans tout le dépôt
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Échéance (§5.18) : dernier jour du mois SUIVANT le mois déclaré.
 *  (avril -> 31 mai ; décembre -> 31 janvier de l'année suivante)
 *  Astuce Date.UTC : jour 0 du mois d'index m = dernier jour du mois m-1. */
function dueDateIso(year: number, month: number): string {
  return new Date(Date.UTC(year, month + 1, 0)).toISOString();
}

/** Statut dérivé — CODES TECHNIQUES NEUTRES (le staff est FR/NL, l'interface
 *  traduit, la donnée ne porte aucune langue). L'état « échu » n'est JAMAIS
 *  stocké : il dépend de la date du jour, il se dérive de DueDate à
 *  l'affichage.
 *
 *  ⚠ Le cas Balance < 0 (TROP-PERÇU, backlog §10.13) tombe aujourd'hui dans
 *  « Paid ». La donnée est juste (la dette est éteinte) mais ne distingue pas
 *  « soldé » de « trop-perçu ». Un état « Overpaid » réglerait l'affaire —
 *  c'est une DÉCISION MÉTIER en attente, pas un oubli. */
function payStatus(balance: number, paid: number): string {
  if (balance <= 0) return "Paid";
  return paid > 0 ? "Partial" : "Unpaid";
}

type OwnedFields = {
  FedasilNumber: string;
  Year: number;
  Quarter: number;
  Month: number;
  YearMonth: number;
  NetSalary: number;
  GrossSalary: number;
  Contribution: number;
  Paid: number;
  Balance: number;
  PayStatus: string;
  StructuredCom: string;
  DueDate: string;
};

/** Une ligne Soldes existante est-elle déjà à jour ? (Si oui : AUCUNE écriture
 *  — c'est ce qui rend la synchronisation rejouable à volonté.) Pour DueDate,
 *  seul le JOUR compte : SharePoint renvoie un ISO légèrement différent de
 *  celui qu'on envoie. */
function isUpToDate(
  existing: Record<string, unknown>,
  wanted: OwnedFields
): boolean {
  const numEq = (k: keyof OwnedFields) =>
    round2(toNumber(existing[k])) === round2(wanted[k] as number);
  const strEq = (k: keyof OwnedFields) =>
    String(existing[k] ?? "").trim() === String(wanted[k]).trim();
  const dayEq =
    String(existing["DueDate"] ?? "").slice(0, 10) === wanted.DueDate.slice(0, 10);

  return (
    strEq("FedasilNumber") &&
    numEq("Year") &&
    numEq("Quarter") &&
    numEq("Month") &&
    numEq("YearMonth") &&
    numEq("NetSalary") &&
    numEq("GrossSalary") &&
    numEq("Contribution") &&
    numEq("Paid") &&
    numEq("Balance") &&
    strEq("PayStatus") &&
    strEq("StructuredCom") &&
    dayEq
  );
}

// ---------------------------------------------------------------------------
//  Lecture CIBLÉE de Soldes — 3 requêtes par trimestre, colonne INDEXÉE
// ---------------------------------------------------------------------------
//
//  AVANT (12/7) : la liste Soldes était lue ENTIÈREMENT à chaque exécution
//  (20 113 lignes constatées le 14/7 pour en comparer 4 201), et cela grossit
//  de ~8 000 lignes par an. En mode --auto (4 listes), c'était 4 × 20 000.
//
//  MAINTENANT : on ne lit que les 3 mois du trimestre traité.
//
//  ⚠ POURQUOI `YearMonth` ET PAS `Year` + `Quarter` (pourtant indexées) :
//  SharePoint applique un $filter composé en partant de la PREMIÈRE colonne ;
//  « Year eq 2026 » ramène à lui seul ~8 000 lignes, soit AU-DELÀ du seuil des
//  5 000 -> 400 garanti dès la première année pleine. `YearMonth eq 202604`
//  ramène ~1 700 lignes (une par résident déclarant), et ce chiffre NE GROSSIT
//  PAS avec les années. C'est le seul découpage qui tienne dans la durée (§6.1).

async function readSoldesRowsForQuarter(
  graph: GraphClient,
  siteId: string,
  soldesListId: string,
  year: number,
  quarter: number,
  log: Logger
): Promise<Map<string, ListItem>> {
  const byTitle = new Map<string, ListItem>();
  const months = [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
  const select = OWNED_SOLDES_COLUMNS.join(",");

  for (const month of months) {
    const yearMonth = year * 100 + month;
    const items = await graph.getAllPages<ListItem>(
      `/sites/${siteId}/lists/${soldesListId}/items` +
        `?$expand=fields($select=${select})` +
        `&$filter=fields/YearMonth eq ${yearMonth}` +
        `&$top=200`
    );
    for (const it of items) {
      const title = String(it.fields?.["Title"] ?? "").trim();
      if (title) byTitle.set(title, it);
    }
    log(`   Soldes ${yearMonth} : ${items.length} ligne(s) existante(s)`);
  }

  return byTitle;
}

// ---------------------------------------------------------------------------
//  Synchronisation d'UN trimestre
// ---------------------------------------------------------------------------

export type SyncQuarterOptions = {
  /** Trimestre 1-4 (la liste source est « KB-Cumul T<quarter> »). */
  quarter: number;
  /** Année des données CONTENUES dans cette liste (explicite dans Soldes). */
  year: number;
  dryRun: boolean;
  log: Logger;
  /** Nom de liste source explicite (par défaut « KB-Cumul T<quarter> »). */
  listName?: string;
};

export async function syncQuarter(
  graph: GraphClient,
  siteId: string,
  soldesListId: string,
  opts: SyncQuarterOptions
): Promise<QuarterResult> {
  const { quarter, year, dryRun, log } = opts;
  const displayName = opts.listName ?? `KB-Cumul T${quarter}`;

  const result: QuarterResult = {
    quarter,
    year,
    listName: displayName,
    sourceCount: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    outOfQuarter: 0,
  };

  const source = await findListByName(graph, siteId, displayName);
  if (!source) {
    throw new SoldesSyncError(
      `Liste source « ${displayName} » introuvable (npm run sp:inspect).`
    );
  }

  log(`\n── ${displayName} — données ${year} ──`);

  const sourceItems = await graph.getAllPages<ListItem>(
    `/sites/${siteId}/lists/${source.id}/items` +
      `?$expand=fields($select=${SOURCE_COLUMNS.join(",")})&$top=200`
  );
  result.sourceCount = sourceItems.length;
  log(`   Source : ${sourceItems.length} ligne(s)`);

  // Liste vide = cas NORMAL au lendemain d'une rotation (§11quater.3) : ce
  // n'est pas une erreur, il n'y a simplement rien à photographier.
  if (sourceItems.length === 0) {
    log("   Liste vide : rien à synchroniser.");
    return result;
  }

  const existingByTitle = await readSoldesRowsForQuarter(
    graph,
    siteId,
    soldesListId,
    year,
    quarter,
    log
  );

  let processed = 0;
  for (const it of sourceItems) {
    processed++;

    const fa = String(it.fields?.["FedasilNumber"] ?? "").trim();
    const month = Number(it.fields?.["Month"]);

    if (!fa || !Number.isInteger(month) || month < 1 || month > 12) {
      result.skipped++;
      log(
        `   ⚠ ligne source id=${it.id} ignorée (FA « ${fa} » / mois « ${String(
          it.fields?.["Month"] ?? ""
        )} » invalide)`
      );
      continue;
    }

    const rowQuarter = Math.ceil(month / 3);
    if (rowQuarter !== quarter) {
      // Anomalie de DONNÉES, pas de code : une ligne rangée dans la mauvaise
      // liste trimestrielle. On la traite quand même (le mois fait foi), mais
      // l'année déduite pour elle est CELLE DE LA LISTE — donc potentiellement
      // fausse. À investiguer si ce compteur n'est pas nul.
      result.outOfQuarter++;
      log(
        `   ⚠ FA ${fa}, mois ${month} : hors du trimestre T${quarter} de la ` +
          `liste source (classé T${rowQuarter} dans Soldes — VÉRIFIER LA DONNÉE)`
      );
    }

    const contribution = round2(toNumber(it.fields?.["Contribution"]));
    const paid = round2(toNumber(it.fields?.["Paid"]));
    const balance = round2(contribution - paid);

    const wanted: OwnedFields = {
      FedasilNumber: fa,
      Year: year,
      Quarter: rowQuarter,
      Month: month,
      YearMonth: year * 100 + month,
      NetSalary: round2(toNumber(it.fields?.["NetSalary"])),
      GrossSalary: round2(toNumber(it.fields?.["GrossSalary"])),
      Contribution: contribution,
      Paid: paid,
      Balance: balance,
      PayStatus: payStatus(balance, paid),
      StructuredCom: String(it.fields?.["StructuredCom"] ?? "").trim(),
      DueDate: dueDateIso(year, month),
    };

    const title = `${fa}-${year}-${String(month).padStart(2, "0")}`;
    const existing = existingByTitle.get(title);

    if (!existing) {
      if (dryRun) {
        log(
          `   + [dry-run] création : ${title} (${wanted.PayStatus}, solde ${balance} €)`
        );
      } else {
        await graph.write(
          "POST",
          `/sites/${siteId}/lists/${soldesListId}/items`,
          { fields: { Title: title, ...wanted } }
        );
      }
      result.created++;
    } else if (isUpToDate(existing.fields ?? {}, wanted)) {
      result.unchanged++;
    } else {
      if (dryRun) {
        log(
          `   ~ [dry-run] mise à jour : ${title} (${wanted.PayStatus}, solde ${balance} €)`
        );
      } else {
        await graph.write(
          "PATCH",
          `/sites/${siteId}/lists/${soldesListId}/items/${existing.id}/fields`,
          wanted
        );
      }
      result.updated++;
    }

    if (processed % 250 === 0 || processed === sourceItems.length) {
      log(`   ${processed}/${sourceItems.length} traité(s)…`);
    }
  }

  log(
    `   → ${result.created} créé(s), ${result.updated} mis à jour, ` +
      `${result.unchanged} inchangé(s), ${result.skipped} ignoré(s)`
  );
  return result;
}

// ---------------------------------------------------------------------------
//  Mode AUTO — les 4 listes, sans jamais coder une année en dur
// ---------------------------------------------------------------------------
//
//  C'est CE point d'entrée que la Function nocturne appellera. Il lit le
//  trimestre actif dans Config (la même source que Me.ts et Declare.ts), en
//  déduit l'année de chacune des 4 listes KB-Cumul, et les synchronise toutes.
//
//  Pourquoi les QUATRE et pas seulement le trimestre courant : un paiement
//  tardif met à jour `Paid` dans la KB-Cumul d'un trimestre CLÔTURÉ (qui vit
//  encore ~13 mois). Le portail, lui, lit ce trimestre dans Soldes. Sans
//  resynchronisation, il continuerait d'afficher « impayé » une dette réglée
//  — et le futur moteur de rappels enverrait des mises en demeure pour rien
//  (§5.20.1).

export async function syncAuto(
  graph: GraphClient,
  siteId: string,
  opts: { dryRun: boolean; log: Logger }
): Promise<{ active: ActiveQuarter; results: QuarterResult[] }> {
  const { dryRun, log } = opts;

  const active = await readActiveQuarter(graph, siteId);
  log(
    `Trimestre actif (liste Config) : T${active.quarter} ${active.year} ` +
      `(« ${active.cumulListName} »)`
  );

  const soldes = await findListByName(graph, siteId, SOLDES_LIST_NAME);
  if (!soldes) {
    throw new SoldesSyncError(
      `Liste « ${SOLDES_LIST_NAME} » introuvable. → npm run sp:provision`
    );
  }
  await assertSoldesColumns(graph, siteId, soldes.id);

  const plan = [1, 2, 3, 4].map((q) => ({
    quarter: q,
    year: yearOfCumulList(q, active),
  }));
  log(
    "Plan : " +
      plan.map((p) => `KB-Cumul T${p.quarter} → ${p.year}`).join(" · ") +
      (dryRun ? "   [MODE --dry-run : AUCUNE écriture]" : "")
  );

  const results: QuarterResult[] = [];
  for (const p of plan) {
    results.push(
      await syncQuarter(graph, siteId, soldes.id, {
        quarter: p.quarter,
        year: p.year,
        dryRun,
        log,
      })
    );
  }

  return { active, results };
}

/** Résumé lisible d'une exécution (CLI et journal de la Function). */
export function formatSummary(results: QuarterResult[], dryRun: boolean): string {
  const total = results.reduce(
    (acc, r) => ({
      created: acc.created + r.created,
      updated: acc.updated + r.updated,
      unchanged: acc.unchanged + r.unchanged,
      skipped: acc.skipped + r.skipped,
      outOfQuarter: acc.outOfQuarter + r.outOfQuarter,
    }),
    { created: 0, updated: 0, unchanged: 0, skipped: 0, outOfQuarter: 0 }
  );

  const lines = [
    `\nTOTAL${dryRun ? " (dry-run, AUCUNE écriture)" : ""} : ` +
      `${total.created} créé(s), ${total.updated} mis à jour, ` +
      `${total.unchanged} inchangé(s), ${total.skipped} ignoré(s).`,
  ];
  if (total.outOfQuarter > 0) {
    lines.push(
      `⚠ ${total.outOfQuarter} ligne(s) rangée(s) dans la MAUVAISE liste ` +
        `trimestrielle : leur année dans Soldes est déduite de la liste et ` +
        `peut être fausse. À investiguer.`
    );
  }
  return lines.join("\n");
}
