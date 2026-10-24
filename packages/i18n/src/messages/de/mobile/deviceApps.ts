import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "Verbundene Apps",
  "mobile.deviceApps.apps": "Apps",
  "mobile.deviceApps.appsFooter":
    "Lass deine Agenten diese Apps auf diesem iPhone nutzen. Wenn du eine App einschaltest, fragt das iPhone nach ihrer Berechtigung. Solange eine App aus ist, fragt OpenBot beim ersten Zugriff eines Agenten nach.",
  "mobile.deviceApps.writes": "Einträge hinzufügen",
  "mobile.deviceApps.writesFooter":
    "Bis du „Immer“ wählst, fragt OpenBot nach, bevor ein Agent einen Termin oder eine Erinnerung hinzufügt.",
  "mobile.deviceApps.app.calendar": "Kalender",
  "mobile.deviceApps.app.reminders": "Erinnerungen",
  "mobile.deviceApps.app.contacts": "Kontakte",
  "mobile.deviceApps.app.location": "Standort",
  "mobile.deviceApps.app.denied": "{app} (verweigert)",
  "mobile.deviceApps.write.calendar": "Termine ohne Nachfrage hinzufügen",
  "mobile.deviceApps.write.reminders": "Erinnerungen ohne Nachfrage hinzufügen",
  "mobile.deviceApps.osDenied": "{app} in den iPhone-Einstellungen erlauben",
  "mobile.deviceApps.consent.heading": "{app} erlauben?",
  "mobile.deviceApps.consent.calendarListEvents": "Ein Agent möchte Termine in deinem Kalender lesen.",
  "mobile.deviceApps.consent.calendarAddEvent": "Ein Agent möchte diesen Termin zu deinem Kalender hinzufügen: {title}",
  "mobile.deviceApps.consent.remindersList": "Ein Agent möchte deine Erinnerungen lesen.",
  "mobile.deviceApps.consent.remindersAdd": "Ein Agent möchte diese Erinnerung hinzufügen: {title}",
  "mobile.deviceApps.consent.contactsFind": "Ein Agent möchte Personen in deinen Kontakten suchen.",
  "mobile.deviceApps.consent.locationCurrent": "Ein Agent möchte wissen, wo du bist, auf etwa 100 Meter genau.",
  "mobile.deviceApps.consent.privacy":
    "Was der Agent liest, geht an seinen Computer und kann seinen Modellanbieter erreichen.",
  "mobile.deviceApps.consent.once": "Einmal erlauben",
  "mobile.deviceApps.consent.always": "Immer erlauben",
  "mobile.deviceApps.consent.deny": "Verweigern",
} as const satisfies PartialTranslation<typeof source>;
