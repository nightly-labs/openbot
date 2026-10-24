import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "Połączone aplikacje",
  "mobile.deviceApps.apps": "Aplikacje",
  "mobile.deviceApps.appsFooter":
    "Pozwól agentom korzystać z tych aplikacji na tym iPhonie. Gdy włączysz aplikację, iPhone poprosi o jej uprawnienie. Gdy aplikacja jest wyłączona, OpenBot pyta przy pierwszym użyciu przez agenta.",
  "mobile.deviceApps.writes": "Dodawanie elementów",
  "mobile.deviceApps.writesFooter":
    "Dopóki nie wybierzesz Zawsze, OpenBot pyta, zanim agent doda wydarzenie lub przypomnienie.",
  "mobile.deviceApps.app.calendar": "Kalendarz",
  "mobile.deviceApps.app.reminders": "Przypomnienia",
  "mobile.deviceApps.app.contacts": "Kontakty",
  "mobile.deviceApps.app.location": "Lokalizacja",
  "mobile.deviceApps.app.denied": "{app} (odmowa)",
  "mobile.deviceApps.write.calendar": "Dodawaj wydarzenia bez pytania",
  "mobile.deviceApps.write.reminders": "Dodawaj przypomnienia bez pytania",
  "mobile.deviceApps.osDenied": "Zezwól na {app} w Ustawieniach iPhone’a",
  "mobile.deviceApps.consent.heading": "Zezwolić na {app}?",
  "mobile.deviceApps.consent.calendarListEvents": "Agent chce odczytać wydarzenia w Twoim Kalendarzu.",
  "mobile.deviceApps.consent.calendarAddEvent": "Agent chce dodać to wydarzenie do Twojego Kalendarza: {title}",
  "mobile.deviceApps.consent.remindersList": "Agent chce odczytać Twoje Przypomnienia.",
  "mobile.deviceApps.consent.remindersAdd": "Agent chce dodać to przypomnienie: {title}",
  "mobile.deviceApps.consent.contactsFind": "Agent chce wyszukać osoby w Twoich Kontaktach.",
  "mobile.deviceApps.consent.locationCurrent": "Agent chce wiedzieć, gdzie jesteś, z dokładnością do około 100 metrów.",
  "mobile.deviceApps.consent.privacy":
    "To, co agent odczyta, trafia na jego komputer i może dotrzeć do jego dostawcy modelu.",
  "mobile.deviceApps.consent.once": "Zezwól raz",
  "mobile.deviceApps.consent.always": "Zawsze zezwalaj",
  "mobile.deviceApps.consent.deny": "Odmów",
} as const satisfies PartialTranslation<typeof source>;
