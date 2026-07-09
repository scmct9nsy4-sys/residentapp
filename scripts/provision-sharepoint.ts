/* ============================================================================
 *  scripts/provision-sharepoint.ts — Provisioning déclaratif des listes
 * ----------------------------------------------------------------------------
 *  Le schéma voulu vit dans sharepoint-schema.json (à la racine du dépôt).
 *  Ce script compare le schéma avec l'état réel du site SharePoint via
 *  Microsoft Graph et CRÉE ce qui manque. Il est IDEMPOTENT et ne supprime
 *  ni ne modifie JAMAIS rien (aucun risque pour les données existantes).
 *
 *  Deux modes :
 *    npm run sp:inspect    -> rapport de l'état RÉEL (listes, colonnes,
 *                             noms INTERNES, types) — aucune écriture.
 *    npm run sp:provision  -> applique le schéma (créations uniquement).
 *
 *  Identifiants : réutilise api/local.settings.json (TENANT_ID,
 *  GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, SP_SITE_HOSTNAME, SP_SITE_PATH).
 *  L'app « e-residentapp admin » a déjà la permission Sites.ReadWrite.All :
 *  aucune configuration supplémentaire n'est nécessaire.
 *  ⚠ Lors du passage à Sites.Selected, conserver le rôle "write" sur le
 *  site ResidentApp pour que ce script continue de fonctionner.
 *
 *  Légende du rapport :  ✓ conforme · + créé · ⚠ à vérifier · · ignoré
 * ============================================================================ */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------- Types du schéma ----------

type ColumnType = "text" | "note" | "number" | "boolean" | "dateTime" | "choice";

type SchemaColumn = {
  name: string;
  type: ColumnType;
  choices?: string[];
  documentOnly?: boolean;
  note?: string;
};

type SchemaList = {
  displayName: string;
  description?: string;
  columns: SchemaColumn[];
};

type Schema = {
  _documentation?: string[];
  lists: SchemaList[];
};

// ---------- Types Graph (sous-ensemble utile) ----------

type GraphList = {
  id: string;
  displayName: string;
  list?: { hidden?: boolean; template?: string };
};

type GraphColumn = {
  name: string;
  displayName?: string;
  hidden?: boolean;
  readOnly?: boolean;
  text?: { allowMultipleLines?: boolean };
  number?: unknown;
  boolean?: unknown;
  dateTime?: unknown;
  choice?: { choices?: string[] };
  currency?: unknown;
  lookup?: unknown;
  personOrGroup?: unknown;
  calculated?: unknown;
};

// ---------- Chargement de la configuration ----------
// Le script est lancé depuis la racine du dépôt (npm run ...), donc
// process.cwd() = racine. Les identifiants viennent de api/local.settings.json
// (fichier NON commité — il contient le secret Graph).

function loadSettings(): Record<string, string> {
  const path = resolve(process.cwd(), "api/local.settings.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    fail(
      `Impossible de lire ${path}.\n` +
        "Lance le script depuis la RACINE du dépôt (npm run sp:inspect / sp:provision)."
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

function loadSchema(): Schema {
  const path = resolve(process.cwd(), "sharepoint-schema.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    fail(`Impossible de lire ${path} (le schéma doit être à la racine du dépôt).`);
  }
  const schema = JSON.parse(raw!) as Schema;
  if (!Array.isArray(schema.lists) || schema.lists.length === 0) {
    fail("sharepoint-schema.json : aucune liste définie dans 'lists'.");
  }
  return schema;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
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

// Appel Graph générique avec gestion d'erreur lisible.
async function graph<T>(
  method: "GET" | "POST",
  url: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${graphToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    fail(`Graph ${method} ${url} -> statut ${res.status}\n${text}`);
  }
  return (await res.json()) as T;
}

async function getSiteId(cfg: Record<string, string>): Promise<string> {
  const hostname = requireSetting(cfg, "SP_SITE_HOSTNAME");
  const sitePath = requireSetting(cfg, "SP_SITE_PATH");
  const site = await graph<{ id: string; webUrl?: string }>(
    "GET",
    `/sites/${hostname}:/${sitePath}?$select=id,webUrl`
  );
  console.log(`Site : ${site.webUrl ?? hostname + "/" + sitePath}\n`);
  return site.id;
}

async function getLists(siteId: string): Promise<GraphList[]> {
  const json = await graph<{ value: GraphList[] }>(
    "GET",
    `/sites/${siteId}/lists?$select=id,displayName,list&$top=200`
  );
  return json.value.filter((l) => !l.list?.hidden);
}

async function getColumns(siteId: string, listId: string): Promise<GraphColumn[]> {
  const json = await graph<{ value: GraphColumn[] }>(
    "GET",
    `/sites/${siteId}/lists/${listId}/columns?$top=200`
  );
  return json.value;
}

// ---------- Interprétation des colonnes ----------

function actualColumnType(col: GraphColumn): string {
  if (col.text) return col.text.allowMultipleLines ? "note" : "text";
  if (col.number !== undefined) return "number";
  if (col.boolean !== undefined) return "boolean";
  if (col.dateTime !== undefined) return "dateTime";
  if (col.choice !== undefined) return "choice";
  if (col.currency !== undefined) return "currency";
  if (col.lookup !== undefined) return "lookup";
  if (col.personOrGroup !== undefined) return "person";
  if (col.calculated !== undefined) return "calculated";
  return "(autre)";
}

// Corps Graph pour la création d'une colonne selon son type de schéma.
function buildColumnBody(col: SchemaColumn): Record<string, unknown> {
  switch (col.type) {
    case "text":
      return { name: col.name, text: {} };
    case "note":
      return { name: col.name, text: { allowMultipleLines: true } };
    case "number":
      return { name: col.name, number: {} };
    case "boolean":
      return { name: col.name, boolean: {} };
    case "dateTime":
      return { name: col.name, dateTime: {} };
    case "choice":
      return {
        name: col.name,
        choice: {
          allowTextEntry: false,
          displayAs: "dropDownMenu",
          choices: col.choices ?? [],
        },
      };
  }
}

// ---------- Mode INSPECT : rapport de l'état réel ----------

async function inspect(siteId: string): Promise<void> {
  const lists = await getLists(siteId);
  console.log(`${lists.length} liste(s) visible(s) sur le site :\n`);

  for (const list of lists) {
    console.log(`■ ${list.displayName}   (id: ${list.id})`);
    const columns = await getColumns(siteId, list.id);
    const visible = columns.filter(
      (c) => !c.hidden && !c.readOnly && c.name !== "ContentType" && c.name !== "Attachments"
    );
    for (const col of visible) {
      const label =
        col.displayName && col.displayName !== col.name
          ? `  (affiché : « ${col.displayName} »)`
          : "";
      console.log(`   ${col.name.padEnd(24)} ${actualColumnType(col).padEnd(10)}${label}`);
    }
    console.log("");
  }

  console.log(
    "Colonne de gauche = nom INTERNE (à utiliser dans sharepoint-schema.json\n" +
      "et dans les variables d'environnement SP_*_FIELD)."
  );
}

// ---------- Mode PROVISION : application du schéma ----------

async function provision(siteId: string, schema: Schema): Promise<void> {
  const actualLists = await getLists(siteId);
  let created = 0;
  let warnings = 0;

  for (const schemaList of schema.lists) {
    console.log(`■ Liste « ${schemaList.displayName} »`);

    // 1) La liste existe-t-elle ? (comparaison insensible à la casse)
    let list = actualLists.find(
      (l) => l.displayName.toLowerCase() === schemaList.displayName.toLowerCase()
    );

    if (!list) {
      list = await graph<GraphList>("POST", `/sites/${siteId}/lists`, {
        displayName: schemaList.displayName,
        description: schemaList.description ?? "",
        list: { template: "genericList" },
      });
      created++;
      console.log(`   + liste créée (id: ${list.id})`);
    } else {
      console.log(`   ✓ liste existante (id: ${list.id})`);
    }

    // 2) Les colonnes.
    const actualColumns = await getColumns(siteId, list.id);

    for (const col of schemaList.columns) {
      // Colonne à documenter mais dont le nom interne n'est pas encore relevé.
      if (col.name === "?") {
        warnings++;
        console.log(
          `   ⚠ colonne à compléter dans le schéma : ${col.note ?? "(voir sharepoint-schema.json)"}`
        );
        continue;
      }

      const existing = actualColumns.find(
        (c) => c.name.toLowerCase() === col.name.toLowerCase()
      );

      if (existing) {
        // Jamais de modification : on vérifie et on signale seulement.
        if (existing.name !== col.name) {
          warnings++;
          console.log(
            `   ⚠ ${col.name} : existe sous la casse « ${existing.name} » — aligner le schéma/les variables.`
          );
        } else {
          const actualType = actualColumnType(existing);
          if (actualType !== col.type) {
            warnings++;
            console.log(
              `   ⚠ ${col.name} : type réel « ${actualType} » ≠ schéma « ${col.type} » (aucune modification faite — aligner le schéma ou la config, ex. SP_FA_IS_NUMBER).`
            );
          } else {
            console.log(`   ✓ ${col.name} (${col.type})`);
          }
        }
        continue;
      }

      // Colonne absente.
      if (col.documentOnly) {
        warnings++;
        console.log(
          `   ⚠ ${col.name} : déclarée documentOnly mais INTROUVABLE dans la liste — à vérifier.`
        );
        continue;
      }

      await graph("POST", `/sites/${siteId}/lists/${list.id}/columns`, buildColumnBody(col));
      created++;
      console.log(`   + ${col.name} (${col.type}) créée`);
    }
    console.log("");
  }

  console.log(
    `Terminé : ${created} création(s), ${warnings} avertissement(s).` +
      (warnings > 0 ? " Relire les lignes ⚠ ci-dessus." : "")
  );
}

// ---------- Point d'entrée ----------

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "inspect" && mode !== "provision") {
    fail(
      "Usage :\n" +
        "  npm run sp:inspect     rapport de l'état réel (aucune écriture)\n" +
        "  npm run sp:provision   applique sharepoint-schema.json (créations uniquement)"
    );
  }

  const cfg = loadSettings();
  graphToken = await getGraphToken(cfg);
  const siteId = await getSiteId(cfg);

  if (mode === "inspect") {
    await inspect(siteId);
  } else {
    const schema = loadSchema();
    await provision(siteId, schema);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
