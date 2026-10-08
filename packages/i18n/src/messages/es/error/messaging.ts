import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "Este espacio de trabajo de Slack no está conectado.",
  "error.messaging.unsupported": "Este equipo no puede conectarse a Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot no puede recibir eventos de Slack en este equipo. Inicia sesión, ponle un nombre a este equipo e inténtalo de nuevo.",
  "error.messaging.discordNotConnected": "Este servidor de Discord no está conectado.",
  "error.messaging.discordUnsupported": "Este equipo no puede conectarse a Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot no puede recibir eventos de Discord en este equipo. Inicia sesión, ponle un nombre a este equipo e inténtalo de nuevo.",
} as const satisfies PartialTranslation<typeof source>;
