import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

// ============================================================================
//  POST /api/declare — Le résident CONNECTÉ déclare ses revenus d'un mois
// ----------------------------------------------------------------------------
//  Corps attendu : { month: 12, grossSalary: 1540, netSalary: 1540 }
//
//  Principes de sécurité :
//   - L'identité vient du jeton Static Web Apps (x-ms-client-principal).
//   - Le FedasilNumber est résolu côté serveur (e-mail -> liste resident).
//   - La CONTRIBUTION est TOUJOURS recalculée ici (jamais reçue du client).
//   - La communication structurée est générée ici (mois + FA + modulo 97).
//   - Le mois doit appartenir au trimestre en cours et ne pas être déjà déclaré.
//
//  Règle métier : si le mois est déjà déclaré, la requête CORRIGE la ligne
//  existante (nouveaux totaux, contribution recalculée, Paid inchangé).
//
//  Réponses : 201 créé · 200 corrigé · 400 montants/mois invalides ·
//             401 non authentifié · 404 compte non lié · 500 erreur générique
// ============================================================================

const TENANT_ID = process.env["TENANT_ID"];
const GRAPH_CLIENT_ID = process.env["GRAPH_CLIENT_ID"];
const GRAPH_CLIENT_SECRET = process.env["GRAPH_CLIENT_SECRET"];

const SP_SITE_HOSTNAME = process.env["SP_SITE_HOSTNAME"];
const SP_SITE_PATH = process.env["SP_SITE_PATH"];

const SP_RESIDENT_LIST_ID = process.env["SP_LIST_ID"];
const SP_EMAIL_FIELD = process.env["SP_EMAIL_FIELD"] ?? "Email";
const SP_RESIDENT_FA_FIELD =
  process.env["SP_RESIDENT_FA_FIELD"] ?? "FedasilNumber";

const SP_CUMUL_LIST_ID = process.env["SP_CUMUL_LIST_ID"];
const SP_CUMUL_LIST_NAME = process.env["SP_CUMUL_LIST_NAME"] ?? "KB-Cumul T4";

const SP_CUMUL_FA_FIELD = process.env["SP_CUMUL_FA_FIELD"] ?? "FedasilNumber";
const SP_MONTH_FIELD = process.env["SP_MONTH_FIELD"] ?? "Month";
const SP_NET_FIELD = process.env["SP_NET_FIELD"] ?? "NetSalary";
const SP_GROSS_FIELD = process.env["SP_GROSS_FIELD"] ?? "GrossSalary";
const SP_CONTRIB_FIELD = process.env["SP_CONTRIB_FIELD"] ?? "Contribution";
const SP_STRUCTCOM_FIELD =
  process.env["SP_STRUCTCOM_FIELD"] ?? "StructuredCom";

const SP_FA_IS_NUMBER =
  (process.env["SP_FA_IS_NUMBER"] ?? "false").toLowerCase() === "true";

const GENERIC_SERVER_ERROR =
  "Une erreur est survenue lors de l'envoi de votre déclaration.";

// Plafond de vraisemblance des montants saisis (garde-fou anti-erreur/abus)
const MAX_AMOUNT = 100000;

// ---------- Métier : calcul de la contribution ----------
// Tranches progressives appliquées au salaire NET (règles Fedasil) :
//   0 – 264,99 : 0 %  ·  265 – 999,99 : 35 %  ·  1000 – 1499,99 : 45 %  ·  1500+ : 50 %
// Formule validée contre les données réelles (ex. net 1569 -> 516,75).
// ⚠ Dupliquée dans Portail.tsx (aperçu en direct) : garder les deux synchronisées.
function calcContribution(net: number): number {
  const t2 = Math.max(0, Math.min(net, 1000) - 265) * 0.35;
  const t3 = Math.max(0, Math.min(net, 1500) - 1000) * 0.45;
  const t4 = Math.max(0, net - 1500) * 0.5;
  return Math.round((t2 + t3 + t4) * 100) / 100;
}

// ---------- Métier : communication structurée belge ----------
// Base 10 chiffres = mois (2) + "0" + 7 derniers chiffres du FA,
// + 2 chiffres de contrôle (base mod 97, convention 0 -> 97).
// Ex. FA00655210, mois 12 -> base 1200655210 -> +++120/0655/21074+++
function buildStructuredCom(fedasilNumber: string, month: number): string {
  const digits = fedasilNumber.replace(/\D/g, "");
  const base = `${String(month).padStart(2, "0")}0${digits.slice(-7)}`;
  const check = Number(base) % 97 || 97;
  const full = `${base}${String(check).padStart(2, "0")}`;
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7, 12)}+++`;
}

// ---------- Helpers (mêmes conventions que Me.ts) ----------

type ClientPrincipal = { userDetails?: string };
type SpFields = Record<string, unknown>;

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

function quarterFromListName(name: string): number | null {
  const m = /T\s*([1-4])/i.exec(name);
  return m ? Number(m[1]) : null;
}

async function getGraphToken(context: InvocationContext): Promise<string> {
  if (!TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    context.log("Config Graph manquante pour /api/declare.");
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
    context.log("Erreur token Graph (/api/declare), statut:", res.status);
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
    context.log("Erreur site (/api/declare), statut:", res.status);
    throw new Error("Impossible de récupérer le site SharePoint.");
  }
  return ((await res.json()) as { id: string }).id;
}

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
    context.log("Erreur résolution liste (/api/declare), statut:", res.status);
    throw new Error("Impossible de retrouver la liste des déclarations.");
  }
  const json = (await res.json()) as { value?: Array<{ id: string }> };
  return json.value?.[0]?.id ?? null;
}

function buildFilter(field: string, value: string, isNumber: boolean): string {
  if (isNumber) {
    const numeric = value.replace(/[^\d.-]/g, "");
    return `fields/${field} eq ${numeric || "0"}`;
  }
  return `fields/${field} eq '${value.replace(/'/g, "''")}'`;
}

async function queryItems(
  siteId: string,
  listId: string,
  filterClause: string,
  selectFields: string[],
  token: string,
  context: InvocationContext
): Promise<Array<{ id: string; fields: SpFields }>> {
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
    context.log("Erreur lecture liste (/api/declare), statut:", res.status);
    throw new Error("Impossible de lire les données.");
  }
  const json = (await res.json()) as {
    value?: Array<{ id?: string; fields?: SpFields }>;
  };
  return (json.value ?? [])
    .filter((it): it is { id: string; fields: SpFields } =>
      Boolean(it.id && it.fields)
    )
    .map((it) => ({ id: it.id, fields: it.fields }));
}

// Nettoie et valide un montant reçu du client.
function sanitizeAmount(v: unknown): number | null {
  const n =
    typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}

// ---------- Endpoint ----------

export async function Declare(
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

    // --- Validation du corps de requête ---
    let body: { month?: unknown; grossSalary?: unknown; netSalary?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return { status: 400, jsonBody: { message: "Requête invalide." } };
    }

    const month = Number(body.month);
    const gross = sanitizeAmount(body.grossSalary);
    const net = sanitizeAmount(body.netSalary);

    // Le mois doit être un des 3 mois du trimestre en cours.
    const quarter = quarterFromListName(SP_CUMUL_LIST_NAME);
    const allowedMonths =
      quarter !== null
        ? [quarter * 3 - 2, quarter * 3 - 1, quarter * 3]
        : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    if (
      !Number.isInteger(month) ||
      !allowedMonths.includes(month) ||
      gross === null ||
      net === null
    ) {
      return { status: 400, jsonBody: { message: "Montants ou mois invalides." } };
    }

    const email = principal.userDetails.trim().toLowerCase();
    context.log(`Déclaration mois ${month} pour: ${maskEmail(email)}`);

    const token = await getGraphToken(context);
    const siteId = await getSiteId(token, context);

    // --- E-mail -> FedasilNumber (jamais fourni par le client) ---
    const residentRows = await queryItems(
      siteId,
      SP_RESIDENT_LIST_ID,
      buildFilter(SP_EMAIL_FIELD, email, false),
      [SP_RESIDENT_FA_FIELD],
      token,
      context
    );
    const fedasilNumber = residentRows[0]
      ? String(residentRows[0].fields[SP_RESIDENT_FA_FIELD] ?? "")
      : "";

    if (!fedasilNumber) {
      return {
        status: 404,
        jsonBody: { message: "Aucune donnée trouvée pour ce compte." },
      };
    }

    // --- Liste du trimestre en cours ---
    let cumulListId: string | null = SP_CUMUL_LIST_ID ?? null;
    if (!cumulListId) {
      cumulListId = await findListIdByName(
        siteId,
        SP_CUMUL_LIST_NAME,
        token,
        context
      );
    }
    if (!cumulListId) {
      context.log("Liste du trimestre en cours introuvable.");
      return { status: 500, jsonBody: { message: GENERIC_SERVER_ERROR } };
    }

    // --- Calculs côté serveur (source de vérité) ---
    const contribution = calcContribution(net);
    const structuredCom = buildStructuredCom(fedasilNumber, month);

    // --- Déclaration existante ? -> CORRECTION (mise à jour de la ligne) ---
    // Règle métier : le résident peut corriger sa déclaration. Les nouveaux
    // totaux remplacent les anciens, la contribution est recalculée ;
    // le champ Paid n'est PAS modifié.
    const existing = await queryItems(
      siteId,
      cumulListId,
      `${buildFilter(SP_CUMUL_FA_FIELD, fedasilNumber, SP_FA_IS_NUMBER)} and fields/${SP_MONTH_FIELD} eq ${month}`,
      [SP_MONTH_FIELD],
      token,
      context
    );

    if (existing.length > 0) {
      const patchRes = await fetch(
        `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${cumulListId}/items/${existing[0].id}/fields`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            [SP_GROSS_FIELD]: gross,
            [SP_NET_FIELD]: net,
            [SP_CONTRIB_FIELD]: contribution,
            [SP_STRUCTCOM_FIELD]: structuredCom,
          }),
        }
      );
      if (!patchRes.ok) {
        context.log("Erreur correction déclaration, statut:", patchRes.status);
        return { status: 500, jsonBody: { message: GENERIC_SERVER_ERROR } };
      }
      return { status: 200, jsonBody: { ok: true, updated: true } };
    }

    // --- Sinon : création de l'élément SharePoint ---
    const createRes = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${cumulListId}/items`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            [SP_CUMUL_FA_FIELD]: SP_FA_IS_NUMBER
              ? Number(fedasilNumber.replace(/\D/g, ""))
              : fedasilNumber,
            [SP_MONTH_FIELD]: month,
            [SP_GROSS_FIELD]: gross,
            [SP_NET_FIELD]: net,
            [SP_CONTRIB_FIELD]: contribution,
            [SP_STRUCTCOM_FIELD]: structuredCom,
          },
        }),
      }
    );

    if (!createRes.ok) {
      context.log("Erreur création déclaration, statut:", createRes.status);
      return { status: 500, jsonBody: { message: GENERIC_SERVER_ERROR } };
    }

    // 201 : le frontend recharge /api/me pour afficher la nouvelle situation.
    return { status: 201, jsonBody: { ok: true } };
  } catch (error) {
    context.log("Erreur dans /api/declare:", error);
    return { status: 500, jsonBody: { message: GENERIC_SERVER_ERROR } };
  }
}

app.http("Declare", {
  route: "declare",
  methods: ["POST"],
  authLevel: "anonymous", // auth réelle gérée par Static Web Apps (route protégée)
  handler: Declare,
});
