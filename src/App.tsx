// =============================================================================
// App.tsx — Formulaire de pré-inscription (version sans MUI)
// -----------------------------------------------------------------------------
// Tout le visuel repose sur src/styles/fedasil.css (classes .btn, .field...).
// Prérequis dans main.tsx :
//   import "./styles/fedasil.css";
//
// FORMULAIRE MINIMAL (règle métier §5.14) :
// Le formulaire ne demande QUE le numéro national, l'adresse e-mail et la
// langue de contact. Les prénom/nom OFFICIELS font foi dans la liste
// resident (l'API Subscription.ts ignore tout nom envoyé par le navigateur) :
// zéro faute de frappe, et pas d'oracle NN -> nom côté client.
//
// SAISIE DU NUMÉRO NATIONAL (ergonomie) :
//   - Le NN peut être tapé ou COLLÉ avec ou sans points/tirets/espaces
//     (ex. « 85.07.30-033.28 » tel qu'il figure sur la carte).
//   - Formatage AUTOMATIQUE à la volée pendant la frappe (00.00.00-000.00) ;
//     effacer un séparateur efface aussi le chiffre qui le précède (sinon
//     le curseur resterait bloqué sur le séparateur reformaté).
//   - Contrôle du MODULO 97 belge avant envoi (numéros NN et BIS, personnes
//     nées avant comme après 2000) : les fautes de frappe sont signalées
//     immédiatement, avec un message clair, au lieu d'échouer côté serveur.
//   - L'API reçoit toujours 11 chiffres NUS (inchangé côté serveur).
//
// CHECK-EMAIL ASSOUPLI (règles métier §5.2 et §5.3) :
// Une adresse e-mail déjà connue dans Entra est un cas NORMAL :
//   - familles partageant une seule adresse (plusieurs NN, un seul compte) ;
//   - changement d'adresse e-mail (re-pré-inscription avec le NN) ;
//   - compte supprimé puis ré-invité (récupération par le NN).
// /api/check-email ne BLOQUE donc plus rien : il alimente seulement un avis
// INFORMATIF et rassurant (bleu, jamais rouge) sous le champ e-mail.
// =============================================================================

import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { useLanguage } from "./i18n/useLanguage";
import type { Language } from "./i18n/translations";

// Base de l'API (inchangé) :
// - En production sur Azure Static Web Apps : URL relatives ("" => /api/...).
// - En local : VITE_API_BASE dans .env.local, ou SWA CLI qui proxie /api.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type FormData = {
  nationalId: string; // valeur AFFICHÉE (formatée 00.00.00-000.00)
  email: string;
  contactLanguage: Language;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

// --- Numéro national : formatage et validation ---------------------------------

/** Ne garde que les chiffres d'une saisie (points, tirets, espaces retirés). */
function nnDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Formate progressivement 0 à 11 chiffres vers 00.00.00-000.00.
 *  Fonctionne pendant la frappe : « 8507 » -> « 85.07 », etc. */
function formatNationalId(digits: string): string {
  const d = digits.slice(0, 11);
  let out = d.slice(0, 2);
  if (d.length > 2) out += "." + d.slice(2, 4);
  if (d.length > 4) out += "." + d.slice(4, 6);
  if (d.length > 6) out += "-" + d.slice(6, 9);
  if (d.length > 9) out += "." + d.slice(9, 11);
  return out;
}

/** Contrôle du modulo 97 du numéro national belge (11 chiffres).
 *  Deux variantes officielles :
 *    - né(e) avant 2000 : 97 - (9 premiers chiffres mod 97) ;
 *    - né(e) à partir de 2000 : idem avec « 2 » préfixé aux 9 chiffres.
 *  Les numéros BIS (registre bis, fréquents chez les demandeurs d'asile)
 *  suivent le même algorithme : aucun risque de faux rejet.
 *  NB : Number suffit (11 chiffres < 2^53), pas besoin de BigInt. */
function isValidBelgianNN(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const base = digits.slice(0, 9);
  const check = Number(digits.slice(9));
  const before2000 = 97 - (Number(base) % 97);
  const from2000 = 97 - (Number("2" + base) % 97);
  return check === before2000 || check === from2000;
}

// Libellés locaux du champ NN (aide + erreur de contrôle), même approche que
// les autres blocs de labels de cette page (pas de dépendance à translations.ts).
const nnLabels = {
  fr: {
    helper:
      "11 chiffres, comme sur votre carte : 85.07.30-033.28. Les points et tirets s'ajoutent automatiquement.",
    checksum:
      "Ce numéro ne semble pas correct. Vérifiez chaque chiffre sur votre carte de séjour ou d'identité.",
  },
  nl: {
    helper:
      "11 cijfers, zoals op uw kaart: 85.07.30-033.28. Punten en streepjes worden automatisch toegevoegd.",
    checksum:
      "Dit nummer lijkt niet correct. Controleer elk cijfer op uw verblijfs- of identiteitskaart.",
  },
  en: {
    helper:
      "11 digits, as on your card: 85.07.30-033.28. Dots and dashes are added automatically.",
    checksum:
      "This number doesn't seem correct. Check each digit on your residence or identity card.",
  },
} as const;

// Avis informatif (jamais bloquant) quand l'adresse e-mail est déjà connue.
// Ton volontairement rassurant : c'est un cas normal (familles, changement
// d'adresse, réinscription), pas une erreur.
const emailKnownLabels = {
  fr: "Cette adresse e-mail est déjà connue chez nous. C'est normal si plusieurs membres de votre famille la partagent, si vous changez d'adresse ou si vous vous réinscrivez. Vous pouvez simplement continuer.",
  nl: "Dit e-mailadres is al bij ons bekend. Dat is normaal als meerdere gezinsleden het delen, als u van adres verandert of als u zich opnieuw inschrijft. U kunt gewoon verdergaan.",
  en: "This email address is already known to us. That's normal if several family members share it, if you changed your address, or if you are registering again. You can simply continue.",
} as const;

// Libellés propres au bandeau « déjà inscrit » (gardés ici pour ne pas
// alourdir translations.ts — même approche que les labels de Portail.tsx).
const portalAccessLabels = {
  fr: {
    question: "Vous êtes déjà inscrit(e) ?",
    cta: "Accéder à mon espace",
  },
  nl: {
    question: "Bent u al ingeschreven?",
    cta: "Naar mijn portaal",
  },
  en: {
    question: "Already registered?",
    cta: "Go to my portal",
  },
} as const;

// Avis affiché après une déconnexion du portail (arrivée sur /?loggedout=1).
// Cas d'usage important : ordinateurs partagés dans les centres d'accueil.
// La déconnexion du portail ne ferme PAS la session Microsoft du navigateur ;
// on guide donc la personne vers une déconnexion complète.
const loggedOutLabels = {
  fr: {
    done: "Vous êtes déconnecté(e) de votre espace ResidentApp.",
    shared:
      "Vous utilisez un ordinateur partagé ? Pour protéger vos informations, suivez aussi ces deux étapes :",
    step1: "Déconnectez-vous de votre compte Microsoft :",
    msLogout: "Se déconnecter de Microsoft",
    step2: "Puis fermez toutes les fenêtres du navigateur.",
  },
  nl: {
    done: "U bent afgemeld van uw ResidentApp-portaal.",
    shared:
      "Gebruikt u een gedeelde computer? Volg dan ook deze twee stappen om uw gegevens te beschermen:",
    step1: "Meld u af van uw Microsoft-account:",
    msLogout: "Afmelden bij Microsoft",
    step2: "Sluit daarna alle browservensters.",
  },
  en: {
    done: "You have been signed out of your ResidentApp portal.",
    shared:
      "Using a shared computer? To protect your information, also follow these two steps:",
    step1: "Sign out of your Microsoft account:",
    msLogout: "Sign out of Microsoft",
    step2: "Then close all browser windows.",
  },
} as const;

// Point de terminaison officiel de déconnexion Microsoft (ferme la session
// Entra du navigateur, pour tous les comptes Microsoft ouverts).
const MS_LOGOUT_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/logout";

// --- Petits composants réutilisables -----------------------------------------

/** Sélecteur de langue en pilules (utilisé pour l'interface ET la langue de contact). */
function LangPills({
  value,
  onChange,
  labels,
  ariaLabel,
}: {
  value: Language;
  onChange: (lang: Language) => void;
  labels: Record<Language, string>;
  ariaLabel: string;
}) {
  const options: Language[] = ["fr", "nl", "en"];
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

/** Champ de formulaire : label + input + texte d'aide ou d'erreur. */
function Field({
  id,
  label,
  helper,
  error,
  ...inputProps
}: {
  id: string;
  label: string;
  helper?: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const message = error || helper;
  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={message ? `${id}-help` : undefined}
        {...inputProps}
      />
      {message && (
        <span className="helper" id={`${id}-help`}>
          {message}
        </span>
      )}
    </div>
  );
}

// --- Composant principal -------------------------------------------------------

export default function App() {
  const { language, setLanguage, t } = useLanguage();

  // true si on arrive ici juste après une déconnexion du portail (/?loggedout=1).
  // Lu une seule fois au montage ; l'avis disparaît à la prochaine navigation.
  const [showLoggedOut] = useState(
    () => new URLSearchParams(window.location.search).get("loggedout") === "1"
  );

  const [formData, setFormData] = useState<FormData>({
    nationalId: "",
    email: "",
    contactLanguage: language,
  });

  // Changement de langue d'INTERFACE (pilules de l'en-tête) : la langue de
  // CONTACT suit par défaut. Fait dans le gestionnaire d'événement et non
  // dans un effet (règle ESLint react-hooks : pas de setState synchrone
  // dans le corps d'un effet). La personne peut ensuite choisir une langue
  // de contact différente via les pilules du formulaire.
  const changeInterfaceLanguage = (lang: Language) => {
    setLanguage(lang);
    setFormData((prev) => ({ ...prev, contactLanguage: lang }));
  };

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // true = l'adresse e-mail saisie est déjà connue dans Entra (avis INFORMATIF
  // uniquement : familles, changement d'adresse, réinscription — jamais bloquant).
  const [emailKnown, setEmailKnown] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;

    setFormData((prev) => {
      const next = { ...prev };

      if (name === "nationalId") {
        // Saisie ou collage AVEC ou SANS séparateurs : on ne garde que les
        // chiffres, puis on reformate 00.00.00-000.00.
        const prevDigits = nnDigits(prev.nationalId);
        let digits = nnDigits(value);

        // Effacement d'un séparateur : les chiffres n'ont pas changé mais la
        // valeur a raccourci -> on retire aussi le chiffre précédent, sinon
        // le reformatage ré-ajoute le séparateur et l'effacement est bloqué.
        if (
          digits === prevDigits &&
          value.length < prev.nationalId.length
        ) {
          digits = digits.slice(0, -1);
        }

        next.nationalId = formatNationalId(digits);
      } else if (name === "email") {
        next.email = value.trim().toLowerCase();
      } else if (name === "contactLanguage") {
        next.contactLanguage = value as Language;
      }

      return next;
    });

    // L'avis « adresse déjà connue » ne vaut que pour l'adresse vérifiée :
    // dès que l'adresse change, on le retire (re-vérification au prochain blur).
    if (name === "email") setEmailKnown(false);

    setErrors((prev) => ({ ...prev, [name]: "" }));
    if (apiError) setApiError(null);
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    const digits = nnDigits(formData.nationalId);

    if (!digits) {
      newErrors.nationalId = t("errorNationalIdRequired");
    } else if (!/^\d{11}$/.test(digits)) {
      newErrors.nationalId = t("errorNationalIdFormat");
    } else if (!isValidBelgianNN(digits)) {
      // 11 chiffres mais modulo 97 incorrect : faute de frappe quasi certaine.
      newErrors.nationalId = nnLabels[language].checksum;
    }

    if (!formData.email.trim()) {
      newErrors.email = t("errorEmailRequired");
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email.trim())) {
      newErrors.email = t("errorEmailInvalid");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Vérification INFORMATIVE : l'adresse est-elle déjà connue dans Entra ?
  // Ne bloque jamais rien et ne pose jamais d'erreur : une adresse connue est
  // un cas normal (familles §5.2, changement d'adresse §5.3, réinscription §5.4).
  // En cas d'échec réseau/API : silence (l'avis est un simple confort).
  const checkEmailKnown = async (email: string) => {
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return;
    }

    try {
      setCheckingEmail(true);
      const response = await fetch(
        `${API_BASE}/api/check-email?email=${encodeURIComponent(email)}`
      );

      if (!response.ok) {
        console.error("Erreur check-email:", await response.text());
        return;
      }

      const data = (await response.json()) as { exists: boolean };
      setEmailKnown(data.exists);
    } catch (err) {
      console.error("Erreur check-email:", err);
    } finally {
      setCheckingEmail(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(false);
    setApiError(null);

    if (!validate()) {
      return;
    }

    try {
      setSubmitting(true);

      // L'API reçoit le NN en 11 chiffres NUS (les séparateurs affichés ne
      // sont qu'un confort de lecture) — format identique à avant.
      const response = await fetch(`${API_BASE}/api/pre-inscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nationalId: nnDigits(formData.nationalId),
          email: formData.email,
          contactLanguage: formData.contactLanguage,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || t("apiErrorDefault"));
      }

      setSubmitted(true);
    } catch (error) {
      console.error("Erreur d'appel API :", error);
      const message =
        error instanceof Error ? error.message : t("apiErrorDefault");
      setApiError(message);
    } finally {
      setSubmitting(false);
    }
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
          onChange={changeInterfaceLanguage}
          labels={{ fr: "FR", nl: "NL", en: "EN" }}
          ariaLabel="Language / Langue / Taal"
        />
      </header>

      <main className="page">
        <h1 className="page-title">{t("title")}</h1>
        <div className="title-accent" aria-hidden="true" />
        <p className="page-subtitle">{t("subtitle")}</p>

        {/* Avis post-déconnexion : démarches pour une déconnexion COMPLÈTE
            (cas des ordinateurs partagés dans les centres). */}
        {showLoggedOut && (
          <div className="alert alert-warning logout-notice" role="status">
            <p className="logout-done">{loggedOutLabels[language].done}</p>
            <p>{loggedOutLabels[language].shared}</p>
            <ol>
              <li>
                <span>{loggedOutLabels[language].step1}</span>
                <a className="btn btn-outline" href={MS_LOGOUT_URL}>
                  {loggedOutLabels[language].msLogout}
                </a>
              </li>
              <li>{loggedOutLabels[language].step2}</li>
            </ol>
          </div>
        )}

        {/* Accès rapide au portail pour les résidents déjà inscrits.
            /portail redirige automatiquement vers la connexion Microsoft
            si la personne n'est pas (ou plus) connectée. */}
        <div className="portal-access">
          <span>{portalAccessLabels[language].question}</span>
          <a className="btn btn-outline" href="/portail">
            {portalAccessLabels[language].cta}
          </a>
        </div>

        {submitted && (
          <div className="alert alert-success" role="status">
            {t("successMessage")}
          </div>
        )}

        {apiError && (
          <div className="alert alert-error" role="alert">
            {apiError}
          </div>
        )}

        <div className="card">
          <form className="form" noValidate onSubmit={handleSubmit}>
            {/* Numéro national : formaté à la volée (00.00.00-000.00),
                séparateurs acceptés à la saisie comme au collage,
                contrôle modulo 97 à la validation. 15 = longueur formatée. */}
            <Field
              id="nationalId"
              name="nationalId"
              label={t("nationalIdLabel")}
              inputMode="numeric"
              autoComplete="off"
              maxLength={15}
              value={formData.nationalId}
              onChange={handleChange}
              error={errors.nationalId || undefined}
              helper={nnLabels[language].helper}
            />

            <Field
              id="email"
              name="email"
              type="email"
              label={t("emailLabel")}
              autoComplete="email"
              value={formData.email}
              onChange={handleChange}
              onBlur={() => checkEmailKnown(formData.email)}
              error={errors.email || undefined}
              helper={checkingEmail ? t("checkingEmail") : t("emailHelper")}
            />

            {/* Adresse déjà connue : avis rassurant, en bleu (jamais rouge),
                qui n'empêche RIEN — la pré-inscription continue normalement. */}
            {emailKnown && (
              <div
                className="alert alert-info email-known-notice"
                role="status"
              >
                {emailKnownLabels[language]}
              </div>
            )}

            {/* Langue de contact */}
            <div>
              <p className="section-label">{t("contactLanguageLabel")}</p>
              <p className="section-hint">{t("contactLanguageHelper")}</p>
              <LangPills
                value={formData.contactLanguage}
                onChange={(lang) =>
                  setFormData((prev) => ({ ...prev, contactLanguage: lang }))
                }
                labels={{
                  fr: t("contactLanguageOptionFr"),
                  nl: t("contactLanguageOptionNl"),
                  en: t("contactLanguageOptionEn"),
                }}
                ariaLabel={t("contactLanguageLabel")}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={submitting}
            >
              {submitting && <span className="spinner" aria-hidden="true" />}
              {t("submitButton")}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
