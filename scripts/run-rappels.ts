/* ============================================================================
 *  scripts/run-rappels.ts — CLI du MOTEUR DU RAPPEL 1 (module 4, R2a)
 * ----------------------------------------------------------------------------
 *  ⚠ CE FICHIER NE CONTIENT AUCUNE RÈGLE MÉTIER.
 *
 *  Toute la logique (garde-fou §4.4, sélection fenêtre/échéance, composition
 *  trilingue, journal anti-double-envoi, estampilles Soldes) vit dans
 *  scripts/lib/rappels.ts — un module SANS argv ni process.exit, pour que la
 *  Function nocturne (chantier R2b) l'appelle TELLE QUELLE après la synchro
 *  Soldes et le calcul des indicateurs. Une seule définition des règles.
 *
 *  Ce fichier ne fait que trois choses : lire les arguments, fournir les
 *  identifiants, afficher le résultat.
 *
 *  Usage (depuis la RACINE du dépôt) :
 *
 *    npm run sp:rappels                          ⭐ DRY-RUN (défaut)
 *        Évalue le garde-fou, sélectionne les candidats, compose les e-mails,
 *        et n'ÉCRIT RIEN, n'ENVOIE RIEN. C'est l'outil d'observation du moteur
 *        AVANT sa mise en service (interrupteur OFF ≠ dry-run impossible :
 *        l'interrupteur n'arrête jamais un dry-run).
 *
 *    npm run sp:rappels -- --sans-garde-fou      dry-run en ignorant le
 *        garde-fou (inspection de la sélection même si la file déborde).
 *        REFUSÉ en mode réel : le garde-fou §4.4 est NON NÉGOCIABLE.
 *
 *    npm run sp:rappels -- --envoyer             MODE RÉEL : envoie les
 *        e-mails, journalise chaque tentative dans « Journal-Rappels »
 *        (Pending -> Sent/Failed), estampille ReminderLevel/Reminder1Date
 *        sur chaque ligne Soldes couverte, pose « LastReminder1Run ».
 *        Ne fait RIEN si Reminder1Enabled n'est pas « true » dans Config.
 *
 *    npm run sp:rappels -- --init-params         sème les 3 lignes paramètres
 *        de Config si elles manquent (Reminder1Enabled=false,
 *        Reminder1MaxQueue=60, Reminder1MaxImportAgeDays=9) puis s'arrête.
 *        Idempotent : une ligne existante n'est JAMAIS modifiée.
 *
 *    npm run sp:rappels -- --liste-complete      détaille TOUS les dossiers
 *        du rapport (défaut : 30 premiers).
 *
 *  Identifiants : api/local.settings.json (Values), ou à défaut les VARIABLES
 *  D'ENVIRONNEMENT du même nom — le même repli qui permettra à la Function de
 *  tourner sans fichier de configuration (R2b).
 *
 *  Contexte d'envoi (mêmes clés que le portail — AUCUNE nouvelle variable) :
 *    GRAPH_SENDER_USER_ID   la boîte qui envoie déjà les invitations
 *    PAYMENT_IBAN           le compte bénéficiaire affiché par le portail
 *    PAYMENT_BENEFICIARY    le libellé bénéficiaire du portail
 *    PORTAL_URL             (ou dérivée d'INVITE_REDIRECT_URL, comme
 *                            Subscription.ts : /portail ajouté si absent)
 *  En dry-run, une clé manquante = avertissement + « [À CONFIGURER] » dans
 *  l'aperçu ; en mode réel = ABSTENTION (fail-safe).
 * ============================================================================ */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SoldesSyncError,
  createGraphClient,
  type Settings,
} from "./lib/soldes-sync.js";

import {
  CONFIG_LIST_NAME_R,
  findConfigListId,
  formatReminderSummary,
  initReminder1Params,
  runReminder1,
  type ReminderMailContext,
} from "./lib/rappels.js";

const REQUIRED_SETTINGS = [
  "TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "SP_SITE_HOSTNAME",
  "SP_SITE_PATH",
] as const;

const MAIL_KEYS = [
  "GRAPH_SENDER_USER_ID",
  "PAYMENT_IBAN",
  "PAYMENT_BENEFICIARY",
  "PORTAL_URL",
  "INVITE_REDIRECT_URL",
] as const;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const log = (message: string): void => console.log(message);

/** api/local.settings.json > Values, complété/remplacé par process.env. */
function loadValues(): Record<string, string> {
  const path = resolve(process.cwd(), "api/local.settings.json");
  let fromFile: Record<string, string> = {};

  try {
    const raw = readFileSync(path, "utf-8");
    const json = JSON.parse(raw) as { Values?: Record<string, string> };
    fromFile = json.Values ?? {};
  } catch {
    log(
      "ℹ api/local.settings.json introuvable — lecture des variables d'environnement."
    );
  }

  const values: Record<string, string> = { ...fromFile };
  for (const key of [...REQUIRED_SETTINGS, ...MAIL_KEYS]) {
    const v = (process.env[key] ?? "").trim();
    if (v) values[key] = v;
  }
  return values;
}

function loadSettings(values: Record<string, string>): Settings {
  const missing = REQUIRED_SETTINGS.filter((k) => !(values[k] ?? "").trim());
  if (missing.length > 0) {
    fail(
      `Variable(s) manquante(s) : ${missing.join(", ")}.\n` +
        "Les renseigner dans api/local.settings.json > Values, ou dans " +
        "l'environnement.\n" +
        "Rappel : lancer la commande depuis la RACINE du dépôt."
    );
  }
  return {
    TENANT_ID: values["TENANT_ID"]!.trim(),
    GRAPH_CLIENT_ID: values["GRAPH_CLIENT_ID"]!.trim(),
    GRAPH_CLIENT_SECRET: values["GRAPH_CLIENT_SECRET"]!.trim(),
    SP_SITE_HOSTNAME: values["SP_SITE_HOSTNAME"]!.trim(),
    SP_SITE_PATH: values["SP_SITE_PATH"]!.trim(),
  };
}

/** URL du portail — MÊME dérivation que Subscription.ts : PORTAL_URL prime,
 *  sinon INVITE_REDIRECT_URL, avec /portail ajouté s'il n'y est pas déjà. */
function derivePortalUrl(values: Record<string, string>): string {
  const explicit = (values["PORTAL_URL"] ?? "").trim();
  if (explicit) return explicit;
  const redirect = (values["INVITE_REDIRECT_URL"] ?? "").trim();
  if (!redirect) return "";
  const base = redirect.replace(/\/+$/, "");
  return base.endsWith("/portail") ? base : `${base}/portail`;
}

// ---------------------------------------------------------------------------
//  Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const known = new Set([
  "--envoyer",
  "--sans-garde-fou",
  "--init-params",
  "--liste-complete",
]);
for (const a of args) {
  if (!known.has(a)) {
    fail(
      `Argument inconnu : « ${a} ».\n` +
        "Arguments acceptés : --envoyer · --sans-garde-fou (dry-run " +
        "uniquement) · --init-params · --liste-complete"
    );
  }
}

const envoyer = args.includes("--envoyer");
const sansGardeFou = args.includes("--sans-garde-fou");
const initParams = args.includes("--init-params");
const listeComplete = args.includes("--liste-complete");

if (envoyer && sansGardeFou) {
  fail(
    "--sans-garde-fou est REFUSÉ avec --envoyer : le garde-fou §4.4 est NON " +
      "NÉGOCIABLE en mode réel (le pire scénario du recouvrement est de " +
      "relancer un résident qui a payé)."
  );
}
if (initParams && (envoyer || sansGardeFou)) {
  fail("--init-params s'utilise seul (il sème les paramètres puis s'arrête).");
}

// ---------------------------------------------------------------------------
//  Exécution
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const values = loadValues();
  const cfg = loadSettings(values);
  const graph = createGraphClient(cfg, log);

  if (initParams) {
    log("");
    log(`Semis des paramètres du rappel 1 dans « ${CONFIG_LIST_NAME_R} » :`);
    const { siteId, configListId } = await findConfigListId(graph, cfg, log);
    const created = await initReminder1Params(graph, siteId, configListId, log);
    log("");
    log(
      created > 0
        ? `✓ ${created} ligne(s) créée(s). L'interrupteur est OFF : le moteur ne peut rien envoyer.`
        : "✓ Rien à créer : les 3 lignes existent déjà (valeurs conservées)."
    );
    return;
  }

  const mailCtx: ReminderMailContext = {
    senderUserId: (values["GRAPH_SENDER_USER_ID"] ?? "").trim(),
    portalUrl: derivePortalUrl(values),
    paymentIban: (values["PAYMENT_IBAN"] ?? "").trim(),
    paymentBeneficiary: (values["PAYMENT_BENEFICIARY"] ?? "").trim(),
  };

  log("");
  log(
    envoyer
      ? "MODE RÉEL (--envoyer) — envois, journal et estampilles."
      : "MODE DRY-RUN (défaut) — rien n'est écrit, rien n'est envoyé." +
          (sansGardeFou ? " Garde-fou ÉVALUÉ mais non bloquant (--sans-garde-fou)." : "")
  );

  const result = await runReminder1(cfg, graph, mailCtx, {
    dryRun: !envoyer,
    skipGuard: sansGardeFou,
    maxDetail: listeComplete ? Number.MAX_SAFE_INTEGER : 30,
    log,
  });

  console.log(formatReminderSummary(result));

  if (!result.aborted && result.failed > 0) {
    process.exitCode = 1; // échec partiel visible d'un `&&` ou d'un cron
  }
}

main().catch((err) => {
  if (err instanceof SoldesSyncError) fail(err.message);
  console.error(err);
  process.exit(1);
});
