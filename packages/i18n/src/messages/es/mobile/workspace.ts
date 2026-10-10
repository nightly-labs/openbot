import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Sin conexión",
  "mobile.workspace.status.online": "En línea",
  "mobile.workspace.status.offline": "Desconectado",
  "mobile.workspace.status.error": "Error de conexión",
  "mobile.workspace.status.reconnecting": "Reconectando",
  "mobile.workspace.status.attempt": "Intento {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Intento ",
  "mobile.workspace.status.retryIn": "Reintento en {seconds} segundos",
  "mobile.workspace.section.agents": "Agentes",
  "mobile.workspace.error.directoryUnavailable": "El directorio de servidores no está disponible.",
  "mobile.workspace.error.sectionsLoadFailed": "No se pudieron cargar las secciones. Inténtalo de nuevo.",
  "mobile.workspace.error.transportNotReady": "El transporte móvil no está listo.",
  "mobile.workspace.error.sectionsUnsupported": "Este host no admite cambios en las secciones.",
  "mobile.workspace.error.leaveOwnServer": "Solo puedes salir de servidores remotos a los que te hayas unido.",
  "mobile.workspace.error.removeOwnedServerOnly": "Solo el propietario puede eliminar este servidor.",
  "mobile.workspace.error.agentNotOnHost": "El agente no está en este host.",
  "mobile.workspace.error.filesUnsupported":
    "Este host no admite la gestión de archivos. Actualiza OpenBot en el host.",
  "mobile.workspace.error.agentUnavailableOnHost": "El agente no está disponible en este host.",
  "mobile.workspace.error.agentUnavailable": "El agente no está disponible.",
  "mobile.workspace.error.formUnavailable": "Este formulario ya no está disponible.",
  "mobile.workspace.error.approvalInactive":
    "Esta solicitud ya no está esperando. Otro dispositivo la respondió o la tarea se detuvo.",
  "mobile.workspace.error.approvalOffline": "Conéctate al servidor para responder a esta solicitud.",
  "mobile.workspace.alert.preferencesTitle": "No se pudieron guardar las preferencias del chat",
  "mobile.workspace.alert.preferencesBody": "Se han conservado tus preferencias anteriores. Inténtalo de nuevo.",
  "mobile.workspace.alert.updateRequiredTitle": "Actualización necesaria",
  "mobile.workspace.alert.updateRequiredUnread":
    "Actualiza este servidor de escritorio para marcar conversaciones como no leídas.",
  "mobile.workspace.alert.markUnreadTitle": "No se pudo marcar como no leído",
  "mobile.workspace.alert.markUnreadBody": "Vuelve a conectarte al servidor e inténtalo de nuevo.",
  "mobile.workspace.alert.markAllReadTitle": "No se pudo marcar todo como leído",
  "mobile.workspace.alert.markAllReadBody":
    "Algunos chats siguen sin leer. Vuelve a conectarte al servidor e inténtalo de nuevo.",
  "mobile.workspace.alert.serverOrderTitle": "No se pudo guardar el orden de los servidores",
  "mobile.workspace.alert.serverOrderBody": "Se ha conservado el orden anterior. Inténtalo de nuevo.",
  "mobile.workspace.error.connectFailed": "Falló la conexión con el servidor.",
  "mobile.workspace.error.disconnectFailed": "El servidor no se desconectó correctamente.",
  "mobile.workspace.error.queueEditRejected": "El host no aceptó esta edición.",
} as const satisfies PartialTranslation<typeof source>;
