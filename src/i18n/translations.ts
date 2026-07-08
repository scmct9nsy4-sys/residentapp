export type Language = "fr" | "nl" | "en";

export const translations = {
  fr: {
    title: "Inscription",
    subtitle:
      "Indiquez votre numéro national et vos coordonnées pour que nous puissions vérifier votre éligibilité et créer votre compte.",
    nationalIdLabel: "Numéro national",
    nationalIdHelper:
      "11 chiffres sans espace, tels qu’ils figurent sur votre document officiel.",
    firstNameLabel: "Prénom",
    lastNameLabel: "Nom",
    emailLabel: "Adresse e-mail",
    emailHelper: "Cette adresse sera utilisée pour votre compte.",
    checkingEmail: "Vérification de l’adresse e-mail…",
    submitButton: "Envoyer la demande",
    successMessage:
      "Votre demande a bien été envoyée. Si vous êtes éligible, vous recevrez un e-mail avec les instructions pour finaliser votre inscription.",
    apiErrorDefault: "Une erreur inattendue est survenue.",

    usernameLabel: "Nom d'utilisateur",
    usernameHelperEditable:
      "Veuillez choisir un autre nom d'utilisateur.",
    usernameHelperLocked:
      "Le nom d'utilisateur est identique à l’adresse e-mail.",

    errorNationalIdRequired: "Le numéro national est obligatoire.",
    errorNationalIdFormat:
      "Le numéro national doit contenir exactement 11 chiffres.",
    errorFirstNameRequired: "Le prénom est obligatoire.",
    errorLastNameRequired: "Le nom est obligatoire.",
    errorEmailRequired: "L'adresse e-mail est obligatoire.",
    errorEmailInvalid: "Adresse e-mail invalide.",
    errorEmailAlreadyUsed:
      "Cette adresse e-mail est déjà utilisée. Veuillez choisir un autre nom d'utilisateur.",
    errorUsernameRequired: "Le nom d'utilisateur est obligatoire.",

    contactLanguageLabel:
      "Langue dans laquelle vous souhaitez communiquer",
    contactLanguageHelper:
      "Vous pouvez choisir une autre langue que celle de l’interface.",
    contactLanguageOptionFr: "Français",
    contactLanguageOptionNl: "Nederlands",
    contactLanguageOptionEn: "English",
  },

  nl: {
    title: "Inschrijving",
    subtitle:
      "Vul uw rijksregisternummer en uw gegevens in zodat wij uw recht op toegang kunnen controleren en uw account kunnen aanmaken.",
    nationalIdLabel: "Rijksregisternummer",
    nationalIdHelper:
      "11 cijfers zonder spaties, zoals op uw officiële document.",
    firstNameLabel: "Voornaam",
    lastNameLabel: "Naam",
    emailLabel: "E-mailadres",
    emailHelper: "Dit e-mailadres wordt gebruikt voor uw account.",
    checkingEmail: "E-mailadres wordt gecontroleerd…",
    submitButton: "Aanvraag verzenden",
    successMessage:
      "Uw aanvraag is verzonden. Als u in aanmerking komt, ontvangt u een e-mail met instructies om uw inschrijving te voltooien.",
    apiErrorDefault: "Er is een onverwachte fout opgetreden.",

    usernameLabel: "Gebruikersnaam",
    usernameHelperEditable:
      "Kies alstublieft een andere gebruikersnaam.",
    usernameHelperLocked:
      "De gebruikersnaam is gelijk aan het e-mailadres.",

    errorNationalIdRequired: "Het rijksregisternummer is verplicht.",
    errorNationalIdFormat:
      "Het rijksregisternummer moet exact 11 cijfers bevatten.",
    errorFirstNameRequired: "De voornaam is verplicht.",
    errorLastNameRequired: "De naam is verplicht.",
    errorEmailRequired: "Het e-mailadres is verplicht.",
    errorEmailInvalid: "Ongeldig e-mailadres.",
    errorEmailAlreadyUsed:
      "Dit e-mailadres is al in gebruik. Kies een andere gebruikersnaam.",
    errorUsernameRequired: "Gebruikersnaam is verplicht.",

    contactLanguageLabel:
      "Taal waarin u wilt communiceren",
    contactLanguageHelper:
      "U kunt een andere taal kiezen dan die van de interface.",
    contactLanguageOptionFr: "Français",
    contactLanguageOptionNl: "Nederlands",
    contactLanguageOptionEn: "English",
  },

  en: {
    title: "Registration",
    subtitle:
      "Please enter your national number and contact details so we can verify your eligibility and create your account.",
    nationalIdLabel: "National number",
    nationalIdHelper:
      "11 digits without spaces, exactly as shown on your official document.",
    firstNameLabel: "First name",
    lastNameLabel: "Last name",
    emailLabel: "Email address",
    emailHelper: "This email address will be used for your account.",
    checkingEmail: "Checking email address…",
    submitButton: "Submit request",
    successMessage:
      "Your request has been submitted. If you are eligible, you will receive an email with instructions to complete your registration.",
    apiErrorDefault: "An unexpected error occurred.",

    usernameLabel: "Username",
    usernameHelperEditable:
      "Please choose a different username.",
    usernameHelperLocked:
      "The username is the same as the email address.",

    errorNationalIdRequired: "National number is required.",
    errorNationalIdFormat:
      "National number must contain exactly 11 digits.",
    errorFirstNameRequired: "First name is required.",
    errorLastNameRequired: "Last name is required.",
    errorEmailRequired: "Email address is required.",
    errorEmailInvalid: "Invalid email address.",
    errorEmailAlreadyUsed:
      "This email address is already in use. Please choose another username.",
    errorUsernameRequired: "Username is required.",

    contactLanguageLabel:
      "Language in which you wish to communicate",
    contactLanguageHelper:
      "You can choose a different language than the interface.",
    contactLanguageOptionFr: "French",
    contactLanguageOptionNl: "Dutch",
    contactLanguageOptionEn: "English",
  },
} as const;

export type TranslationKey = keyof typeof translations.fr;
