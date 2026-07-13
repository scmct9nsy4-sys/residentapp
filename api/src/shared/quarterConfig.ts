import { InvocationContext } from "@azure/functions";

// ============================================================================
//  quarterConfig.ts — Trimestre ACTIF de l'application (chantier §10.0)
// ----------------------------------------------------------------------------
//  AVANT (jusqu'au 13/7/2026) : le trimestre courant était câblé dans les
//  variables d'environnement SP_CUMUL_LIST_NAME / SP_CUMUL_LIST_ID /
//  SP_CUMUL_PREV_LIST_NAME. Chaque bascule trimestrielle exigeait de les
//  modifier À LA MAIN puis de REDÉPLOYER — avec un piège vérifié : l'ID
//  primait sur le nom, donc changer le seul nom n'avait aucun effet, sans le
//  moindre message d'erreur.
//
//  MAINTENANT : la liste SharePoint « Config » porte UNE ligne de clé
//  Title = "ActiveQuarter" (Quarter, Year, CumulListId, CumulListName),
//  écrite par « npm run sp:rotate » À LA FIN de la rotation (après archivage
//  et vidage réussis, confirmation BASCULER). La bascule métier EST cette
//  écriture : plus de variable à modifier, plus de redéploiement, plus
//  d'oubli. Le piège « l'ID prime sur le nom » disparaît structurellement :
//  l'ID et le nom sont écrits ENSEMBLE, par le même script, au même instant.
//
//  LECTURE :
//   - cache mémoire de 5 minutes (les Functions restent chaudes : la liste
//     Config n'est PAS relue à chaque requête) ;
//   - la liste Config est lue SANS $filter (quelques lignes tout au plus :
//     aucun enjeu d'indexation ni de seuil des 5 000 éléments) ;
//   - REPLI : si la liste Config est absente, illisible ou si la ligne
//     ActiveQuarter est invalide, on retombe sur les variables
//     d'environnement historiques (comportement d'avant le 13/7). Le repli
//     est journalisé BRUYAMMENT et n'est mis en cache que 60 secondes, pour
//     que le retour à la normale soit rapide.
//
//  Partagé par Me.ts et Declare.ts (fini le « garder les deux synchronisées »
//  pour cette partie). La future app staff lira la MÊME liste Config.
// ============================================================================

// --- Liste Config (résolution par ID si fourni, sinon par nom) ---
const SP_CONFIG_LIST_NAME = process.env["SP_CONFIG_LIST_NAME"] ?? "Config";
const SP_CONFIG_LIST_ID = process.env["SP_CONFIG_LIST_ID"]; // optionnel

// --- Variables d'environnement historiques = REPLI uniquement ---
const ENV_CUMUL_LIST_ID = process.env["SP_CUMUL_LIST_ID"];
const ENV_CUMUL_LIST_NAME =
  process.env["SP_CUMUL_LIST_NAME"] ?? "KB-Cumul T4";
const ENV_CUMUL_PREV_LIST_NAME =
  process.env["SP_CUMUL_PREV_LIST_NAME"] ?? "KB-Cumul T3";

// Durées de cache : 5 min quand Config répond, 60 s en repli (on re-tente
// vite de lire Config pour sortir du repli dès qu'elle redevient lisible).
const CACHE_TTL_CONFIG_MS = 5 * 60 * 1000;
const CACHE_TTL_FALLBACK_MS = 60 * 1000;

export type ActiveQuarter = {
  /** "config" = lu dans la liste Config ; "env" = repli variables d'env. */
  source: "config" | "env";
  /** Trimestre actif 1-4 (null seulement en repli si le nom est atypique). */
  quarter: number | null;
  /** Année du trimestre actif (null en repli : les variables ne la portent pas). */
  year: number | null;
  /** ID de la liste KB-Cumul du trimestre actif (null si inconnu -> résoudre par nom). */
  listId: string | null;
  /** Nom d'affichage de la liste KB-Cumul du trimestre actif. */
  listName: string;
  /** Trimestre précédent 1-4 (dérivé, ou lu du nom de liste en repli). */
  prevQuarter: number | null;
  /** Nom de la liste KB-Cumul du trimestre précédent. */
  prevListName: string;
};

let cache: { value: ActiveQuarter; expiresAt: number } | null = null;

// ---------- Helpers ----------

// Extrait le n° de trimestre d'un nom de liste ("KB-Cumul T4" -> 4).
export function quarterFromListName(name: string): number | null {
  const m = /T\s*([1-4])/i.exec(name);
  return m ? Number(m[1]) : null;
}

function prevQuarterOf(quarter: number): number {
  return quarter === 1 ? 4 : quarter - 1;
}

function toIntOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) ? n : null;
}

// Repli : reconstruit l'état "comme avant" depuis les variables d'environnement.
function envFallback(): ActiveQuarter {
  const quarter = quarterFromListName(ENV_CUMUL_LIST_NAME);
  return {
    source: "env",
    quarter,
    year: null,
    listId: ENV_CUMUL_LIST_ID?.trim() ? ENV_CUMUL_LIST_ID.trim() : null,
    listName: ENV_CUMUL_LIST_NAME,
    prevQuarter: quarterFromListName(ENV_CUMUL_PREV_LIST_NAME),
    prevListName: ENV_CUMUL_PREV_LIST_NAME,
  };
}

// ---------- Lecture de la liste Config via Graph ----------

async function resolveConfigListId(
  siteId: string,
  token: string
): Promise<string | null> {
  if (SP_CONFIG_LIST_ID?.trim()) return SP_CONFIG_LIST_ID.trim();
  const name = SP_CONFIG_LIST_NAME.replace(/'/g, "''");
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists` +
    `?$select=id,displayName&$filter=displayName eq '${name}'`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Résolution de la liste Config : statut ${res.status}`);
  }
  const json = (await res.json()) as { value?: Array<{ id: string }> };
  return json.value?.[0]?.id ?? null;
}

// Lit la ligne "ActiveQuarter". Renvoie null si liste absente, ligne absente
// ou contenu invalide (l'appelant journalise et passe en repli).
async function readActiveQuarterRow(
  siteId: string,
  token: string,
  context: InvocationContext
): Promise<ActiveQuarter | null> {
  const listId = await resolveConfigListId(siteId, token);
  if (!listId) return null;

  // Liste minuscule (une ligne par clé de configuration) : lecture SANS
  // $filter — aucun besoin d'index, aucun risque lié au seuil des 5 000.
  const url =
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}` +
    `/items?$expand=fields($select=Title,Quarter,Year,CumulListId,CumulListName)` +
    `&$top=20`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Lecture de la liste Config : statut ${res.status}`);
  }
  const json = (await res.json()) as {
    value?: Array<{ fields?: Record<string, unknown> }>;
  };

  const row = (json.value ?? [])
    .map((it) => it.fields ?? {})
    .find(
      (f) =>
        String(f["Title"] ?? "").trim().toLowerCase() === "activequarter"
    );
  if (!row) {
    context.log("Liste Config trouvée mais SANS ligne « ActiveQuarter ».");
    return null;
  }

  const quarter = toIntOrNull(row["Quarter"]);
  const year = toIntOrNull(row["Year"]);
  if (quarter === null || quarter < 1 || quarter > 4) {
    context.log(
      "Ligne ActiveQuarter invalide (Quarter doit être un entier 1-4)."
    );
    return null;
  }
  if (year === null || year < 2020 || year > 2100) {
    context.log(
      "Ligne ActiveQuarter invalide (Year manquante ou hors plage)."
    );
    return null;
  }

  const rawListId = String(row["CumulListId"] ?? "").trim();
  const rawListName = String(row["CumulListName"] ?? "").trim();
  const listName = rawListName !== "" ? rawListName : `KB-Cumul T${quarter}`;
  const prevQuarter = prevQuarterOf(quarter);

  return {
    source: "config",
    quarter,
    year,
    listId: rawListId !== "" ? rawListId : null,
    listName,
    prevQuarter,
    prevListName: `KB-Cumul T${prevQuarter}`,
  };
}

// ---------- API publique ----------

/**
 * Renvoie le trimestre actif de l'application.
 * Ordre : cache mémoire -> liste SharePoint « Config » -> repli variables
 * d'environnement (journalisé ⚠, cache court pour re-tenter vite).
 */
export async function getActiveQuarter(
  siteId: string,
  token: string,
  context: InvocationContext
): Promise<ActiveQuarter> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  try {
    const fromConfig = await readActiveQuarterRow(siteId, token, context);
    if (fromConfig) {
      context.log(
        `Trimestre actif : T${fromConfig.quarter} ${fromConfig.year} ` +
          `(liste « ${fromConfig.listName} », source : Config).`
      );
      cache = { value: fromConfig, expiresAt: now + CACHE_TTL_CONFIG_MS };
      return fromConfig;
    }
  } catch (error) {
    context.log("⚠ Lecture de la liste Config en échec :", error);
  }

  const fallback = envFallback();
  context.log(
    `⚠ REPLI variables d'environnement : trimestre « ${fallback.listName} ». ` +
      `Si une rotation a eu lieu depuis le dernier déploiement, ces variables ` +
      `peuvent être PÉRIMÉES — vérifier la liste Config (ligne ActiveQuarter) ` +
      `et relancer « npm run sp:rotate -- T<n> --config-only » au besoin.`
  );
  cache = { value: fallback, expiresAt: now + CACHE_TTL_FALLBACK_MS };
  return fallback;
}

/** Vide le cache (tests / diagnostics). */
export function clearActiveQuarterCache(): void {
  cache = null;
}
