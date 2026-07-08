// =============================================================================
// App.tsx — Formulaire de pré-inscription (version sans MUI)
// -----------------------------------------------------------------------------
// La logique métier (validation, check-email, soumission) est inchangée.
// Tout le visuel repose sur src/styles/fedasil.css (classes .btn, .field...).
// Prérequis dans main.tsx :
//   import "./styles/fedasil.css";
//   (supprimer ThemeProvider, CssBaseline et tout import @mui/* / @emotion/*)
// =============================================================================

import { useState, useEffect } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { useLanguage } from "./i18n/useLanguage";
import type { Language } from "./i18n/translations";

// Base de l'API (inchangé) :
// - En production sur Azure Static Web Apps : URL relatives ("" => /api/...).
// - En local : VITE_API_BASE dans .env.local, ou SWA CLI qui proxie /api.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

type FormData = {
  nationalId: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  contactLanguage: Language;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

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

  const [formData, setFormData] = useState<FormData>({
    nationalId: "",
    firstName: "",
    lastName: "",
    email: "",
    username: "",
    contactLanguage: language,
  });

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      contactLanguage: language,
    }));
  }, [language]);

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // true = l'utilisateur DOIT choisir un autre nom d'utilisateur (email déjà utilisé)
  const [isUsernameEditable, setIsUsernameEditable] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;

    setFormData((prev) => {
      const next = { ...prev };

      if (name === "email") {
        const cleanedEmail = value.trim().toLowerCase();
        next.email = cleanedEmail;

        if (!isUsernameEditable) {
          next.username = cleanedEmail;
        }
      } else if (name === "contactLanguage") {
        next.contactLanguage = value as Language;
      } else {
        next[name as Exclude<keyof FormData, "contactLanguage">] = value;
      }

      return next;
    });

    setErrors((prev) => ({ ...prev, [name]: "" }));
    if (apiError) setApiError(null);
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.nationalId.trim()) {
      newErrors.nationalId = t("errorNationalIdRequired");
    } else if (!/^\d{11}$/.test(formData.nationalId.trim())) {
      newErrors.nationalId = t("errorNationalIdFormat");
    }

    if (!formData.firstName.trim()) {
      newErrors.firstName = t("errorFirstNameRequired");
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = t("errorLastNameRequired");
    }

    if (!formData.email.trim()) {
      newErrors.email = t("errorEmailRequired");
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email.trim())) {
      newErrors.email = t("errorEmailInvalid");
    }

    if (isUsernameEditable && !formData.username.trim()) {
      newErrors.username = t("errorUsernameRequired");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Vérification côté API si l'email est déjà utilisé par un invité (inchangé)
  const checkEmailAlreadyUsed = async (email: string) => {
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

      if (data.exists) {
        setIsUsernameEditable(true);
        setErrors((prev) => ({
          ...prev,
          email: t("errorEmailAlreadyUsed"),
        }));
      } else {
        setIsUsernameEditable(false);
        setErrors((prev) => ({
          ...prev,
          email: "",
        }));
        setFormData((prev) => ({
          ...prev,
          username: prev.email,
        }));
      }
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

      const response = await fetch(`${API_BASE}/api/pre-inscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
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
          onChange={setLanguage}
          labels={{ fr: "FR", nl: "NL", en: "EN" }}
          ariaLabel="Language / Langue / Taal"
        />
      </header>

      <main className="page">
        <h1 className="page-title">{t("title")}</h1>
        <div className="title-accent" aria-hidden="true" />
        <p className="page-subtitle">{t("subtitle")}</p>

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
            <Field
              id="nationalId"
              name="nationalId"
              label={t("nationalIdLabel")}
              inputMode="numeric"
              autoComplete="off"
              value={formData.nationalId}
              onChange={handleChange}
              error={errors.nationalId || undefined}
              helper={t("nationalIdHelper")}
            />

            <div className="grid-2">
              <Field
                id="firstName"
                name="firstName"
                label={t("firstNameLabel")}
                autoComplete="given-name"
                value={formData.firstName}
                onChange={handleChange}
                error={errors.firstName || undefined}
              />
              <Field
                id="lastName"
                name="lastName"
                label={t("lastNameLabel")}
                autoComplete="family-name"
                value={formData.lastName}
                onChange={handleChange}
                error={errors.lastName || undefined}
              />
            </div>

            <Field
              id="email"
              name="email"
              type="email"
              label={t("emailLabel")}
              autoComplete="email"
              value={formData.email}
              onChange={handleChange}
              onBlur={() => checkEmailAlreadyUsed(formData.email)}
              error={errors.email || undefined}
              helper={checkingEmail ? t("checkingEmail") : t("emailHelper")}
            />

            {/* Nom d'utilisateur semi-automatique (inchangé) */}
            <Field
              id="username"
              name="username"
              label={t("usernameLabel")}
              value={formData.username}
              onChange={handleChange}
              disabled={!isUsernameEditable}
              error={errors.username || undefined}
              helper={
                isUsernameEditable
                  ? t("usernameHelperEditable")
                  : t("usernameHelperLocked")
              }
            />

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
