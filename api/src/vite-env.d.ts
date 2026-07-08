/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base de l'API en développement (ex. http://localhost:7071). Vide en production. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
