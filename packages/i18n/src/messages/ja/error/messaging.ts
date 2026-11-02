import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "この Slack ワークスペースは接続されていません。",
  "error.messaging.unsupported": "このコンピューターは Slack に接続できません。",
  "error.messaging.relayUnavailable":
    "OpenBot はこのコンピューターで Slack のイベントを受信できません。サインインし、このコンピューターに名前を付けてから、もう一度お試しください。",
  "error.messaging.discordNotConnected": "この Discord サーバーは接続されていません。",
  "error.messaging.discordUnsupported": "このコンピューターは Discord に接続できません。",
  "error.messaging.discordRelayUnavailable":
    "OpenBot はこのコンピューターで Discord のイベントを受信できません。サインインし、このコンピューターに名前を付けてから、もう一度お試しください。",
  "error.messaging.discordRolesUnsupported":
    "OpenBot はまだ Discord のロールを一覧にできません。後でもう一度お試しください。",
  "error.messaging.telegramNotConnected": "この Telegram チャットは接続されていません。",
  "error.messaging.telegramUnsupported": "このコンピューターは Telegram に接続できません。",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot はこのコンピューターから Telegram に接続できません。サインインし、このコンピューターに名前を付けてから、もう一度お試しください。",
  "error.messaging.telegramServiceUnavailable":
    "OpenBot は現在 Telegram に接続できません。しばらくしてからもう一度お試しください。",
  "error.messaging.memoryLimit":
    "接続したワークスペースに置けるメモリーは {limit} 個までです。先に 1 つ削除してください。",
} as const satisfies PartialTranslation<typeof source>;
