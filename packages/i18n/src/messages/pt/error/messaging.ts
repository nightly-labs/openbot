import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Este espaço de trabalho do Slack não está conectado.",
  "error.messaging.unsupported": "Este computador não consegue se conectar ao Slack.",
  "error.messaging.relayUnavailable":
    "O OpenBot não consegue receber eventos do Slack neste computador. Entre, dê um nome a este computador e tente novamente.",
} as const satisfies PartialTranslation<typeof source>;
