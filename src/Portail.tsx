// =============================================================================
// Portail.tsx — Espace sécurisé du résident (version sans MUI)
// -----------------------------------------------------------------------------
// La logique est inchangée : /.auth/me → redirection connexion si besoin,
// puis /api/me → affichage des montants (états loading / ready / nodata / error).
// Nouveautés visuelles :
//   - Même en-tête que le formulaire (cohérence entre les deux pages),
//     avec le sélecteur de langue désormais disponible aussi ici
//   - Titre avec le trait rouge de la charte
//   - Montants présentés en tuiles (grille 2 colonnes, 1 sur mobile)
// Après remplacement de ce fichier : MUI n'est plus utilisé nulle part →
// on pourra désinstaller @mui/* et @emotion/*.
// =============================================================================

import { useState, useEffect } from "react";

import { useLanguage } from "./i18n/useLanguage";
import type { Language } from "./i18n/translations";

// Libellés propres à cette page (gardés ici pour ne pas alourdir translations.ts).
const labels = {
  fr: {
    welcome: "Bienvenue",
    activated: "Votre accès est activé.",
    intro: "Voici vos informations.",
    netSalary: "Salaire net",
    grossSalary: "Salaire brut",
    contribution: "Cotisation",
    paid: "Payé",
    loading: "Chargement de vos informations…",
    noData:
      "Votre compte est bien activé, mais aucune information n'est encore associée. Contactez votre personne de référence si cela persiste.",
    error:
      "Vos informations n'ont pas pu être chargées pour le moment. Veuillez réessayer plus tard.",
    logout: "Se déconnecter",
  },
  nl: {
    welcome: "Welkom",
    activated: "Uw toegang is geactiveerd.",
    intro: "Hier zijn uw gegevens.",
    netSalary: "Nettoloon",
    grossSalary: "Brutoloon",
    contribution: "Bijdrage",
    paid: "Betaald",
    loading: "Uw gegevens worden geladen…",
    noData:
      "Uw account is geactiveerd, maar er zijn nog geen gegevens gekoppeld. Neem contact op met uw contactpersoon als dit blijft duren.",
    error:
      "Uw gegevens konden momenteel niet worden geladen. Probeer het later opnieuw.",
    logout: "Afmelden",
  },
  en: {
    welcome: "Welcome",
    activated: "Your access is now active.",
    intro: "Here is your information.",
    netSalary: "Net salary",
    grossSalary: "Gross salary",
    contribution: "Contribution",
    paid: "Paid",
    loading: "Loading your information…",
    noData:
      "Your account is active, but no information is linked yet. Contact your reference person if this persists.",
    error:
      "Your information could not be loaded right now. Please try again later.",
    logout: "Sign out",
  },
} as const;

type CumulData = {
  netSalary: string;
  grossSalary: string;
  contribution: string;
  paid: string;
};

type Status = "loading" | "ready" | "nodata" | "error";

// --- Petits composants de présentation ----------------------------------------

/** Sélecteur de langue en pilules (copie locale de celui d'App.tsx ;
 *  à factoriser dans src/components/ si un 3e écran apparaît un jour). */
function LangPills({
  value,
  onChange,
  ariaLabel,
}: {
  value: Language;
  onChange: (lang: Language) => void;
  ariaLabel: string;
}) {
  const options: Language[] = ["fr", "nl", "en"];
  const labels: Record<Language, string> = { fr: "FR", nl: "NL", en: "EN" };
  return (
    <div className="lang-switch" role="group" aria-label={ariaLabel}>
      {options.map((lang) => (
        <button
          key={lang}
          type="button"
          aria-pressed={value === lang}
          onClick={() => onChange(lang)}
        >
          {labels[lang]}
        </button>
      ))}
    </div>
  );
}

/** Coche verte (remplace CheckCircleOutlineIcon, sans dépendance). */
function CheckIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12.5l2.5 2.5L16 9" />
    </svg>
  );
}

/** Tuile de donnée : libellé + valeur. */
function DataTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`data-tile${highlight ? " highlight" : ""}`}>
      <span className="label">{label}</span>
      <span className="value">{value || "—"}</span>
    </div>
  );
}

// --- Composant principal --------------------------------------------------------

export default function Portail() {
  const { language, setLanguage } = useLanguage();
  const t = labels[language];

  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<CumulData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // 1) Qui est connecté ? (fourni par Azure Static Web Apps)
        const authRes = await fetch("/.auth/me");
        const authJson = (await authRes.json()) as {
          clientPrincipal: { userDetails?: string } | null;
        };

        // Pas connecté -> redirection vers la connexion Microsoft
        if (!authJson.clientPrincipal) {
          window.location.href =
            "/.auth/login/aad?post_login_redirect_uri=/portail";
          return;
        }

        // 2) Récupérer SES données (filtrage fait côté serveur)
        const res = await fetch("/api/me");
        if (cancelled) return;

        if (res.status === 404) {
          setStatus("nodata");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }

        const json = (await res.json()) as CumulData;
        setData(json);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <header className="app-header">
        {/* Logo : remplacer par le SVG officiel Fedasil quand disponible */}
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">
            F
          </div>
          <span>fedasil</span>
        </div>

        <LangPills
          value={language}
          onChange={setLanguage}
          ariaLabel="Language / Langue / Taal"
        />
      </header>

      <main className="page">
        <h1 className="page-title">{t.welcome}</h1>
        <div className="title-accent" aria-hidden="true" />
        <p className="page-subtitle">{t.intro}</p>

        <div className="card">
          <div className="alert alert-success alert-flex" role="status">
            <CheckIcon />
            <span>{t.activated}</span>
          </div>

          {status === "loading" && (
            <div className="loading-row" role="status">
              <span className="spinner spinner-violet" aria-hidden="true" />
              <span>{t.loading}</span>
            </div>
          )}

          {status === "error" && (
            <div className="alert alert-error" role="alert">
              {t.error}
            </div>
          )}

          {status === "nodata" && (
            <div className="alert alert-info" role="status">
              {t.noData}
            </div>
          )}

          {status === "ready" && data && (
            <div className="data-grid">
              <DataTile label={t.grossSalary} value={data.grossSalary} />
              <DataTile label={t.netSalary} value={data.netSalary} highlight />
              <DataTile label={t.contribution} value={data.contribution} />
              <DataTile label={t.paid} value={data.paid} />
            </div>
          )}

          <div className="card-footer">
            <a
              className="btn btn-outline"
              href="/.auth/logout?post_logout_redirect_uri=/"
            >
              {t.logout}
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
