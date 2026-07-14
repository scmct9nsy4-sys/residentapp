import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getActiveQuarter } from "../shared/quarterConfig";

// ============================================================================
//  /api/me  —  Déclarations mensuelles du résident CONNECTÉ uniquement
// ----------------------------------------------------------------------------
//  RÉSOLUTION D'IDENTITÉ :
//    1) oid du jeton (claim objectidentifier) -> liste "resident" (EntraOid).
//    2) REPLI transitoire par e-mail si correspondance UNIQUE (auto-réparation
//       de l'oid au passage, non bloquant).
//
//  FAMILLES : plusieurs personnes partagent le même compte invité (même oid,
//  FA différents) -> { needsProfile: true, profiles: [...] } ; le paramètre
//  ?fa=<FA> est VÉRIFIÉ serveur (403 si le FA n'appartient pas à l'identité).
//
//  TRIMESTRE ACTIF (§10.0, 13/7/2026) : lu via getActiveQuarter()
//  (liste SharePoint « Config », cache 5 min, repli variables d'env).
//
//  HISTORIQUE MULTI-TRIMESTRES (§10.0, 14/7/2026) — NOUVEAU :
//    Le résident consulte une FENÊTRE DE 4 TRIMESTRES (courant compris) :
//      - trimestre COURANT  -> lu dans KB-Cumul (là où l'on écrit : fraîcheur
//        immédiate ; lire Soldes ferait disparaître une déclaration jusqu'à la
//        prochaine synchro) ;
//      - trimestres ANTÉRIEURS -> lus dans « Soldes » (mémoire permanente,
//        insensible aux rotations, §5.20).
//
//    ⚠ POURQUOI EXACTEMENT 4 : la communication structurée encode le mois et
//    le FA, mais PAS l'année (§5.12). Sur 4 trimestres glissants, chaque mois
//    n'apparaît qu'UNE fois -> aucun paiement ambigu. Au 5e trimestre, avril
//    2025 et avril 2026 porteraient la MÊME communication. La constante
//    HISTORY_QUARTERS ne pourra augmenter qu'une fois l'année réglée dans la
//    communication structurée.
//
//    ⚠ LECTURE DE SOLDES : $filter sur le SEUL FedasilNumber (colonne INDEXÉE,
//    §5.20) ; l'année et le trimestre sont sélectionnés EN CODE. C'est la leçon
//    de la panne du 13/7 sur Declare.ts (filtre sur la colonne Month non
//    indexée -> 400 -> 500) : on SUPPRIME la dépendance à l'index au lieu de la
//    satisfaire — un index de moins à créer, à vérifier, et à ne pas oublier
//    lors de la réplication production.
//
//  Paramètres optionnels :
//    ?fa=<FA>                  -> profil actif (obligatoire si plusieurs)
//    ?quarter=<1-4>&year=<AAAA>-> trimestre demandé (DOIT être dans la fenêtre)
//    ?quarter=previous         -> alias historique (trimestre précédent)
//
//  Réponse 200 (profil résolu) :
//    {
//      quarter: 1..4 | null,
//      year: number | null,
//      archived: boolean,                 // true = lu dans Soldes
//      quarters: [ { quarter, year } ],   // fenêtre, du + récent au + ancien
//      months: [ { month, netSalary, grossSalary, contribution, paid,
//                  structuredCom } ],     // trié mois décroissant
//      payment: { iban, beneficiary } | null,
//      profile: { fa, firstName, lastName },
//      profiles: [ ... ]                  // présent si plusieurs
//    }
//
//  Sécurité :
//   - Identité issue du jeton Static Web Apps (x-ms-client-principal) UNIQUEMENT.
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

// Étape 2 : listes KB-Cumul (une liste PAR trimestre).
// NB (§10.0) : SP_CUMUL_LIST_NAME / SP_CUMUL_LIST_ID / SP_CUMUL_PREV_LIST_NAME
// ne sont PLUS lues ici : elles servent de REPLI dans ../shared/quarterConfig.

// Noms INTERNES des colonnes dans les listes KB-Cumul
const SP_CUMUL_FA_FIELD = process.env["SP_CUMUL_FA_FIELD"] ?? "FedasilNumber";
const SP_MONTH_FIELD = process.env["SP_MONTH_FIELD"] ?? "Month";
const SP_NET_FIELD = process.env["SP_NET_FIELD"] ?? "NetSalary";
const SP_GROSS_FIELD = process.env["SP_GROSS_FIELD"] ?? "GrossSalary";
const SP_CONTRIB_FIELD = process.env["SP_CONTRIB_FIELD"] ?? "Contribution";
const SP_PAID_FIELD = process.env["SP_PAID_FIELD"] ?? "Paid";
const SP_STRUCTCOM_FIELD =
  process.env["SP_STRUCTCOM_FIELD"] ?? "StructuredCom";

// Étape 2bis (NOUVEAU) : liste « Soldes » — mémoire permanente (§5.20).
// Résolue par NOM par défaut (aucune variable à créer) ; un ID peut être
// fourni pour économiser la résolution.
const SP_SOLDES_LIST_NAME = process.env["SP_SOLDES_LIST_NAME"] ?? "Soldes";
const SP_SOLDES_LIST_ID = process.env["SP_SOLDES_LIST_ID"]; // optionnel

// Noms INTERNES des colonnes de la liste Soldes (§5.20).
const SP_SOLDES_FA_FIELD =
  process.env["SP_SOLDES_FA_FIELD"] ?? "FedasilNumber";
const SP_SOLDES_YEAR_FIELD = process.env["SP_SOLDES_YEAR_FIELD"] ?? "Year";
const SP_SOLDES_MONTH_FIELD = process.env["SP_SOLDES_MONTH_FIELD"] ?? "Month";

// --- Paiement (affiché sur le portail ; si absent, la section paiement
// n'apparaît tout simplement pas côté frontend) ---
const PAYMENT_IBAN = process.env["PAYMENT_IBAN"] ?? "";
const PAYMENT_BENEFICIARY = process.env["PAYMENT_BENEFICIARY"] ?? "";

// FedasilNumber est-il une colonne de type Nombre dans SharePoint ?
const SP_FA_IS_NUMBER =
  (process.env["SP_FA_IS_NUMBER"] ?? "false").toLowerCase() === "true";

// ⚠ Fenêtre d'historique. NE PAS AUGMENTER sans avoir d'abord réglé l'année
// dans la communication structurée (§5.12) : voir l'en-tête de ce fichier.
const HISTORY_QUARTERS = 4;

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

/** Un trimestre de la fenêtre d'historique. */
type QuarterRef = {
  quarter: number;
  year: number;
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

// GUID Entra (oid) : 8-4-4-4-12 hexa.
const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Extrait l'oid Entra du principal.
// IMPORTANT : avec l'auth personnalisée SWA, le header x-ms-client-principal
// transmis à la fonction ne contient PAS toujours le tableau `claims` détaillé.
// En revanche, `userId` EST l'oid pour le fournisseur AAD. On lit donc :
//   1) le claim objectidentifier s'il est présent ;
//   2) sinon userId (oid AAD), validé comme GUID.
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

// Convertit une valeur SharePoint (nombre, texte, vide) en nombre ou null.
function toNumberOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Trimestre d'un mois (1-12) : 1..3 -> 1, 4..6 -> 2, etc.
function quarterOfMonth(month: number): number {
  return Math.ceil(month / 3);
}

// Trimestre précédent, avec bouclage d'année (T1 2026 -> T4 2025).
function previousQuarter(ref: QuarterRef): QuarterRef {
  return ref.quarter === 1
    ? { quarter: 4, year: ref.year - 1 }
    : { quarter: ref.quarter - 1, year: ref.year };
}

// Fenêtre d'historique : le trimestre courant puis les précédents,
// du plus récent au plus ancien.
function buildWindow(current: QuarterRef, size: number): QuarterRef[] {
  const window: QuarterRef[] = [current];
  for (let i = 1; i < size; i++) {
    window.push(previousQuarter(window[i - 1]));
  }
  return window;
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
// Renvoie null si la liste n'existe pas.
// NB : ce $filter porte sur displayName du point de terminaison /lists (les
// listes elles-mêmes, pas leurs éléments) : aucun enjeu d'index ni de seuil.
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
    context.log("Erreur résolution de liste, statut:", res.status);
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
//
// ⚠ PRÉREQUIS D'INDEXATION (§6.1, RÈGLE CORRIGÉE le 13/7/2026) : Graph refuse
// un $filter sur colonne NON INDEXÉE IMMÉDIATEMENT (400), quelle que soit la
// taille de la liste — le seuil des 5000 n'est PAS la condition du refus.
// TOUTE colonne apparaissant dans un $filter doit donc être indexée, ou ne pas
// apparaître dans le filtre. Colonnes indexées utilisées ici :
//   Residents List : EntraOid, FedasilNumber, Title
//   KB-Cumul       : FedasilNumber
//   Soldes         : FedasilNumber
// Le header « Prefer: HonorNonIndexedQueriesWarningMayFailRandomly » a été
// RETIRÉ le 13/7 : fail fast plutôt que fail random.
//
// ⚠ DÉPLOIEMENT : poser les index sur les listes AVANT de déployer ce code.
// Dans l'autre ordre, le portail casse immédiatement pour tous les résidents.
//
// PAGINATION (14/7/2026, §10.0) : la lecture suit désormais @odata.nextLink.
// Indispensable pour la liste Soldes : un résident y accumule ~12 lignes par
// an, ce qui aurait dépassé l'ancien $top=50 dès la 5e année — et TRONQUÉ
// silencieusement son historique. Sans effet sur KB-Cumul (<= 3 lignes par
// résident et par trimestre).
async function queryItems(
  siteId: string,
  listId: string,
  filterClause: string,
  selectFields: string[],
  token: string,
  context: InvocationContext
): Promise<Array<{ id: string; fields: SpFields }>> {
  const out: Array<{ id: string; fields: SpFields }> = [];

  let url: string | null =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}` +
    `/items?$expand=fields($select=${selectFields.join(",")})` +
    `&$filter=${filterClause}&$top=200`;

  // Garde-fou : jamais de boucle infinie sur une pagination anormale.
  const MAX_PAGES = 25;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // Une colonne de filtre non indexée renvoie typiquement 400/403/503 :
      // on le signale explicitement pour ne PLUS jamais chercher des heures.
      if (res.status === 400 || res.status === 403 || res.status === 503) {
        context.log(
          `Erreur lecture liste (/api/me), statut: ${res.status} — CAUSE PROBABLE : ` +
            `colonne de filtre NON INDEXÉE (Graph refuse le $filter immédiatement, ` +
            `même sur une petite liste). Vérifier les index SharePoint ` +
            `(Paramètres de la liste > Colonnes indexées) — « npm run sp:provision » les liste.`
        );
      } else {
        context.log("Erreur lecture liste (/api/me), statut:", res.status);
      }
      throw new Error("Impossible de lire les données.");
    }

    const json = (await res.json()) as {
      value?: Array<{ id?: string; fields?: SpFields }>;
      "@odata.nextLink"?: string;
    };

    for (const it of json.value ?? []) {
      if (it.id && it.fields) out.push({ id: it.id, fields: it.fields });
    }

    url = json["@odata.nextLink"] ?? null;
  }

  return out;
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

// ---------- Lecture des déclarations ----------

// Transforme un lot de lignes (KB-Cumul OU Soldes) en déclarations mensuelles,
// triées du mois le plus récent au plus ancien.
// `keepMonth` permet de ne garder que les mois d'un trimestre donné (Soldes
// contient TOUS les mois de TOUTES les années d'un résident).
function toMonths(
  rows: Array<{ fields: SpFields }>,
  monthField: string,
  keepMonth: (month: number, fields: SpFields) => boolean
): MonthlyDeclaration[] {
  // Une entrée par mois. (En cas de doublon improbable, la dernière ligne lue
  // gagne — comportement inchangé.)
  const byMonth = new Map<number, MonthlyDeclaration>();

  for (const { fields: f } of rows) {
    const month = toNumberOrNull(f[monthField]);
    if (month === null || month < 1 || month > 12) continue;
    if (!keepMonth(month, f)) continue;

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

  return [...byMonth.values()].sort((a, b) => b.month - a.month);
}

// Trimestre COURANT -> KB-Cumul (source d'écriture : fraîcheur immédiate).
async function readCurrentQuarter(
  siteId: string,
  listId: string,
  fedasilNumber: string,
  token: string,
  context: InvocationContext
): Promise<MonthlyDeclaration[]> {
  const rows = await queryItems(
    siteId,
    listId,
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
  // Une liste KB-Cumul ne contient QUE son trimestre : aucun tri à faire.
  return toMonths(rows, SP_MONTH_FIELD, () => true);
}

// Trimestre ARCHIVÉ -> Soldes (mémoire permanente, §5.20).
//
// ⚠ Le $filter porte sur le SEUL FedasilNumber (colonne indexée). L'année et
// le trimestre sont sélectionnés EN CODE : Year et Quarter sont pourtant
// indexées, mais chaque colonne ajoutée à un filtre est un index de plus à ne
// pas oublier de poser sur le tenant Fedasil — et un $filter composé de plus à
// voir tomber en 400. Le volume ne le justifie pas : un résident a ~12 lignes
// Soldes par an. On supprime la dépendance au lieu de la satisfaire (§11ter).
async function readArchivedQuarter(
  siteId: string,
  soldesListId: string,
  fedasilNumber: string,
  ref: QuarterRef,
  token: string,
  context: InvocationContext
): Promise<MonthlyDeclaration[]> {
  const rows = await queryItems(
    siteId,
    soldesListId,
    buildFilter(SP_SOLDES_FA_FIELD, fedasilNumber, SP_FA_IS_NUMBER),
    [
      SP_SOLDES_YEAR_FIELD,
      SP_SOLDES_MONTH_FIELD,
      SP_NET_FIELD,
      SP_GROSS_FIELD,
      SP_CONTRIB_FIELD,
      SP_PAID_FIELD,
      SP_STRUCTCOM_FIELD,
    ],
    token,
    context
  );

  context.log(
    `Soldes : ${rows.length} ligne(s) lue(s) pour ce profil ; ` +
      `sélection en code de T${ref.quarter} ${ref.year}.`
  );

  // Le trimestre est DÉRIVÉ du mois (et non lu dans la colonne Quarter) :
  // une colonne de moins dont dépendre.
  return toMonths(rows, SP_SOLDES_MONTH_FIELD, (month, f) => {
    const year = toNumberOrNull(f[SP_SOLDES_YEAR_FIELD]);
    return year === ref.year && quarterOfMonth(month) === ref.quarter;
  });
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
    const quarterParam = (request.query.get("quarter") ?? "").trim();
    const yearParam = (request.query.get("year") ?? "").trim();
    const faParam = (request.query.get("fa") ?? "").trim();

    context.log(
      `Requête /api/me pour: ${maskEmail(email)} (oid=${
        oid ? "présent" : "absent"
      }, quarter=${quarterParam || "current"}${yearParam ? `/${yearParam}` : ""})`
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

    const profileBlock = {
      fa: active.fa,
      firstName: active.firstName,
      lastName: active.lastName,
    };
    const profilesBlock = profiles.length > 1 ? publicProfiles : undefined;

    // --- Étape 2 : trimestre actif (liste « Config », §5.21) ---
    const activeQuarter = await getActiveQuarter(siteId, token, context);

    // Cas dégradé : en REPLI sur les variables d'environnement, l'année n'est
    // pas portée (et le trimestre peut l'être mal si le nom de liste est
    // atypique). On sert alors le trimestre courant SEUL, sans historique :
    // mieux vaut une fenêtre absente qu'une fenêtre fausse.
    if (activeQuarter.quarter === null) {
      context.log(
        "⚠ Trimestre actif inconnu (repli) : historique multi-trimestres désactivé."
      );
    }
    const currentYear =
      activeQuarter.year ??
      (activeQuarter.quarter !== null
        ? new Date().getUTCFullYear() // repli : l'année civile est correcte aux 4 dates de bascule (§5.16)
        : null);

    const currentRef: QuarterRef | null =
      activeQuarter.quarter !== null && currentYear !== null
        ? { quarter: activeQuarter.quarter, year: currentYear }
        : null;

    const windowRefs: QuarterRef[] = currentRef
      ? buildWindow(currentRef, HISTORY_QUARTERS)
      : [];

    // --- Étape 3 : quel trimestre est demandé ? ---
    // Par défaut : le courant. « previous » = alias historique (compatibilité
    // avec l'ancien frontend). Sinon : quarter=<1-4>&year=<AAAA>, qui DOIT
    // appartenir à la fenêtre (sinon 400 : on ne sert pas hors fenêtre).
    let requested: QuarterRef | null = currentRef;

    if (quarterParam === "previous") {
      requested = windowRefs[1] ?? null;
    } else if (quarterParam !== "" && quarterParam !== "current") {
      const q = Number(quarterParam);
      const y = Number(yearParam);
      const inWindow =
        Number.isInteger(q) &&
        Number.isInteger(y) &&
        windowRefs.find((w) => w.quarter === q && w.year === y);
      if (!inWindow) {
        context.log("Trimestre demandé hors fenêtre d'historique : refusé.");
        return {
          status: 400,
          jsonBody: { message: "Trimestre non disponible." },
        };
      }
      requested = inWindow;
    }

    // Fenêtre publiée au frontend (le sélecteur se construit avec ça).
    const quartersBlock = windowRefs.map(({ quarter, year }) => ({
      quarter,
      year,
    }));

    // Configuration de paiement (IBAN institutionnel + bénéficiaire).
    // Absente ou incomplète -> null : le portail masque la section paiement.
    const payment =
      PAYMENT_IBAN && PAYMENT_BENEFICIARY
        ? { iban: PAYMENT_IBAN, beneficiary: PAYMENT_BENEFICIARY }
        : null;

    // Réponse "vide" réutilisable (liste introuvable, trimestre inconnu…).
    const emptyBody = (ref: QuarterRef | null, archived: boolean) => ({
      quarter: ref?.quarter ?? null,
      year: ref?.year ?? null,
      archived,
      quarters: quartersBlock,
      months: [] as MonthlyDeclaration[],
      payment,
      profile: profileBlock,
      profiles: profilesBlock,
    });

    if (!requested) {
      return { status: 200, jsonBody: emptyBody(null, false) };
    }

    const isCurrent =
      currentRef !== null &&
      requested.quarter === currentRef.quarter &&
      requested.year === currentRef.year;

    // --- Étape 4a : trimestre COURANT -> KB-Cumul ---
    if (isCurrent) {
      // L'ID écrit dans Config (ou, en repli, SP_CUMUL_LIST_ID) évite une
      // résolution par nom.
      const cumulListId =
        activeQuarter.listId ??
        (await findListIdByName(
          siteId,
          activeQuarter.listName,
          token,
          context
        ));

      if (!cumulListId) {
        context.log("Liste KB-Cumul du trimestre courant introuvable.");
        return { status: 200, jsonBody: emptyBody(requested, false) };
      }

      const months = await readCurrentQuarter(
        siteId,
        cumulListId,
        fedasilNumber,
        token,
        context
      );

      return {
        status: 200,
        jsonBody: { ...emptyBody(requested, false), months },
      };
    }

    // --- Étape 4b : trimestre ARCHIVÉ -> Soldes (§5.20) ---
    const soldesListId =
      SP_SOLDES_LIST_ID?.trim() ||
      (await findListIdByName(siteId, SP_SOLDES_LIST_NAME, token, context));

    if (!soldesListId) {
      context.log(
        `⚠ Liste « ${SP_SOLDES_LIST_NAME} » introuvable : historique archivé indisponible ` +
          `(lancer « npm run sp:provision » puis « npm run sp:soldes »).`
      );
      return { status: 200, jsonBody: emptyBody(requested, true) };
    }

    const months = await readArchivedQuarter(
      siteId,
      soldesListId,
      fedasilNumber,
      requested,
      token,
      context
    );

    return {
      status: 200,
      jsonBody: { ...emptyBody(requested, true), months },
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
