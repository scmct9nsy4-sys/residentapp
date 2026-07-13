/* ============================================================================
 *  scripts/rotate-quarter.ts — Archivage + vidage d'une liste trimestrielle
 *                              + BASCULE du trimestre actif (liste Config)
 * ----------------------------------------------------------------------------
 *  Le modèle ResidentApp utilise 4 listes permanentes (KB-Cumul T1..T4) aux
 *  ID FIXES, réutilisées chaque année. À la bascule de trimestre, la liste
 *  qui va être réutilisée doit être ARCHIVÉE (export) puis VIDÉE.
 *
 *  NOUVEAU (13/7/2026, chantier §10.0) : après le vidage, le script propose
 *  d'écrire la ligne « ActiveQuarter » de la liste SharePoint « Config »
 *  (trimestre, année, ID + nom de la liste KB-Cumul). C'est CETTE écriture
 *  qui bascule le portail : /api/me et /api/declare lisent la liste Config
 *  (cache ~5 min) — plus de variable d'environnement à modifier, plus de
 *  redéploiement. La confirmation est SÉPARÉE (taper BASCULER) : le vidage
 *  et l'activation restent deux décisions distinctes.
 *
 *  Usage (depuis la RACINE du dépôt) :
 *    npm run sp:rotate -- T3                 archive, vide « KB-Cumul T3 »,
 *                                            puis propose la bascule vers T3
 *    npm run sp:rotate -- T3 2025            idem, fichiers nommés ...-2025-T3...
 *    npm run sp:rotate -- "Ma Liste" 2025    nom de liste complet accepté
 *                                            (pas de bascule si non T1..T4)
 *    npm run sp:rotate -- T3 2025 --export-only   archive SANS vider
 *                                                 (et SANS bascule)
 *    npm run sp:rotate -- T3 --config-only        bascule SEULE, sans toucher
 *                                                 aux données (initialisation
 *                                                 de Config, ou récupération)
 *    npm run sp:rotate -- T3 --config-only --annee=2026
 *                                            force l'année du trimestre actif
 *                                            (défaut : l'année courante, qui
 *                                            est correcte pour les 4 bascules
 *                                            du calendrier — §5.16)
 *
 *  Sécurité :
 *    - L'ARCHIVE EST TOUJOURS ÉCRITE AVANT toute suppression
 *      (archives/<liste>[-label]_<horodatage>.json + .csv) ;
 *    - la suppression exige de taper le mot VIDER en toutes lettres ;
 *    - la bascule Config exige de taper le mot BASCULER en toutes lettres ;
 *    - liste introuvable -> aucune action ; liste vide -> pas d'archive ni de
 *      vidage, mais la bascule est tout de même proposée (clôturer un
 *      trimestre sans données reste une clôture) ;
 *    - --export-only n'écrit JAMAIS la liste Config.
 *
 *  ⚠ Les archives contiennent des DONNÉES PERSONNELLES : le dossier
 *    archives/ doit figurer dans .gitignore et être rangé ensuite dans un
 *    emplacement approprié (SharePoint staff, coffre…), jamais dans le dépôt.
 *
 *  Identifiants : réutilise api/local.settings.json (TENANT_ID,
 *  GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, SP_SITE_HOSTNAME, SP_SITE_PATH),
 *  comme provision-sharepoint.ts. Permission requise : écriture sur le site
 *  (Sites.ReadWrite.All actuelle, ou Sites.Selected avec rôle write).
 * ============================================================================ */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

// Nom de la liste de configuration (schéma sharepoint-schema.json) et clé de
// la ligne du trimestre actif. Mêmes valeurs que api/src/shared/quarterConfig.ts.
const CONFIG_LIST_NAME = "Config";
const ACTIVE_QUARTER_KEY = "ActiveQuarter";

// ---------- Configuration (même mécanique que provision-sharepoint.ts) ------

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
        "Lance le script depuis la RACINE du dépôt (npm run sp:rotate -- T3)."
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

// DELETE avec une reprise en cas de limitation de débit (429/503).
async function graphDelete(url: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${graphToken}` },
    });
    if (res.ok || res.status === 204) return;
    if ((res.status === 429 || res.status === 503) && attempt === 1) {
      const wait = Number(res.headers.get("retry-after") ?? "5");
      console.log(`   … limitation Graph (statut ${res.status}), pause ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const text = await res.text();
    fail(`Graph DELETE ${url} -> statut ${res.status}\n${text}`);
  }
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

// ---------- Lecture de la liste ----------

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

// ---------- Export (JSON fidèle + CSV de confort) ----------

// Colonnes métier connues en premier, le reste en ordre alphabétique.
const PREFERRED_HEADERS = [
  "FedasilNumber",
  "Month",
  "NetSalary",
  "GrossSalary",
  "Contribution",
  "Paid",
  "StructuredCom",
  "StructuredText",
  "Title",
];

function buildCsv(items: ListItem[]): string {
  const keys = new Set<string>();
  for (const it of items) {
    for (const k of Object.keys(it.fields)) {
      if (!k.startsWith("@") && !k.startsWith("_")) keys.add(k);
    }
  }
  const rest = [...keys]
    .filter((k) => !PREFERRED_HEADERS.includes(k))
    .sort((a, b) => a.localeCompare(b));
  const headers = [
    "id",
    ...PREFERRED_HEADERS.filter((h) => keys.has(h)),
    ...rest,
  ];

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // Séparateur ; (convention Excel FR/BE) + BOM UTF-8 pour Excel.
  const lines = [headers.join(";")];
  for (const it of items) {
    lines.push(
      headers
        .map((h) => (h === "id" ? it.id : escape(it.fields[h])))
        .join(";")
    );
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

// ---------- Bascule du trimestre actif (liste Config, §10.0) ----------

async function askConfirmation(prompt: string, word: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim() === word;
}

// Écrit (upsert) la ligne ActiveQuarter de la liste Config. NE FAIT PAS
// échouer la rotation si la liste Config est absente : l'archivage et le
// vidage sont déjà faits — on explique comment rattraper (--config-only).
async function writeActiveQuarterConfig(
  siteId: string,
  quarter: number,
  year: number,
  cumulListId: string,
  cumulListName: string
): Promise<boolean> {
  const configList = await findListByName(siteId, CONFIG_LIST_NAME);
  if (!configList) {
    console.log(
      `\n⚠ Liste « ${CONFIG_LIST_NAME} » INTROUVABLE : la bascule automatique ` +
        `n'a PAS été enregistrée (le portail reste sur son trimestre actuel,\n` +
        `  ou sur les variables d'environnement en repli). Pour rattraper :\n` +
        `  1) npm run sp:provision   (crée la liste Config décrite dans sharepoint-schema.json)\n` +
        `  2) npm run sp:rotate -- T${quarter} --config-only --annee=${year}`
    );
    return false;
  }

  const items = await getAllItems(siteId, configList.id);
  const row = items.find(
    (it) =>
      String(it.fields["Title"] ?? "").trim().toLowerCase() ===
      ACTIVE_QUARTER_KEY.toLowerCase()
  );

  const stamp = new Date().toISOString();
  const fields = {
    Quarter: quarter,
    Year: year,
    CumulListId: cumulListId,
    CumulListName: cumulListName,
    RotationNote: `Bascule vers T${quarter} ${year} le ${stamp} via sp:rotate`,
  };

  if (row) {
    await graphWrite(
      "PATCH",
      `/sites/${siteId}/lists/${configList.id}/items/${row.id}/fields`,
      fields
    );
  } else {
    await graphWrite("POST", `/sites/${siteId}/lists/${configList.id}/items`, {
      fields: { Title: ACTIVE_QUARTER_KEY, ...fields },
    });
  }

  console.log(
    `\n✓ Trimestre actif basculé : T${quarter} ${year} ` +
      `(« ${cumulListName} », id ${cumulListId}).\n` +
      `  Le portail suit automatiquement (cache mémoire ≤ 5 min) — ` +
      `AUCUNE variable à modifier, AUCUN redéploiement.\n` +
      `  (Filet de sécurité : penser à aligner un jour les variables ` +
      `SP_CUMUL_* de repli, sans urgence.)`
  );
  return true;
}

// Propose puis exécute la bascule (confirmation BASCULER).
async function proposeQuarterSwitch(
  siteId: string,
  quarter: number,
  year: number,
  cumulListId: string,
  cumulListName: string
): Promise<void> {
  const confirmed = await askConfirmation(
    `\nActiver « ${cumulListName} » comme trimestre courant du portail ` +
      `(T${quarter} ${year}) ?\n` +
      `⚠ Cette écriture FERME les déclarations de l'ancien trimestre et ` +
      `OUVRE le nouveau,\n` +
      `  effective sur le portail en ≤ 5 minutes. ` +
      `Tapez BASCULER pour confirmer : `,
    "BASCULER"
  );
  if (!confirmed) {
    console.log(
      "\nBascule NON confirmée : le portail reste sur le trimestre actuel.\n" +
        `Pour basculer plus tard SANS retoucher aux données :\n` +
        `  npm run sp:rotate -- T${quarter} --config-only --annee=${year}`
    );
    return;
  }
  await writeActiveQuarterConfig(
    siteId,
    quarter,
    year,
    cumulListId,
    cumulListName
  );
}

// ---------- Point d'entrée ----------

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const exportOnly = args.includes("--export-only");
  const configOnly = args.includes("--config-only");
  const anneeArg = args.find((a) => a.startsWith("--annee="));
  const positional = args.filter((a) => !a.startsWith("--"));

  if (exportOnly && configOnly) {
    fail("--export-only et --config-only sont incompatibles.");
  }

  const listArg = positional[0];
  const label = positional[1]; // ex. l'année des données archivées ("2025")

  if (!listArg) {
    fail(
      "Usage :\n" +
        '  npm run sp:rotate -- T3 [2025] [--export-only]\n' +
        '  npm run sp:rotate -- "Nom complet de liste" [2025] [--export-only]\n' +
        "  npm run sp:rotate -- T3 --config-only [--annee=2026]\n" +
        "T1..T4 est un raccourci pour « KB-Cumul Tn ».\n" +
        "--config-only : bascule SEULE du trimestre actif (liste Config),\n" +
        "sans archivage ni vidage. --annee : année du trimestre activé\n" +
        "(défaut : année courante)."
    );
  }

  const displayName = /^t[1-4]$/i.test(listArg)
    ? `KB-Cumul ${listArg.toUpperCase()}`
    : listArg;

  // Trimestre pour la bascule Config : déduit du nom de liste ("… T3" -> 3).
  const quarterMatch = /T\s*([1-4])\b/i.exec(displayName);
  const quarter = quarterMatch ? Number(quarterMatch[1]) : null;

  // Année du trimestre ACTIVÉ (≠ label = année des données ARCHIVÉES !).
  // Par défaut : l'année courante — correcte pour les 4 bascules du
  // calendrier §5.16 (T1 activé le 1er février de SON année, T2 le 1er mai,
  // T3 le 1er août, T4 le 1er novembre). --annee=YYYY pour forcer.
  let activeYear = new Date().getFullYear();
  if (anneeArg) {
    const y = Number(anneeArg.slice("--annee=".length));
    if (!Number.isInteger(y) || y < 2020 || y > 2100) {
      fail(`--annee invalide : « ${anneeArg} » (attendu : --annee=2026).`);
    }
    activeYear = y;
  }

  const cfg = loadSettings();
  graphToken = await getGraphToken(cfg);
  const siteId = await getSiteId(cfg);

  const list = await findListByName(siteId, displayName);
  if (!list) {
    fail(
      `Liste « ${displayName} » introuvable sur le site. ` +
        "Vérifie le nom (npm run sp:inspect) — aucune action effectuée."
    );
  }
  console.log(`Liste : « ${list.displayName} » (id: ${list.id})\n`);

  // ---- Mode --config-only : bascule SEULE, aucune donnée touchée. ----
  if (configOnly) {
    if (quarter === null) {
      fail(
        "--config-only nécessite une liste trimestrielle (T1..T4 ou nom " +
          "contenant « T1 »..« T4 »)."
      );
    }
    console.log(
      "Mode --config-only : ni archivage ni vidage — bascule du trimestre actif uniquement."
    );
    await proposeQuarterSwitch(
      siteId,
      quarter,
      activeYear,
      list.id,
      list.displayName
    );
    return;
  }

  console.log("Lecture des éléments…");
  const items = await getAllItems(siteId, list.id);
  console.log(`${items.length} élément(s) trouvé(s).`);

  if (items.length === 0) {
    console.log(
      "\nListe déjà vide : rien à archiver ni à vider."
    );
    // Clôturer un trimestre sans données reste une clôture : proposer quand
    // même la bascule (sauf --export-only ou liste non trimestrielle).
    if (!exportOnly && quarter !== null) {
      await proposeQuarterSwitch(
        siteId,
        quarter,
        activeYear,
        list.id,
        list.displayName
      );
    } else {
      console.log("Terminé.");
    }
    return;
  }

  // 1) ARCHIVE (toujours AVANT toute suppression).
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "_")
    .replace(":", "h");
  const safeName = list.displayName.replace(/\s+/g, "-");
  const base = `${safeName}${label ? `-${label}` : ""}_${stamp}`;
  const dir = resolve(process.cwd(), "archives");
  mkdirSync(dir, { recursive: true });

  const jsonPath = resolve(dir, `${base}.json`);
  const csvPath = resolve(dir, `${base}.csv`);
  writeFileSync(jsonPath, JSON.stringify(items, null, 2), "utf-8");
  writeFileSync(csvPath, buildCsv(items), "utf-8");
  console.log(`\nArchive écrite :\n  ${jsonPath}\n  ${csvPath}`);
  console.log(
    "⚠ Données personnelles : archives/ doit être dans .gitignore ; ranger " +
      "ces fichiers dans l'emplacement prévu (hors dépôt) après la bascule."
  );

  if (exportOnly) {
    console.log(
      "\nMode --export-only : aucune suppression, aucune bascule. Terminé."
    );
    return;
  }

  // 2) CONFIRMATION EXPLICITE avant vidage.
  const wipeConfirmed = await askConfirmation(
    `\nVider DÉFINITIVEMENT les ${items.length} élément(s) de « ${list.displayName} » ?\n` +
      `L'archive ci-dessus a été écrite. Tapez VIDER pour confirmer : `,
    "VIDER"
  );

  if (!wipeConfirmed) {
    console.log("\nConfirmation non reçue : AUCUNE suppression. Terminé.");
    return;
  }

  // 3) VIDAGE (élément par élément, avec reprise sur limitation de débit).
  console.log("");
  let deleted = 0;
  for (const it of items) {
    await graphDelete(`/sites/${siteId}/lists/${list.id}/items/${it.id}`);
    deleted++;
    if (deleted % 50 === 0 || deleted === items.length) {
      console.log(`   ${deleted}/${items.length} supprimé(s)…`);
    }
  }

  console.log(
    `\nTerminé : ${deleted} élément(s) supprimé(s) de « ${list.displayName} ».\n` +
      "La liste est prête pour le nouveau trimestre (les ID de liste ne changent pas)."
  );

  // 4) BASCULE du trimestre actif (liste Config) — confirmation SÉPARÉE.
  //    ⚠ Rappel exploitation : c'est aussi MAINTENANT, liste vide, qu'il faut
  //    vérifier l'index FedasilNumber (étape B-bis de la procédure).
  if (quarter !== null) {
    await proposeQuarterSwitch(
      siteId,
      quarter,
      activeYear,
      list.id,
      list.displayName
    );
  } else {
    console.log(
      "\nListe non trimestrielle (pas de « T1 »..« T4 » dans le nom) : " +
        "aucune bascule Config proposée."
    );
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
