import { useState } from "react";
import type { FormEvent, ChangeEvent } from "react";
import "./App.css";

type FormData = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

function App() {
  const [formData, setFormData] = useState<FormData>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const { name, value } = event.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // On efface l’erreur au fur et à mesure que l’utilisateur corrige
    setErrors((prev) => ({
      ...prev,
      [name]: "",
    }));
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = "Le prénom est obligatoire.";
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = "Le nom est obligatoire.";
    }

    if (!formData.email.trim()) {
      newErrors.email = "L’adresse e-mail est obligatoire.";
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email)) {
      newErrors.email = "Adresse e-mail invalide.";
    }

    if (!formData.password) {
      newErrors.password = "Le mot de passe est obligatoire.";
    } else if (formData.password.length < 6) {
      newErrors.password = "Le mot de passe doit contenir au moins 6 caractères.";
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = "Veuillez confirmer le mot de passe.";
    } else if (formData.confirmPassword !== formData.password) {
      newErrors.confirmPassword = "Les mots de passe ne correspondent pas.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!validate()) {
      setSubmitted(false);
      return;
    }

    // Ici tu pourrais envoyer les données vers une API plus tard.
    console.log("Formulaire soumis :", formData);
    setSubmitted(true);
  };

  return (
    <div className="app-container">
      <div className="form-card">
        <h1>Inscription</h1>
        <p className="subtitle">
          Remplis le formulaire pour créer ton compte.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="firstName">Prénom</label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                value={formData.firstName}
                onChange={handleChange}
                placeholder="Jean"
              />
              {errors.firstName && (
                <p className="error">{errors.firstName}</p>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="lastName">Nom</label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                value={formData.lastName}
                onChange={handleChange}
                placeholder="Dupont"
              />
              {errors.lastName && (
                <p className="error">{errors.lastName}</p>
              )}
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="email">Adresse e-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="jean.dupont@example.com"
            />
            {errors.email && <p className="error">{errors.email}</p>}
          </div>

          <div className="form-field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
            />
            {errors.password && (
              <p className="error">{errors.password}</p>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="confirmPassword">
              Confirmation du mot de passe
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="••••••••"
            />
            {errors.confirmPassword && (
              <p className="error">{errors.confirmPassword}</p>
            )}
          </div>

          <button type="submit" className="submit-button">
            S’inscrire
          </button>

          {submitted && (
            <p className="success-message">
              Inscription envoyée (voir la console du navigateur) !
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

export default App;
