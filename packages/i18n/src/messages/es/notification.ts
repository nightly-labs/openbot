import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Necesita tu respuesta.",
  "notification.needsApproval": "Necesita tu aprobación.",
  "notification.needsBrowserStep": "Necesita que completes un paso en el navegador.",
  "notification.needsApprovalFor": "Necesita tu aprobación: {action}",
  "notification.finished": "Ha terminado de trabajar.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "Un paso espera tu aprobación.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "Un flujo de trabajo tiene un resultado nuevo.",
  "notification.failed": "Se detuvo con un error.",
  "notification.channelTitle": "{agent} en {channel}",
  "notification.channelMessage": "Envió un mensaje.",
  "notification.usageLimit.title": "La cuenta de {provider} alcanzó su límite",
  "notification.usageLimit.body": {
    one: "{count} agente espera. OpenBot lo intentará de nuevo más tarde.",
    other: "{count} agentes esperan. OpenBot lo intentará de nuevo más tarde.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agente espera. Se restablece {reset}.",
    other: "{count} agentes esperan. Se restablece {reset}.",
  },
  "notification.machineAlert.disk": "{server}: disco lleno al {percent}",
  "notification.machineAlert.memory": "{server}: memoria usada al {percent}",
  "notification.machineAlert.cpu": "{server}: CPU ocupada al {percent}",
  "notification.machineAlert.body":
    "Superó el nivel de alerta del {level}. Consulta Ajustes del servidor > Almacenamiento.",
  "notification.test": "Las notificaciones funcionan.",
  "notification.welcome": "OpenBot te avisará aquí cuando un agente te necesite.",
  "notification.toast.region": "Notificaciones",
  "notification.toast.close": "Cerrar notificación",
} as const satisfies PartialTranslation<typeof source>;
