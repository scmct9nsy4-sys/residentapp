// =============================================================================
// Portail.tsx — Espace sécurisé du résident (version sans MUI)
// -----------------------------------------------------------------------------
// Flux : /.auth/me → redirection connexion si besoin, puis /api/me.
//
// HISTORIQUE MULTI-TRIMESTRES (chantier §10.0, 14/7/2026) :
//   /api/me renvoie, en plus des déclarations du trimestre demandé, la FENÊTRE
//   des trimestres consultables :
//       { quarter, year, archived, quarters: [{quarter, year}], months, ... }
//   - trimestre COURANT    -> KB-Cumul (là où l'on écrit : fraîcheur immédiate)
//   - trimestres ANTÉRIEURS -> liste « Soldes » (mémoire permanente, insensible
//     aux rotations trimestrielles)
//   Le bouton « Voir le trimestre précédent » devient un SÉLECTEUR de
//   4 trimestres (courant compris).
//
//   ⚠ POURQUOI 4 ET PAS PLUS : la communication structurée encode le mois et le
//   FA, mais PAS l'année. Sur 4 trimestres glissants, chaque mois n'apparaît
//   qu'une fois -> aucun paiement ambigu. La fenêtre est décidée et bornée par
//   le SERVEUR (Me.ts, HISTORY_QUARTERS) : ce fichier affiche ce que l'API
//   autorise, il ne calcule jamais la fenêtre lui-même.
//
//   Sur un trimestre CLÔTURÉ :
//   - consultation : oui (mois déclarés cliquables) ;
//   - PAIEMENT : oui — une dette ancienne reste payable (Soldes conserve la
//     communication structurée d'origine) ;
//   - déclaration / correction : NON (Declare.ts borne l'écriture au trimestre
//     en cours) -> mois non déclarés en gris sans « + », pas de « Corriger ».
//
// Présentation :
//   0. La pastille « Votre accès est activé » n'apparaît qu'à la PREMIÈRE
//      visite réussie du compte sur cet appareil (clé localStorage par oid) ;
//      ensuite l'espace en haut de page est rendu au contenu utile
//   1. Sélecteur de trimestre (4 pilules)
//   2. Tuiles du mois AFFICHÉ (par défaut le plus récent ; cliquer un mois
//      dans la carte trimestre change le mois affiché) ; la tuile « Payé »
//      porte un bouton violet « Payer X € » quand un solde reste dû pour ce
//      mois -> défilement direct vers le QR et les infos de virement ;
//      la tuile « Reste à payer » du récapitulatif fait de même (FIFO)
//   3. Carte du trimestre : lignes de mois CLIQUABLES, chacune avec une icône
//      d'état de paiement (forme + couleur : cercle violet = à payer,
//      demi-cercle ambre = acompte, coche verte = payé, point d'exclamation
//      rouge = échéance dépassée), total du trimestre
//   4. « Paiements du trimestre » : à payer / déjà payé / reste à payer
//   5. Carte de paiement (QR EPC + virement manuel) du mois affiché
//
// MOBILE (la majorité des résidents consultent depuis leur téléphone) :
//   - Un code QR ne peut pas être scanné sur l'écran qui l'affiche : sur
//     appareil tactile (hover:none + pointer:coarse), la carte de paiement
//     met les champs COPIABLES en premier et le QR devient optionnel
//     (bouton « Afficher le code QR », utile pour scanner avec un AUTRE
//     appareil). Sur ordinateur : QR d'abord, comme avant.
//   - Le bouton « Se déconnecter » est aussi dans l'EN-TÊTE (toujours
//     visible, important sur les postes partagés) ; celui du pied de carte
//     est conservé (chemin naturel après lecture).
//
// LITTÉRATIE ET CONFIANCE (public multilingue, à l'aise ou non avec l'écrit) :
//   - Aide dépliable « Où trouver ces montants sur ma fiche de paie ? » dans
//     le formulaire de déclaration (brut = haut de la fiche, net = bas).
//   - Pictogrammes discrets sur les titres de section (repères visuels).
//   - Confirmation verte après une déclaration/correction réussie, avec
//     sélection automatique du mois concerné (enchaîne vers le paiement).
//   - Erreurs récupérables : bouton « Réessayer » (réseaux mobiles
//     instables) ; session expirée (401) -> retour à la connexion au lieu
//     d'un message d'erreur incompréhensible.
//   - TOUTE impasse offre une sortie : les états « erreur » et « aucune
//     donnée » portent « Réessayer » ET « Changer de personne » (sans quoi un
//     compte FAMILLE dont UN profil échoue est entièrement bloqué — seule la
//     déconnexion resterait).
//
// FAMILLES (plusieurs personnes partagent une adresse e-mail = même compte
// Microsoft = même oid, mais des FA différents) :
//   - /api/me sans ?fa= renvoie { needsProfile: true, profiles: [...] }
//     -> écran « Qui êtes-vous ? » (sélecteur de profil) ;
//   - le FA choisi est propagé à TOUS les appels (?fa= sur /api/me, champ fa
//     dans le corps de /api/declare) ; le serveur VÉRIFIE toujours que ce FA
//     appartient bien à l'identité connectée (403 sinon) ;
//   - une barre « Vous consultez le dossier de … » + bouton « Changer de
//     personne » reste visible tant qu'il y a plusieurs profils ;
//   - le cache des trimestres est vidé à chaque changement de personne.
// =============================================================================

import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
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
    declared: "Déclaration reçue",
    notYetDeclared: "pas encore de déclaration",
    showMonth: "Afficher ce mois",
    quarterTotal: "Total du trimestre",
    paymentsTitle: "Paiements du trimestre",
    toPay: "À payer",
    alreadyPaid: "Déjà payé",
    remaining: "Reste à payer",
    backToCurrent: "Revenir au trimestre en cours",
    quarterShort: "T",
    historyTitle: "Vos trimestres",
    historyAria: "Choisir un trimestre",
    archivedNote:
      "Ce trimestre est clôturé : vous ne pouvez plus déclarer ni corriger des revenus ici. Vous pouvez toujours payer une contribution qui reste due. Pour une correction, contactez votre personne de référence.",
    noDeclarationShort: "pas de déclaration",
    declarePrompt: "Choisissez un mois ci-dessous pour déclarer vos revenus.",
    payTitle: "Payer ma contribution",
    payFor: "Paiement pour",
    scanQr: "Scannez ce code avec votre application bancaire :",
    orManual: "Ou faites un virement avec ces informations :",
    manualOnly: "Faites un virement avec ces informations :",
    showQrBtn: "Afficher le code QR",
    hideQrBtn: "Masquer le code QR",
    qrOtherDevice:
      "Ce code se scanne avec l'application bancaire d'un autre appareil.",
    payAmountBtn: "Payer {amount}",
    retry: "Réessayer",
    declaredOk:
      "Votre déclaration de {month} est enregistrée. Contribution : {amount}.",
    whereAmounts: "Où trouver ces montants sur ma fiche de paie ?",
    whereGross:
      "Le salaire brut est le montant avant les retenues (cotisations, impôts). Il se trouve en général en haut de votre fiche de paie.",
    whereNet:
      "Le salaire net est le montant que vous recevez sur votre compte en banque. Il se trouve en général en bas de votre fiche de paie.",
    payOtherAmount: "Payer un autre montant",
    payFullAmount: "Revenir au solde complet",
    customAmountLabel: "Montant à payer (€)",
    customAmountHelp:
      "Entre 0,01 et {max}. Le reste pourra être payé plus tard avec la même communication.",
    customAmountInvalid:
      "Montant non valide. Indiquez un montant entre 0,01 et {max}.",
    remainderAfter: "Après ce paiement, il restera {amount} pour ce mois.",
    stateUnpaid: "À payer",
    statePartial: "Acompte versé",
    statePaid: "Payé",
    stateOverdue: "Échéance dépassée",
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
    profileTitle: "Qui êtes-vous ?",
    profileIntro:
      "Plusieurs personnes utilisent cette adresse e-mail. Choisissez votre profil pour voir vos informations.",
    profileOpenAria: "Ouvrir le profil de",
    profileViewing: "Vous consultez le dossier de",
    profileChange: "Changer de personne",
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
    declared: "Aangifte ontvangen",
    notYetDeclared: "nog geen aangifte",
    showMonth: "Deze maand weergeven",
    quarterTotal: "Totaal van het kwartaal",
    paymentsTitle: "Betalingen van het kwartaal",
    toPay: "Te betalen",
    alreadyPaid: "Al betaald",
    remaining: "Nog te betalen",
    backToCurrent: "Terug naar het huidige kwartaal",
    quarterShort: "K",
    historyTitle: "Uw kwartalen",
    historyAria: "Kies een kwartaal",
    archivedNote:
      "Dit kwartaal is afgesloten: u kunt hier geen inkomsten meer aangeven of corrigeren. Een openstaande bijdrage kunt u nog altijd betalen. Neem contact op met uw contactpersoon voor een correctie.",
    noDeclarationShort: "geen aangifte",
    declarePrompt: "Kies hieronder een maand om uw inkomsten aan te geven.",
    payTitle: "Mijn bijdrage betalen",
    payFor: "Betaling voor",
    scanQr: "Scan deze code met uw bankapp:",
    orManual: "Of doe een overschrijving met deze gegevens:",
    manualOnly: "Doe een overschrijving met deze gegevens:",
    showQrBtn: "QR-code tonen",
    hideQrBtn: "QR-code verbergen",
    qrOtherDevice: "Deze code scant u met de bankapp van een ander toestel.",
    payAmountBtn: "{amount} betalen",
    retry: "Opnieuw proberen",
    declaredOk:
      "Uw aangifte voor {month} is geregistreerd. Bijdrage: {amount}.",
    whereAmounts: "Waar vind ik deze bedragen op mijn loonfiche?",
    whereGross:
      "Het brutoloon is het bedrag vóór de inhoudingen (bijdragen, belastingen). Het staat meestal bovenaan uw loonfiche.",
    whereNet:
      "Het nettoloon is het bedrag dat u op uw bankrekening ontvangt. Het staat meestal onderaan uw loonfiche.",
    payOtherAmount: "Een ander bedrag betalen",
    payFullAmount: "Terug naar het volledige saldo",
    customAmountLabel: "Te betalen bedrag (€)",
    customAmountHelp:
      "Tussen 0,01 en {max}. De rest kunt u later betalen met dezelfde mededeling.",
    customAmountInvalid:
      "Ongeldig bedrag. Geef een bedrag op tussen 0,01 en {max}.",
    remainderAfter: "Na deze betaling blijft er {amount} over voor deze maand.",
    stateUnpaid: "Te betalen",
    statePartial: "Voorschot betaald",
    statePaid: "Betaald",
    stateOverdue: "Vervaldag verstreken",
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
    profileTitle: "Wie bent u?",
    profileIntro:
      "Meerdere personen gebruiken dit e-mailadres. Kies uw profiel om uw gegevens te bekijken.",
    profileOpenAria: "Profiel openen van",
    profileViewing: "U bekijkt het dossier van",
    profileChange: "Van persoon wisselen",
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
    declared: "Declaration received",
    notYetDeclared: "no declaration yet",
    showMonth: "Show this month",
    quarterTotal: "Quarter total",
    paymentsTitle: "Quarter payments",
    toPay: "To pay",
    alreadyPaid: "Already paid",
    remaining: "Remaining",
    backToCurrent: "Back to current quarter",
    quarterShort: "Q",
    historyTitle: "Your quarters",
    historyAria: "Choose a quarter",
    archivedNote:
      "This quarter is closed: you can no longer declare or correct income here. You can still pay a contribution that is still due. Contact your reference person for a correction.",
    noDeclarationShort: "no declaration",
    declarePrompt: "Choose a month below to declare your income.",
    payTitle: "Pay my contribution",
    payFor: "Payment for",
    scanQr: "Scan this code with your banking app:",
    orManual: "Or make a transfer with these details:",
    manualOnly: "Make a transfer with these details:",
    showQrBtn: "Show QR code",
    hideQrBtn: "Hide QR code",
    qrOtherDevice: "Scan this code with the banking app on another device.",
    payAmountBtn: "Pay {amount}",
    retry: "Try again",
    declaredOk:
      "Your declaration for {month} has been saved. Contribution: {amount}.",
    whereAmounts: "Where can I find these amounts on my payslip?",
    whereGross:
      "The gross salary is the amount before deductions (contributions, taxes). It is usually at the top of your payslip.",
    whereNet:
      "The net salary is the amount you actually receive in your bank account. It is usually at the bottom of your payslip.",
    payOtherAmount: "Pay a different amount",
    payFullAmount: "Back to the full balance",
    customAmountLabel: "Amount to pay (€)",
    customAmountHelp:
      "Between 0.01 and {max}. The rest can be paid later with the same communication.",
    customAmountInvalid:
      "Invalid amount. Enter an amount between 0.01 and {max}.",
    remainderAfter: "After this payment, {amount} will remain for this month.",
    stateUnpaid: "To pay",
    statePartial: "Deposit paid",
    statePaid: "Paid",
    stateOverdue: "Deadline passed",
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
    profileTitle: "Who are you?",
    profileIntro:
      "Several people use this email address. Choose your profile to see your information.",
    profileOpenAria: "Open the profile of",
    profileViewing: "You are viewing the file of",
    profileChange: "Switch person",
  },
} as const;

// URL de déconnexion du portail (renvoie vers "/" avec l'avis « ordinateur
// partagé » ; voir App.tsx). Utilisée dans l'en-tête ET en pied de carte.
const LOGOUT_URL = "/.auth/logout?post_logout_redirect_uri=%2F%3Floggedout%3D1";

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

/** Un profil resident (une PERSONNE) lié au compte connecté.
 *  Plusieurs profils = famille partageant la même adresse e-mail. */
type Profile = {
  fa: string;
  firstName: string;
  lastName: string;
};

/** Un trimestre de la fenêtre d'historique (§10.0). L'ANNÉE en fait partie :
 *  « T2 » seul serait ambigu dès qu'on remonte au-delà de l'année civile. */
type QuarterRef = {
  quarter: number;
  year: number;
};

type MeResponse = {
  quarter: number | null;
  /** Année du trimestre (nouveau §10.0). Rend l'échéance de paiement EXACTE
   *  sur un trimestre ancien, au lieu de la déduire de la date du jour. */
  year?: number | null;
  /** true = trimestre clôturé, lu dans la liste « Soldes » : ni déclaration ni
   *  correction possible — le paiement, lui, reste ouvert. */
  archived?: boolean;
  /** Fenêtre des trimestres consultables, du plus récent au plus ancien.
   *  Décidée par le SERVEUR (Me.ts) : le frontend ne la calcule jamais. */
  quarters?: QuarterRef[];
  months: MonthlyDeclaration[]; // trié du plus récent au plus ancien
  payment?: PaymentConfig | null;
  profile?: Profile; // profil actif (renvoyé par /api/me)
  profiles?: Profile[]; // présent uniquement s'il y a plusieurs profils
};

/** Réponse brute de /api/me : soit des données, soit une demande de choix
 *  de profil ({ needsProfile: true, profiles }) quand plusieurs personnes
 *  partagent le compte et qu'aucun ?fa= n'a été fourni. */
type MeRaw = MeResponse & { needsProfile?: boolean };

type Status = "loading" | "chooseProfile" | "ready" | "nodata" | "error";
/** État de chargement d'un trimestre CLÔTURÉ (le trimestre courant suit
 *  `status`). */
type QuarterStatus = "idle" | "loading" | "ready" | "error";

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

// --- Statut de paiement d'un mois (codes couleurs) --------------------------

/** Les 4 états de paiement : rien versé / acompte / payé / échéance dépassée. */
type PayStatus = "unpaid" | "partial" | "paid" | "overdue";

/** Date limite de paiement d'un mois déclaré.
 *  RÈGLE MÉTIER (confirmée le 10/7/2026) : la contribution d'un mois est
 *  due pour la FIN DU MOIS SUIVANT la clôture du mois (ex. avril -> 31 mai).
 *  Échéance dépassée = mise en évidence UNIQUEMENT (couleur + libellé) ;
 *  aucune action ni blocage : le paiement reste possible à l'identique.
 *
 *  ANNÉE (§10.0, 14/7/2026) : elle est désormais FOURNIE par l'API (champ
 *  `year`) — indispensable depuis l'historique multi-trimestres : sur un
 *  trimestre clôturé de l'an dernier, la déduction d'après la date du jour
 *  donnerait une échéance fausse (donc des mois « en retard » à tort, ou
 *  l'inverse). REPLI (year absent, API ancienne) : l'année est déduite du
 *  trimestre applicatif (décalé, §5.16) — si le trimestre affiché est
 *  postérieur au trimestre calendaire d'aujourd'hui, il appartient à l'année
 *  précédente (ex. T4 en janvier). */
function paymentDeadline(
  month: number,
  quarter: number,
  year?: number | null
): Date {
  const now = new Date();
  const calendarQuarter = Math.floor(now.getMonth() / 3) + 1;
  const resolvedYear =
    year ?? (quarter > calendarQuarter ? now.getFullYear() - 1 : now.getFullYear());
  // Dernier jour du mois suivant (le débordement de mois est géré par JS).
  return new Date(resolvedYear, month + 1, 0, 23, 59, 59);
}

/** Statut de paiement d'un mois déclaré.
 *  L'échéance dépassée PRIME sur l'acompte (couleur distinctive). */
function monthPayStatus(
  m: MonthlyDeclaration,
  quarter: number | null,
  year?: number | null
): PayStatus {
  const due = (m.contribution ?? 0) - (m.paid ?? 0);
  if (due <= 0.005) return "paid";
  if (quarter !== null && new Date() > paymentDeadline(m.month, quarter, year)) {
    return "overdue";
  }
  return (m.paid ?? 0) > 0.005 ? "partial" : "unpaid";
}

/** Tonalité de tuile correspondant à un statut de paiement. */
function toneForStatus(
  s: PayStatus
): "highlight" | "ok" | "partial" | "overdue" {
  if (s === "paid") return "ok";
  if (s === "partial") return "partial";
  if (s === "overdue") return "overdue";
  return "highlight";
}

/** Libellé texte d'un statut de paiement (jamais la couleur seule). */
function stateLabelFor(t: (typeof labels)[Language], s: PayStatus): string {
  if (s === "paid") return t.statePaid;
  if (s === "partial") return t.statePartial;
  if (s === "overdue") return t.stateOverdue;
  return t.stateUnpaid;
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

// --- Détection tactile (ergonomie mobile) ---------------------------------------

/** true sur les appareils tactiles SANS souris (téléphones, tablettes).
 *  Utilisé pour adapter la carte de paiement : un QR affiché sur l'écran
 *  du téléphone ne peut pas être scanné par ce même téléphone.
 *  Réactif : suit les changements (ex. tablette avec souris branchée). */
function useCoarsePointer(): boolean {
  const QUERY = "(hover: none) and (pointer: coarse)";
  const [coarse, setCoarse] = useState<boolean>(
    () =>
      typeof window !== "undefined" && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // QUERY est une constante : pas de dépendance nécessaire.
  }, []);

  return coarse;
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

/** Icône d'état de paiement d'un mois : la FORME distingue les états en
 *  plus de la couleur (daltonisme, écrans de faible qualité) :
 *  cercle vide = à payer · demi-cercle plein = acompte versé ·
 *  coche = payé · point d'exclamation = échéance dépassée. */
function PayStatusIcon({
  status,
  size = 18,
}: {
  status: PayStatus;
  size?: number;
}) {
  if (status === "paid") return <CheckIcon size={size} />;

  if (status === "partial") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 0 20Z" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (status === "overdue") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="7" x2="12" y2="13" />
        <circle cx="12" cy="16.5" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  // "unpaid" : cercle vide (état normal, rien d'alarmant)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

/** Icônes de section : repères visuels pour les lecteurs peu à l'aise avec
 *  le texte (public multilingue). Toujours aria-hidden : le titre TEXTE
 *  porte l'information, l'icône n'est qu'un renfort. */
function CalendarIcon({ size = 18 }: { size?: number }) {
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
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function EuroIcon({ size = 18 }: { size?: number }) {
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
      <path d="M4 10h12" />
      <path d="M4 14h9" />
      <path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2" />
    </svg>
  );
}

function PenIcon({ size = 18 }: { size?: number }) {
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
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function FileTextIcon({ size = 18 }: { size?: number }) {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

/** Titre de section avec pictogramme optionnel (violet, décoratif). */
function SectionTitle({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <h2 className="portal-section-title">
      {icon && (
        <span className="title-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span>{children}</span>
    </h2>
  );
}

/** Tuile de donnée : libellé + valeur + sous-libellé d'état optionnel.
 *  tone : "highlight" = violet, "ok" = vert, "partial" = ambre (acompte),
 *  "overdue" = rouge (échéance dépassée) — le sous-libellé TEXTE accompagne
 *  toujours la couleur (jamais la couleur seule).
 *  onClick : rend la tuile ENTIÈRE cliquable (bouton), ex. « Reste à payer »
 *  -> défilement vers la carte de paiement.
 *  action : bouton violet plein INTÉGRÉ à la tuile (ex. « Payer 245,00 € »
 *  sur la tuile « Payé »). Ignoré si onClick est fourni (pas de bouton
 *  imbriqué dans un bouton). */
function DataTile({
  label,
  value,
  tone,
  sub,
  onClick,
  action,
}: {
  label: string;
  value: string;
  tone?: "highlight" | "ok" | "partial" | "overdue";
  sub?: string;
  onClick?: () => void;
  action?: { label: string; onClick: () => void };
}) {
  const className = `data-tile${tone ? ` ${tone}` : ""}`;
  const inner = (
    <>
      <span className="label">{label}</span>
      <span className="value">{value || "—"}</span>
      {sub && <span className="sub">{sub}</span>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {inner}
        <span className="tile-arrow" aria-hidden="true">
          ›
        </span>
      </button>
    );
  }

  return (
    <div className={className}>
      {inner}
      {action && (
        <button
          type="button"
          className="btn btn-primary btn-tile"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Carte trimestre : une ligne par mois + total.
 *  - onSelectMonth fourni -> les mois DÉCLARÉS sont cliquables (ils changent
 *    le mois affiché dans les tuiles et la carte de paiement) ;
 *  - canDeclareMissing (défaut true) -> les mois NON déclarés sont cliquables
 *    et portent un « + » (ils ouvrent le formulaire de déclaration).
 *    ⚠ Sur un trimestre CLÔTURÉ, on passe false : Declare.ts refuse toute
 *    écriture hors du trimestre en cours. Les mois non déclarés restent
 *    AFFICHÉS (en gris, sans « + ») : les masquer laisserait croire que la
 *    photo du trimestre est complète. Pas de rouge non plus — un mois sans
 *    déclaration n'est pas une faute (pas de revenus = pas de déclaration). */
function QuarterCard({
  data,
  lang,
  selectedMonth,
  onSelectMonth,
  canDeclareMissing = true,
}: {
  data: MeResponse;
  lang: Language;
  selectedMonth?: number | null;
  onSelectMonth?: (month: number) => void;
  canDeclareMissing?: boolean;
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

        // ---- Mois NON déclaré ----
        if (!decl) {
          const declarable = Boolean(onSelectMonth) && canDeclareMissing;

          const missingContent = (
            <>
              <span className="q-month">{monthName(month, lang)}</span>
              <span className="q-amounts">
                {declarable ? t.notYetDeclared : t.noDeclarationShort}
              </span>
              {declarable && (
                <span className="q-check q-plus" aria-hidden="true">
                  +
                </span>
              )}
            </>
          );

          // Déclarable -> bouton (ouvre le formulaire) ; sinon ligne inerte.
          return declarable && onSelectMonth ? (
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

        // ---- Mois déclaré ----
        // État de paiement du mois : icône (forme + couleur) en bout de ligne.
        // L'année vient de l'API (§10.0) : échéance exacte même sur un
        // trimestre clôturé de l'an dernier.
        const st = monthPayStatus(decl, data.quarter, data.year);

        const content = (
          <>
            <span className="q-month">{monthName(month, lang)}</span>
            <span className="q-amounts">
              {t.netShort} {euro(decl.netSalary, lang)} · {t.contribShort}{" "}
              {euro(decl.contribution, lang)}
            </span>
            <span
              className={`q-check q-status-${st}`}
              role="img"
              aria-label={`${t.declared} · ${stateLabelFor(t, st)}`}
            >
              <PayStatusIcon status={st} size={18} />
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
 *  Affichée pour le mois impayé le plus ancien (règle d'imputation FIFO).
 *
 *  ERGONOMIE MOBILE : sur appareil tactile (le cas majoritaire), le QR ne
 *  sert à rien pour la personne (elle ne peut pas scanner son propre écran).
 *  Les champs copiables passent donc EN PREMIER et le QR devient optionnel
 *  (bouton « Afficher le code QR », pour scanner avec un autre appareil).
 *  Sur ordinateur : QR d'abord, puis les champs, comme avant.
 *
 *  MONTANT LIBRE : par défaut, le montant proposé est le SOLDE du mois
 *  (total si rien n'est versé, reste si un acompte existe). Le résident
 *  peut aussi encoder un montant de son choix (ex. 100 € sur 245 €) : le
 *  QR et le champ « Montant » suivent. La communication structurée ne
 *  change JAMAIS (le champ Paid est un CUMUL, §5.17 : plusieurs virements
 *  avec la même communication s'additionnent). */
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
  const isTouch = useCoarsePointer();

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  // Sur tactile, le QR est masqué par défaut et s'ouvre à la demande.
  const [qrVisible, setQrVisible] = useState(false);

  // Montant libre : champ optionnel, pré-rempli avec le solde du mois.
  const [customMode, setCustomMode] = useState(false);
  const [customRaw, setCustomRaw] = useState("");
  const customParsed = parseAmount(customRaw);
  const customValid =
    customParsed !== null &&
    customParsed >= 0.01 &&
    customParsed <= amount + 0.005;

  // Montant effectivement proposé au paiement : solde du mois par défaut,
  // montant libre s'il est valide. null = montant libre INVALIDE -> ni QR
  // ni champs (jamais d'ambiguïté sur ce qui serait payé).
  const effectiveAmount = customMode
    ? customValid
      ? (customParsed as number)
      : null
    : amount;

  // Le QR n'est généré que s'il sera montré (toujours sur ordinateur,
  // à la demande sur tactile) et que le montant est valide.
  const wantQr = effectiveAmount !== null && (!isTouch || qrVisible);

  // Génère le QR localement (aucun service externe, compatible CSP).
  useEffect(() => {
    if (!wantQr || effectiveAmount === null) return;
    let cancelled = false;
    QRCode.toDataURL(
      epcQrPayload(
        payment.beneficiary,
        payment.iban,
        effectiveAmount,
        structuredCom
      ),
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
  }, [wantQr, payment.beneficiary, payment.iban, effectiveAmount, structuredCom]);

  const copy = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Presse-papiers indisponible : l'utilisateur peut sélectionner le texte.
    }
  };

  const amountText =
    effectiveAmount === null
      ? ""
      : new Intl.NumberFormat(LOCALES[lang], {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(effectiveAmount);

  const fields: Array<{ key: string; label: string; value: string }> = [
    { key: "benef", label: t.beneficiaryLabel, value: payment.beneficiary },
    { key: "iban", label: t.ibanLabel, value: payment.iban },
    { key: "amount", label: t.amountLabel, value: amountText },
    { key: "com", label: t.communicationLabel, value: structuredCom },
  ];

  // Bloc des champs copiables (partagé entre les deux dispositions).
  const fieldsBlock = (
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
  );

  // Bloc QR (image seule ; le texte d'intro diffère selon le contexte).
  const qrImage = qrDataUrl && (
    <img
      src={qrDataUrl}
      width={200}
      height={200}
      alt={`QR — ${t.payFor} ${monthName(month, lang)}`}
    />
  );

  return (
    <div className="payment-card">
      <p className="payment-for">
        {t.payFor} <strong>{monthName(month, lang)}</strong> ·{" "}
        <strong>
          {effectiveAmount !== null ? euro(effectiveAmount, lang) : "—"}
        </strong>
      </p>

      {/* Montant libre : solde complet par défaut, montant au choix sinon */}
      <div className="pay-amount-choice">
        {!customMode ? (
          <button
            type="button"
            className="btn btn-outline btn-copy"
            onClick={() => {
              // Pré-rempli avec le solde : toujours valide à l'ouverture.
              setCustomRaw(String(amount).replace(".", ","));
              setCustomMode(true);
            }}
          >
            {t.payOtherAmount}
          </button>
        ) : (
          <div className={`field${customValid ? "" : " has-error"}`}>
            <label htmlFor={`pay-amount-${month}`}>
              {t.customAmountLabel}
            </label>
            <input
              id={`pay-amount-${month}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={customRaw}
              onChange={(e) => setCustomRaw(e.target.value)}
            />
            <span className="helper">
              {(customValid ? t.customAmountHelp : t.customAmountInvalid).replace(
                "{max}",
                euro(amount, lang)
              )}
            </span>
            <button
              type="button"
              className="btn btn-outline btn-copy pay-amount-reset"
              onClick={() => {
                setCustomMode(false);
                setCustomRaw("");
              }}
            >
              {t.payFullAmount}
            </button>
          </div>
        )}
        {customMode &&
          effectiveAmount !== null &&
          amount - effectiveAmount > 0.005 && (
            <p className="pay-remainder">
              {t.remainderAfter.replace(
                "{amount}",
                euro(
                  Math.round((amount - effectiveAmount) * 100) / 100,
                  lang
                )
              )}
            </p>
          )}
      </div>

      {effectiveAmount !== null &&
        (isTouch ? (
        <>
          {/* MOBILE / TABLETTE : champs copiables d'abord, QR à la demande. */}
          <p className="payment-manual-intro">{t.manualOnly}</p>
          {fieldsBlock}
          <p className="payment-note">{t.commNote}</p>

          <div className="qr-toggle">
            <button
              type="button"
              className="btn btn-outline"
              aria-expanded={qrVisible}
              onClick={() => setQrVisible((v) => !v)}
            >
              {qrVisible ? t.hideQrBtn : t.showQrBtn}
            </button>
            {qrVisible && (
              <div className="qr-block qr-block-touch">
                <p>{t.qrOtherDevice}</p>
                {qrImage}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* ORDINATEUR : QR d'abord (on le scanne avec son téléphone). */}
          {qrDataUrl && (
            <div className="qr-block">
              <p>{t.scanQr}</p>
              {qrImage}
            </div>
          )}

          <p className="payment-manual-intro">{t.orManual}</p>
          {fieldsBlock}
          <p className="payment-note">{t.commNote}</p>
        </>
      ))}

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
  fa,
}: {
  month: number;
  lang: Language;
  onSubmitted: () => void;
  initial?: { gross: number | null; net: number | null };
  onCancel?: () => void;
  /** FA du profil actif (familles). Null = un seul profil : le serveur
   *  le résout seul. TOUJOURS vérifié côté serveur (jamais de confiance). */
  fa?: string | null;
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
          // Familles : profil actif, vérifié côté serveur (403 si non lié).
          ...(fa ? { fa } : {}),
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

      {/* Aide littératie : où trouver brut et net sur la fiche de paie.
          <details> natif : accessible clavier, aucun JavaScript. */}
      <details className="declare-help">
        <summary>{t.whereAmounts}</summary>
        <div className="declare-help-body">
          <p>{t.whereGross}</p>
          <p>{t.whereNet}</p>
        </div>
      </details>

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

  // Trimestre COURANT (KB-Cumul) : le seul où l'on peut déclarer/corriger.
  // Il porte aussi la FENÊTRE des trimestres consultables (json.quarters).
  const [current, setCurrent] = useState<MeResponse | null>(null);

  // Trimestre AFFICHÉ : null = le trimestre courant ; sinon un trimestre
  // CLÔTURÉ (lu dans « Soldes », §10.0).
  const [shownQuarter, setShownQuarter] = useState<QuarterRef | null>(null);

  // Cache des trimestres clôturés déjà chargés, par clé "AAAA-T".
  // ⚠ Appartient au PROFIL actif : vidé à chaque changement de personne.
  const [archives, setArchives] = useState<Record<string, MeResponse>>({});
  const [archiveStatus, setArchiveStatus] = useState<QuarterStatus>("idle");

  // Pastille « Votre accès est activé » : première visite réussie uniquement
  // (décidé dans init(), au moment où l'oid du compte est connu).
  const [showActivated, setShowActivated] = useState(false);

  // Mois affiché dans les tuiles (par défaut : le plus récent).
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  // Mois déclaré en cours de CORRECTION (formulaire pré-rempli).
  const [editingMonth, setEditingMonth] = useState<number | null>(null);

  // Mois qui vient d'être déclaré/corrigé avec succès : confirmation verte
  // au-dessus des tuiles (rassure et enchaîne vers le paiement).
  // Effacé dès que l'utilisateur navigue ailleurs.
  const [successMonth, setSuccessMonth] = useState<number | null>(null);

  // Sélectionner un mois quitte toujours le mode correction
  // et efface la confirmation de déclaration.
  const selectMonth = (month: number) => {
    setSelectedMonth(month);
    setEditingMonth(null);
    setSuccessMonth(null);
  };

  // --- « Payer maintenant » : défilement vers la carte de paiement -----------
  // payRef pointe sur la section paiement ; payScrollTick déclenche le
  // défilement APRÈS le re-rendu (le mois impayé le plus ancien vient
  // d'être sélectionné, la carte de paiement est donc bien montée).
  const payRef = useRef<HTMLDivElement | null>(null);
  const [payScrollTick, setPayScrollTick] = useState(0);

  useEffect(() => {
    if (payScrollTick === 0) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    payRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [payScrollTick]);

  // --- Familles : plusieurs profils sur un même compte -----------------------
  // profiles : la liste des personnes liées au compte (null = pas encore su).
  // activeFa : le FA du profil choisi (null = un seul profil, résolu serveur).
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [activeFa, setActiveFa] = useState<string | null>(null);

  // Charge (ou recharge) les données du trimestre EN COURS.
  // fa = profil actif à demander ; null = laisser le serveur décider
  // (un seul profil) ou renvoyer needsProfile (plusieurs profils).
  const loadCurrent = async (fa: string | null) => {
    try {
      const url = fa ? `/api/me?fa=${encodeURIComponent(fa)}` : "/api/me";
      const res = await fetch(url);
      // Session expirée pendant la consultation : repartir vers la
      // connexion plutôt que d'afficher une erreur incompréhensible.
      // (assign() = même comportement que href, accepté par la règle
      // ESLint react-hooks/immutability.)
      if (res.status === 401) {
        window.location.assign(
          "/.auth/login/aad?post_login_redirect_uri=/portail"
        );
        return;
      }
      if (res.status === 404) {
        setStatus("nodata");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const json = (await res.json()) as MeRaw;

      // Plusieurs personnes sur ce compte et aucun profil choisi
      // -> écran « Qui êtes-vous ? ».
      if (json.needsProfile && json.profiles && json.profiles.length > 0) {
        setProfiles(json.profiles);
        setStatus("chooseProfile");
        return;
      }

      // Mémorise la liste des profils (permet « Changer de personne »).
      if (json.profiles && json.profiles.length > 1) {
        setProfiles(json.profiles);
      }

      setCurrent(json);
      setShownQuarter(null); // on revient toujours au trimestre en cours
      setSelectedMonth(json.months[0]?.month ?? null);
      setEditingMonth(null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  // Choix d'un profil dans le sélecteur : devient le profil ACTIF pour tous
  // les appels suivants (consultation, historique, déclaration).
  const chooseProfile = (fa: string) => {
    setActiveFa(fa);
    setSuccessMonth(null);
    // Le cache des trimestres appartient à l'ANCIEN profil : on le vide.
    setArchives({});
    setArchiveStatus("idle");
    setShownQuarter(null);
    setStatus("loading");
    void loadCurrent(fa);
  };

  // Retour à l'écran de choix (bouton « Changer de personne »).
  const changeProfile = () => {
    setEditingMonth(null);
    setSelectedMonth(null);
    setSuccessMonth(null);
    setShownQuarter(null);
    setStatus("chooseProfile");
  };

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // 1) Qui est connecté ? (fourni par Azure Static Web Apps)
        const authRes = await fetch("/.auth/me");
        const authJson = (await authRes.json()) as {
          clientPrincipal: { userDetails?: string; userId?: string } | null;
        };

        // Pas connecté -> redirection vers la connexion Microsoft
        if (!authJson.clientPrincipal) {
          window.location.assign(
            "/.auth/login/aad?post_login_redirect_uri=/portail"
          );
          return;
        }

        // Pastille « Votre accès est activé » : uniquement à la PREMIÈRE
        // visite de ce compte sur cet appareil (l'activation vient d'aboutir),
        // mémorisée en localStorage — clé par oid (userId = oid pour AAD,
        // cf. apprentissages du projet). Décidé ICI, dans le flux asynchrone
        // d'initialisation, et non dans un effet : la règle ESLint
        // react-hooks interdit un setState synchrone dans le corps d'un effet.
        try {
          const oid = authJson.clientPrincipal.userId;
          if (oid) {
            const key = `ra-activated-${oid}`;
            if (!window.localStorage.getItem(key)) {
              window.localStorage.setItem(key, "1");
              if (!cancelled) setShowActivated(true);
            }
          }
        } catch {
          // Stockage local indisponible (navigation privée stricte) : on
          // n'affiche pas la pastille plutôt que la ré-afficher à chaque fois.
        }

        // 2) Récupérer SES données (filtrage fait côté serveur).
        //    Premier appel SANS fa : le serveur répond soit avec les données
        //    (un seul profil), soit avec needsProfile (famille).
        if (!cancelled) await loadCurrent(null);
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // Déclaration/correction envoyée avec succès : recharge les données,
  // ré-affiche le mois concerné (loadCurrent sélectionnerait sinon le plus
  // récent) et montre la confirmation verte.
  const handleDeclared = async (month: number) => {
    await loadCurrent(activeFa);
    setSelectedMonth(month);
    setEditingMonth(null);
    setSuccessMonth(month);
  };

  // --- Historique multi-trimestres (§10.0) ------------------------------------

  // Clé de cache d'un trimestre (l'année en fait partie : « T2 » seul serait
  // ambigu d'une année à l'autre).
  const quarterKey = (ref: QuarterRef): string => `${ref.year}-${ref.quarter}`;

  // Le trimestre demandé est-il le trimestre EN COURS ?
  const isCurrentRef = (ref: QuarterRef): boolean =>
    current !== null &&
    current.quarter === ref.quarter &&
    current.year === ref.year;

  // Chargement (ou RE-chargement après erreur) d'un trimestre CLÔTURÉ.
  const loadArchive = async (ref: QuarterRef) => {
    setArchiveStatus("loading");
    setSelectedMonth(null);
    try {
      const params = new URLSearchParams({
        quarter: String(ref.quarter),
        year: String(ref.year),
      });
      // Familles : profil actif, TOUJOURS revérifié côté serveur (403 sinon).
      if (activeFa) params.set("fa", activeFa);

      const res = await fetch(`/api/me?${params.toString()}`);
      if (res.status === 401) {
        window.location.assign(
          "/.auth/login/aad?post_login_redirect_uri=/portail"
        );
        return;
      }
      if (!res.ok) {
        setArchiveStatus("error");
        return;
      }
      const json = (await res.json()) as MeResponse;
      setArchives((prev) => ({ ...prev, [quarterKey(ref)]: json }));
      setSelectedMonth(json.months[0]?.month ?? null);
      setArchiveStatus("ready");
    } catch {
      setArchiveStatus("error");
    }
  };

  // Affiche un trimestre de la fenêtre (courant ou clôturé). Un trimestre
  // clôturé n'est chargé QU'UNE FOIS par profil (cache) ; « Réessayer » appelle
  // loadArchive() DIRECTEMENT (fonction séparée : aucun état à remettre à
  // "idle" au préalable, donc pas de relance annulée en silence par une valeur
  // d'état lue dans la closure du rendu courant — piège consigné §11ter).
  const showQuarter = (ref: QuarterRef) => {
    setEditingMonth(null);
    setSuccessMonth(null);

    // Trimestre en cours : déjà en mémoire, rien à charger.
    if (isCurrentRef(ref)) {
      setShownQuarter(null);
      setSelectedMonth(current?.months[0]?.month ?? null);
      return;
    }

    setShownQuarter(ref);
    const cached = archives[quarterKey(ref)];
    if (cached) {
      setArchiveStatus("ready");
      setSelectedMonth(cached.months[0]?.month ?? null);
      return;
    }
    void loadArchive(ref);
  };

  // Retour au trimestre en cours.
  const backToCurrent = () => {
    setShownQuarter(null);
    setEditingMonth(null);
    setSuccessMonth(null);
    setSelectedMonth(current?.months[0]?.month ?? null);
  };

  // --- Trimestre AFFICHÉ ------------------------------------------------------
  // Fenêtre des trimestres consultables : décidée par le serveur. Si l'API ne
  // la renvoie pas (déploiement partiel), le sélecteur disparaît simplement et
  // le portail se comporte comme avant (trimestre en cours seul).
  const quarterWindow: QuarterRef[] = current?.quarters ?? [];

  const viewingArchive = shownQuarter !== null;
  const archived: MeResponse | null = shownQuarter
    ? archives[quarterKey(shownQuarter)] ?? null
    : null;

  // Les données réellement affichées (trimestre courant OU trimestre clôturé).
  const data: MeResponse | null = viewingArchive ? archived : current;

  // Déclaration affichée dans les tuiles (mois sélectionné, sinon la dernière).
  const latestMonth = data?.months[0]?.month ?? null;
  const displayed =
    data?.months.find((m) => m.month === selectedMonth) ??
    data?.months[0] ??
    null;

  // Le mois sélectionné n'est pas encore déclaré -> formulaire de déclaration.
  // ⚠ Trimestre EN COURS uniquement : Declare.ts refuse toute écriture sur un
  // trimestre clôturé (et QuarterCard n'y rend pas les mois manquants
  // cliquables).
  const isMissingSelected =
    !viewingArchive &&
    selectedMonth !== null &&
    current !== null &&
    !current.months.some((m) => m.month === selectedMonth);

  // Récapitulatif des paiements du trimestre AFFICHÉ.
  const totalToPay =
    data?.months.reduce((s, m) => s + (m.contribution ?? 0), 0) ?? 0;
  const totalPaid = data?.months.reduce((s, m) => s + (m.paid ?? 0), 0) ?? 0;
  const remaining = Math.max(0, totalToPay - totalPaid);

  // Solde du mois AFFICHÉ (le paiement suit le mois sélectionné).
  const displayedDue = displayed
    ? Math.max(0, (displayed.contribution ?? 0) - (displayed.paid ?? 0))
    : 0;

  // Mois impayé le plus ancien : sert d'avertissement si le résident regarde
  // un mois plus récent alors qu'un mois antérieur reste dû (logique FIFO).
  const oldestUnpaid = data
    ? [...data.months]
        .sort((a, b) => a.month - b.month)
        .find((m) => (m.contribution ?? 0) - (m.paid ?? 0) > 0.005) ?? null
    : null;

  // « Payer maintenant » : sélectionne le mois impayé le plus ancien (FIFO)
  // puis fait défiler jusqu'à la carte de paiement (voir payScrollTick).
  const goToPayment = () => {
    if (oldestUnpaid) selectMonth(oldestUnpaid.month);
    setPayScrollTick((n) => n + 1);
  };

  // Défilement vers la carte de paiement du mois AFFICHÉ (sans changer de
  // mois) : utilisé par le bouton « Payer X € » de la tuile « Payé ».
  const scrollToPayment = () => setPayScrollTick((n) => n + 1);

  // Statut de paiement du TRIMESTRE AFFICHÉ : code couleur PARTAGÉ entre le
  // bandeau du haut et la tuile « Reste à payer » (toujours synchronisés).
  // vert = tout payé · rouge = au moins une échéance dépassée ·
  // ambre = acompte(s) versé(s) · violet = rien versé (état normal).
  const quarterPayStatus: PayStatus =
    !data || data.months.length === 0 || remaining <= 0.005
      ? "paid"
      : data.months.some(
            (m) => monthPayStatus(m, data.quarter, data.year) === "overdue"
          )
        ? "overdue"
        : totalPaid > 0.005
          ? "partial"
          : "unpaid";

  // Statut de paiement du mois AFFICHÉ (colore la tuile « Payé »).
  const displayedStatus: PayStatus | null =
    displayed && data ? monthPayStatus(displayed, data.quarter, data.year) : null;

  // Libellé texte accompagnant chaque statut (jamais la couleur seule).
  const stateLabel = (s: PayStatus): string => stateLabelFor(t, s);

  // « avril – juin 2026 »
  const quarterRange = (ref: QuarterRef): string => {
    const [first, , last] = quarterMonths(ref.quarter);
    return `${monthName(first, language).toLowerCase()} – ${monthName(
      last,
      language
    ).toLowerCase()} ${ref.year}`;
  };

  // Titre de la carte du trimestre affiché.
  const shownTitle = ((): string => {
    if (!data || data.quarter === null) return t.quarterCurrent;
    const year = data.year ?? null;
    if (year === null) return t.quarterCurrent;
    const ref = { quarter: data.quarter, year };
    const base = viewingArchive
      ? `${t.quarterShort}${ref.quarter} ${ref.year}`
      : t.quarterCurrent;
    return `${base} (${quarterRange(ref)})`;
  })();

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

        {/* Langue + déconnexion : la déconnexion doit rester visible en
            permanence (postes partagés dans les centres d'accueil). */}
        <div className="header-actions">
          <LangPills
            value={language}
            onChange={setLanguage}
            ariaLabel="Language / Langue / Taal"
          />
          <a className="btn btn-outline btn-logout" href={LOGOUT_URL}>
            {t.logout}
          </a>
        </div>
      </header>

      <main className="page">
        <h1 className="page-title">
          {t.welcome}
          {status === "ready" && current?.profile
            ? ` ${current.profile.firstName}`
            : ""}
        </h1>
        <div className="title-accent" aria-hidden="true" />
        <p className="page-subtitle">{t.intro}</p>

        <div className="card">
          {showActivated && (
            <div className="alert alert-success alert-flex" role="status">
              <CheckIcon />
              <span>{t.activated}</span>
            </div>
          )}

          {/* Famille : rappel du profil consulté + changement de personne.
              Visible quel que soit le trimestre affiché. */}
          {status === "ready" &&
            profiles &&
            profiles.length > 1 &&
            current?.profile && (
              <div className="profile-bar">
                <span className="profile-bar-text">
                  {t.profileViewing}{" "}
                  <strong>
                    {current.profile.firstName} {current.profile.lastName}
                  </strong>
                </span>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={changeProfile}
                >
                  {t.profileChange}
                </button>
              </div>
            )}

          {/* ---------- Vue : choix du profil (familles) ---------- */}
          {status === "chooseProfile" && profiles && (
            <>
              <h2 className="portal-section-title">{t.profileTitle}</h2>
              <p className="month-caption">{t.profileIntro}</p>
              <div className="profile-select">
                {profiles.map((p) => (
                  <button
                    key={p.fa}
                    type="button"
                    className="profile-option"
                    aria-label={`${t.profileOpenAria} ${p.firstName} ${p.lastName}`}
                    onClick={() => chooseProfile(p.fa)}
                  >
                    <span className="profile-name">
                      {p.firstName} {p.lastName}
                    </span>
                    <span className="profile-fa">{p.fa}</span>
                    <span className="profile-arrow" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {status === "loading" && (
            <div className="loading-row" role="status">
              <span className="spinner spinner-violet" aria-hidden="true" />
              <span>{t.loading}</span>
            </div>
          )}

          {/* Erreur de chargement : TOUJOURS offrir une issue.
              Sans « Changer de personne », un compte FAMILLE dont UN profil
              échoue reste bloqué : le sélecteur « Qui êtes-vous ? » n'est plus
              atteignable (la barre de profil n'existe que dans l'état "ready")
              et seule la déconnexion resterait. */}
          {status === "error" && (
            <>
              <div
                className="alert alert-error alert-flex alert-retry"
                role="alert"
              >
                <span>{t.error}</span>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setStatus("loading");
                    void loadCurrent(activeFa);
                  }}
                >
                  {t.retry}
                </button>
              </div>
              {profiles && profiles.length > 1 && (
                <div className="portal-actions">
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={changeProfile}
                  >
                    {t.profileChange}
                  </button>
                </div>
              )}
            </>
          )}

          {/* Aucune donnée (404) : même piège pour les familles — un profil
              sans données ne doit pas condamner l'accès aux autres. */}
          {status === "nodata" && (
            <>
              <div className="alert alert-info" role="status">
                {t.noData}
              </div>
              {profiles && profiles.length > 1 && (
                <div className="portal-actions">
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={changeProfile}
                  >
                    {t.profileChange}
                  </button>
                </div>
              )}
            </>
          )}

          {/* ---------- Vue principale : un trimestre de la fenêtre ---------- */}
          {status === "ready" && current && (
            <>
              {/* 1. Sélecteur de trimestre (§10.0). La fenêtre vient du serveur ;
                    s'il n'en renvoie pas, rien ne s'affiche (compatibilité). */}
              {quarterWindow.length > 1 && (
                <>
                  <SectionTitle icon={<CalendarIcon />}>
                    {t.historyTitle}
                  </SectionTitle>
                  <div
                    className="quarter-switch"
                    role="group"
                    aria-label={t.historyAria}
                  >
                    {quarterWindow.map((ref) => {
                      const isShown = viewingArchive
                        ? shownQuarter !== null &&
                          shownQuarter.quarter === ref.quarter &&
                          shownQuarter.year === ref.year
                        : isCurrentRef(ref);
                      return (
                        <button
                          key={quarterKey(ref)}
                          type="button"
                          aria-pressed={isShown}
                          aria-label={quarterRange(ref)}
                          onClick={() => showQuarter(ref)}
                        >
                          {t.quarterShort}
                          {ref.quarter} {ref.year}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* 2. Chargement / erreur d'un trimestre clôturé */}
              {viewingArchive && archiveStatus === "loading" && (
                <div className="loading-row" role="status">
                  <span className="spinner spinner-violet" aria-hidden="true" />
                  <span>{t.loading}</span>
                </div>
              )}

              {viewingArchive && archiveStatus === "error" && (
                <>
                  <div
                    className="alert alert-error alert-flex alert-retry"
                    role="alert"
                  >
                    <span>{t.error}</span>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() =>
                        shownQuarter && void loadArchive(shownQuarter)
                      }
                    >
                      {t.retry}
                    </button>
                  </div>
                  <div className="portal-actions">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={backToCurrent}
                    >
                      {t.backToCurrent}
                    </button>
                  </div>
                </>
              )}

              {/* 3. Contenu du trimestre affiché */}
              {data && (!viewingArchive || archiveStatus === "ready") && (
                <>
                  {/* Trimestre clôturé : dire ce qui reste possible (payer) et
                      ce qui ne l'est plus (déclarer / corriger). */}
                  {viewingArchive && (
                    <div className="alert alert-info" role="status">
                      {t.archivedNote}
                    </div>
                  )}

                  {/* Confirmation de la déclaration qui vient d'être envoyée :
                      mois + contribution recalculée par le serveur, lue dans
                      les données rechargées. */}
                  {successMonth !== null &&
                    editingMonth === null &&
                    !isMissingSelected &&
                    displayed &&
                    displayed.month === successMonth && (
                      <div
                        className="alert alert-success alert-flex"
                        role="status"
                      >
                        <CheckIcon />
                        <span>
                          {t.declaredOk
                            .replace(
                              "{month}",
                              monthName(successMonth, language)
                            )
                            .replace(
                              "{amount}",
                              euro(displayed.contribution, language)
                            )}
                        </span>
                      </div>
                    )}

                  {/* 3a. Formulaire (déclaration ou correction) OU tuiles du
                         mois affiché. Les formulaires n'existent QUE sur le
                         trimestre en cours. */}
                  {isMissingSelected && selectedMonth !== null ? (
                    <>
                      <SectionTitle icon={<PenIcon />}>
                        {t.declareTitle}
                      </SectionTitle>
                      <p className="month-caption">
                        {monthName(selectedMonth, language)}
                      </p>
                      <DeclarationForm
                        key={selectedMonth}
                        month={selectedMonth}
                        lang={language}
                        onSubmitted={() => void handleDeclared(selectedMonth)}
                        fa={activeFa}
                      />
                    </>
                  ) : !viewingArchive &&
                    displayed &&
                    editingMonth === displayed.month ? (
                    <>
                      <SectionTitle icon={<PenIcon />}>
                        {t.correctBtn}
                      </SectionTitle>
                      <p className="month-caption">
                        {monthName(displayed.month, language)}
                      </p>
                      <DeclarationForm
                        key={`edit-${displayed.month}`}
                        month={displayed.month}
                        lang={language}
                        onSubmitted={() => void handleDeclared(displayed.month)}
                        initial={{
                          gross: displayed.grossSalary,
                          net: displayed.netSalary,
                        }}
                        onCancel={() => setEditingMonth(null)}
                        fa={activeFa}
                      />
                    </>
                  ) : displayed ? (
                    <>
                      <SectionTitle icon={<FileTextIcon />}>
                        {displayed.month === latestMonth
                          ? t.lastDeclaration
                          : t.displayedDeclaration}
                      </SectionTitle>
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
                          tone={
                            displayedStatus
                              ? toneForStatus(displayedStatus)
                              : undefined
                          }
                          sub={
                            displayedStatus
                              ? stateLabel(displayedStatus)
                              : undefined
                          }
                          action={
                            displayedDue > 0.005 && data.payment
                              ? {
                                  label: t.payAmountBtn.replace(
                                    "{amount}",
                                    euro(displayedDue, language)
                                  ),
                                  onClick: scrollToPayment,
                                }
                              : undefined
                          }
                        />
                      </div>

                      {/* Corriger : trimestre EN COURS uniquement. */}
                      {!viewingArchive && (
                        <div className="declare-correct">
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={() => setEditingMonth(displayed.month)}
                          >
                            {t.correctBtn}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    /* Aucune déclaration dans ce trimestre.
                       ⚠ CORRECTIF (14/7/2026) : auparavant, un trimestre VIDE
                       n'affichait qu'une alerte — SANS la carte du trimestre,
                       donc SANS aucun moyen de déclarer. Or une liste KB-Cumul
                       est vide au lendemain de chaque rotation : plus personne
                       n'aurait pu déclarer le trimestre qui s'ouvre. La carte
                       est désormais TOUJOURS affichée (ci-dessous). */
                    <div className="alert alert-info" role="status">
                      {viewingArchive ? t.noDeclarations : t.declarePrompt}
                    </div>
                  )}

                  {/* 3b. Les mois du trimestre.
                         Trimestre clôturé : mois déclarés cliquables (pour
                         payer), mois manquants inertes (pas de « + »). */}
                  <SectionTitle icon={<CalendarIcon />}>
                    {shownTitle}
                  </SectionTitle>
                  <QuarterCard
                    data={data}
                    lang={language}
                    selectedMonth={selectedMonth}
                    onSelectMonth={selectMonth}
                    canDeclareMissing={!viewingArchive}
                  />

                  {/* 3c. Récapitulatif des paiements (l'info clé du résident) */}
                  {data.months.length > 0 && (
                    <>
                      <SectionTitle icon={<EuroIcon />}>
                        {t.paymentsTitle}
                      </SectionTitle>
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
                          tone={toneForStatus(quarterPayStatus)}
                          sub={stateLabel(quarterPayStatus)}
                          onClick={
                            remaining > 0.005 && data.payment
                              ? goToPayment
                              : undefined
                          }
                        />
                      </div>
                    </>
                  )}

                  {/* 3d. Paiement : suit le mois sélectionné dans la carte
                         (masqué pendant une déclaration ou une correction).
                         Reste OUVERT sur un trimestre clôturé : une dette
                         ancienne se paie encore, et « Soldes » conserve la
                         communication structurée d'origine.
                         payRef = cible du bouton « Payer maintenant ». */}
                  {!isMissingSelected &&
                    editingMonth === null &&
                    data.payment &&
                    displayed && (
                      <div ref={payRef} className="pay-anchor">
                        <SectionTitle icon={<EuroIcon />}>
                          {t.payTitle}
                        </SectionTitle>

                        {displayedDue > 0.005 && displayed.structuredCom ? (
                          <PaymentCard
                            key={`${shownTitle}-${displayed.month}`}
                            month={displayed.month}
                            amount={displayedDue}
                            structuredCom={displayed.structuredCom}
                            payment={data.payment}
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
                                onClick={() => selectMonth(oldestUnpaid.month)}
                              >
                                {t.seeMonth}{" "}
                                {monthName(oldestUnpaid.month, language)}
                              </button>
                            </div>
                          )}
                      </div>
                    )}

                  {/* 3e. Retour au trimestre en cours (depuis un trimestre
                         clôturé). Le sélecteur le permet aussi, mais un bouton
                         explicite évite de chercher. */}
                  {viewingArchive && (
                    <div className="portal-actions">
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={backToCurrent}
                      >
                        {t.backToCurrent}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className="card-footer">
            <a className="btn btn-outline" href={LOGOUT_URL}>
              {t.logout}
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
