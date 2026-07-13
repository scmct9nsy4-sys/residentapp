import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getActiveQuarter } from "../shared/quarterConfig";

// ============================================================================
//  POST /api/declare — Le résident CONNECTÉ déclare ses revenus d'un mois
// ----------------------------------------------------------------------------
//  Corps attendu : { month: 12, grossSalary: 1540, netSalary: 1540, fa?: "FA..." }
//    - fa est OBLIGATOIRE uniquement quand plusieurs profils sont liés au
//      compte connecté (familles partageant un e-mail). Il est VÉRIFIÉ côté
//      serveur : le fa doit appartenir aux profils de l'identité authentifiée.
//
//  RÉSOLUTION D'IDENTITÉ (identique à Me.ts — garder les deux synchronisées) :
//    1) oid du jeton (claim objectidentifier) -> lignes resident (EntraOid)
//    2) repli e-mail UNIQUEMENT si correspondance unique (+ auto-réparation :
//       l'oid est écrit sur la ligne au passage)
//
//  TRIMESTRE ACTIF (chantier §10.0, 13/7/2026) : le trimestre en cours n'est
//  PLUS câblé ici. Il est lu via getActiveQuarter() (module partagé
//  ../shared/quarterConfig) : liste SharePoint « Config » écrite par
//  « npm run sp:rotate », cache mémoire ~5 min, repli variables d'env.
//  Conséquence sur l'ORDRE des contrôles : la validation « le mois appartient
//  au trimestre en cours » a besoin du trimestre, donc du jeton Graph — elle
//  se fait désormais APRÈS l'authentification Graph (une pré-validation
//  1..12 sans réseau reste en tête, comportement inchangé pour le client).
//
//  Principes de sécurité :
//   - L'identité vient du jeton Static Web Apps (x-ms-client-principal).
//   - Le FedasilNumber actif est résolu/contrôlé côté serveur.
//   - La CONTRIBUTION est TOUJOURS recalculée ici (jamais reçue du client).
//   - La communication structurée est générée ici (mois + FA + modulo 97).
//   - Le mois doit appartenir au trimestre en cours.
//
//  Règle métier : si le mois est déjà déclaré, la requête CORRIGE la ligne
//  existante (nouveaux totaux, contribution recalculée, Paid inchangé).
//
//  Réponses : 201 créé · 200 corrigé · 400 montants/mois/profil invalides ·
//             401 non authentifié · 403 profil non autorisé ·
//             404 compte non lié · 500 erreur générique
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
const SP_RESIDENT_OID_FIELD =
  process.env["SP_RESIDENT_OID_FIELD"] ?? "EntraOid";
const SP_FIRSTNAME_FIELD = process.env["SP_FIRSTNAME_FIELD"] ?? "FirstName";
const SP_LASTNAME_FIELD = process.env["SP_LASTNAME_FIELD"] ?? "LastName";

// NB (13/7/2026, §10.0) : SP_CUMUL_LIST_ID / SP_CUMUL_LIST_NAME ne sont PLUS
// lues ici : elles servent de REPLI dans ../shared/quarterConfig si la liste
// « Config » est illisible.

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

const RELINK_REQUIRED_MESSAGE =
  "Votre compte doit être relié à votre profil. " +
  "Merci de refaire la pré-inscription avec votre numéro national.";

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

type ClientPrincipal = {
  userId?: string;
  userDetails?: string;
  claims?: Array<{ typ: string; val: string }>;
};
type SpFields = Record<string, unknown>;

type ResidentProfile = {
  itemId: string;
  fa: string;
  firstName: string;
  lastName: string;
};

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

// GUID Entra (oid) : 8-4-4-4-12 hexa.
const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Extrait l'oid Entra du principal.
// IMPORTANT : avec l'auth personnalisée SWA, le header x-ms-client-principal
// transmis à la fonction ne contient PAS toujours le tableau `claims` détaillé
// (celui-ci n'est visible que sur /.auth/me côté navigateur). En revanche,
// `userId` EST l'oid pour le fournisseur AAD. On lit donc, dans l'ordre :
//   1) le claim objectidentifier s'il est présent ;
//   2) sinon userId (oid AAD), validé comme GUID.
// En local (simulateur SWA), userId n'est pas un GUID -> null -> repli e-mail.
function getOid(principal: ClientPrincipal): string | null {
  const claim = principal.claims?.find(
    (c) =>
      c.typ ===
        "http://schemas.microsoft.com/identity/claims/objectidentifier" ||
      c.typ === "oid"
  );
  const fromClaim = claim?.val?.trim() ?? "";
  if (fromClaim !== "") return fromClaim;

  const fromUserId = principal.userId?.trim() ?? "";
  if (GUID_RE.test(fromUserId)) return fromUserId;

  return null;
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

// ⚠ PRÉREQUIS D'INDEXATION (13/7/2026) : ce $filter s'appuie sur des colonnes
// SharePoint INDEXÉES (Residents List : EntraOid, FedasilNumber, Title ;
// KB-Cumul : FedasilNumber). Le header « Prefer:
// HonorNonIndexedQueriesWarningMayFailRandomly » a été RETIRÉ : il autorisait
// le filtrage sur colonnes NON indexées, au prix d'un échec ALÉATOIRE dès que
// la liste dépasse 5000 éléments — soit, à ~1700 déclarations/mois, le 3e mois
// de CHAQUE trimestre, exactement quand les résidents déclarent le plus.
// Sans ce header, une colonne non indexée fait échouer la requête TOUT DE
// SUITE et pour tout le monde (panne franche, diagnostiquable) au lieu de
// tomber au hasard en production. Fail fast plutôt que fail random.
//
// ⚠ DÉPLOIEMENT : poser les index sur les listes AVANT de déployer ce code.
// Dans l'autre ordre, le portail casse immédiatement pour tous les résidents.
// Rappel : un index ne peut être créé que si la liste compte MOINS de 5000
// éléments (donc, pour une KB-Cumul, juste après la rotation trimestrielle).
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
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // Le seuil de vue de liste (5000) renvoie typiquement 400/403/503 : on le
    // signale explicitement pour ne PLUS jamais chercher pendant des heures.
    if (res.status === 400 || res.status === 403 || res.status === 503) {
      context.log(
        `Erreur lecture liste (/api/declare), statut: ${res.status} — CAUSE PROBABLE : ` +
          `colonne de filtre NON INDEXÉE sur une liste de plus de 5000 éléments. ` +
          `Vérifier les index SharePoint (Paramètres de la liste > Colonnes indexées).`
      );
    } else {
      context.log("Erreur lecture liste (/api/declare), statut:", res.status);
    }
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

// ---------- Résolution d'identité (identique à Me.ts) ----------

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

  if (email) {
    const byEmail = await findResidentProfiles(
      siteId,
      buildFilter(SP_EMAIL_FIELD, email, false),
      token,
      context
    );
    if (byEmail.length === 1) {
      context.log("Identité résolue par e-mail (repli, correspondance unique).");
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

    // --- Validation du corps de requête ---
    let body: {
      month?: unknown;
      grossSalary?: unknown;
      netSalary?: unknown;
      fa?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return { status: 400, jsonBody: { message: "Requête invalide." } };
    }

    const month = Number(body.month);
    const gross = sanitizeAmount(body.grossSalary);
    const net = sanitizeAmount(body.netSalary);
    const faRequested =
      typeof body.fa === "string" ? body.fa.trim() : "";

    // Pré-validation SANS réseau (mois plausible, montants valides). Le
    // contrôle « le mois appartient au trimestre EN COURS » vient plus bas :
    // depuis le §10.0, le trimestre actif est lu dans la liste Config, ce qui
    // demande le jeton Graph.
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      gross === null ||
      net === null
    ) {
      return { status: 400, jsonBody: { message: "Montants ou mois invalides." } };
    }

    context.log(`Déclaration mois ${month} pour: ${maskEmail(email)} (oid=${
      oid ? "présent" : "absent"
    })`);

    const token = await getGraphToken(context);
    const siteId = await getSiteId(token, context);

    // --- Trimestre actif (liste Config, cache ~5 min, repli env — §10.0) ---
    const activeQuarter = await getActiveQuarter(siteId, token, context);
    const quarter = activeQuarter.quarter;

    // Le mois doit être un des 3 mois du trimestre en cours.
    const allowedMonths =
      quarter !== null
        ? [quarter * 3 - 2, quarter * 3 - 1, quarter * 3]
        : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    if (!allowedMonths.includes(month)) {
      return { status: 400, jsonBody: { message: "Montants ou mois invalides." } };
    }

    // --- Identité -> profil(s) resident (jamais fourni librement par le client) ---
    const resolved = await resolveProfiles(oid, email, siteId, token, context);
    if ("error" in resolved) return resolved.error;
    const profiles = resolved.profiles;

    // Profil actif : obligatoire et VÉRIFIÉ quand plusieurs profils existent.
    let active: ResidentProfile | undefined;
    if (faRequested) {
      active = profiles.find((p) => p.fa === faRequested);
      if (!active) {
        context.log("Champ fa refusé (profil non lié à cette identité).");
        return { status: 403, jsonBody: { message: "Profil non autorisé." } };
      }
    } else if (profiles.length === 1) {
      active = profiles[0];
    } else {
      return {
        status: 400,
        jsonBody: { message: "Profil manquant pour cette déclaration." },
      };
    }
    const fedasilNumber = active.fa;

    // --- Liste du trimestre en cours (ID écrit dans Config, sinon par nom) ---
    let cumulListId: string | null = activeQuarter.listId;
    if (!cumulListId) {
      cumulListId = await findListIdByName(
        siteId,
        activeQuarter.listName,
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
    //
    // ⚠ CORRECTIF DU 13/7/2026 (bug de production) : ce filtre portait AUSSI
    // sur le mois (« … and fields/Month eq 4 »). Or `Month` n'est PAS une
    // colonne indexée — et depuis le retrait du header
    // HonorNonIndexedQueriesWarningMayFailRandomly, Graph refuse par un 400
    // TOUT $filter touchant une colonne non indexée, MÊME sur une petite liste
    // (le seuil des 5000 n'est pas la condition du refus : c'est seulement le
    // moment où l'ancien header cessait de masquer le problème). Résultat :
    // /api/declare tombait en 500 à CHAQUE déclaration.
    //
    // Correction : on filtre sur le SEUL FedasilNumber (indexé), ce qui borne
    // déjà la requête à 3 lignes au maximum (un résident n'a que 3 mois dans
    // un trimestre), et on sélectionne le mois EN JAVASCRIPT. Aucun index
    // supplémentaire à créer ni à maintenir en production — et rien à oublier
    // lors de la réplication sur le tenant Fedasil.
    const residentRows = await queryItems(
      siteId,
      cumulListId,
      buildFilter(SP_CUMUL_FA_FIELD, fedasilNumber, SP_FA_IS_NUMBER),
      [SP_MONTH_FIELD],
      token,
      context
    );

    const existing = residentRows.filter((row) => {
      const raw = row.fields[SP_MONTH_FIELD];
      const rowMonth =
        typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
      return rowMonth === month;
    });

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
