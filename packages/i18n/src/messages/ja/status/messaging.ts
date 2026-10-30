import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "対応しています…",
  "status.messaging.queued": "待機中: OpenBot は別のリクエストを処理しています。回答はここに届きます。",
  "status.messaging.busy": "待機中のリクエストが多すぎます。しばらくしてからもう一度お試しください。",
  "status.messaging.failed": "OpenBot はこのリクエストを完了できませんでした。詳細は OpenBot のホストにあります。",
  "status.messaging.noAnswer": "OpenBot はテキストの回答を返さずに終了しました。",
  "status.messaging.noAgent":
    "ここで回答できるエージェントはまだいません。OpenBot で Slack Orchestrator を追加してください。",
  "status.messaging.delegated": "チームメイトが対応しています。回答はここに届きます。",
  "status.messaging.stopped": "停止しました。",
  "status.messaging.stop": "停止",
  "status.messaging.approvalTitle": "OpenBot が続行の承認を求めています。",
  "status.messaging.approvalCommand": "コマンドを実行",
  "status.messaging.approvalFileChange": "ファイルを変更",
  "status.messaging.approvalPermissions": "追加の権限を取得",
  "status.messaging.approve": "承認",
  "status.messaging.deny": "拒否",
  "status.messaging.approvedBy": "{user} が承認しました。",
  "status.messaging.deniedBy": "{user} が拒否しました。",
  "status.messaging.answeredOnHost": "OpenBot のホストで回答されました。",
  "status.messaging.requestInactive": "このリクエストはもう有効ではありません。",
  "status.messaging.onlyRequester": "これを行えるのは {user} だけです。OpenBot のホストでも回答できます。",
  "status.messaging.hostOnly": "このリクエストに回答できるのは OpenBot のホストだけです。",
  "status.messaging.filesSkipped": "一部のファイルは送信されませんでした: {names}。",
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Slack で回答し、チームに依頼します",
  "status.messaging.discordNoAgent":
    "ここで回答できるエージェントはまだいません。OpenBot で Discord Orchestrator を追加してください。",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Discord で回答し、チームに依頼します",
  "status.messaging.integrationsSection": "連携",
  "status.messaging.signInReceived": "OpenBot は Slack のインストールを受け取りました。このタブは閉じてかまいません。",
  "status.messaging.signInUnknown":
    "この Slack のインストールは OpenBot が開始したものではありません。OpenBot でもう一度開始してください。",
  "status.messaging.telegramNoAgent":
    "ここで回答できるエージェントはまだいません。OpenBot で Telegram Orchestrator を追加してください。",
  "status.messaging.telegramLinked":
    "OpenBot はこのチャットに接続されています。エージェントに依頼するには、{bot} をメンションするか、OpenBot のメッセージに返信してください。",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "Telegram で回答し、チームに依頼します",
  "status.messaging.whatsappNoAgent":
    "ここで回答できるエージェントはまだいません。OpenBot で WhatsApp Orchestrator を追加してください。",
  "status.messaging.whatsappApprovalMenu": "承認する場合は 1、拒否する場合は 2 と返信してください。",
  "status.messaging.whatsappStopMenu": "停止するには「stop」と返信してください。",
  "status.messaging.whatsappPairingCode":
    "この番号は、所有者が許可した人にだけ回答します。所有者にこのコードを伝えてください: {code}",
  "status.messaging.whatsappPairingApproved": "この番号にリクエストを送れるようになりました。",
  "status.messaging.whatsappOwnChat": "自分にメッセージ",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "WhatsApp で回答し、チームに依頼します",
} as const satisfies PartialTranslation<typeof source>;
