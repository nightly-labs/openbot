import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "Apps connectées",
  "mobile.deviceApps.apps": "Apps",
  "mobile.deviceApps.appsFooter":
    "Autorisez vos agents à utiliser ces apps sur cet iPhone. Quand vous activez une app, l’iPhone demande son autorisation. Tant qu’une app est désactivée, OpenBot demande la première fois qu’un agent l’utilise.",
  "mobile.deviceApps.writes": "Ajout d’éléments",
  "mobile.deviceApps.writesFooter":
    "Tant que vous ne choisissez pas Toujours, OpenBot demande avant qu’un agent ajoute un événement ou un rappel.",
  "mobile.deviceApps.app.calendar": "Calendrier",
  "mobile.deviceApps.app.reminders": "Rappels",
  "mobile.deviceApps.app.contacts": "Contacts",
  "mobile.deviceApps.app.location": "Position",
  "mobile.deviceApps.app.denied": "{app} (refusé)",
  "mobile.deviceApps.write.calendar": "Ajouter des événements sans demander",
  "mobile.deviceApps.write.reminders": "Ajouter des rappels sans demander",
  "mobile.deviceApps.osDenied": "Autoriser {app} dans les Réglages de l’iPhone",
  "mobile.deviceApps.consent.heading": "Autoriser {app} ?",
  "mobile.deviceApps.consent.calendarListEvents": "Un agent souhaite lire les événements de votre Calendrier.",
  "mobile.deviceApps.consent.calendarAddEvent": "Un agent souhaite ajouter cet événement à votre Calendrier : {title}",
  "mobile.deviceApps.consent.remindersList": "Un agent souhaite lire vos Rappels.",
  "mobile.deviceApps.consent.remindersAdd": "Un agent souhaite ajouter ce rappel : {title}",
  "mobile.deviceApps.consent.contactsFind": "Un agent souhaite rechercher des personnes dans vos Contacts.",
  "mobile.deviceApps.consent.locationCurrent": "Un agent souhaite savoir où vous êtes, à 100 mètres environ.",
  "mobile.deviceApps.consent.privacy":
    "Ce que l’agent lit va vers son ordinateur et peut atteindre son fournisseur de modèle.",
  "mobile.deviceApps.consent.once": "Autoriser une fois",
  "mobile.deviceApps.consent.always": "Toujours autoriser",
  "mobile.deviceApps.consent.deny": "Refuser",
} as const satisfies PartialTranslation<typeof source>;
