import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

import { buildInvitationEmail } from "./invitationEmail";

// ============================================================================
//  POST /api/pre-inscription — Pré-inscription + invitation B2B
// ----------------------------------------------------------------------------
//  NOUVEAU (matching par oid) : après une invitation réussie, la ligne de la
//  liste "resident" correspondant au NUMÉRO NATIONAL est mise à jour avec :
//    - l'e-mail utilisé pour l'inscription (colonne SP_EMAIL_FIELD)
//    - l'oid du compte invité Entra    (colonne SP_RESIDENT_OID_FIELD)
//
//  Ce mécanisme unique couvre trois cas métier :
//    1. Première inscription        -> capture initiale de l'oid.
//    2. Changement d'adresse e-mail -> le résident refait la pré-inscription
//       avec son numéro national + sa NOUVELLE adresse ; la ligne (retrouvée
//       par NN) reçoit le nouvel e-mail et le nouvel oid. Le FA ne change
//       pas : l'historique est intact.
//    3. Compte invité supprimé puis ré-invité -> même parcours, même effet.
//       Le numéro national sert de clé de récupération.
//
//  Familles : plusieurs personnes (NN différents) peuvent partager la même
//  adresse e-mail. L'invitation Graph est idempotente : le même e-mail
//  renvoie le même invité (même oid). Chaque membre fait SA pré-inscription
//  avec SON numéro national ; plusieurs lignes resident portent alors le
//  même oid, et le portail propose un sélecteur de profil (voir Me.ts).
//
//  La liaison est NON BLOQUANTE : si l'écriture SharePoint échoue, la
//  pré-inscription reste un succès (le compte invité existe déjà) ; le
//  repli par e-mail unique dans Me.ts/Declare.ts prend alors le relais.
// ============================================================================

// ---------- Types ----------

type PreInscriptionBody = {
  nationalId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  contactLanguage?: string;
};

type CreateUserResult = {
  id: string;
  email: string;
  inviteRedeemUrl?: string;
};

// ---------- Config Graph ----------

const TENANT_ID = process.env["TENANT_ID"];
const GRAPH_CLIENT_ID = process.env["GRAPH_CLIENT_ID"];
const GRAPH_CLIENT_SECRET = process.env["GRAPH_CLIENT_SECRET"];
const GRAPH_SENDER_USER_ID = process.env["GRAPH_SENDER_USER_ID"];

const SP_SITE_HOSTNAME = process.env["SP_SITE_HOSTNAME"];
const SP_SITE_PATH = process.env["SP_SITE_PATH"];
const SP_LIST_ID = process.env["SP_LIST_ID"];
const SP_NATIONALID_FIELD = process.env["SP_NATIONALID_FIELD"] ?? "Title";

// Colonnes de la liste resident mises à jour après invitation.
// SP_RESIDENT_OID_FIELD = nom INTERNE de la colonne texte "EntraOid".
const SP_EMAIL_FIELD = process.env["SP_EMAIL_FIELD"] ?? "Email";
const SP_RESIDENT_OID_FIELD =
  process.env["SP_RESIDENT_OID_FIELD"] ?? "EntraOid";

// ⚠️ À MODIFIER POUR LA PRODUCTION ⚠️
// INVITE_REDIRECT_URL = adresse où l'utilisateur est renvoyé après avoir
// accepté son invitation.
//   - En local / test : "https://myapps.microsoft.com" (portail Microsoft).
//   - En production    : l'URL HTTPS réelle de l'application déployée,
//                        ex. "https://<nom-app>.azurestaticapps.net".
// Microsoft Graph REFUSE le http:// et les adresses localhost
// (erreur "The invite redirect URL field is invalid").
// Cette valeur n'est PAS définie ici mais dans la configuration :
//   - local      -> api/local.settings.json
//   - production -> Azure > Static Web App / Function App > Configuration
const INVITE_REDIRECT_URL = process.env["INVITE_REDIRECT_URL"];

// Active la validation du checksum (modulo 97) du numéro national belge.
// Désactivée par défaut pour ne pas bloquer d'éventuels numéros de test
// présents dans la liste SharePoint. À activer en production : NN_CHECKSUM_STRICT=true
const NN_CHECKSUM_STRICT =
  (process.env["NN_CHECKSUM_STRICT"] ?? "false").toLowerCase() === "true";

// Message générique renvoyé au client. Le détail technique reste uniquement
// dans les logs serveur pour éviter toute fuite d'information vers l'utilisateur.
const GENERIC_SERVER_ERROR =
  "Une erreur est survenue lors du traitement de votre demande. Veuillez réessayer plus tard.";

// Refus d'éligibilité volontairement neutre : ne confirme pas qu'il s'agit
// spécifiquement du numéro national (évite l'oracle d'éligibilité - test T03).
const GENERIC_INELIGIBLE =
  "Nous ne pouvons pas donner suite à votre demande avec les informations fournies. " +
  "Si vous pensez qu'il s'agit d'une erreur, contactez le service concerné.";

// ⚠️ DEBUG TEMPORAIRE — à retirer après diagnostic.
// Si DEBUG_ERRORS=true (variable d'environnement), les réponses 500 incluent
// le détail de l'erreur. NE JAMAIS laisser activé en usage réel.
const DEBUG_ERRORS =
  (process.env["DEBUG_ERRORS"] ?? "false").toLowerCase() === "true";

function buildErrorBody(error: unknown): Record<string, unknown> {
  if (!DEBUG_ERRORS) return { message: GENERIC_SERVER_ERROR };
  return {
    message: GENERIC_SERVER_ERROR,
    debug: error instanceof Error ? error.message : String(error),
  };
}

// ---------- Helpers de journalisation (RGPD) ----------
// Le guide impose de ne jamais écrire le numéro national complet, ni les
// payloads bruts, ni les réponses Graph contenant des données personnelles.

function maskNationalId(nn?: string): string {
  if (!nn) return "(absent)";
  const digits = nn.replace(/\D/g, "");
  if (digits.length < 2) return "***";
  return `***${digits.slice(-2)}`; // ne garde que les 2 derniers chiffres
}

function maskEmail(email?: string): string {
  if (!email) return "(absent)";
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

// ---------- Validation du numéro national ----------

function isValidNationalIdFormat(nn: string): boolean {
  return /^\d{11}$/.test(nn);
}

// Checksum officiel du numéro national belge (modulo 97), deux variantes
// selon que la naissance est avant ou après 2000.
function isValidBelgianNationalNumber(nn: string): boolean {
  if (!isValidNationalIdFormat(nn)) return false;
  const base = nn.substring(0, 9);
  const check = Number(nn.substring(9, 11));
  const mod1900 = 97 - (Number(base) % 97);
  const mod2000 = 97 - (Number("2" + base) % 97);
  return check === mod1900 || check === mod2000;
}

// ---------- Limitation de débit (anti brute-force / anti-énumération) ----------
// IMPORTANT : implémentation en mémoire, *best-effort*. Les Azure Functions
// peuvent scaler sur plusieurs instances : ce compteur n'est PAS partagé entre
// instances. Pour une vraie protection en production, mettre en place une
// limitation au niveau Azure Front Door / API Management, ou un store partagé
// (Durable Entities, Redis). À compléter par un CAPTCHA (ex. Cloudflare
// Turnstile) sur le formulaire public.

const rateLimitStore = new Map<string, number[]>();

function getClientKey(request: HttpRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (rateLimitStore.get(key) ?? []).filter(
    (t) => now - t < windowMs
  );
  recent.push(now);
  rateLimitStore.set(key, recent);
  return recent.length > max;
}

// ---------- Authentification Microsoft Graph (client credentials) ----------

async function getGraphToken(context: InvocationContext): Promise<string> {
  if (!TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    context.log(
      "Config Graph manquante (TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET)"
    );
    throw new Error(
      "Configuration serveur incomplète pour l'accès à Microsoft Graph."
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID,
    client_secret: GRAPH_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    // On ne logge pas le corps : il peut contenir des détails sur le secret/app.
    context.log("Erreur d'obtention du token Graph, statut:", response.status);
    throw new Error(
      `Impossible d'obtenir un jeton d'accès Microsoft Graph (statut ${response.status}).`
    );
  }

  const json = (await response.json()) as { access_token: string };
  return json.access_token;
}

// ---------- SharePoint : site + liste resident ----------

async function getSiteId(
  token: string,
  context: InvocationContext
): Promise<string> {
  if (!SP_SITE_HOSTNAME || !SP_SITE_PATH) {
    context.log(
      "Configuration SharePoint manquante (SP_SITE_HOSTNAME/SP_SITE_PATH)."
    );
    throw new Error("Configuration SharePoint incomplète (site).");
  }
  const url = `https://graph.microsoft.com/v1.0/sites/${SP_SITE_HOSTNAME}:/${SP_SITE_PATH}?$select=id`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    context.log("Erreur récupération site SharePoint, statut:", res.status);
    throw new Error(
      `Impossible de récupérer le site SharePoint (statut ${res.status}).`
    );
  }
  return ((await res.json()) as { id: string }).id;
}

// Recherche la ligne resident par numéro national.
// Renvoie l'ID de l'élément SharePoint (nécessaire pour la liaison e-mail/oid
// après invitation), ou null si le numéro n'est pas dans la liste (inéligible).
async function findResidentItemIdByNationalId(
  nationalId: string,
  token: string,
  siteId: string,
  context: InvocationContext
): Promise<string | null> {
  if (!SP_LIST_ID) {
    context.log("Configuration SharePoint manquante (SP_LIST_ID).");
    throw new Error(
      "Configuration SharePoint incomplète pour la vérification d'éligibilité."
    );
  }

  // nationalId est déjà revalidé en amont (^\d{11}$), donc il ne contient que
  // des chiffres : pas de risque d'injection OData. On conserve malgré tout
  // l'échappement par sécurité.
  const encodedNationalId = nationalId.replace(/'/g, "''");

  const listItemsUrl =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${SP_LIST_ID}` +
    `/items?$select=id&$expand=fields($select=${SP_NATIONALID_FIELD})` +
    `&$filter=fields/${SP_NATIONALID_FIELD} eq '${encodedNationalId}'`;

  const listResponse = await fetch(listItemsUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!listResponse.ok) {
    // On NE logge PAS le corps : il contiendrait des données d'éligibilité.
    context.log(
      "Erreur interrogation liste SharePoint, statut:",
      listResponse.status
    );
    throw new Error(
      `Impossible d'interroger la liste SharePoint (statut ${listResponse.status}).`
    );
  }

  const listJson = (await listResponse.json()) as {
    value?: Array<{ id?: string }>;
  };
  const itemId = listJson.value?.[0]?.id ?? null;

  // Log minimisé : on ne trace que le résultat booléen + un id masqué.
  context.log(
    `Vérification éligibilité pour ${maskNationalId(nationalId)} : ${
      itemId ? "trouvé" : "non trouvé"
    }`
  );

  return itemId;
}

// ---------- Liaison resident <-> compte invité (e-mail + oid) ----------
// NON BLOQUANTE : un échec ici ne doit jamais faire échouer la pré-inscription
// (le compte invité existe déjà côté Entra ; renvoyer une 500 créerait une
// incohérence d'état). Le repli par e-mail unique de Me.ts/Declare.ts couvre
// la période où l'oid manquerait.

async function linkResidentToGuest(
  residentItemId: string,
  user: CreateUserResult,
  token: string,
  siteId: string,
  context: InvocationContext
): Promise<void> {
  try {
    if (!SP_LIST_ID) return;

    const fieldsToWrite: Record<string, string> = {
      [SP_EMAIL_FIELD]: user.email.trim().toLowerCase(),
    };

    // L'oid Entra est un GUID ; createExternalUser peut renvoyer un repli
    // (userPrincipalName / "unknown") qu'on ne doit PAS écrire comme oid.
    const looksLikeGuid =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        user.id
      );
    if (looksLikeGuid) {
      fieldsToWrite[SP_RESIDENT_OID_FIELD] = user.id;
    } else {
      context.log(
        "Oid invité indisponible (id non-GUID) : liaison e-mail seule."
      );
    }

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${SP_LIST_ID}/items/${residentItemId}/fields`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(fieldsToWrite),
      }
    );

    if (!res.ok) {
      context.log(
        "Échec liaison resident/invité (non bloquant), statut:",
        res.status
      );
      return;
    }
    context.log("Ligne resident reliée au compte invité (e-mail + oid).");
  } catch (error) {
    context.log("Exception liaison resident/invité (non bloquant):", error);
  }
}

function requireInviteRedirectUrl(context: InvocationContext): string {
  if (!INVITE_REDIRECT_URL) {
    context.log("INVITE_REDIRECT_URL non configurée.");
    throw new Error("Configuration serveur incomplète (URL de redirection).");
  }
  return INVITE_REDIRECT_URL;
}

// ---------- Création de l'utilisateur externe via invitation B2B ----------

async function createExternalUser(
  input: PreInscriptionBody,
  context: InvocationContext
): Promise<CreateUserResult> {
  const { firstName, lastName, email } = input;

  if (!firstName || !lastName || !email) {
    throw new Error("Données utilisateur incomplètes pour l'invitation externe.");
  }

  const cleanedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanedEmail)) {
    context.log("E-mail invalide pour l'invitation:", maskEmail(cleanedEmail));
    throw new Error("L'adresse e-mail fournie n'est pas valide pour l'invitation.");
  }

  const redirectUrl = requireInviteRedirectUrl(context);
  const accessToken = await getGraphToken(context);

  const graphUrl = "https://graph.microsoft.com/v1.0/invitations";
  const displayName = `${firstName} ${lastName}`.trim();

  const inviteBody = {
    invitedUserEmailAddress: cleanedEmail,
    inviteRedirectUrl: redirectUrl,
    invitedUserDisplayName: displayName,
    sendInvitationMessage: false,
    invitedUserType: "Guest",
  };

  // On ne logge plus le corps complet (contient nom + e-mail).
  context.log("Envoi invitation Graph pour:", maskEmail(cleanedEmail));

  const response = await fetch(graphUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(inviteBody),
  });

  const text = await response.text();

  if (!response.ok) {
    // Détail technique en log uniquement, pas renvoyé au client.
    context.log("Erreur Graph /invitations, statut:", response.status, text);
    throw new Error(
      `Impossible de créer / inviter le compte externe dans Entra (statut ${response.status}).`
    );
  }

  type InvitationResponse = {
    invitedUser?: { id?: string; userPrincipalName?: string; mail?: string };
    invitedUserEmailAddress?: string;
    inviteRedeemUrl?: string;
  };

  const json = JSON.parse(text) as InvitationResponse;

  // invitedUser.id = l'oid Entra du compte invité (identique à chaque
  // ré-invitation du même e-mail : l'invitation Graph est idempotente).
  const id =
    json.invitedUser?.id ?? json.invitedUser?.userPrincipalName ?? "unknown";

  const finalEmail =
    json.invitedUser?.mail ?? json.invitedUserEmailAddress ?? cleanedEmail;

  context.log("Utilisateur invité (guest) créé, id (masqué):", id ? "ok" : "?");

  return { id, email: finalEmail, inviteRedeemUrl: json.inviteRedeemUrl };
}

// ---------- Envoi d'e-mail de confirmation ----------
// Renvoie true si l'e-mail est parti, false sinon. NE lève PLUS d'exception :
// si l'invitation est créée mais que l'e-mail échoue, on ne veut pas renvoyer
// une 500 alors que le compte existe déjà (incohérence d'état).

async function sendConfirmationEmail(
  user: CreateUserResult,
  input: PreInscriptionBody,
  context: InvocationContext
): Promise<boolean> {
  if (!GRAPH_SENDER_USER_ID) {
    context.log("GRAPH_SENDER_USER_ID manquant, e-mail d'invitation non envoyé.");
    return false;
  }
  if (!user.inviteRedeemUrl) {
    context.log("inviteRedeemUrl manquant, e-mail non envoyé.");
    return false;
  }

  try {
    const accessToken = await getGraphToken(context);

    const mailUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      GRAPH_SENDER_USER_ID
    )}/sendMail`;

    // Texte de l'e-mail dans la langue du résident (FR/NL/EN)
    const { subject, html } = buildInvitationEmail(
      input.contactLanguage,
      input.firstName ?? "",
      user.inviteRedeemUrl
    );

    const mailBody = {
      message: {
        subject,
        body: {
          contentType: "HTML",
          content: html,
        },
        toRecipients: [{ emailAddress: { address: user.email } }],
      },
      saveToSentItems: false,
    };

    const response = await fetch(mailUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mailBody),
    });

    if (!response.ok) {
      const text = await response.text();
      context.log("Erreur Graph /sendMail, statut:", response.status, text);
      return false;
    }

    context.log("E-mail d'invitation envoyé à:", maskEmail(user.email));
    return true;
  } catch (error) {
    context.log("Exception lors de l'envoi de l'e-mail:", error);
    return false;
  }
}

// ---------- Vérification d'existence d'un invité ----------

async function guestExistsByEmail(
  email: string,
  context: InvocationContext
): Promise<boolean> {
  const accessToken = await getGraphToken(context);

  const encodedEmail = email.replace(/'/g, "''");
  const url =
    "https://graph.microsoft.com/v1.0/users?$select=id&" +
    `$filter=mail eq '${encodedEmail}' or userPrincipalName eq '${encodedEmail}'`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    context.log("Erreur Graph /users (check-email), statut:", response.status, text);
    throw new Error("Impossible de vérifier l'existence de l'e-mail dans Entra.");
  }

  const json = (await response.json()) as { value?: unknown[] };
  return (json.value?.length ?? 0) > 0;
}

// ---------- Endpoint /check-email ----------
// ATTENTION : cet endpoint reste un oracle d'énumération (il révèle si une
// adresse existe). Il est ici protégé par une limitation de débit best-effort.
// En production, envisager : limitation Front Door/APIM, CAPTCHA, ou
// suppression au profit d'une vérification interne au flux de pré-inscription.
// NOTE métier : une adresse déjà connue dans Entra n'est PAS une erreur
// (familles partageant un e-mail, ré-inscription après changement d'adresse) —
// le frontend ne doit pas bloquer la pré-inscription sur cette seule base.

export async function CheckEmail(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const clientKey = getClientKey(request);
    if (isRateLimited(`check-email:${clientKey}`, 10, 60_000)) {
      context.log("Rate limit atteint (check-email) pour une clé client.");
      return { status: 429, jsonBody: { message: "Trop de requêtes. Réessayez plus tard." } };
    }

    const email = request.query.get("email");
    if (!email) {
      return { status: 400, jsonBody: { message: "Paramètre 'email' manquant." } };
    }

    context.log("Requête /check-email pour:", maskEmail(email));

    const exists = await guestExistsByEmail(email, context);
    return { status: 200, jsonBody: { exists } };
  } catch (error) {
    context.log("Erreur dans /check-email:", error);
    return { status: 500, jsonBody: buildErrorBody(error) };
  }
}

app.http("CheckEmail", {
  route: "check-email",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: CheckEmail,
});

// ---------- Endpoint principal /pre-inscription ----------

export async function Subscription(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const clientKey = getClientKey(request);
    // Limite stricte : déclenche des invitations Graph + interroge l'éligibilité.
    if (isRateLimited(`pre-inscription:${clientKey}`, 5, 60_000)) {
      context.log("Rate limit atteint (pre-inscription) pour une clé client.");
      return { status: 429, jsonBody: { message: "Trop de requêtes. Réessayez plus tard." } };
    }

    const body = (await request.json()) as PreInscriptionBody;
    const { nationalId, firstName, lastName, email } = body ?? {};

    // Log minimisé : jamais le payload brut.
    context.log(
      `Requête /pre-inscription reçue (nn=${maskNationalId(
        nationalId
      )}, email=${maskEmail(email)})`
    );

    if (!nationalId || !firstName || !lastName || !email) {
      return {
        status: 400,
        jsonBody: {
          message: "Données manquantes (numéro national, prénom, nom, e-mail).",
        },
      };
    }

    // Revalidation serveur du numéro national (le front est contournable).
    if (!isValidNationalIdFormat(nationalId)) {
      return {
        status: 400,
        jsonBody: { message: "Le numéro national doit contenir exactement 11 chiffres." },
      };
    }
    if (NN_CHECKSUM_STRICT && !isValidBelgianNationalNumber(nationalId)) {
      context.log("Checksum NN invalide pour:", maskNationalId(nationalId));
      // Message neutre : on ne précise pas que c'est le checksum qui échoue.
      return { status: 400, jsonBody: { message: GENERIC_INELIGIBLE } };
    }

    // 1. Éligibilité : le NN doit exister dans la liste resident.
    //    On récupère l'ID de l'élément pour la liaison e-mail/oid (étape 3).
    const graphToken = await getGraphToken(context);
    const siteId = await getSiteId(graphToken, context);
    const residentItemId = await findResidentItemIdByNationalId(
      nationalId,
      graphToken,
      siteId,
      context
    );
    if (!residentItemId) {
      return { status: 400, jsonBody: { message: GENERIC_INELIGIBLE } };
    }

    // 2. Invitation B2B (idempotente côté Graph : réinviter renvoie l'invité existant)
    const createdUser = await createExternalUser(body, context);

    // 3. Liaison resident <-> compte invité : e-mail + oid écrits sur la ligne
    //    retrouvée par numéro national. Couvre inscription initiale,
    //    changement d'e-mail et récupération après suppression de compte.
    //    NON BLOQUANT en cas d'échec.
    await linkResidentToGuest(
      residentItemId,
      createdUser,
      graphToken,
      siteId,
      context
    );

    // 4. E-mail de confirmation (échec non bloquant)
    const emailSent = await sendConfirmationEmail(createdUser, body, context);

    return {
      status: 200,
      jsonBody: {
        message: emailSent
          ? "Votre pré-inscription est enregistrée. Vous allez recevoir un e-mail d'invitation."
          : "Votre pré-inscription est enregistrée. L'e-mail d'invitation vous parviendra prochainement.",
      },
    };
  } catch (error) {
    // Détail uniquement en log, message générique au client
    // (+ champ debug si DEBUG_ERRORS=true — temporaire).
    context.log("Erreur dans /pre-inscription:", error);
    return { status: 500, jsonBody: buildErrorBody(error) };
  }
}

app.http("Subscription", {
  route: "pre-inscription",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: Subscription,
});
