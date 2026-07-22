/* ============================================================================
 *  soldes-timer/src/functions/soldesNightly.ts
 *  Function App NOCTURNE — synchronisation KB-Cumul -> liste « Soldes »
 * ----------------------------------------------------------------------------
 *  CHANTIER 2b (§5.20.1). Cette Function ne contient AUCUNE règle métier : elle
 *  se contente d'appeler syncAuto() du module partagé
 *  scripts/lib/soldes-sync.ts — LE MÊME code que la CLI « npm run sp:soldes --
 *  --auto ». Une seule définition de Balance / PayStatus / DueDate dans tout le
 *  dépôt : aucune dérive possible entre la ligne de commande et l'automate (§7).
 *
 *  Pourquoi un dossier séparé de « api/ » : les Functions MANAGÉES d'une Static
 *  Web App ne supportent QUE les déclencheurs HTTP. Un déclencheur timer exige
 *  une Function App distincte (§5.20.1).
 *
 *  Le module est importé PAR CHEMIN RELATIF (pas de copie). esbuild l'inline
 *  dans le bundle au build ; Azure ne reçoit qu'un fichier autonome.
 *
 *  Identifiants Graph : lus dans les variables d'environnement (App Settings en
 *  Azure, local.settings.json en local) — jamais chez GitHub (§10.11).
 *
 *  Garde-fou : SOLDES_DRY_RUN=true fait tourner la synchro en lecture seule
 *  (aucune écriture). À poser AVANT le tout premier lancement en Azure, pour
 *  valider la connexion et le chemin de lecture sans rien modifier.
 * ============================================================================ */

import { app, type InvocationContext, type Timer } from "@azure/functions";

import {
  createGraphClient,
  getSiteId,
  syncAuto,
  formatSummary,
  SoldesSyncError,
  type Settings,
} from "../../../scripts/lib/soldes-sync";
import {
  INDICATOR,
  computeIndicateurs,
  formatIndicateursSummary,
  stampIndicator,
} from "../../../scripts/lib/indicateurs";
import {
  formatReminderSummary,
  formatReminder2Summary,
  runReminder1,
  runReminder2,
  type ReminderMailContext,
} from "../../../scripts/lib/rappels";

/** Les 5 identifiants attendus — mêmes noms que api/local.settings.json. */
const REQUIRED_SETTINGS = [
  "TENANT_ID",
  "GRAPH_CLIENT_ID",
  "GRAPH_CLIENT_SECRET",
  "SP_SITE_HOSTNAME",
  "SP_SITE_PATH",
] as const;

/** Lit les identifiants depuis l'environnement, ou échoue FRANCHEMENT.
 *  Contrairement au portail (qui a un repli sur variables d'env.), un automate
 *  qui synchroniserait le mauvais site en silence serait pire que rien : on
 *  refuse de démarrer si un identifiant manque. */
function loadSettings(): Settings {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const key of REQUIRED_SETTINGS) {
    const v = (process.env[key] ?? "").trim();
    if (!v) missing.push(key);
    values[key] = v;
  }

  if (missing.length > 0) {
    throw new SoldesSyncError(
      `Variable(s) d'environnement manquante(s) : ${missing.join(", ")}. ` +
        `Les renseigner dans les App Settings de la Function App (ou dans ` +
        `soldes-timer/local.settings.json en local).`
    );
  }

  return values as Settings;
}

/** URL du portail résident — MÊME dérivation que Subscription.ts et
 *  scripts/run-rappels.ts : PORTAL_URL prime, sinon INVITE_REDIRECT_URL avec
 *  « /portail » ajouté s'il n'y est pas déjà. Vide si rien n'est configuré :
 *  le moteur de rappels le signale lui-même (bloquant en mode réel, simple
 *  avertissement en dry-run). */
function derivePortalUrl(): string {
  const explicit = (process.env["PORTAL_URL"] ?? "").trim();
  if (explicit) return explicit;
  const redirect = (process.env["INVITE_REDIRECT_URL"] ?? "").trim();
  if (!redirect) return "";
  const base = redirect.replace(/\/+$/, "");
  return base.endsWith("/portail") ? base : `${base}/portail`;
}

/** Point d'entrée du timer. */
export async function soldesNightly(
  myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  const log = (message: string): void => context.log(message);
  const dryRun = (process.env.SOLDES_DRY_RUN ?? "").trim().toLowerCase() === "true";

  const startedAt = Date.now();
  log(
    `Synchronisation Soldes — démarrage${dryRun ? " [MODE DRY-RUN : aucune écriture]" : ""}`
  );
  if (myTimer.isPastDue) {
    context.warn(
      "Déclenchement en retard (isPastDue) : exécution de rattrapage."
    );
  }

  try {
    const cfg = loadSettings();
    const graph = createGraphClient(cfg, log);
    const siteId = await getSiteId(graph, cfg, log);

    const { active, results } = await syncAuto(graph, siteId, { dryRun, log });

    log(
      `Trimestre actif : T${active.quarter} ${active.year} ` +
        `(« ${active.cumulListName} »)`
    );
    log(formatSummary(results, dryRun));

    const outOfQuarter = results.reduce((n, r) => n + r.outOfQuarter, 0);
    if (outOfQuarter > 0) {
      // Anomalie de DONNÉES (ligne dans la mauvaise liste trimestrielle) : à
      // remonter bruyamment, mais ce n'est pas un échec d'exécution.
      context.warn(
        `⚠ ${outOfQuarter} ligne(s) hors trimestre : année déduite peut-être ` +
          `fausse dans Soldes. À investiguer (voir §5.20.1).`
      );
    }

    // ── Module 1 (tableau de bord staff) ─────────────────────────────────
    // 1) Estampille « LastSoldesSync » : chaque acteur estampille son propre
    //    passage — jamais en dry-run (une répétition n'est pas une synchro).
    //    Une estampille qui échoue ne fait JAMAIS échouer la synchro qu'elle
    //    documente : on remonte l'erreur dans Application Insights, sans throw.
    if (!dryRun) {
      try {
        await stampIndicator(
          graph,
          siteId,
          {
            title: INDICATOR.lastSoldesSync,
            scope: `T${active.quarter} ${active.year}`,
            detail: formatSummary(results, dryRun).trim(),
          },
          log
        );
      } catch (err) {
        context.error(
          `⚠ Estampille LastSoldesSync NON écrite : ${
            err instanceof Error ? err.message : String(err)
          } — la synchro, elle, est terminée et intacte.`
        );
      }
    }

    // 2) Indicateurs PRÉCALCULÉS : le calcul tourne JUSTE APRÈS la synchro —
    //    les agrégats sont cohérents avec la photo Soldes de cette nuit. Même
    //    règle d'isolement : un échec du calcul laisse le tableau de bord sur
    //    ses valeurs de la veille (chaque ligne porte son ComputedAt), il ne
    //    marque pas la synchro « échouée ».
    try {
      const indicateurs = await computeIndicateurs(graph, siteId, {
        dryRun,
        log,
      });
      log(formatIndicateursSummary(indicateurs, dryRun));
    } catch (err) {
      context.error(
        `⚠ Calcul des indicateurs ÉCHOUÉ : ${
          err instanceof Error ? err.message : String(err)
        } — le tableau de bord reste sur ses valeurs de la veille.`
      );
    }

    // 3) MOTEUR DE RAPPELS (module 4, chantier R2b) : il tourne EN DERNIER —
    //    après la synchro (photo Soldes fraîche) et les indicateurs (les
    //    estampilles que son garde-fou §4.4 relit). Même règle d'isolement :
    //    un échec du moteur ne marque JAMAIS la nuit « échouée ». En
    //    fonctionnement normal, l'interrupteur « Reminder1Enabled » (liste
    //    Config) est le SEUL maître : OFF -> abstention ET estampille
    //    « LastReminder1Run » avec la raison — la preuve de vie quotidienne
    //    que le tableau de bord staff affiche. SOLDES_DRY_RUN=true force
    //    aussi le moteur en dry-run (rien n'est écrit, rien n'est envoyé,
    //    aucune estampille : une répétition n'est pas un passage).
    try {
      const mailCtx: ReminderMailContext = {
        senderUserId: (process.env["GRAPH_SENDER_USER_ID"] ?? "").trim(),
        portalUrl: derivePortalUrl(),
        paymentIban: (process.env["PAYMENT_IBAN"] ?? "").trim(),
        paymentBeneficiary: (process.env["PAYMENT_BENEFICIARY"] ?? "").trim(),
      };
      const rappels = await runReminder1(cfg, graph, mailCtx, { dryRun, log });
      log(formatReminderSummary(rappels));
      if (!rappels.aborted && rappels.failed > 0) {
        context.warn(
          `⚠ Rappels : ${rappels.failed} envoi(s) en échec — retentés au ` +
            `prochain passage (lignes « Failed » dans Journal-Rappels).`
        );
      }
    } catch (err) {
      context.error(
        `⚠ Moteur de rappels ÉCHOUÉ : ${
          err instanceof Error ? err.message : String(err)
        } — la synchro et les indicateurs de cette nuit, eux, sont intacts.`
      );
    }

    // 4) RAPPEL 2 (module 4, chantier R3a) : APRÈS le rappel 1, il CONSOMME le
    //    lot « Queued » validé le matin par un collaborateur (app staff, R3b)
    //    et l'envoie — la nuit N+1. Même règle d'isolement : un échec du
    //    rappel 2 ne marque JAMAIS la nuit « échouée », et n'affecte ni la
    //    synchro, ni les indicateurs, ni le rappel 1 déjà passés. Interrupteur
    //    PROPRE « Reminder2Enabled » (Config) : OFF -> abstention + estampille
    //    « LastReminder2Run ». SOLDES_DRY_RUN=true force aussi le rappel 2 en
    //    dry-run (revalidation et aperçu, rien n'est écrit ni envoyé).
    try {
      const mailCtx2: ReminderMailContext = {
        senderUserId: (process.env["GRAPH_SENDER_USER_ID"] ?? "").trim(),
        portalUrl: derivePortalUrl(),
        paymentIban: (process.env["PAYMENT_IBAN"] ?? "").trim(),
        paymentBeneficiary: (process.env["PAYMENT_BENEFICIARY"] ?? "").trim(),
      };
      const rappels2 = await runReminder2(cfg, graph, mailCtx2, { dryRun, log });
      log(formatReminder2Summary(rappels2));
      if (!rappels2.aborted && rappels2.failed > 0) {
        context.warn(
          `⚠ Rappel 2 : ${rappels2.failed} envoi(s) en échec — la ligne reste ` +
            `« Failed » dans Journal-Rappels (résolution humaine).`
        );
      }
    } catch (err) {
      context.error(
        `⚠ Moteur de rappel 2 ÉCHOUÉ : ${
          err instanceof Error ? err.message : String(err)
        } — la synchro, les indicateurs et le rappel 1 de cette nuit sont intacts.`
      );
    }

    const seconds = Math.round((Date.now() - startedAt) / 1000);
    log(`Synchronisation Soldes — terminée en ${seconds}s.`);
  } catch (err) {
    // On journalise en ERREUR (visible dans Application Insights) ET on relance :
    // l'exécution est ainsi marquée « échouée » côté plateforme. Un timer ne
    // rejoue PAS après un échec — la prochaine exécution nocturne resynchronise
    // de toute façon (upsert idempotent), donc une nuit ratée n'est pas grave.
    const detail =
      err instanceof SoldesSyncError
        ? err.message
        : err instanceof Error
          ? err.stack ?? err.message
          : String(err);
    context.error(`Échec de la synchronisation Soldes : ${detail}`);
    throw err;
  }
}

// Enregistrement de la Function (modèle Node v4). NCRONTAB à 6 champs :
// {seconde} {minute} {heure} {jour} {mois} {jour-semaine}. 01:30 UTC chaque
// jour = 02:30 (hiver) / 03:30 (été) en Belgique — nocturne toute l'année.
app.timer("soldesNightly", {
  schedule: "0 30 1 * * *",
  runOnStartup: false,
  handler: soldesNightly,
});
