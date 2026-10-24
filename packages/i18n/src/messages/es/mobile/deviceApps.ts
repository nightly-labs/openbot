import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "Apps conectadas",
  "mobile.deviceApps.apps": "Apps",
  "mobile.deviceApps.appsFooter":
    "Deja que tus agentes usen estas apps en este iPhone. Al activar una app, el iPhone pide su permiso. Mientras una app esté desactivada, OpenBot pregunta la primera vez que un agente la usa.",
  "mobile.deviceApps.writes": "Añadir elementos",
  "mobile.deviceApps.writesFooter":
    "Hasta que elijas Siempre, OpenBot pregunta antes de que un agente añada un evento o un recordatorio.",
  "mobile.deviceApps.app.calendar": "Calendario",
  "mobile.deviceApps.app.reminders": "Recordatorios",
  "mobile.deviceApps.app.contacts": "Contactos",
  "mobile.deviceApps.app.location": "Ubicación",
  "mobile.deviceApps.app.denied": "{app} (denegado)",
  "mobile.deviceApps.write.calendar": "Añadir eventos sin preguntar",
  "mobile.deviceApps.write.reminders": "Añadir recordatorios sin preguntar",
  "mobile.deviceApps.osDenied": "Permite {app} en los Ajustes del iPhone",
  "mobile.deviceApps.consent.heading": "¿Permitir {app}?",
  "mobile.deviceApps.consent.calendarListEvents": "Un agente quiere leer los eventos de tu Calendario.",
  "mobile.deviceApps.consent.calendarAddEvent": "Un agente quiere añadir este evento a tu Calendario: {title}",
  "mobile.deviceApps.consent.remindersList": "Un agente quiere leer tus Recordatorios.",
  "mobile.deviceApps.consent.remindersAdd": "Un agente quiere añadir este recordatorio: {title}",
  "mobile.deviceApps.consent.contactsFind": "Un agente quiere buscar personas en tus Contactos.",
  "mobile.deviceApps.consent.locationCurrent": "Un agente quiere saber dónde estás, con unos 100 metros de precisión.",
  "mobile.deviceApps.consent.privacy":
    "Lo que el agente lee va a su ordenador y puede llegar a su proveedor de modelos.",
  "mobile.deviceApps.consent.once": "Permitir una vez",
  "mobile.deviceApps.consent.always": "Permitir siempre",
  "mobile.deviceApps.consent.deny": "Denegar",
} as const satisfies PartialTranslation<typeof source>;
