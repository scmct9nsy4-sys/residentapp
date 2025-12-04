import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";

type FormData = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

export default function App() {
  const [formData, setFormData] = useState<FormData>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

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
      newErrors.email = "L'adresse e-mail est obligatoire.";
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email)) {
      newErrors.email = "Adresse e-mail invalide.";
    }
    if (!formData.password) {
      newErrors.password = "Le mot de passe est obligatoire.";
    } else if (formData.password.length < 6) {
      newErrors.password =
        "Le mot de passe doit contenir au moins 6 caractères.";
    }
    if (formData.confirmPassword !== formData.password) {
      newErrors.confirmPassword = "Les mots de passe ne correspondent pas.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validate()) {
      setSubmitted(false);
      return;
    }

    console.log("Inscription réussie :", formData);
    setSubmitted(true);
  };

  return (
    <Container maxWidth="sm">
      <Box sx={{ mt: 6 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Inscription
        </Typography>
        <Typography variant="body1" sx={{ mb: 3, color: "gray" }}>
          Remplis le formulaire pour créer ton compte.
        </Typography>

        {submitted && (
          <Alert severity="success" sx={{ mb: 3 }}>
            Inscription envoyée !
          </Alert>
        )}

        <Box component="form" noValidate onSubmit={handleSubmit}>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              fullWidth
              label="Prénom"
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              error={Boolean(errors.firstName)}
              helperText={errors.firstName}
            />
            <TextField
              fullWidth
              label="Nom"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              error={Boolean(errors.lastName)}
              helperText={errors.lastName}
            />
          </Box>

          <TextField
            fullWidth
            label="Adresse e-mail"
            name="email"
            type="email"
            sx={{ mt: 2 }}
            value={formData.email}
            onChange={handleChange}
            error={Boolean(errors.email)}
            helperText={errors.email}
          />

          <TextField
            fullWidth
            label="Mot de passe"
            name="password"
            type="password"
            sx={{ mt: 2 }}
            value={formData.password}
            onChange={handleChange}
            error={Boolean(errors.password)}
            helperText={errors.password}
          />

          <TextField
            fullWidth
            label="Confirmer le mot de passe"
            name="confirmPassword"
            type="password"
            sx={{ mt: 2 }}
            value={formData.confirmPassword}
            onChange={handleChange}
            error={Boolean(errors.confirmPassword)}
            helperText={errors.confirmPassword}
          />

          <Button
            type="submit"
            variant="contained"
            color="primary"
            sx={{ mt: 3 }}
            fullWidth
          >
            S’inscrire
          </Button>
        </Box>
      </Box>
    </Container>
  );
}
