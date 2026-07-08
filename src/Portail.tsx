import { useState, useEffect } from "react";

import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";

import { useLanguage } from "./i18n/useLanguage";

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

export default function Portail() {
  const { language } = useLanguage();
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
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Paper elevation={2} sx={{ p: { xs: 3, sm: 4 }, borderRadius: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
          <CheckCircleOutlineIcon color="success" fontSize="large" />
          <Typography variant="h5" component="h1">
            {t.welcome}
          </Typography>
        </Box>

        <Typography variant="body1" color="success.main" sx={{ mb: 0.5 }}>
          {t.activated}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t.intro}
        </Typography>

        <Divider sx={{ mb: 3 }} />

        {status === "loading" && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 2 }}>
            <CircularProgress size={24} />
            <Typography variant="body2">{t.loading}</Typography>
          </Box>
        )}

        {status === "error" && <Alert severity="error">{t.error}</Alert>}

        {status === "nodata" && <Alert severity="info">{t.noData}</Alert>}

        {status === "ready" && data && (
          <Box sx={{ display: "grid", gap: 2 }}>
            <Field label={t.grossSalary} value={data.grossSalary} />
            <Field label={t.netSalary} value={data.netSalary} />
            <Field label={t.contribution} value={data.contribution} />
            <Field label={t.paid} value={data.paid} />
          </Box>
        )}

        <Box sx={{ mt: 4, display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="outlined"
            href="/.auth/logout?post_logout_redirect_uri=/"
          >
            {t.logout}
          </Button>
        </Box>
      </Paper>
    </Container>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 500 }}>
        {value || "—"}
      </Typography>
    </Box>
  );
}
