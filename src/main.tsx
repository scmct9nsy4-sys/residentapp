// =============================================================================
// main.tsx — Point d'entrée (version sans MUI)
// -----------------------------------------------------------------------------
// Changements par rapport à la version MUI :
//   - Suppression de createTheme, ThemeProvider et CssBaseline
//   - Le style global vient désormais de src/styles/fedasil.css
// Le routage minimal /portail est conservé tel quel.
// =============================================================================

import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/fedasil.css";

import { LanguageProvider } from "./i18n/LanguageProvider";
import App from "./App";
import Portail from "./Portail";

// Routage minimal sans dépendance supplémentaire :
//  - /portail        -> page sécurisée (confirmation + données du résident)
//  - tout le reste   -> formulaire d'inscription existant
const path = window.location.pathname;
const isPortail = path === "/portail" || path.startsWith("/portail/");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      {isPortail ? <Portail /> : <App />}
    </LanguageProvider>
  </React.StrictMode>
);
