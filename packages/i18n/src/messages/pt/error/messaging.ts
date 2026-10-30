import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Este espaço de trabalho do Slack não está conectado.",
  "error.messaging.unsupported": "Este computador não consegue se conectar ao Slack.",
  "error.messaging.relayUnavailable":
    "O OpenBot não consegue receber eventos do Slack neste computador. Entre na conta, dê um nome a este computador e tente novamente.",
  "error.messaging.discordNotConnected": "Este servidor do Discord não está conectado.",
  "error.messaging.discordUnsupported": "Este computador não consegue se conectar ao Discord.",
  "error.messaging.discordRelayUnavailable":
    "O OpenBot não consegue receber eventos do Discord neste computador. Entre na conta, dê um nome a este computador e tente novamente.",
  "error.messaging.discordRolesUnsupported":
    "O OpenBot ainda não consegue listar as funções do Discord. Tente novamente mais tarde.",
  "error.messaging.telegramNotConnected": "Este chat do Telegram não está conectado.",
  "error.messaging.telegramUnsupported": "Este computador não consegue se conectar ao Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "O OpenBot não consegue acessar o Telegram neste computador. Entre na conta, dê um nome a este computador e tente novamente.",
  "error.messaging.telegramServiceUnavailable":
    "O OpenBot não consegue conectar o Telegram agora. Tente novamente mais tarde.",
  "error.messaging.whatsappNotConnected": "Este número do WhatsApp não está conectado.",
  "error.messaging.whatsappUnsupported": "Este computador não consegue se conectar ao WhatsApp.",
  "error.messaging.whatsappTooManySenders": "Um número do WhatsApp pode permitir até 200 contatos e grupos.",
  "error.messaging.whatsappRequestEnded":
    "Esta solicitação terminou. Peça para a pessoa escrever de novo para receber um novo código.",
  "error.messaging.memoryLimit": "Um espaço de trabalho conectado pode ter até {limit} memórias. Exclua uma primeiro.",
} as const satisfies PartialTranslation<typeof source>;
