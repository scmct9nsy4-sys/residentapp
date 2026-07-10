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
//  Aidants (ex. assistante sociale en centre) : dérivé du cas famille. Un
//  aidant s'inscrit avec SON adresse e-mail + le NN de chaque résident aidé,
//  et gère leurs déclarations via le sélecteur de profils.
//  ⚠ RÈGLE : un dossier resident = UN SEUL compte lié à la fois. La
//  ré-inscription par NN TRANSFÈRE l'accès (remplace e-mail + oid sur la
//  ligne) — elle ne le partage pas. Si le résident reprend la main, il
//  refait simplement sa pré-inscription (même mécanisme, §5.3/§5.4).
//
//  COMPTES INTERNES (membres du tenant, ex. personnel @fedasil) : Graph
//  REFUSE d'inviter une adresse d'un domaine vérifié du tenant (un membre ne
//  peut pas être invité chez lui). On cherche donc l'utilisateur AVANT
//  d'inviter : s'il existe comme MEMBRE, on relie directement son oid à la
//  ligne resident (aucune invitation) et l'e-mail de confirmation pointe vers
//  le portail (pas de lien d'activation à racheter). Les membres bénéficient
//  des protections de l'organisation (MFA, accès conditionnel). Invités et
//  inconnus suivent le flux d'invitation habituel (idempotent).
//
//  GARDE-FOU AIDANTS : seuls les membres internes dont l'adresse figure dans
//  la liste SharePoint « ResidentApp Aidants » (colonne Title = e-mail en
//  minuscules) peuvent se lier à des dossiers. Comportement FAIL-CLOSED :
//  liste absente, vide ou illisible => AUCUN membre autorisé (message neutre
//  403). Sans effet sur les invités externes (résidents/familles). La liste
//  est gérée par le staff dans SharePoint (créable via sp:provision).
//
//  PRÉNOM / NOM : plus jamais demandés au formulaire. Ils font foi dans la
//  liste Residents (colonnes FirstName/LastName), retrouvée par NN AVANT
//  l'invitation. On les lit ici pour le displayName de l'invitation et le
//  prénom de l'e-mail : données officielles, zéro faute de frappe.
//  NB : le nom n'est jamais renvoyé au navigateur à cette étape (ce serait
//  un oracle NN -> nom) ; il ne circule que vers Graph et l'e-mail.
//
//  La liaison est NON BLOQUANTE : si l'écriture SharePoint échoue, la
//  pré-inscription reste un succès (le compte invité existe déjà) ; le
//  repli par e-mail unique dans Me.ts/Declare.ts prend alors le relais.
// ============================================================================

// ---------- Types ----------

type PreInscriptionBody = {
  nationalId?: string;
  email?: string;
  contactLanguage?: string;
  // Champs HISTORIQUES : encore acceptés (anciens clients/caches) mais
  // totalement IGNORÉS — les nom/prénom font foi dans la liste resident.
  firstName?: string;
  lastName?: string;
  username?: string;
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

// Colonnes prénom/nom de la liste resident (mêmes défauts que Me.ts) :
// LUES ici pour l'invitation B2B et l'e-mail (le formulaire ne les demande plus).
const SP_FIRSTNAME_FIELD = process.env["SP_FIRSTNAME_FIELD"] ?? "FirstName";
const SP_LASTNAME_FIELD = process.env["SP_LASTNAME_FIELD"] ?? "LastName";

// Liste garde-fou des aidants internes autorisés (voir en-tête).
// SP_STAFF_LIST_ID facultatif (résolution par nom sinon) ; la colonne e-mail
// est Title par défaut. Stocker les adresses EN MINUSCULES dans la liste.
const SP_STAFF_LIST_ID = process.env["SP_STAFF_LIST_ID"];
const SP_STAFF_LIST_NAME =
  process.env["SP_STAFF_LIST_NAME"] ?? "ResidentApp Aidants";
const SP_STAFF_EMAIL_FIELD = process.env["SP_STAFF_EMAIL_FIELD"] ?? "Title";

// Refus d'un membre interne hors liste : message neutre (ne confirme ni que
// l'adresse existe dans Entra, ni le mécanisme de liste).
const STAFF_NOT_ALLOWED_MESSAGE =
  "Cette adresse ne peut pas être utilisée pour la pré-inscription. " +
  "Contactez votre référent ResidentApp.";

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

// URL du portail, utilisée dans l'e-mail de confirmation des MEMBRES internes
// (pas de lien d'activation à racheter : ils se connectent directement).
// Défaut : déduite d'INVITE_REDIRECT_URL — si elle pointe déjà sur /portail
// (configuration recommandée), elle est reprise telle quelle ; sinon on
// ajoute /portail. PORTAL_URL ne sert qu'à surcharger ce défaut.
function derivePortalUrl(): string | undefined {
  const explicit = process.env["PORTAL_URL"];
  if (explicit) return explicit;
  if (!INVITE_REDIRECT_URL) return undefined;
  const base = INVITE_REDIRECT_URL.replace(/\/+$/, "");
  return base.toLowerCase().endsWith("/portail") ? base : `${base}/portail`;
}
const PORTAL_URL = derivePortalUrl();

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
// Renvoie l'ID de l'élément SharePoint (nécessaire pour la liaison e-mail/oid)
// AINSI QUE le prénom et le nom officiels (pour l'invitation B2B et l'e-mail),
// ou null si le numéro n'est pas dans la liste (inéligible).
type ResidentMatch = {
  itemId: string;
  firstName: string;
  lastName: string;
};

async function findResidentByNationalId(
  nationalId: string,
  token: string,
  siteId: string,
  context: InvocationContext
): Promise<ResidentMatch | null> {
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
    `/items?$select=id&$expand=fields($select=${SP_NATIONALID_FIELD},` +
    `${SP_FIRSTNAME_FIELD},${SP_LASTNAME_FIELD})` +
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
    value?: Array<{ id?: string; fields?: Record<string, unknown> }>;
  };
  const item = listJson.value?.[0];

  // Log minimisé : on ne trace que le résultat booléen (jamais le nom).
  context.log(
    `Vérification éligibilité pour ${maskNationalId(nationalId)} : ${
      item?.id ? "trouvé" : "non trouvé"
    }`
  );

  if (!item?.id) return null;

  const fields = item.fields ?? {};
  return {
    itemId: item.id,
    firstName: String(fields[SP_FIRSTNAME_FIELD] ?? "").trim(),
    lastName: String(fields[SP_LASTNAME_FIELD] ?? "").trim(),
  };
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
// displayName = prénom + nom OFFICIELS lus dans la liste resident (jamais
// saisis par l'utilisateur). NB : pour un invité DÉJÀ existant (famille,
// aidant, ré-inscription), Graph renvoie le compte existant SANS renommer
// son displayName — cosmétique uniquement, le portail identifie les
// personnes via le sélecteur de profils, pas via le nom du compte Microsoft.

async function createExternalUser(
  email: string,
  displayName: string,
  context: InvocationContext
): Promise<CreateUserResult> {
  const cleanedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanedEmail)) {
    context.log("E-mail invalide pour l'invitation:", maskEmail(cleanedEmail));
    throw new Error("L'adresse e-mail fournie n'est pas valide pour l'invitation.");
  }

  const redirectUrl = requireInviteRedirectUrl(context);
  const accessToken = await getGraphToken(context);

  const graphUrl = "https://graph.microsoft.com/v1.0/invitations";

  const inviteBody: Record<string, unknown> = {
    invitedUserEmailAddress: cleanedEmail,
    inviteRedirectUrl: redirectUrl,
    sendInvitationMessage: false,
    invitedUserType: "Guest",
  };
  // displayName facultatif côté Graph : omis si la liste ne le fournit pas
  // (ne devrait pas arriver — colonnes obligatoires côté staff).
  if (displayName) {
    inviteBody["invitedUserDisplayName"] = displayName;
  }

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
// NB : pour un MEMBRE interne, inviteRedeemUrl contient l'URL du portail
// (PORTAL_URL) — il n'y a pas d'invitation à racheter, on se connecte
// directement. Si PORTAL_URL est indisponible, l'e-mail est simplement omis.

async function sendConfirmationEmail(
  user: CreateUserResult,
  contactLanguage: string | undefined,
  firstName: string,
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

    // Texte de l'e-mail dans la langue du résident (FR/NL/EN).
    // Le prénom vient de la liste resident : « Bonjour <Prénom> » confirme
    // ainsi QUEL profil vient d'être activé (utile familles et aidants).
    const { subject, html } = buildInvitationEmail(
      contactLanguage,
      firstName,
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

// ---------- Garde-fou : e-mail interne autorisé ? ----------
// FAIL-CLOSED : toute impossibilité de vérifier (liste introuvable, erreur
// Graph, colonne absente) => NON autorisé. C'est un contrôle de sécurité :
// il vaut mieux bloquer un aidant légitime (qui contactera son référent)
// que laisser passer n'importe quel compte interne.

async function findStaffListId(
  siteId: string,
  token: string,
  context: InvocationContext
): Promise<string | null> {
  if (SP_STAFF_LIST_ID) return SP_STAFF_LIST_ID;
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists` +
    `?$select=id,displayName&$top=200`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    context.log("Erreur lecture des listes (garde-fou aidants), statut:", res.status);
    return null;
  }
  const json = (await res.json()) as {
    value?: Array<{ id?: string; displayName?: string }>;
  };
  const found = json.value?.find(
    (l) =>
      (l.displayName ?? "").trim().toLowerCase() ===
      SP_STAFF_LIST_NAME.trim().toLowerCase()
  );
  return found?.id ?? null;
}

async function isStaffEmailAllowed(
  email: string,
  siteId: string,
  token: string,
  context: InvocationContext
): Promise<boolean> {
  try {
    const listId = await findStaffListId(siteId, token, context);
    if (!listId) {
      context.log(
        `Liste garde-fou « ${SP_STAFF_LIST_NAME} » introuvable : refus (fail-closed).`
      );
      return false;
    }

    const encoded = email.replace(/'/g, "''");
    const url =
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}` +
      `/items?$select=id&$expand=fields($select=${SP_STAFF_EMAIL_FIELD})` +
      `&$filter=fields/${SP_STAFF_EMAIL_FIELD} eq '${encoded}'`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      context.log("Erreur lecture garde-fou aidants, statut:", res.status);
      return false; // fail-closed
    }
    const json = (await res.json()) as { value?: unknown[] };
    const allowed = (json.value?.length ?? 0) > 0;
    context.log(
      `Garde-fou aidants pour ${maskEmail(email)} : ${
        allowed ? "AUTORISÉ" : "refusé"
      }`
    );
    return allowed;
  } catch (error) {
    context.log("Exception garde-fou aidants (fail-closed):", error);
    return false;
  }
}

// ---------- Recherche d'un MEMBRE interne par e-mail ----------
// Appelée AVANT l'invitation : Graph refuse d'inviter une adresse d'un
// domaine vérifié du tenant. Si l'adresse correspond à un utilisateur de
// type "Member" (personnel interne), on renvoie son oid pour une liaison
// directe. Les invités (Guest) renvoient null ici : ils passent par le flux
// d'invitation habituel, dont l'idempotence fournit un lien d'activation
// aux comptes non encore rachetés.

async function findMemberByEmail(
  email: string,
  token: string,
  context: InvocationContext
): Promise<{ id: string } | null> {
  const encodedEmail = email.replace(/'/g, "''");
  const url =
    "https://graph.microsoft.com/v1.0/users?$select=id,userType&" +
    `$filter=mail eq '${encodedEmail}' or userPrincipalName eq '${encodedEmail}'`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    context.log(
      "Erreur Graph /users (recherche membre), statut:",
      response.status,
      text
    );
    throw new Error("Impossible de vérifier le type de compte dans Entra.");
  }

  const json = (await response.json()) as {
    value?: Array<{ id?: string; userType?: string }>;
  };
  const member = json.value?.find(
    (u) => (u.userType ?? "").toLowerCase() === "member" && u.id
  );

  if (member?.id) {
    context.log("Adresse reconnue comme MEMBRE interne : liaison directe.");
    return { id: member.id };
  }
  return null;
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
    const { nationalId, email, contactLanguage } = body ?? {};

    // Log minimisé : jamais le payload brut.
    context.log(
      `Requête /pre-inscription reçue (nn=${maskNationalId(
        nationalId
      )}, email=${maskEmail(email)})`
    );

    // Prénom/nom NE SONT PLUS requis : ils font foi dans la liste resident.
    if (!nationalId || !email) {
      return {
        status: 400,
        jsonBody: {
          message: "Données manquantes (numéro national, e-mail).",
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
    //    On récupère l'ID de l'élément (liaison e-mail/oid, étape 3) et les
    //    prénom/nom OFFICIELS (invitation + e-mail). Rien de tout cela n'est
    //    renvoyé au navigateur (anti-oracle NN -> nom).
    const graphToken = await getGraphToken(context);
    const siteId = await getSiteId(graphToken, context);
    const resident = await findResidentByNationalId(
      nationalId,
      graphToken,
      siteId,
      context
    );
    if (!resident) {
      return { status: 400, jsonBody: { message: GENERIC_INELIGIBLE } };
    }
    const displayName = `${resident.firstName} ${resident.lastName}`.trim();

    // 2. Compte de connexion :
    //    a) MEMBRE interne (personnel) -> liaison directe de son oid, AUCUNE
    //       invitation (Graph la refuserait : domaine vérifié du tenant).
    //       L'e-mail de confirmation pointera vers le portail (PORTAL_URL).
    //    b) Sinon (invité existant ou nouvel externe) -> invitation B2B,
    //       idempotente côté Graph (réinviter renvoie l'invité existant).
    const cleanedEmail = email.trim().toLowerCase();
    // Revalidation serveur du format (le front est contournable) — vaut pour
    // les DEUX branches (membre interne et invitation).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
      return {
        status: 400,
        jsonBody: { message: "L'adresse e-mail fournie n'est pas valide." },
      };
    }
    const member = await findMemberByEmail(cleanedEmail, graphToken, context);

    // Garde-fou : un MEMBRE interne doit figurer dans la liste des aidants
    // autorisés (fail-closed). Sans effet sur les invités/externes.
    if (member) {
      const allowed = await isStaffEmailAllowed(
        cleanedEmail,
        siteId,
        graphToken,
        context
      );
      if (!allowed) {
        return { status: 403, jsonBody: { message: STAFF_NOT_ALLOWED_MESSAGE } };
      }
    }

    const createdUser: CreateUserResult = member
      ? { id: member.id, email: cleanedEmail, inviteRedeemUrl: PORTAL_URL }
      : await createExternalUser(email, displayName, context);

    // 3. Liaison resident <-> compte invité : e-mail + oid écrits sur la ligne
    //    retrouvée par numéro national. Couvre inscription initiale,
    //    changement d'e-mail, récupération après suppression de compte, et
    //    prise en charge par un aidant (TRANSFERT d'accès : un dossier = un
    //    compte lié à la fois). NON BLOQUANT en cas d'échec.
    await linkResidentToGuest(
      resident.itemId,
      createdUser,
      graphToken,
      siteId,
      context
    );

    // 4. E-mail de confirmation (échec non bloquant)
    const emailSent = await sendConfirmationEmail(
      createdUser,
      contactLanguage,
      resident.firstName,
      context
    );

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
