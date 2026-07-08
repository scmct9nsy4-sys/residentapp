// ============================================================================
//  Texte de l'e-mail d'invitation, en FR / NL / EN.
//  Formulation volontairement GÉNÉRIQUE sur la méthode de connexion :
//  selon la personne, Microsoft demandera un code par e-mail OU une connexion
//  Microsoft existante (mot de passe, passkey, Touch ID...). On ne promet donc
//  pas "vous recevrez un code".
// ============================================================================

type EmailLang = "fr" | "nl" | "en";

export function buildInvitationEmail(
  language: string | undefined,
  firstName: string,
  redeemUrl: string
): { subject: string; html: string } {
  const lang: EmailLang =
    language === "nl" || language === "en" ? language : "fr";

  // Sécurité d'affichage : on neutralise d'éventuels chevrons dans le prénom.
  const safeName = (firstName ?? "").replace(/[<>]/g, "").trim();

  const content = {
    fr: {
      subject: "Votre invitation à votre espace en ligne",
      greeting: `Bonjour ${safeName},`,
      p1: "Nous avons bien reçu votre demande et vous avez été invité(e) à accéder à votre espace en ligne sécurisé.",
      cta: "Activer mon accès",
      p2: "Lorsque vous cliquez sur le bouton, Microsoft vous demandera de confirmer votre identité — soit en saisissant un code envoyé par e-mail, soit avec votre méthode de connexion Microsoft habituelle si vous en avez déjà une.",
      p3: "Une fois connecté(e), vous arriverez sur votre espace, où vous pourrez consulter vos informations.",
      signature: "Cordialement,<br/>L'équipe d'accompagnement",
    },
    nl: {
      subject: "Uw uitnodiging voor uw online ruimte",
      greeting: `Beste ${safeName},`,
      p1: "Wij hebben uw aanvraag goed ontvangen en u bent uitgenodigd om toegang te krijgen tot uw beveiligde online ruimte.",
      cta: "Mijn toegang activeren",
      p2: "Wanneer u op de knop klikt, vraagt Microsoft u om uw identiteit te bevestigen — ofwel met een code die per e-mail wordt verzonden, ofwel met uw gebruikelijke Microsoft-aanmelding als u die al heeft.",
      p3: "Zodra u bent aangemeld, komt u op uw ruimte terecht waar u uw gegevens kunt raadplegen.",
      signature: "Met vriendelijke groeten,<br/>Het begeleidingsteam",
    },
    en: {
      subject: "Your invitation to your online space",
      greeting: `Hello ${safeName},`,
      p1: "We have received your request and you have been invited to access your secure online space.",
      cta: "Activate my access",
      p2: "When you click the button, Microsoft will ask you to confirm your identity — either by entering a code sent to you by e-mail, or with your usual Microsoft sign-in if you already have one.",
      p3: "Once signed in, you will reach your space where you can view your information.",
      signature: "Kind regards,<br/>The support team",
    },
  }[lang];

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #1a1a1a; line-height: 1.5;">
      <p>${content.greeting}</p>
      <p>${content.p1}</p>
      <p style="margin: 24px 0;">
        <a href="${redeemUrl}"
           style="background:#1565c0;color:#ffffff;text-decoration:none;
                  padding:12px 20px;border-radius:6px;display:inline-block;">
          ${content.cta}
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">${content.p2}</p>
      <p style="font-size: 13px; color: #555;">${content.p3}</p>
      <p style="margin-top: 24px;">${content.signature}</p>
    </div>
  `;

  return { subject: content.subject, html };
}
