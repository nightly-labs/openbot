import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.error.approvalInactive":
    "Diese Anfrage wartet nicht mehr. Ein anderes Gerät hat sie beantwortet, oder die Aufgabe wurde beendet.",
  "mobile.workspace.error.approvalOffline": "Verbinde dich mit dem Server, um diese Anfrage zu beantworten.",
  "mobile.workspace.alert.markAllReadTitle": "Nicht alle konnten als gelesen markiert werden",
  "mobile.workspace.alert.markAllReadBody":
    "Einige Chats sind noch ungelesen. Verbinde dich erneut mit dem Server und versuche es noch einmal.",
} as const satisfies PartialTranslation<typeof source>;
