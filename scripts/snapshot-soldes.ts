/* ============================================================================
 *  scripts/snapshot-soldes.ts — Synchronisation KB-Cumul Tn -> liste « Soldes »
 * ----------------------------------------------------------------------------
 *  La liste « Soldes » est la MÉMOIRE PERMANENTE des soldes mensuels
 *  (décision du 12/7/2026 — §3 de CONCEPTION-STAFF-APP.md) : une ligne par
 *  FA × année × mois, photo complète de tous les mois déclarés.
 *
 *  Ce script lit une liste trimestrielle KB-Cumul et fait un UPSERT dans
 *  Soldes (clé d'idempotence : Title = <FA>-<année>-<mois sur 2 chiffres>).
 *  Il est REJOUABLE À VOLONTÉ :
 *    - ligne absente de Soldes  -> création ;
 *    - ligne présente           -> mise à jour des SEULES colonnes qu'il
 *                                  possède (montants, statut, échéance) ;
 *    - ligne identique          -> aucune écriture.
 *  Les colonnes qu'il ne possède pas (futur module 4 staff : escalade,
 *  dates de rappel, notes…) ne sont JAMAIS touchées.
 *
 *  RÈGLE DE VÉRITÉ : tant que la ligne KB-Cumul existe (~9 mois après la
 *  clôture), KB-Cumul reste la source (le portail résident la lit) et ce
 *  script resynchronise. Après le vidage de la liste trimestrielle
 *  (sp:rotate), Soldes devient la seule vérité.
 *
 *  Usage (depuis la RACINE du dépôt) — l'ANNÉE est OBLIGATOIRE (les listes
 *  KB-Cumul ont une année implicite ; Soldes la rend explicite) :
 *    npm run sp:soldes -- T2 2026              synchronise « KB-Cumul T2 » (année 2026)
 *    npm run sp:soldes -- T2 2026 --dry-run    montre ce qui serait fait, n'écrit rien
 *    npm run sp:soldes -- "Ma Liste" 2026      nom de liste complet accepté
 *
 *  Quand le lancer :
 *    - juste APRÈS chaque bascule trimestrielle, sur le trimestre qui vient
 *      de se clôturer (ex. bascule du 1er août -> sp:soldes -- T2 2026) ;
 *    - régulièrement ensuite, tant que des paiements tardifs mettent à jour
 *      Paid dans la liste KB-Cumul du trimestre clos ;
 *    - une DERNIÈRE fois sur toute liste contenant des données réelles,
 *      juste AVANT son vidage par sp:rotate.
 *
 *  Identifiants : réutilise api/local.settings.json (TENANT_ID,
 *  GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, SP_SITE_HOSTNAME, SP_SITE_PATH),
 *  comme provision-sharepoint.ts et rotate-quarter.ts. Permission requise :
 *  écriture sur le site (Sites.ReadWrite.All actuelle, ou Sites.Selected
 *  avec rôle write).
 * ============================================================================ */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
        "Lance le script depuis la RACINE du dépôt (npm run sp:soldes -- T2 2026)."
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

// ---------- Client Graph minimal ----------

let graphToken = "";

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

// GET générique (URL relative /v1.0 ou absolue pour la pagination).
async function graphGet<T>(url: string): Promise<T> {
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

// POST/PATCH avec une reprise en cas de limitation de débit (429/503).
async function graphWrite(
  method: "POST" | "PATCH",
  url: string,
  body: unknown
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${graphToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    if ((res.status === 429 || res.status === 503) && attempt === 1) {
      const wait = Number(res.headers.get("retry-after") ?? "5");
      console.log(`   … limitation Graph (statut ${res.status}), pause ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const text = await res.text();
    fail(`Graph ${method} ${url} -> statut ${res.status}\n${text}`);
  }
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

async function findListByName(
  siteId: string,
  displayName: string
): Promise<{ id: string; displayName: string } | null> {
  const json = await graphGet<{
    value: Array<{ id: string; displayName: string; list?: { hidden?: boolean } }>;
  }>(`/sites/${siteId}/lists?$select=id,displayName,list&$top=200`);
  return (
    json.value
      .filter((l) => !l.list?.hidden)
      .find(
        (l) => l.displayName.toLowerCase() === displayName.toLowerCase()
      ) ?? null
  );
}

async function getAllItems(siteId: string, listId: string): Promise<ListItem[]> {
  const items: ListItem[] = [];
  let url: string | undefined =
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=200`;
  while (url) {
    const page: {
      value: Array<{ id: string; fields?: Record<string, unknown> }>;
      "@odata.nextLink"?: string;
    } = await graphGet(url);
    for (const it of page.value) {
      items.push({ id: it.id, fields: it.fields ?? {} });
    }
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

// Échéance §5.18 : dernier jour du mois SUIVANT le mois déclaré
// (avril -> 31 mai ; décembre -> 31 janvier de l'année suivante).
// Astuce Date.UTC : jour 0 du mois d'index m = dernier jour du mois d'index m-1.
function dueDateIso(year: number, month: number): string {
  return new Date(Date.UTC(year, month + 1, 0)).toISOString();
}

// Statut dérivé — CODES TECHNIQUES NEUTRES, l'interface staff traduit (FR/NL) :
// Balance <= 0 -> Paid ; sinon Paid > 0 -> Partial ; sinon Unpaid.
// (L'état « échu » n'est pas stocké : il dépend de la date du jour.)
function payStatus(balance: number, paid: number): string {
  if (balance <= 0) return "Paid";
  return paid > 0 ? "Partial" : "Unpaid";
}

// Colonnes POSSÉDÉES par ce script dans Soldes : lui seul les écrit, et il
// n'écrit JAMAIS rien d'autre (les colonnes du futur module 4 sont à l'abri).
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

// Une ligne existante est-elle déjà à jour ? (comparaison champ à champ ;
// pour DueDate, seul le jour compte — SharePoint renvoie un format ISO
// légèrement différent de celui qu'on envoie).
function isUpToDate(existing: Record<string, unknown>, wanted: OwnedFields): boolean {
  const numEq = (k: keyof OwnedFields) =>
    round2(toNumber(existing[k])) === round2(wanted[k] as number);
  const strEq = (k: keyof OwnedFields) =>
    String(existing[k] ?? "").trim() === String(wanted[k]).trim();
  const dayEq = () =>
    String(existing.DueDate ?? "").slice(0, 10) === wanted.DueDate.slice(0, 10);

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
    dayEq()
  );
}

// ---------- Point d'entrée ----------

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));

  const listArg = positional[0];
  const yearArg = positional[1];

  if (!listArg || !yearArg) {
    fail(
      "Usage :\n" +
        "  npm run sp:soldes -- T2 2026 [--dry-run]\n" +
        '  npm run sp:soldes -- "Nom complet de liste" 2026 [--dry-run]\n' +
        "T1..T4 est un raccourci pour « KB-Cumul Tn ».\n" +
        "L'ANNÉE est obligatoire : les listes KB-Cumul ont une année implicite,\n" +
        "Soldes la rend explicite (ne pas se tromper pour un T4 synchronisé en janvier !)."
    );
  }

  const year = Number(yearArg);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    fail(`Année invalide : « ${yearArg} » (attendu : ex. 2026).`);
  }

  const isShortcut = /^t[1-4]$/i.test(listArg);
  const displayName = isShortcut ? `KB-Cumul ${listArg.toUpperCase()}` : listArg;
  const expectedQuarter = isShortcut ? Number(listArg.slice(1)) : null;

  const cfg = loadSettings();
  graphToken = await getGraphToken(cfg);
  const siteId = await getSiteId(cfg);

  const source = await findListByName(siteId, displayName);
  if (!source) {
    fail(
      `Liste source « ${displayName} » introuvable sur le site. ` +
        "Vérifie le nom (npm run sp:inspect) — aucune action effectuée."
    );
  }
  const soldes = await findListByName(siteId, "Soldes");
  if (!soldes) {
    fail(
      "Liste « Soldes » introuvable sur le site.\n" +
        "La créer d'abord : npm run sp:provision (elle est décrite dans sharepoint-schema.json)."
    );
  }

  console.log(`Source : « ${source.displayName} » (id: ${source.id})`);
  console.log(`Cible  : « ${soldes.displayName} » (id: ${soldes.id})`);
  console.log(`Année  : ${year}${dryRun ? "   [MODE --dry-run : AUCUNE écriture]" : ""}\n`);

  console.log("Lecture de la liste source…");
  const sourceItems = await getAllItems(siteId, source.id);
  console.log(`${sourceItems.length} élément(s) dans la source.`);

  if (sourceItems.length === 0) {
    console.log("\nSource vide : rien à synchroniser. Terminé.");
    return;
  }

  console.log("Lecture de la liste Soldes…");
  const soldesItems = await getAllItems(siteId, soldes.id);
  console.log(`${soldesItems.length} élément(s) déjà dans Soldes.\n`);

  const byTitle = new Map<string, ListItem>();
  for (const it of soldesItems) {
    const title = String(it.fields.Title ?? "").trim();
    if (title) byTitle.set(title, it);
  }

  let createdCount = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let processed = 0;

  for (const it of sourceItems) {
    processed++;

    const fa = String(it.fields.FedasilNumber ?? "").trim();
    const month = Number(it.fields.Month);

    if (!fa || !Number.isInteger(month) || month < 1 || month > 12) {
      skipped++;
      console.log(
        `   ⚠ ligne source id=${it.id} ignorée (FA « ${fa} » / mois « ${String(
          it.fields.Month ?? ""
        )} » invalide)`
      );
      continue;
    }

    const quarter = Math.ceil(month / 3);
    if (expectedQuarter !== null && quarter !== expectedQuarter) {
      console.log(
        `   ⚠ FA ${fa}, mois ${month} : hors du trimestre T${expectedQuarter} de la liste source ` +
          `(classé T${quarter} dans Soldes — vérifier la donnée)`
      );
    }

    const contribution = round2(toNumber(it.fields.Contribution));
    const paid = round2(toNumber(it.fields.Paid));
    const balance = round2(contribution - paid);

    const wanted: OwnedFields = {
      FedasilNumber: fa,
      Year: year,
      Quarter: quarter,
      Month: month,
      YearMonth: year * 100 + month,
      NetSalary: round2(toNumber(it.fields.NetSalary)),
      GrossSalary: round2(toNumber(it.fields.GrossSalary)),
      Contribution: contribution,
      Paid: paid,
      Balance: balance,
      PayStatus: payStatus(balance, paid),
      StructuredCom: String(it.fields.StructuredCom ?? "").trim(),
      DueDate: dueDateIso(year, month),
    };

    const title = `${fa}-${year}-${String(month).padStart(2, "0")}`;
    const existing = byTitle.get(title);

    if (!existing) {
      if (dryRun) {
        console.log(`   + [dry-run] création : ${title} (${wanted.PayStatus}, solde ${balance} €)`);
      } else {
        await graphWrite("POST", `/sites/${siteId}/lists/${soldes.id}/items`, {
          fields: { Title: title, ...wanted },
        });
      }
      createdCount++;
    } else if (isUpToDate(existing.fields, wanted)) {
      unchanged++;
    } else {
      if (dryRun) {
        console.log(`   ~ [dry-run] mise à jour : ${title} (${wanted.PayStatus}, solde ${balance} €)`);
      } else {
        await graphWrite(
          "PATCH",
          `/sites/${siteId}/lists/${soldes.id}/items/${existing.id}/fields`,
          wanted
        );
      }
      updated++;
    }

    if (processed % 50 === 0 || processed === sourceItems.length) {
      console.log(`   ${processed}/${sourceItems.length} traité(s)…`);
    }
  }

  console.log(
    `\nTerminé${dryRun ? " (dry-run, AUCUNE écriture)" : ""} : ` +
      `${createdCount} créé(s), ${updated} mis à jour, ${unchanged} inchangé(s), ${skipped} ignoré(s).`
  );
  console.log(
    "Rappel : rejouable à volonté (upsert par Title). Relancer après chaque mise à jour\n" +
      "de Paid dans la source, et une dernière fois AVANT tout vidage par sp:rotate."
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
