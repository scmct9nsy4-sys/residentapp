import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

// ============================================================================
//  /api/me  —  Déclarations mensuelles du résident CONNECTÉ uniquement
// ----------------------------------------------------------------------------
//  RÉSOLUTION D'IDENTITÉ (nouvelle, robuste) :
//    1) oid du jeton (claim objectidentifier, disponible grâce à l'auth
//       personnalisée SWA) -> lignes de la liste "resident" (EntraOid).
//    2) REPLI transitoire : si aucun oid stocké ne correspond, matching par
//       e-mail — UNIQUEMENT si l'e-mail correspond à EXACTEMENT UNE ligne
//       (jamais en cas d'ambiguïté familiale). En cas de succès, l'oid est
//       écrit sur la ligne au passage (auto-réparation, non bloquant).
//
//  FAMILLES (plusieurs personnes partagent le même e-mail = même compte
//  invité = même oid, mais des FA différents) :
//    - plusieurs lignes trouvées SANS paramètre fa
//        -> 200 { needsProfile: true, profiles: [{fa, firstName, lastName}] }
//        (le frontend affiche un sélecteur de profil)
//    - GET /api/me?fa=FA00655210 : le serveur VÉRIFIE que ce FA appartient
//      aux lignes liées à l'identité authentifiée (sinon 403). Le navigateur
//      ne choisit que parmi SES profils, jamais librement.
//
//  Paramètres optionnels :
//    ?quarter=previous  -> liste du trimestre précédent (inchangé)
//    ?fa=<FA>           -> profil actif (obligatoire si plusieurs profils)
//
//  Réponse 200 (profil résolu) :
//    {
//      quarter: 4 | 3 | null,
//      months: [ { month, netSalary, grossSalary, contribution, paid,
//                  structuredCom }, ... ],       // trié mois décroissant
//      payment: { iban, beneficiary } | null,
//      profile: { fa, firstName, lastName },     // profil actif
//      profiles: [ ... ]                         // présent si plusieurs
//    }
//
//  Sécurité :
//   - L'identité vient du jeton Static Web Apps (x-ms-client-principal),
//     JAMAIS d'un paramètre du navigateur.
//   - Le FedasilNumber actif est résolu/contrôlé ICI.
//   - Aucune valeur sensible (montant, FA, NN) dans les logs.
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
// Noms INTERNES des colonnes de la liste resident
const SP_RESIDENT_FA_FIELD =
  process.env["SP_RESIDENT_FA_FIELD"] ?? "FedasilNumber";
const SP_RESIDENT_OID_FIELD =
  process.env["SP_RESIDENT_OID_FIELD"] ?? "EntraOid";
const SP_FIRSTNAME_FIELD = process.env["SP_FIRSTNAME_FIELD"] ?? "FirstName";
const SP_LASTNAME_FIELD = process.env["SP_LASTNAME_FIELD"] ?? "LastName";

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
const SP_STRUCTCOM_FIELD =
  process.env["SP_STRUCTCOM_FIELD"] ?? "StructuredCom";

// --- Paiement (affiché sur le portail ; si absent, la section paiement
// n'apparaît tout simplement pas côté frontend) ---
const PAYMENT_IBAN = process.env["PAYMENT_IBAN"] ?? "";
const PAYMENT_BENEFICIARY = process.env["PAYMENT_BENEFICIARY"] ?? "";

// FedasilNumber est-il une colonne de type Nombre dans SharePoint ?
const SP_FA_IS_NUMBER =
  (process.env["SP_FA_IS_NUMBER"] ?? "false").toLowerCase() === "true";

const GENERIC_SERVER_ERROR =
  "Une erreur est survenue lors du chargement de vos informations.";

// Cas famille sans liaison oid (plusieurs lignes pour un même e-mail, aucune
// reliée) : impossible de savoir de qui il s'agit -> il faut refaire la
// pré-inscription (avec le numéro national), qui écrit la liaison.
const RELINK_REQUIRED_MESSAGE =
  "Votre compte doit être relié à votre profil. " +
  "Merci de refaire la pré-inscription avec votre numéro national.";

// ---------- Types ----------

type ClientPrincipal = {
  identityProvider?: string;
  userId?: string;
  userDetails?: string;
  userRoles?: string[];
  // Disponible avec l'auth personnalisée SWA (plan Standard).
  claims?: Array<{ typ: string; val: string }>;
};

type MonthlyDeclaration = {
  month: number;
  netSalary: number | null;
  grossSalary: number | null;
  contribution: number | null;
  paid: number | null;
  structuredCom: string | null; // communication structurée du virement (+++...+++)
};

type ResidentProfile = {
  itemId: string; // ID de l'élément SharePoint (pour l'auto-réparation oid)
  fa: string;
  firstName: string;
  lastName: string;
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

// Extrait l'oid Entra des claims du jeton (auth personnalisée uniquement ;
// renvoie null en local avec le simulateur SWA -> repli e-mail).
function getOid(principal: ClientPrincipal): string | null {
  const claim = principal.claims?.find(
    (c) =>
      c.typ ===
        "http://schemas.microsoft.com/identity/claims/objectidentifier" ||
      c.typ === "oid"
  );
  const val = claim?.val?.trim() ?? "";
  return val !== "" ? val : null;
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

// Renvoie id + fields de TOUS les éléments correspondants.
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
    context.log("Erreur lecture liste (/api/me), statut:", res.status);
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

// ---------- Résolution d'identité (liste resident) ----------

function toProfile(item: { id: string; fields: SpFields }): ResidentProfile | null {
  const fa = String(item.fields[SP_RESIDENT_FA_FIELD] ?? "").trim();
  if (!fa) return null;
  return {
    itemId: item.id,
    fa,
    firstName: String(item.fields[SP_FIRSTNAME_FIELD] ?? "").trim(),
    lastName: String(item.fields[SP_LASTNAME_FIELD] ?? "").trim(),
  };
}

async function findResidentProfiles(
  siteId: string,
  filterClause: string,
  token: string,
  context: InvocationContext
): Promise<ResidentProfile[]> {
  const items = await queryItems(
    siteId,
    SP_RESIDENT_LIST_ID as string,
    filterClause,
    [SP_RESIDENT_FA_FIELD, SP_FIRSTNAME_FIELD, SP_LASTNAME_FIELD],
    token,
    context
  );
  return items
    .map(toProfile)
    .filter((p): p is ResidentProfile => p !== null);
}

// Auto-réparation : écrit l'oid sur la ligne resident lorsque le matching a
// dû passer par le repli e-mail. NON BLOQUANT.
async function writeOidOnResident(
  siteId: string,
  itemId: string,
  oid: string,
  token: string,
  context: InvocationContext
): Promise<void> {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${SP_RESIDENT_LIST_ID}/items/${itemId}/fields`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ [SP_RESIDENT_OID_FIELD]: oid }),
      }
    );
    context.log(
      res.ok
        ? "Auto-réparation : oid écrit sur la ligne resident."
        : `Auto-réparation oid échouée (non bloquant), statut: ${res.status}`
    );
  } catch (error) {
    context.log("Auto-réparation oid : exception (non bloquant):", error);
  }
}

// Résout les profils du compte connecté : oid d'abord, repli e-mail unique.
// Renvoie { profiles } ou { error } (réponse HTTP prête à renvoyer).
async function resolveProfiles(
  oid: string | null,
  email: string,
  siteId: string,
  token: string,
  context: InvocationContext
): Promise<
  { profiles: ResidentProfile[] } | { error: HttpResponseInit }
> {
  let profiles: ResidentProfile[] = [];

  // 1) Matching par oid (voie normale en production).
  if (oid) {
    profiles = await findResidentProfiles(
      siteId,
      buildFilter(SP_RESIDENT_OID_FIELD, oid, false),
      token,
      context
    );
    if (profiles.length > 0) {
      context.log(`Identité résolue par oid (${profiles.length} profil(s)).`);
      return { profiles };
    }
  }

  // 2) Repli transitoire par e-mail — UNIQUEMENT si correspondance unique.
  if (email) {
    const byEmail = await findResidentProfiles(
      siteId,
      buildFilter(SP_EMAIL_FIELD, email, false),
      token,
      context
    );
    if (byEmail.length === 1) {
      context.log("Identité résolue par e-mail (repli, correspondance unique).");
      // Auto-réparation : au fil des connexions, tout le monde migre vers l'oid.
      if (oid) {
        await writeOidOnResident(
          siteId,
          byEmail[0].itemId,
          oid,
          token,
          context
        );
      }
      return { profiles: byEmail };
    }
    if (byEmail.length > 1) {
      // Famille sans liaison oid : ambiguïté irrésoluble sans le NN.
      context.log(
        "E-mail partagé sans liaison oid : re-pré-inscription requise."
      );
      return {
        error: {
          status: 404,
          jsonBody: { message: RELINK_REQUIRED_MESSAGE },
        },
      };
    }
  }

  context.log("Aucun profil resident pour cette identité.");
  return {
    error: {
      status: 404,
      jsonBody: { message: "Aucune donnée trouvée pour ce compte." },
    },
  };
}

// ---------- Endpoint ----------

export async function Me(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const principal = getClientPrincipal(request);
    if (!principal) {
      return { status: 401, jsonBody: { message: "Non authentifié." } };
    }
    const oid = getOid(principal);
    const email = (principal.userDetails ?? "").trim().toLowerCase();
    if (!oid && !email) {
      return { status: 401, jsonBody: { message: "Non authentifié." } };
    }
    if (!SP_RESIDENT_LIST_ID) {
      context.log("SP_LIST_ID (liste resident) manquant.");
      return { status: 500, jsonBody: { message: GENERIC_SERVER_ERROR } };
    }

    // Paramètres strictement bornés.
    const wantPrevious = request.query.get("quarter") === "previous";
    const faParam = (request.query.get("fa") ?? "").trim();

    context.log(
      `Requête /api/me pour: ${maskEmail(email)} (oid=${
        oid ? "présent" : "absent"
      }, quarter=${wantPrevious ? "previous" : "current"})`
    );

    const token = await getGraphToken(context);
    const siteId = await getSiteId(token, context);

    // --- Étape 1 : identité -> profil(s) resident ---
    const resolved = await resolveProfiles(oid, email, siteId, token, context);
    if ("error" in resolved) return resolved.error;
    const profiles = resolved.profiles;

    const publicProfiles = profiles.map(({ fa, firstName, lastName }) => ({
      fa,
      firstName,
      lastName,
    }));

    // Plusieurs profils (famille) sans choix explicite -> sélecteur côté front.
    if (profiles.length > 1 && !faParam) {
      return {
        status: 200,
        jsonBody: { needsProfile: true, profiles: publicProfiles },
      };
    }

    // Profil actif : le fa demandé DOIT appartenir aux profils de l'identité.
    const active = faParam
      ? profiles.find((p) => p.fa === faParam)
      : profiles[0];
    if (!active) {
      context.log("Paramètre fa refusé (profil non lié à cette identité).");
      return { status: 403, jsonBody: { message: "Profil non autorisé." } };
    }
    const fedasilNumber = active.fa;

    // --- Étape 2 : FedasilNumber -> déclarations du trimestre demandé ---
    const listName = wantPrevious ? SP_CUMUL_PREV_LIST_NAME : SP_CUMUL_LIST_NAME;
    const quarter = quarterFromListName(listName);

    // Trimestre en cours : l'ID explicite (SP_CUMUL_LIST_ID) a priorité.
    let cumulListId: string | null =
      !wantPrevious && SP_CUMUL_LIST_ID ? SP_CUMUL_LIST_ID : null;
    if (!cumulListId) {
      cumulListId = await findListIdByName(siteId, listName, token, context);
    }

    const profileBlock = {
      fa: active.fa,
      firstName: active.firstName,
      lastName: active.lastName,
    };
    const profilesBlock = profiles.length > 1 ? publicProfiles : undefined;

    // Liste introuvable : réponse vide (le frontend affichera l'état adapté).
    if (!cumulListId) {
      context.log("Liste de trimestre introuvable (réponse vide).");
      return {
        status: 200,
        jsonBody: {
          quarter,
          months: [],
          profile: profileBlock,
          profiles: profilesBlock,
        },
      };
    }

    const rows = await queryItems(
      siteId,
      cumulListId,
      buildFilter(SP_CUMUL_FA_FIELD, fedasilNumber, SP_FA_IS_NUMBER),
      [
        SP_MONTH_FIELD,
        SP_NET_FIELD,
        SP_GROSS_FIELD,
        SP_CONTRIB_FIELD,
        SP_PAID_FIELD,
        SP_STRUCTCOM_FIELD,
      ],
      token,
      context
    );

    // Une entrée par mois, triée du plus récent au plus ancien.
    // (En cas de doublon improbable sur un mois, la dernière ligne lue gagne.)
    const byMonth = new Map<number, MonthlyDeclaration>();
    for (const { fields: f } of rows) {
      const month = toNumberOrNull(f[SP_MONTH_FIELD]);
      if (month === null) continue;
      const rawCom = f[SP_STRUCTCOM_FIELD];
      byMonth.set(month, {
        month,
        netSalary: toNumberOrNull(f[SP_NET_FIELD]),
        grossSalary: toNumberOrNull(f[SP_GROSS_FIELD]),
        contribution: toNumberOrNull(f[SP_CONTRIB_FIELD]),
        paid: toNumberOrNull(f[SP_PAID_FIELD]),
        structuredCom:
          typeof rawCom === "string" && rawCom.trim() !== ""
            ? rawCom.trim()
            : null,
      });
    }
    const months = [...byMonth.values()].sort((a, b) => b.month - a.month);

    // Configuration de paiement (IBAN institutionnel + bénéficiaire).
    // Absente ou incomplète -> null : le portail masque la section paiement.
    const payment =
      PAYMENT_IBAN && PAYMENT_BENEFICIARY
        ? { iban: PAYMENT_IBAN, beneficiary: PAYMENT_BENEFICIARY }
        : null;

    return {
      status: 200,
      jsonBody: {
        quarter,
        months,
        payment,
        profile: profileBlock,
        profiles: profilesBlock,
      },
    };
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
