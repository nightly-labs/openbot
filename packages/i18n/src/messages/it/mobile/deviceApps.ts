import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "App collegate",
  "mobile.deviceApps.apps": "App",
  "mobile.deviceApps.appsFooter":
    "Lascia che i tuoi agenti usino queste app su questo iPhone. Quando attivi un’app, l’iPhone ne chiede l’autorizzazione. Finché un’app è disattivata, OpenBot chiede la prima volta che un agente la usa.",
  "mobile.deviceApps.writes": "Aggiunta di elementi",
  "mobile.deviceApps.writesFooter":
    "Finché non scegli Sempre, OpenBot chiede prima che un agente aggiunga un evento o un promemoria.",
  "mobile.deviceApps.app.calendar": "Calendario",
  "mobile.deviceApps.app.reminders": "Promemoria",
  "mobile.deviceApps.app.contacts": "Contatti",
  "mobile.deviceApps.app.location": "Posizione",
  "mobile.deviceApps.app.denied": "{app} (negato)",
  "mobile.deviceApps.write.calendar": "Aggiungi eventi senza chiedere",
  "mobile.deviceApps.write.reminders": "Aggiungi promemoria senza chiedere",
  "mobile.deviceApps.osDenied": "Consenti {app} nelle Impostazioni di iPhone",
  "mobile.deviceApps.consent.heading": "Consentire {app}?",
  "mobile.deviceApps.consent.calendarListEvents": "Un agente vuole leggere gli eventi del tuo Calendario.",
  "mobile.deviceApps.consent.calendarAddEvent": "Un agente vuole aggiungere questo evento al tuo Calendario: {title}",
  "mobile.deviceApps.consent.remindersList": "Un agente vuole leggere i tuoi Promemoria.",
  "mobile.deviceApps.consent.remindersAdd": "Un agente vuole aggiungere questo promemoria: {title}",
  "mobile.deviceApps.consent.contactsFind": "Un agente vuole cercare persone nei tuoi Contatti.",
  "mobile.deviceApps.consent.locationCurrent":
    "Un agente vuole sapere dove sei, con una precisione di circa 100 metri.",
  "mobile.deviceApps.consent.privacy":
    "Ciò che l’agente legge va al suo computer e può arrivare al suo provider di modelli.",
  "mobile.deviceApps.consent.once": "Consenti una volta",
  "mobile.deviceApps.consent.always": "Consenti sempre",
  "mobile.deviceApps.consent.deny": "Nega",
} as const satisfies PartialTranslation<typeof source>;
