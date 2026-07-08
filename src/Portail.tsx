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
    contribution: "Contribution",
    paid: "Payé",
    netShort: "net",
    contribShort: "contribution",
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
    payTitle: "Payer ma contribution",
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
    monthPaid: "La contribution de {month} est payée.",
    olderDue: "Attention : la contribution de {month} n'est pas encore payée.",
    seeMonth: "Voir",
    declareTitle: "Déclarer mes revenus",
    declareIntro: "Indiquez les montants de votre fiche de paie pour {month}.",
    grossInput: "Salaire brut (€)",
    netInput: "Salaire net (€)",
    contributionCalc: "Contribution calculée",
    declareCheck:
      "La contribution est calculée automatiquement. Vérifiez vos montants avant d'envoyer.",
    declareSubmit: "Envoyer ma déclaration",
    declareSending: "Envoi en cours…",
    declareInvalid: "Vérifiez les montants saisis.",
    declareError:
      "L'envoi n'a pas fonctionné. Veuillez réessayer plus tard.",
    declareMonthAria: "Déclarer ce mois",
    correctIntro:
      "Corrigez les montants pour {month}. Les nouveaux montants remplacent les anciens.",
    correctBtn: "Corriger ma déclaration",
    cancelBtn: "Annuler",
    payslip: "Fiche de paie {n}",
    addPayslip: "+ Ajouter une fiche de paie",
    removePayslip: "Supprimer la fiche de paie {n}",
    multiHint:
      "Plusieurs contrats ce mois-ci ? Ajoutez une fiche de paie par contrat : les montants s'additionnent.",
    totalGross: "Total brut",
    totalNet: "Total net",
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
    declareTitle: "Mijn inkomsten aangeven",
    declareIntro: "Vul de bedragen van uw loonfiche voor {month} in.",
    grossInput: "Brutoloon (€)",
    netInput: "Nettoloon (€)",
    contributionCalc: "Berekende bijdrage",
    declareCheck:
      "De bijdrage wordt automatisch berekend. Controleer uw bedragen vóór het verzenden.",
    declareSubmit: "Mijn aangifte verzenden",
    declareSending: "Bezig met verzenden…",
    declareInvalid: "Controleer de ingevoerde bedragen.",
    declareError: "Het verzenden is niet gelukt. Probeer het later opnieuw.",
    declareMonthAria: "Deze maand aangeven",
    correctIntro:
      "Corrigeer de bedragen voor {month}. De nieuwe bedragen vervangen de oude.",
    correctBtn: "Mijn aangifte corrigeren",
    cancelBtn: "Annuleren",
    payslip: "Loonfiche {n}",
    addPayslip: "+ Loonfiche toevoegen",
    removePayslip: "Loonfiche {n} verwijderen",
    multiHint:
      "Meerdere contracten deze maand? Voeg per contract een loonfiche toe: de bedragen worden opgeteld.",
    totalGross: "Totaal bruto",
    totalNet: "Totaal netto",
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
    declareTitle: "Declare my income",
    declareIntro: "Enter the amounts from your payslip for {month}.",
    grossInput: "Gross salary (€)",
    netInput: "Net salary (€)",
    contributionCalc: "Calculated contribution",
    declareCheck:
      "The contribution is calculated automatically. Check your amounts before sending.",
    declareSubmit: "Send my declaration",
    declareSending: "Sending…",
    declareInvalid: "Check the amounts you entered.",
    declareError: "Sending failed. Please try again later.",
    declareMonthAria: "Declare this month",
    correctIntro:
      "Correct the amounts for {month}. The new amounts replace the old ones.",
    correctBtn: "Correct my declaration",
    cancelBtn: "Cancel",
    payslip: "Payslip {n}",
    addPayslip: "+ Add a payslip",
    removePayslip: "Remove payslip {n}",
    multiHint:
      "Several contracts this month? Add one payslip per contract: the amounts are added together.",
    totalGross: "Total gross",
    totalNet: "Total net",
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

/** Contribution selon les tranches Fedasil, appliquées au salaire NET :
 *  0–264,99 : 0 % · 265–999,99 : 35 % · 1000–1499,99 : 45 % · 1500+ : 50 %.
 *  ⚠ Aperçu en direct uniquement : le montant qui fait foi est TOUJOURS
 *  recalculé côté serveur (Declare.ts) — garder les deux synchronisées. */
function calcContribution(net: number): number {
  const t2 = Math.max(0, Math.min(net, 1000) - 265) * 0.35;
  const t3 = Math.max(0, Math.min(net, 1500) - 1000) * 0.45;
  const t4 = Math.max(0, net - 1500) * 0.5;
  return Math.round((t2 + t3 + t4) * 100) / 100;
}

/** Montant saisi (virgule ou point) -> nombre, ou null si invalide. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 && n <= 100000
    ? Math.round(n * 100) / 100
    : null;
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
          const missingContent = (
            <>
              <span className="q-month">{monthName(month, lang)}</span>
              <span className="q-amounts">{t.notYetDeclared}</span>
              <span className="q-check q-plus" aria-hidden="true">
                +
              </span>
            </>
          );
          // Mois non déclaré : cliquable -> ouvre le formulaire de déclaration.
          return onSelectMonth ? (
            <button
              type="button"
              key={month}
              className={`quarter-row q-clickable q-missing${
                selectedMonth === month ? " q-selected" : ""
              }`}
              aria-current={selectedMonth === month ? "true" : undefined}
              aria-label={`${t.declareMonthAria} : ${monthName(month, lang)}`}
              onClick={() => onSelectMonth(month)}
            >
              {missingContent}
            </button>
          ) : (
            <div className="quarter-row q-missing" key={month}>
              {missingContent}
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

/** Formulaire de déclaration d'un mois.
 *  - Par défaut une seule fiche de paie (brut + net) ; « + Ajouter une fiche »
 *    pour les résidents avec plusieurs contrats : les montants s'ADDITIONNENT
 *    et la contribution est calculée sur le NET TOTAL (tranches progressives).
 *  - Mode correction : pré-rempli avec les totaux actuels ; l'envoi remplace
 *    la déclaration existante (l'API met à jour la ligne du mois).
 *  L'aperçu de contribution est indicatif : le montant qui fait foi est
 *  recalculé côté serveur (Declare.ts). */
type PayslipLine = { gross: string; net: string };
const MAX_PAYSLIPS = 10;

function DeclarationForm({
  month,
  lang,
  onSubmitted,
  initial,
  onCancel,
}: {
  month: number;
  lang: Language;
  onSubmitted: () => void;
  initial?: { gross: number | null; net: number | null };
  onCancel?: () => void;
}) {
  const t = labels[lang];
  const toInput = (v: number | null | undefined): string =>
    v === null || v === undefined ? "" : String(v).replace(".", ",");

  const [lines, setLines] = useState<PayslipLine[]>([
    { gross: toInput(initial?.gross), net: toInput(initial?.net) },
  ]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = lines.map((l) => ({
    gross: parseAmount(l.gross),
    net: parseAmount(l.net),
  }));
  const allValid = parsed.every((p) => p.gross !== null && p.net !== null);
  const totalGross = parsed.reduce((s, p) => s + (p.gross ?? 0), 0);
  const totalNet = parsed.reduce((s, p) => s + (p.net ?? 0), 0);
  const contributionPreview = allValid ? calcContribution(totalNet) : null;
  const canSubmit = allValid && !sending;

  const setLine = (i: number, patch: Partial<PayslipLine>) =>
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l))
    );
  const addLine = () =>
    setLines((prev) =>
      prev.length < MAX_PAYSLIPS ? [...prev, { gross: "", net: "" }] : prev
    );
  const removeLine = (i: number) =>
    setLines((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/declare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          grossSalary: Math.round(totalGross * 100) / 100,
          netSalary: Math.round(totalNet * 100) / 100,
        }),
      });
      if (res.status === 400) {
        setError(t.declareInvalid);
      } else if (!res.ok) {
        setError(t.declareError);
      } else {
        onSubmitted(); // recharge les données -> le mois apparaît déclaré
        return;
      }
    } catch {
      setError(t.declareError);
    }
    setSending(false);
  };

  return (
    <div className="declare-card">
      <p className="declare-intro">
        {(initial ? t.correctIntro : t.declareIntro).replace(
          "{month}",
          monthName(month, lang)
        )}
      </p>

      {lines.map((line, i) => (
        <fieldset className="payslip" key={i}>
          {lines.length > 1 && (
            <div className="payslip-head">
              <legend>{t.payslip.replace("{n}", String(i + 1))}</legend>
              <button
                type="button"
                className="btn btn-outline btn-copy"
                aria-label={t.removePayslip.replace("{n}", String(i + 1))}
                onClick={() => removeLine(i)}
              >
                ✕
              </button>
            </div>
          )}
          <div className="form declare-form">
            <div className="field">
              <label htmlFor={`gross-${month}-${i}`}>{t.grossInput}</label>
              <input
                id={`gross-${month}-${i}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={line.gross}
                onChange={(e) => setLine(i, { gross: e.target.value })}
                placeholder="0,00"
              />
            </div>
            <div className="field">
              <label htmlFor={`net-${month}-${i}`}>{t.netInput}</label>
              <input
                id={`net-${month}-${i}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={line.net}
                onChange={(e) => setLine(i, { net: e.target.value })}
                placeholder="0,00"
              />
            </div>
          </div>
        </fieldset>
      ))}

      {lines.length < MAX_PAYSLIPS && (
        <div className="declare-add">
          <button type="button" className="btn btn-outline" onClick={addLine}>
            {t.addPayslip}
          </button>
          <p className="declare-hint">{t.multiHint}</p>
        </div>
      )}

      {/* Totaux (utiles dès qu'il y a plusieurs fiches) + contribution */}
      {lines.length > 1 && (
        <div className="declare-totals">
          <span>
            {t.totalGross} <strong>{euro(totalGross, lang)}</strong>
          </span>
          <span>
            {t.totalNet} <strong>{euro(totalNet, lang)}</strong>
          </span>
        </div>
      )}
      <div className="declare-preview" role="status" aria-live="polite">
        <span>{t.contributionCalc}</span>
        <strong>
          {contributionPreview !== null
            ? euro(contributionPreview, lang)
            : "—"}
        </strong>
      </div>

      <p className="declare-check">{t.declareCheck}</p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="declare-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit}
          onClick={submit}
        >
          {sending ? t.declareSending : t.declareSubmit}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={onCancel}
            disabled={sending}
          >
            {t.cancelBtn}
          </button>
        )}
      </div>
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

  // Mois déclaré en cours de CORRECTION (formulaire pré-rempli).
  const [editingMonth, setEditingMonth] = useState<number | null>(null);

  // Sélectionner un mois quitte toujours le mode correction.
  const selectMonth = (month: number) => {
    setSelectedMonth(month);
    setEditingMonth(null);
  };

  // Trimestre précédent : chargé à la demande, puis gardé en mémoire.
  const [view, setView] = useState<"current" | "previous">("current");
  const [prevStatus, setPrevStatus] = useState<PrevStatus>("idle");
  const [previous, setPrevious] = useState<MeResponse | null>(null);

  // Charge (ou recharge) les données du trimestre en cours.
  const loadCurrent = async () => {
    try {
      const res = await fetch("/api/me");
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
      setEditingMonth(null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function init() {
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
        if (!cancelled) await loadCurrent();
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    init();
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

  // Le mois sélectionné n'est pas encore déclaré -> formulaire de déclaration.
  const isMissingSelected =
    selectedMonth !== null &&
    current !== null &&
    !current.months.some((m) => m.month === selectedMonth);

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
                  {/* 1. Mois non déclaré sélectionné OU correction en cours
                        -> formulaire ; sinon tuiles du mois affiché */}
                  {isMissingSelected && selectedMonth !== null ? (
                    <>
                      <h2 className="portal-section-title">
                        {t.declareTitle}
                      </h2>
                      <p className="month-caption">
                        {monthName(selectedMonth, language)}
                      </p>
                      <DeclarationForm
                        key={selectedMonth}
                        month={selectedMonth}
                        lang={language}
                        onSubmitted={loadCurrent}
                      />
                    </>
                  ) : displayed && editingMonth === displayed.month ? (
                    <>
                      <h2 className="portal-section-title">{t.correctBtn}</h2>
                      <p className="month-caption">
                        {monthName(displayed.month, language)}
                      </p>
                      <DeclarationForm
                        key={`edit-${displayed.month}`}
                        month={displayed.month}
                        lang={language}
                        onSubmitted={loadCurrent}
                        initial={{
                          gross: displayed.grossSalary,
                          net: displayed.netSalary,
                        }}
                        onCancel={() => setEditingMonth(null)}
                      />
                    </>
                  ) : (
                    <>
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
                          <div className="declare-correct">
                            <button
                              type="button"
                              className="btn btn-outline"
                              onClick={() =>
                                setEditingMonth(displayed.month)
                              }
                            >
                              {t.correctBtn}
                            </button>
                          </div>
                        </>
                      )}
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
                    onSelectMonth={selectMonth}
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

                  {/* 4. Paiement : suit le mois sélectionné dans la carte
                        (masqué pendant une déclaration ou une correction) */}
                  {!isMissingSelected &&
                    editingMonth === null &&
                    current.payment &&
                    displayed && (
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
                                selectMonth(oldestUnpaid.month)
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
