import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

// ---------- Types ----------

type PreInscriptionBody = {
  nationalId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
};

type EligibilityResult = {
  eligible: boolean;
  reason?: string;
};

type CreateUserResult = {
  id: string;
  email: string;
};

// ---------- Helpers : configuration ----------

// À mettre dans local.settings.json (en Values) pour les tests locaux,
// puis dans les App Settings de ta Function App en prod.
const TENANT_ID = process.env["TENANT_ID"]; // tenant Entra (ou tenant External ID dédié)
const GRAPH_CLIENT_ID = process.env["GRAPH_CLIENT_ID"];
const GRAPH_CLIENT_SECRET = process.env["GRAPH_CLIENT_SECRET"];

// ---------- 1) Vérification d’éligibilité ----------

// Pour l’instant, on simule avec une liste en mémoire.
// Ensuite tu remplacerais cette fonction par :
// - un appel à SharePoint (Microsoft Graph / REST)
// - ou une requête SQL
// - ou la lecture d’un fichier Excel sur SharePoint/OneDrive.
async function checkEligibility(
  nationalId: string,
  context: InvocationContext
): Promise<EligibilityResult> {
  // TODO: remplacer par ta vraie source de données

  // Exemple : liste blanche simulée
  const allowedIds = new Set<string>([
    "12345678911",
    "11111111111",
    "22222222222",
  ]);

  if (!allowedIds.has(nationalId)) {
    context.log(`NationalId ${nationalId} non trouvé ou non éligible`);
    return {
      eligible: false,
      reason:
        "Votre numéro national ne correspond pas aux personnes éligibles au programme.",
    };
  }

  return { eligible: true };
}

// ---------- 2) Microsoft Graph : auth ----------

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
    const text = await response.text();
    context.log("Erreur d'obtention du token Graph :", response.status, text);
    throw new Error("Impossible d'obtenir un jeton d'accès Microsoft Graph.");
  }

  const json = (await response.json()) as { access_token: string };
  return json.access_token;
}

// ---------- 3) Création de l’utilisateur Entra External ID ----------

async function createExternalUser(
  input: PreInscriptionBody,
  context: InvocationContext
): Promise<CreateUserResult> {
  const { firstName, lastName, email } = input;

  if (!firstName || !lastName || !email) {
    throw new Error("Données utilisateur incomplètes pour la création Entra.");
  }

  const accessToken = await getGraphToken(context);

  // Exemple de création d’utilisateur “local account” / B2C-like.
  // À adapter selon ton modèle Entra External ID exact (tenant, policies, etc.).
  const graphUrl = "https://graph.microsoft.com/v1.0/users";

  const userBody = {
    accountEnabled: true,
    displayName: `${firstName} ${lastName}`,
    identities: [
      {
        signInType: "emailAddress",
        issuer: TENANT_ID,
        issuerAssignedId: email,
      },
    ],
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password: "ChangeMe!1234", // À remplacer par une génération aléatoire + envoi par mail
    },
    passwordPolicies: "DisablePasswordExpiration",
  };

  const response = await fetch(graphUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userBody),
  });

  if (!response.ok) {
    const text = await response.text();
    context.log("Erreur création utilisateur Graph :", response.status, text);
    throw new Error("Impossible de créer le compte dans Entra External ID.");
  }

  const created = (await response.json()) as { id: string };
  return {
    id: created.id,
    email,
  };
}

// ---------- 4) Envoi d’e-mail de confirmation ----------

async function sendConfirmationEmail(
  user: CreateUserResult,
  input: PreInscriptionBody,
  context: InvocationContext
): Promise<void> {
  const { firstName } = input;
  const accessToken = await getGraphToken(context);

  // Variante 1 : on utilise un compte/service qui envoie l’e-mail (via /users/{id}/sendMail ou /me/sendMail)
  // Ici, on suppose un compte “service” identifié par GRAPH_SENDER_USER_ID.
  const senderUserId = process.env["GRAPH_SENDER_USER_ID"]; // à configurer

  if (!senderUserId) {
    context.log("GRAPH_SENDER_USER_ID manquant, e-mail non envoyé.");
    return;
  }

  const mailUrl = `https://graph.microsoft.com/v1.0/users/${senderUserId}/sendMail`;

  const mailBody = {
    message: {
      subject: "Confirmation de votre pré-inscription",
      body: {
        contentType: "HTML",
        content: `
          <p>Bonjour ${firstName ?? ""},</p>
          <p>Nous avons bien reçu votre pré-inscription. Votre compte a été créé.</p>
          <p>Vous recevrez prochainement plus d'informations pour vous connecter et compléter votre dossier.</p>
          <p>Cordialement,<br/>L'équipe d'accompagnement</p>
        `,
      },
      toRecipients: [
        {
          emailAddress: {
            address: user.email,
          },
        },
      ],
    },
    saveToSentItems: "false",
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
    context.log("Erreur envoi e-mail Graph :", response.status, text);
    // Ici on log, mais on ne bloque pas forcément la pré-inscription
  } else {
    context.log("E-mail de confirmation envoyé à", user.email);
  }
}

// ---------- 5) Function HTTP principale ----------

export async function Subscription(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const body = (await request.json()) as PreInscriptionBody;
    const { nationalId, firstName, lastName, email } = body ?? {};

    context.log("Requête reçue /pre-inscription :", body);

    if (!nationalId || !firstName || !lastName || !email) {
      return {
        status: 400,
        jsonBody: {
          message:
            "Données manquantes (numéro national, prénom, nom, e-mail).",
        },
      };
    }

    // 1. Vérifier l’éligibilité
    const eligibility = await checkEligibility(nationalId, context);
    if (!eligibility.eligible) {
      return {
        status: 400,
        jsonBody: {
          message:
            eligibility.reason ??
            "Vous ne remplissez pas les critères d'éligibilité.",
        },
      };
    }

    // 2. Créer l’utilisateur dans Entra External ID
    const createdUser = await createExternalUser(body, context);

    // 3. Envoyer un e-mail de confirmation
    await sendConfirmationEmail(createdUser, body, context);

    return {
      status: 200,
      jsonBody: {
        message:
          "Votre pré-inscription est enregistrée. Un e-mail de confirmation vous a été envoyé.",
      },
    };
  } catch (error) {
    context.log("Erreur dans /pre-inscription :", error);
    const message =
      error instanceof Error
        ? error.message
        : "Erreur interne du serveur.";
    return {
      status: 500,
      jsonBody: {
        message,
      },
    };
  }
}

// Déclaration HTTP de la Function
app.http("Subscription", {
  route: "pre-inscription",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: Subscription,
});

