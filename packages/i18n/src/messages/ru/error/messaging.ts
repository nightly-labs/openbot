import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

// Not translated yet: the screen shows the English text.
export const messages = {
  "error.messaging.notConnected": "Это рабочее пространство Slack не подключено.",
  "error.messaging.unsupported": "Этот компьютер не может подключиться к Slack.",
  "error.messaging.relayUnavailable":
    "OpenBot не может получать события Slack на этом компьютере. Войдите, дайте компьютеру имя и повторите попытку.",
  "error.messaging.discordNotConnected": "Этот сервер Discord не подключён.",
  "error.messaging.discordUnsupported": "Этот компьютер не может подключиться к Discord.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot не может получать события Discord на этом компьютере. Войдите, дайте компьютеру имя и повторите попытку.",
  "error.messaging.telegramNotConnected": "Этот чат Telegram не подключён.",
  "error.messaging.telegramUnsupported": "Этот компьютер не может подключиться к Telegram.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot не может связаться с Telegram на этом компьютере. Войдите в аккаунт, задайте компьютеру имя и повторите попытку.",
} as const satisfies PartialTranslation<typeof source>;
