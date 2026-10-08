import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Necesita tu respuesta.",
  "notification.needsApproval": "Necesita tu aprobación.",
  "notification.finished": "Ha terminado de trabajar.",
  "notification.failed": "Se detuvo con un error.",
  "notification.usageLimit.title": "La cuenta de {provider} alcanzó su límite",
  "notification.usageLimit.body": {
    one: "{count} agente espera. OpenBot lo intentará de nuevo más tarde.",
    other: "{count} agentes esperan. OpenBot lo intentará de nuevo más tarde.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agente espera. Se restablece {reset}.",
    other: "{count} agentes esperan. Se restablece {reset}.",
  },
  "notification.test": "Las notificaciones funcionan.",
  "notification.welcome": "OpenBot te avisará aquí cuando un agente te necesite.",
  "notification.toast.region": "Notificaciones",
  "notification.toast.close": "Cerrar notificación",
} as const satisfies PartialTranslation<typeof source>;
