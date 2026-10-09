import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.error.approvalInactive":
    "Esta solicitud ya no está esperando. Otro dispositivo la respondió o la tarea se detuvo.",
  "mobile.workspace.error.approvalOffline": "Conéctate al servidor para responder a esta solicitud.",
} as const satisfies PartialTranslation<typeof source>;
