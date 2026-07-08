import { createContext, useState, type ReactNode } from "react";
import { translations, type Language, type TranslationKey } from "./translations";

export type LanguageContextValue = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
};

export const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined
);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Langue par défaut FR (cohérent avec l'usage FR/NL/EN du guide).
  const [language, setLanguage] = useState<Language>("fr");

  const t = (key: TranslationKey): string => {
    return translations[language][key];
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
