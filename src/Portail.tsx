// =============================================================================
// Portail.tsx — Espace sécurisé du résident (version sans MUI)
// -----------------------------------------------------------------------------
// Flux : /.auth/me → redirection connexion si besoin, puis /api/me.
// L'API renvoie toutes les déclarations du trimestre, triées de la plus
// récente à la plus ancienne : { quarter, months: [...] }.
// Présentation :
//   1. Tuiles du mois AFFICHÉ (par défaut le plus récent ; cliquer un mois
//      dans la carte trimestre change le mois affiché)
//   2. Carte « Trimestre en cours » : lignes de mois CLIQUABLES (coche =
//      déclaré), total du trimestre
//   3. « Paiements du trimestre » : à payer / déjà payé / reste à payer
//      (l'information principale pour le résident)
//   4. Bouton vers le trimestre précédent (/api/me?quarter=previous)
// =============================================================================

import { useState, useEffect } from "react";
import QRCode from "qrcode";

import { useLanguage } from "./i18n/useLanguage";
import type { Language } from "./i18n/translations";

// Libellés propres à cette page (gardés ici pour ne pas alourdir translations.ts).
const labels = {
  fr: {
    welcome: "Bienvenue",
    activated: "Votre accès est activé.",
    intro: "Voici vos informations.",
    lastDeclaration: "Votre dernière déclaration",
    displayedDeclaration: "Déclaration affichée",
    netSalary: "Salaire net",
    grossSalary: "Salaire brut",
    contribution: "Cotisation",
    paid: "Payé",
    netShort: "net",
    contribShort: "cotisation",
    quarterCurrent: "Trimestre en cours",
    quarterPrevious: "Trimestre précédent",
    declared: "Déclaration reçue",
    notYetDeclared: "pas encore de déclaration",
    showMonth: "Afficher ce mois",
    quarterTotal: "Total du trimestre",
    paymentsTitle: "Paiements du trimestre",
    toPay: "À payer",
    alreadyPaid: "Déjà payé",
    remaining: "Reste à payer",
    seePrevious: "Voir le trimestre précédent",
    backToCurrent: "Revenir au trimestre en cours",
    payTitle: "Payer ma cotisation",
    payFor: "Paiement pour",
    scanQr: "Scannez ce code avec votre application bancaire :",
    orManual: "Ou faites un virement avec ces informations :",
    beneficiaryLabel: "Bénéficiaire",
    ibanLabel: "Compte (IBAN)",
    amountLabel: "Montant",
    communicationLabel: "Communication structurée",
    commNote:
      "Important : utilisez uniquement cette communication structurée, sans rien ajouter ni modifier.",
    paidDelay:
      "Après votre virement, le paiement peut prendre quelques jours pour apparaître ici.",
    monthPaid: "La cotisation de {month} est payée.",
    olderDue: "Attention : la cotisation de {month} n'est pas encore payée.",
    seeMonth: "Voir",
    copy: "Copier",
    copied: "Copié ✓",
    noDeclarations: "Aucune déclaration pour ce trimestre pour le moment.",
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
    lastDeclaration: "Uw laatste aangifte",
    displayedDeclaration: "Weergegeven aangifte",
    netSalary: "Nettoloon",
    grossSalary: "Brutoloon",
    contribution: "Bijdrage",
    paid: "Betaald",
    netShort: "netto",
    contribShort: "bijdrage",
    quarterCurrent: "Huidig kwartaal",
    quarterPrevious: "Vorig kwartaal",
    declared: "Aangifte ontvangen",
    notYetDeclared: "nog geen aangifte",
    showMonth: "Deze maand weergeven",
    quarterTotal: "Totaal van het kwartaal",
    paymentsTitle: "Betalingen van het kwartaal",
    toPay: "Te betalen",
    alreadyPaid: "Al betaald",
    remaining: "Nog te betalen",
    seePrevious: "Vorig kwartaal bekijken",
    backToCurrent: "Terug naar het huidige kwartaal",
    payTitle: "Mijn bijdrage betalen",
    payFor: "Betaling voor",
    scanQr: "Scan deze code met uw bankapp:",
    orManual: "Of doe een overschrijving met deze gegevens:",
    beneficiaryLabel: "Begunstigde",
    ibanLabel: "Rekening (IBAN)",
    amountLabel: "Bedrag",
    communicationLabel: "Gestructureerde mededeling",
    commNote:
      "Belangrijk: gebruik uitsluitend deze gestructureerde mededeling, zonder iets toe te voegen of te wijzigen.",
    paidDelay:
      "Na uw overschrijving kan het enkele dagen duren voordat de betaling hier verschijnt.",
    monthPaid: "De bijdrage van {month} is betaald.",
    olderDue: "Opgelet: de bijdrage van {month} is nog niet betaald.",
    seeMonth: "Bekijk",
    copy: "Kopiëren",
    copied: "Gekopieerd ✓",
    noDeclarations: "Nog geen aangiften voor dit kwartaal.",
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
    lastDeclaration: "Your latest declaration",
    displayedDeclaration: "Displayed declaration",
    netSalary: "Net salary",
    grossSalary: "Gross salary",
    contribution: "Contribution",
    paid: "Paid",
    netShort: "net",
    contribShort: "contribution",
    quarterCurrent: "Current quarter",
    quarterPrevious: "Previous quarter",
    declared: "Declaration received",
    notYetDeclared: "no declaration yet",
    showMonth: "Show this month",
    quarterTotal: "Quarter total",
    paymentsTitle: "Quarter payments",
    toPay: "To pay",
    alreadyPaid: "Already paid",
    remaining: "Remaining",
    seePrevious: "View previous quarter",
    backToCurrent: "Back to current quarter",
    payTitle: "Pay my contribution",
    payFor: "Payment for",
    scanQr: "Scan this code with your banking app:",
    orManual: "Or make a transfer with these details:",
    beneficiaryLabel: "Beneficiary",
    ibanLabel: "Account (IBAN)",
    amountLabel: "Amount",
    communicationLabel: "Structured communication",
    commNote:
      "Important: use only this structured communication, without adding or changing anything.",
    paidDelay:
      "After your transfer, the payment may take a few days to appear here.",
    monthPaid: "The contribution for {month} is paid.",
    olderDue: "Note: the contribution for {month} has not been paid yet.",
    seeMonth: "View",
    copy: "Copy",
    copied: "Copied ✓",
    noDeclarations: "No declarations for this quarter yet.",
    loading: "Loading your information…",
    noData:
      "Your account is active, but no information is linked yet. Contact your reference person if this persists.",
    error:
      "Your information could not be loaded right now. Please try again later.",
    logout: "Sign out",
  },
} as const;

// --- Types (alignés sur la réponse de /api/me) ----------------------------------

type MonthlyDeclaration = {
  month: number;
  netSalary: number | null;
  grossSalary: number | null;
  contribution: number | null;
  paid: number | null;
  structuredCom: string | null;
};

type PaymentConfig = {
  iban: string;
  beneficiary: string;
};

type MeResponse = {
  quarter: number | null;
  months: MonthlyDeclaration[]; // trié du plus récent au plus ancien
  payment?: PaymentConfig | null;
};

type Status = "loading" | "ready" | "nodata" | "error";
type PrevStatus = "idle" | "loading" | "ready" | "error";

// --- Formatage (mois et montants, selon la langue de l'interface) ----------------

const LOCALES: Record<Language, string> = {
  fr: "fr-BE",
  nl: "nl-BE",
  en: "en-GB",
};

/** Nom du mois (1-12) dans la langue courante, avec majuscule initiale. */
function monthName(month: number, lang: Language): string {
  const name = new Date(2000, month - 1, 1).toLocaleDateString(LOCALES[lang], {
    month: "long",
  });
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Montant en euros ("—" si absent). */
function euro(value: number | null, lang: Language): string {
  if (value === null) return "—";
  return new Intl.NumberFormat(LOCALES[lang], {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

/** Les 3 mois d'un trimestre (ex. 4 -> [10, 11, 12]). */
function quarterMonths(quarter: number): number[] {
  return [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
}

/** Contenu d'un QR EPC (« SEPA Credit Transfer », norme EPC069-12).
 *  Reconnu par les applications bancaires belges (ING, KBC, Belfius…).
 *  La communication structurée belge (+++...+++) se place dans le champ
 *  « remittance non structurée » (ligne 11) : les apps belges la
 *  reconnaissent et la convertissent en communication structurée. */
function epcQrPayload(
  beneficiary: string,
  iban: string,
  amount: number,
  remittance: string
): string {
  return [
    "BCD", // service tag
    "002", // version (BIC facultatif)
    "1", // encodage UTF-8
    "SCT", // SEPA Credit Transfer
    "", // BIC (facultatif en version 002)
    beneficiary.slice(0, 70),
    iban.replace(/\s+/g, ""),
    `EUR${amount.toFixed(2)}`,
    "", // purpose
    "", // référence structurée ISO 11649 (non utilisée en Belgique)
    remittance, // communication belge +++.../.../..+++
  ].join("\n");
}

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

/** Coche verte (sans dépendance). */
function CheckIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

/** Tuile de donnée : libellé + valeur.
 *  tone : "highlight" = valeur en violet, "ok" = valeur en vert. */
function DataTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "highlight" | "ok";
}) {
  return (
    <div className={`data-tile${tone ? ` ${tone}` : ""}`}>
      <span className="label">{label}</span>
      <span className="value">{value || "—"}</span>
    </div>
  );
}

/** Carte trimestre : une ligne par mois + total.
 *  Si onSelectMonth est fourni, les mois déclarés sont cliquables et le mois
 *  sélectionné est mis en évidence. */
function QuarterCard({
  data,
  lang,
  selectedMonth,
  onSelectMonth,
}: {
  data: MeResponse;
  lang: Language;
  selectedMonth?: number | null;
  onSelectMonth?: (month: number) => void;
}) {
  const t = labels[lang];
  const byMonth = new Map(data.months.map((m) => [m.month, m]));

  // Les 3 mois du trimestre si connu, sinon uniquement les mois déclarés.
  const monthsToShow =
    data.quarter !== null
      ? quarterMonths(data.quarter)
      : [...byMonth.keys()].sort((a, b) => a - b);

  const totalNet = data.months.reduce((s, m) => s + (m.netSalary ?? 0), 0);
  const totalContrib = data.months.reduce(
    (s, m) => s + (m.contribution ?? 0),
    0
  );

  return (
    <div className="quarter-card">
      {monthsToShow.map((month) => {
        const decl = byMonth.get(month);

        if (!decl) {
          return (
            <div className="quarter-row q-missing" key={month}>
              <span className="q-month">{monthName(month, lang)}</span>
              <span className="q-amounts">{t.notYetDeclared}</span>
              <span className="q-check" aria-hidden="true">
                —
              </span>
            </div>
          );
        }

        const content = (
          <>
            <span className="q-month">{monthName(month, lang)}</span>
            <span className="q-amounts">
              {t.netShort} {euro(decl.netSalary, lang)} · {t.contribShort}{" "}
              {euro(decl.contribution, lang)}
            </span>
            <span className="q-check" role="img" aria-label={t.declared}>
              <CheckIcon size={18} />
            </span>
          </>
        );

        // Mois cliquable : affiche ce mois dans les tuiles du haut.
        return onSelectMonth ? (
          <button
            type="button"
            key={month}
            className={`quarter-row q-clickable${
              selectedMonth === month ? " q-selected" : ""
            }`}
            aria-current={selectedMonth === month ? "true" : undefined}
            aria-label={`${t.showMonth} : ${monthName(month, lang)}`}
            onClick={() => onSelectMonth(month)}
          >
            {content}
          </button>
        ) : (
          <div className="quarter-row" key={month}>
            {content}
          </div>
        );
      })}

      <div className="quarter-total">
        <span className="q-label">{t.quarterTotal}</span>
        <span>
          {t.netShort} <strong>{euro(totalNet, lang)}</strong> ·{" "}
          {t.contribShort} <strong>{euro(totalContrib, lang)}</strong>
        </span>
      </div>
    </div>
  );
}

/** Carte de paiement : QR EPC + informations de virement copiables.
 *  Affichée pour le mois impayé le plus ancien (règle d'imputation FIFO). */
function PaymentCard({
  month,
  amount,
  structuredCom,
  payment,
  lang,
}: {
  month: number;
  amount: number;
  structuredCom: string;
  payment: PaymentConfig;
  lang: Language;
}) {
  const t = labels[lang];
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Génère le QR localement (aucun service externe, compatible CSP).
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(
      epcQrPayload(payment.beneficiary, payment.iban, amount, structuredCom),
      { width: 200, margin: 2, errorCorrectionLevel: "M" }
    )
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null); // pas de QR -> champs manuels seuls
      });
    return () => {
      cancelled = true;
    };
  }, [payment.beneficiary, payment.iban, amount, structuredCom]);

  const copy = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Presse-papiers indisponible : l'utilisateur peut sélectionner le texte.
    }
  };

  const amountText = new Intl.NumberFormat(LOCALES[lang], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  const fields: Array<{ key: string; label: string; value: string }> = [
    { key: "benef", label: t.beneficiaryLabel, value: payment.beneficiary },
    { key: "iban", label: t.ibanLabel, value: payment.iban },
    { key: "amount", label: t.amountLabel, value: amountText },
    { key: "com", label: t.communicationLabel, value: structuredCom },
  ];

  return (
    <div className="payment-card">
      <p className="payment-for">
        {t.payFor} <strong>{monthName(month, lang)}</strong> ·{" "}
        <strong>{euro(amount, lang)}</strong>
      </p>

      {qrDataUrl && (
        <div className="qr-block">
          <p>{t.scanQr}</p>
          <img
            src={qrDataUrl}
            width={200}
            height={200}
            alt={`QR — ${t.payFor} ${monthName(month, lang)}`}
          />
        </div>
      )}

      <p className="payment-manual-intro">{t.orManual}</p>
      <div className="payment-fields">
        {fields.map((f) => (
          <div className="pay-field" key={f.key}>
            <span className="pf-label">{f.label}</span>
            <span className="pf-value">{f.value}</span>
            <button
              type="button"
              className="btn btn-outline btn-copy"
              onClick={() => copy(f.key, f.value)}
            >
              {copiedField === f.key ? t.copied : t.copy}
            </button>
          </div>
        ))}
      </div>

      <p className="payment-note">{t.commNote}</p>
      <p className="payment-delay">{t.paidDelay}</p>
    </div>
  );
}

// --- Composant principal --------------------------------------------------------

export default function Portail() {
  const { language, setLanguage } = useLanguage();
  const t = labels[language];

  const [status, setStatus] = useState<Status>("loading");
  const [current, setCurrent] = useState<MeResponse | null>(null);

  // Mois affiché dans les tuiles (par défaut : le plus récent).
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  // Trimestre précédent : chargé à la demande, puis gardé en mémoire.
  const [view, setView] = useState<"current" | "previous">("current");
  const [prevStatus, setPrevStatus] = useState<PrevStatus>("idle");
  const [previous, setPrevious] = useState<MeResponse | null>(null);

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

        const json = (await res.json()) as MeResponse;
        setCurrent(json);
        setSelectedMonth(json.months[0]?.month ?? null);
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

  // Bascule vers le trimestre précédent (chargé une seule fois).
  const showPrevious = async () => {
    setView("previous");
    if (prevStatus !== "idle") return;
    setPrevStatus("loading");
    try {
      const res = await fetch("/api/me?quarter=previous");
      if (!res.ok) {
        setPrevStatus("error");
        return;
      }
      const json = (await res.json()) as MeResponse;
      setPrevious(json);
      setPrevStatus("ready");
    } catch {
      setPrevStatus("error");
    }
  };

  // Déclaration affichée dans les tuiles (mois sélectionné, sinon la dernière).
  const latestMonth = current?.months[0]?.month ?? null;
  const displayed =
    current?.months.find((m) => m.month === selectedMonth) ??
    current?.months[0] ??
    null;

  // Récapitulatif des paiements du trimestre en cours.
  const totalToPay =
    current?.months.reduce((s, m) => s + (m.contribution ?? 0), 0) ?? 0;
  const totalPaid = current?.months.reduce((s, m) => s + (m.paid ?? 0), 0) ?? 0;
  const remaining = Math.max(0, totalToPay - totalPaid);

  // Solde du mois AFFICHÉ (le paiement suit le mois sélectionné).
  const displayedDue = displayed
    ? Math.max(0, (displayed.contribution ?? 0) - (displayed.paid ?? 0))
    : 0;

  // Mois impayé le plus ancien : sert d'avertissement si le résident regarde
  // un mois plus récent alors qu'un mois antérieur reste dû (logique FIFO).
  const oldestUnpaid = current
    ? [...current.months]
        .sort((a, b) => a.month - b.month)
        .find((m) => (m.contribution ?? 0) - (m.paid ?? 0) > 0.005) ?? null
    : null;

  const quarterTitle = (data: MeResponse | null, base: string): string => {
    if (!data || data.quarter === null) return base;
    const [first, , last] = quarterMonths(data.quarter);
    return `${base} (${monthName(first, language).toLowerCase()} – ${monthName(
      last,
      language
    ).toLowerCase()})`;
  };

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

          {/* ---------- Vue : trimestre en cours ---------- */}
          {status === "ready" && current && view === "current" && (
            <>
              {current.months.length === 0 ? (
                <div className="alert alert-info" role="status">
                  {t.noDeclarations}
                </div>
              ) : (
                <>
                  {/* 1. Tuiles du mois affiché */}
                  <h2 className="portal-section-title">
                    {displayed && displayed.month === latestMonth
                      ? t.lastDeclaration
                      : t.displayedDeclaration}
                  </h2>
                  {displayed && (
                    <>
                      <p className="month-caption">
                        {monthName(displayed.month, language)}
                      </p>
                      <div className="data-grid">
                        <DataTile
                          label={t.grossSalary}
                          value={euro(displayed.grossSalary, language)}
                        />
                        <DataTile
                          label={t.netSalary}
                          value={euro(displayed.netSalary, language)}
                          tone="highlight"
                        />
                        <DataTile
                          label={t.contribution}
                          value={euro(displayed.contribution, language)}
                        />
                        <DataTile
                          label={t.paid}
                          value={euro(displayed.paid, language)}
                        />
                      </div>
                    </>
                  )}

                  {/* 2. Les mois du trimestre (cliquables) */}
                  <h2 className="portal-section-title">
                    {quarterTitle(current, t.quarterCurrent)}
                  </h2>
                  <QuarterCard
                    data={current}
                    lang={language}
                    selectedMonth={selectedMonth}
                    onSelectMonth={setSelectedMonth}
                  />

                  {/* 3. Récapitulatif des paiements (l'info clé du résident) */}
                  <h2 className="portal-section-title">{t.paymentsTitle}</h2>
                  <div className="recap-grid">
                    <DataTile
                      label={t.toPay}
                      value={euro(totalToPay, language)}
                    />
                    <DataTile
                      label={t.alreadyPaid}
                      value={euro(totalPaid, language)}
                    />
                    <DataTile
                      label={t.remaining}
                      value={euro(remaining, language)}
                      tone={remaining === 0 ? "ok" : "highlight"}
                    />
                  </div>

                  {/* 4. Paiement : suit le mois sélectionné dans la carte */}
                  {current.payment && displayed && (
                    <>
                      <h2 className="portal-section-title">{t.payTitle}</h2>

                      {displayedDue > 0.005 && displayed.structuredCom ? (
                        <PaymentCard
                          key={displayed.month}
                          month={displayed.month}
                          amount={displayedDue}
                          structuredCom={displayed.structuredCom}
                          payment={current.payment}
                          lang={language}
                        />
                      ) : displayedDue <= 0.005 ? (
                        <div
                          className="alert alert-success alert-flex"
                          role="status"
                        >
                          <CheckIcon />
                          <span>
                            {t.monthPaid.replace(
                              "{month}",
                              monthName(displayed.month, language)
                            )}
                          </span>
                        </div>
                      ) : null}

                      {/* Rappel FIFO : un mois plus ancien reste dû */}
                      {oldestUnpaid &&
                        oldestUnpaid.month < displayed.month && (
                          <div
                            className="alert alert-warning alert-flex older-due"
                            role="status"
                          >
                            <span>
                              {t.olderDue.replace(
                                "{month}",
                                monthName(oldestUnpaid.month, language)
                              )}
                            </span>
                            <button
                              type="button"
                              className="btn btn-outline"
                              onClick={() =>
                                setSelectedMonth(oldestUnpaid.month)
                              }
                            >
                              {t.seeMonth}{" "}
                              {monthName(oldestUnpaid.month, language)}
                            </button>
                          </div>
                        )}
                    </>
                  )}
                </>
              )}

              <div className="portal-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={showPrevious}
                >
                  {t.seePrevious}
                </button>
              </div>
            </>
          )}

          {/* ---------- Vue : trimestre précédent ---------- */}
          {status === "ready" && view === "previous" && (
            <>
              <h2 className="portal-section-title">
                {quarterTitle(previous, t.quarterPrevious)}
              </h2>

              {prevStatus === "loading" && (
                <div className="loading-row" role="status">
                  <span className="spinner spinner-violet" aria-hidden="true" />
                  <span>{t.loading}</span>
                </div>
              )}

              {prevStatus === "error" && (
                <div className="alert alert-error" role="alert">
                  {t.error}
                </div>
              )}

              {prevStatus === "ready" &&
                previous &&
                (previous.months.length === 0 ? (
                  <div className="alert alert-info" role="status">
                    {t.noDeclarations}
                  </div>
                ) : (
                  <QuarterCard data={previous} lang={language} />
                ))}

              <div className="portal-actions">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setView("current")}
                >
                  {t.backToCurrent}
                </button>
              </div>
            </>
          )}

          <div className="card-footer">
            <a
              className="btn btn-outline"
              href="/.auth/logout?post_logout_redirect_uri=%2F%3Floggedout%3D1"
            >
              {t.logout}
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
