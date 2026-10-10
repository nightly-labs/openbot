import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "この Slack ワークスペースは接続されていません。",
  "error.messaging.unsupported": "このコンピュータは Slack に接続できません。",
  "error.messaging.relayUnavailable":
    "OpenBot はこのコンピュータで Slack のイベントを受信できません。サインインし、このコンピュータに名前を付けてから、もう一度お試しください。",
  "error.messaging.discordNotConnected": "この Discord サーバーは接続されていません。",
  "error.messaging.discordUnsupported": "このコンピュータは Discord に接続できません。",
  "error.messaging.discordRelayUnavailable":
    "OpenBot はこのコンピュータで Discord のイベントを受信できません。サインインし、このコンピュータに名前を付けてから、もう一度お試しください。",
  "error.messaging.telegramNotConnected": "この Telegram チャットは接続されていません。",
  "error.messaging.telegramUnsupported": "このコンピュータは Telegram に接続できません。",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot はこのコンピュータから Telegram に接続できません。サインインし、このコンピュータに名前を付けてから、もう一度お試しください。",
} as const satisfies PartialTranslation<typeof source>;
