import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

// ============================================================================
//  /api/me  —  Montants du résident CONNECTÉ uniquement
// ----------------------------------------------------------------------------
//  Recherche en DEUX temps (sécurisée, côté serveur) :
//    1) e-mail connecté  -> FedasilNumber   (liste "resident")
//    2) FedasilNumber     -> NetSalary/GrossSalary/Contribution/Paid  (KB-Cumul T4)
//
//  Sécurité :
//   - L'identité vient du jeton Static Web Apps (en-tête x-ms-client-principal),
//     JAMAIS d'un paramètre du navigateur.
//   - Filtrage par personne fait ICI. Le navigateur ne reçoit que SES données.
//   - Données financières sensibles : aucune valeur (montant, FedasilNumber)
//     n'est écrite en clair dans les logs.
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
// Nom INTERNE de la colonne FedasilNumber dans la liste resident (vérifier la casse !)
const SP_RESIDENT_FA_FIELD =
  process.env["SP_RESIDENT_FA_FIELD"] ?? "FedasilNumber";

// Étape 2 : liste KB-Cumul T4
const SP_CUMUL_LIST_ID = process.env["SP_CUMUL_LIST_ID"];
const SP_CUMUL_LIST_NAME = process.env["SP_CUMUL_LIST_NAME"] ?? "KB-Cumul T4";
// Nom INTERNE de la colonne FedasilNumber dans KB-Cumul T4 (vérifier la casse !)
const SP_CUMUL_FA_FIELD = process.env["SP_CUMUL_FA_FIELD"] ?? "FedasilNumber";

// Colonnes de montants
const SP_NET_FIELD = process.env["SP_NET_FIELD"] ?? "NetSalary";
const SP_GROSS_FIELD = process.env["SP_GROSS_FIELD"] ?? "GrossSalary";
const SP_CONTRIB_FIELD = process.env["SP_CONTRIB_FIELD"] ?? "Contribution";
const SP_PAID_FIELD = process.env["SP_PAID_FIELD"] ?? "Paid";

// FedasilNumber est-il une colonne de type Nombre dans SharePoint ?
//  - colonne Texte  -> false (valeur entre quotes dans le filtre)  [défaut]
//  - colonne Nombre -> true  (valeur sans quotes)
const SP_FA_IS_NUMBER =
  (process.env["SP_FA_IS_NUMBER"] ?? "false").toLowerCase() === "true";

const GENERIC_SERVER_ERROR =
  "Une erreur est survenue lors du chargement de vos informations.";

function maskEmail(email?: string): string {
  if (!email) return "(absent)";
  const [u, d] = email.split("@");
  if (!d) return "***";
  return `${u.slice(0, 1)}***@${d}`;
}

// --- Identité authentifiée ---
type ClientPrincipal = { userDetails: string };

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

// --- Token Graph ---
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
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    context.log("Erreur site (/api/me), statut:", res.status);
    throw new Error("Impossible de récupérer le site SharePoint.");
  }
  return ((await res.json()) as { id: string }).id;
}

async function resolveCumulListId(
  siteId: string,
  token: string,
  context: InvocationContext
): Promise<string> {
  if (SP_CUMUL_LIST_ID) return SP_CUMUL_LIST_ID;
  const name = SP_CUMUL_LIST_NAME.replace(/'/g, "''");
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists` +
    `?$select=id,displayName&$filter=displayName eq '${name}'`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    context.log("Erreur résolution liste KB-Cumul T4, statut:", res.status);
    throw new Error("Impossible de retrouver la liste KB-Cumul T4.");
  }
  const id = ((await res.json()) as { value?: Array<{ id: string }> }).value?.[0]
    ?.id;
  if (!id) throw new Error(`Liste "${SP_CUMUL_LIST_NAME}" introuvable.`);
  return id;
}

// Construit la clause de filtre (texte entre quotes, nombre sans quotes)
function buildFilter(field: string, value: string, isNumber: boolean): string {
  if (isNumber) {
    const numeric = value.replace(/[^\d.-]/g, ""); // garde chiffres/séparateurs
    return `fields/${field} eq ${numeric || "0"}`;
  }
  return `fields/${field} eq '${value.replace(/'/g, "''")}'`;
}

// Requête générique : renvoie les "fields" du premier élément correspondant
async function queryFirstItem(
  siteId: string,
  listId: string,
  filterClause: string,
  selectFields: string[],
  token: string,
  context: InvocationContext
): Promise<Record<string, unknown> | null> {
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}` +
    `/items?$expand=fields($select=${selectFields.join(",")})` +
    `&$filter=${filterClause}`;
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
    value?: Array<{ fields?: Record<string, unknown> }>;
  };
  return json.value?.[0]?.fields ?? null;
}

type CumulData = {
  netSalary: string;
  grossSalary: string;
  contribution: string;
  paid: string;
};

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

    const email = principal.userDetails.trim().toLowerCase();
    context.log("Requête /api/me pour:", maskEmail(email));

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

    // --- Étape 2 : FedasilNumber -> montants (KB-Cumul T4) ---
    const cumulListId = await resolveCumulListId(siteId, token, context);
    const cumulFields = await queryFirstItem(
      siteId,
      cumulListId,
      buildFilter(SP_CUMUL_FA_FIELD, fedasilNumber, SP_FA_IS_NUMBER),
      [SP_NET_FIELD, SP_GROSS_FIELD, SP_CONTRIB_FIELD, SP_PAID_FIELD],
      token,
      context
    );

    if (!cumulFields) {
      context.log("Aucune ligne KB-Cumul T4 pour ce compte.");
      return {
        status: 404,
        jsonBody: { message: "Aucune donnée trouvée pour ce compte." },
      };
    }

    const asStr = (v: unknown) => (v === undefined || v === null ? "" : String(v));
    const data: CumulData = {
      netSalary: asStr(cumulFields[SP_NET_FIELD]),
      grossSalary: asStr(cumulFields[SP_GROSS_FIELD]),
      contribution: asStr(cumulFields[SP_CONTRIB_FIELD]),
      paid: asStr(cumulFields[SP_PAID_FIELD]),
    };

    return { status: 200, jsonBody: data };
  } catch (error) {
    context.log("Erreur dans /api/me:", error);
    return { status: 500, jsonBody: { message: GENERIC_SERVER_ERROR } };
  }
}

app.http("Me", {
  route: "me",
  methods: ["GET"],
  authLevel: "anonymous", // auth réelle gérée par Static Web Apps (route protégée + en-tête principal)
  handler: Me,
});
