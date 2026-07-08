import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

// ============================================================================
//  /api/me  —  Déclarations mensuelles du résident CONNECTÉ uniquement
// ----------------------------------------------------------------------------
//  Recherche en DEUX temps (sécurisée, côté serveur) :
//    1) e-mail connecté  -> FedasilNumber   (liste "resident")
//    2) FedasilNumber     -> TOUTES les lignes du trimestre (liste KB-Cumul),
//       triées par mois décroissant (la plus récente en premier).
//
//  Paramètre optionnel :  GET /api/me?quarter=previous
//    -> interroge la liste du trimestre précédent (SP_CUMUL_PREV_LIST_NAME).
//    Toute autre valeur (ou absence) = trimestre en cours.
//
//  Réponse 200 :
//    {
//      quarter: 4 | 3 | null,      // n° du trimestre, déduit du nom de liste
//      months: [                   // trié du mois le plus récent au plus ancien
//        { month: 12, netSalary: 1540, grossSalary: 1540,
//          contribution: 495, paid: null },
//        ...
//      ]
//    }
//    months peut être vide (aucune déclaration, ou liste du trimestre
//    précédent inexistante) : c'est au frontend d'afficher l'état adapté.
//
//  Sécurité :
//   - L'identité vient du jeton Static Web Apps (x-ms-client-principal),
//     JAMAIS d'un paramètre du navigateur.
//   - Le FedasilNumber est résolu ICI ; le navigateur ne choisit jamais
//     quelles données il reçoit.
//   - Aucune valeur sensible (montant, FedasilNumber) dans les logs.
// ============================================================================

// --- Graph / SharePoint ---
const TENANT_ID = process.env["TENANT_ID"];
const GRAPH_CLIENT_ID = process.env["GRAPH_CLIENT_ID"];
const GRAPH_CLIENT_SECRET = process.env["GRAPH_CLIENT_SECRET"];

const SP_SITE_HOSTNAME = process.env["SP_SITE_HOSTNAME"];
const SP_SITE_PATH = process.env["SP_SITE_PATH"];

// Étape 1 : liste "resident" (même liste que l'éligibilité) -> SP_LIST_ID
const SP_RESIDENT_LIST_ID = process.env["SP_LIST_ID"];
const SP_EMAIL_FIELD = process.env["SP_EMAIL_FIELD"] ?? "Email";
// Nom INTERNE de la colonne FedasilNumber dans la liste resident
const SP_RESIDENT_FA_FIELD =
  process.env["SP_RESIDENT_FA_FIELD"] ?? "FedasilNumber";

// Étape 2 : listes KB-Cumul (une liste PAR trimestre)
const SP_CUMUL_LIST_ID = process.env["SP_CUMUL_LIST_ID"];
const SP_CUMUL_LIST_NAME = process.env["SP_CUMUL_LIST_NAME"] ?? "KB-Cumul T4";
// Trimestre précédent : par nom uniquement (la liste change chaque trimestre)
const SP_CUMUL_PREV_LIST_NAME =
  process.env["SP_CUMUL_PREV_LIST_NAME"] ?? "KB-Cumul T3";

// Noms INTERNES des colonnes dans les listes KB-Cumul
const SP_CUMUL_FA_FIELD = process.env["SP_CUMUL_FA_FIELD"] ?? "FedasilNumber";
const SP_MONTH_FIELD = process.env["SP_MONTH_FIELD"] ?? "Month";
const SP_NET_FIELD = process.env["SP_NET_FIELD"] ?? "NetSalary";
const SP_GROSS_FIELD = process.env["SP_GROSS_FIELD"] ?? "GrossSalary";
const SP_CONTRIB_FIELD = process.env["SP_CONTRIB_FIELD"] ?? "Contribution";
const SP_PAID_FIELD = process.env["SP_PAID_FIELD"] ?? "Paid";

// FedasilNumber est-il une colonne de type Nombre dans SharePoint ?
const SP_FA_IS_NUMBER =
  (process.env["SP_FA_IS_NUMBER"] ?? "false").toLowerCase() === "true";

const GENERIC_SERVER_ERROR =
  "Une erreur est survenue lors du chargement de vos informations.";

// ---------- Types ----------

type ClientPrincipal = {
  identityProvider?: string;
  userId?: string;
  userDetails?: string;
  userRoles?: string[];
};

type MonthlyDeclaration = {
  month: number;
  netSalary: number | null;
  grossSalary: number | null;
  contribution: number | null;
  paid: number | null;
};

type SpFields = Record<string, unknown>;

// ---------- Helpers ----------

function maskEmail(email?: string): string {
  if (!email) return "(absent)";
  const [u, d] = email.split("@");
  if (!d) return "***";
  return `${u.slice(0, 1)}***@${d}`;
}

function getClientPrincipal(request: HttpRequest): ClientPrincipal | null {
  const header = request.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    return JSON.parse(
      Buffer.from(header, "base64").toString("utf-8")
    ) as ClientPrincipal;
  } catch {
    return null;
  }
}

// Convertit une valeur SharePoint (nombre, texte, vide) en nombre ou null.
function toNumberOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Extrait le n° de trimestre du nom de liste ("KB-Cumul T4" -> 4).
function quarterFromListName(name: string): number | null {
  const m = /T\s*([1-4])/i.exec(name);
  return m ? Number(m[1]) : null;
}

// ---------- Token Graph ----------

async function getGraphToken(context: InvocationContext): Promise<string> {
  if (!TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    context.log("Config Graph manquante pour /api/me.");
    throw new Error("Configuration serveur incomplète (Graph).");
  }
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID,
    client_secret: GRAPH_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    context.log("Erreur token Graph (/api/me), statut:", res.status);
    throw new Error("Impossible d'obtenir un jeton Microsoft Graph.");
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

async function getSiteId(
  token: string,
  context: InvocationContext
): Promise<string> {
  if (!SP_SITE_HOSTNAME || !SP_SITE_PATH) {
    throw new Error("Configuration SharePoint incomplète (site).");
  }
  const url = `https://graph.microsoft.com/v1.0/sites/${SP_SITE_HOSTNAME}:/${SP_SITE_PATH}?$select=id`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    context.log("Erreur site (/api/me), statut:", res.status);
    throw new Error("Impossible de récupérer le site SharePoint.");
  }
  return ((await res.json()) as { id: string }).id;
}

// Retrouve l'ID d'une liste par son nom d'affichage.
// Renvoie null si la liste n'existe pas (cas normal pour le trimestre
// précédent en tout début d'année, par exemple).
async function findListIdByName(
  siteId: string,
  displayName: string,
  token: string,
  context: InvocationContext
): Promise<string | null> {
  const name = displayName.replace(/'/g, "''");
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists` +
    `?$select=id,displayName&$filter=displayName eq '${name}'`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    context.log("Erreur résolution liste KB-Cumul, statut:", res.status);
    throw new Error("Impossible de retrouver la liste des déclarations.");
  }
  const json = (await res.json()) as { value?: Array<{ id: string }> };
  return json.value?.[0]?.id ?? null;
}

// Construit la clause de filtre (texte entre quotes, nombre sans quotes)
function buildFilter(field: string, value: string, isNumber: boolean): string {
  if (isNumber) {
    const numeric = value.replace(/[^\d.-]/g, "");
    return `fields/${field} eq ${numeric || "0"}`;
  }
  return `fields/${field} eq '${value.replace(/'/g, "''")}'`;
}

// Renvoie les "fields" du premier élément correspondant (ou null).
async function queryFirstItem(
  siteId: string,
  listId: string,
  filterClause: string,
  selectFields: string[],
  token: string,
  context: InvocationContext
): Promise<SpFields | null> {
  const items = await queryItems(
    siteId,
    listId,
    filterClause,
    selectFields,
    token,
    context
  );
  return items[0] ?? null;
}

// Renvoie les "fields" de TOUS les éléments correspondants.
async function queryItems(
  siteId: string,
  listId: string,
  filterClause: string,
  selectFields: string[],
  token: string,
  context: InvocationContext
): Promise<SpFields[]> {
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}` +
    `/items?$expand=fields($select=${selectFields.join(",")})` +
    `&$filter=${filterClause}&$top=50`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly",
    },
  });
  if (!res.ok) {
    context.log("Erreur lecture liste (/api/me), statut:", res.status);
    throw new Error("Impossible de lire les données.");
  }
  const json = (await res.json()) as {
    value?: Array<{ fields?: SpFields }>;
  };
  return (json.value ?? [])
    .map((it) => it.fields)
    .filter((f): f is SpFields => Boolean(f));
}

// ---------- Endpoint ----------

export async function Me(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const principal = getClientPrincipal(request);
    if (!principal || !principal.userDetails) {
      return { status: 401, jsonBody: { message: "Non authentifié." } };
    }
    if (!SP_RESIDENT_LIST_ID) {
      context.log("SP_LIST_ID (liste resident) manquant.");
      return { status: 500, jsonBody: { message: GENERIC_SERVER_ERROR } };
    }

    // Paramètre strictement borné : tout sauf "previous" = trimestre en cours.
    const wantPrevious = request.query.get("quarter") === "previous";

    const email = principal.userDetails.trim().toLowerCase();
    context.log(
      `Requête /api/me pour: ${maskEmail(email)} (quarter=${
        wantPrevious ? "previous" : "current"
      })`
    );

    const token = await getGraphToken(context);
    const siteId = await getSiteId(token, context);

    // --- Étape 1 : e-mail -> FedasilNumber (liste resident) ---
    const residentFields = await queryFirstItem(
      siteId,
      SP_RESIDENT_LIST_ID,
      buildFilter(SP_EMAIL_FIELD, email, false),
      [SP_RESIDENT_FA_FIELD],
      token,
      context
    );
    const fedasilNumber = residentFields
      ? String(residentFields[SP_RESIDENT_FA_FIELD] ?? "")
      : "";

    if (!fedasilNumber) {
      context.log("Aucun FedasilNumber pour", maskEmail(email));
      return {
        status: 404,
        jsonBody: { message: "Aucune donnée trouvée pour ce compte." },
      };
    }

    // --- Étape 2 : FedasilNumber -> déclarations du trimestre demandé ---
    const listName = wantPrevious ? SP_CUMUL_PREV_LIST_NAME : SP_CUMUL_LIST_NAME;
    const quarter = quarterFromListName(listName);

    // Trimestre en cours : l'ID explicite (SP_CUMUL_LIST_ID) a priorité.
    let cumulListId: string | null =
      !wantPrevious && SP_CUMUL_LIST_ID ? SP_CUMUL_LIST_ID : null;
    if (!cumulListId) {
      cumulListId = await findListIdByName(siteId, listName, token, context);
    }

    // Liste introuvable : réponse vide (le frontend affichera l'état adapté).
    if (!cumulListId) {
      context.log("Liste de trimestre introuvable (réponse vide).");
      return { status: 200, jsonBody: { quarter, months: [] } };
    }

    const rows = await queryItems(
      siteId,
      cumulListId,
      buildFilter(SP_CUMUL_FA_FIELD, fedasilNumber, SP_FA_IS_NUMBER),
      [SP_MONTH_FIELD, SP_NET_FIELD, SP_GROSS_FIELD, SP_CONTRIB_FIELD, SP_PAID_FIELD],
      token,
      context
    );

    // Une entrée par mois, triée du plus récent au plus ancien.
    // (En cas de doublon improbable sur un mois, la dernière ligne lue gagne.)
    const byMonth = new Map<number, MonthlyDeclaration>();
    for (const f of rows) {
      const month = toNumberOrNull(f[SP_MONTH_FIELD]);
      if (month === null) continue;
      byMonth.set(month, {
        month,
        netSalary: toNumberOrNull(f[SP_NET_FIELD]),
        grossSalary: toNumberOrNull(f[SP_GROSS_FIELD]),
        contribution: toNumberOrNull(f[SP_CONTRIB_FIELD]),
        paid: toNumberOrNull(f[SP_PAID_FIELD]),
      });
    }
    const months = [...byMonth.values()].sort((a, b) => b.month - a.month);

    return { status: 200, jsonBody: { quarter, months } };
  } catch (error) {
    context.log("Erreur dans /api/me:", error);
    return { status: 500, jsonBody: { message: GENERIC_SERVER_ERROR } };
  }
}

app.http("Me", {
  route: "me",
  methods: ["GET"],
  authLevel: "anonymous", // auth réelle gérée par Static Web Apps (route protégée)
  handler: Me,
});
