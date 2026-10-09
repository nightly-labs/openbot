import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.error.approvalInactive":
    "Esta solicitud ya no está esperando. Otro dispositivo la respondió o la tarea se detuvo.",
  "mobile.workspace.error.approvalOffline": "Conéctate al servidor para responder a esta solicitud.",
  "mobile.workspace.alert.markAllReadTitle": "No se pudo marcar todo como leído",
  "mobile.workspace.alert.markAllReadBody":
    "Algunos chats siguen sin leer. Vuelve a conectarte al servidor e inténtalo de nuevo.",
} as const satisfies PartialTranslation<typeof source>;
