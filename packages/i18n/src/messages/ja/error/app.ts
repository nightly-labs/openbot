import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "外部ブラウザーで開けるのは HTTP(S) リンクのみです。",
  "error.app.notificationsUnsupported": "このシステムはデスクトップ通知に対応していません。",
  "error.app.notificationSettingsMissing": "このシステムには通知設定のページがありません。",
  "error.app.notReady": "OpenBot の準備ができていません。",
  "error.app.macSecureStorageUnavailable": "macOS のセキュアストレージを利用できません。",
  "error.app.secretStorageUnavailable": "システムのシークレットストレージを利用できません。",
  "error.app.remoteIdentityUnavailable": "リモートホストの ID を利用できません。",
  "error.app.iceServersMissing": "Remote Signal からまだ ICE サーバーが提供されていません。",
  "error.app.finishLocalTest": "ディスプレイを切り替える前に、ローカルテストを終了してください。",
  "error.app.windowBlockedBySecuritySoftware":
    "このコンピューターのセキュリティソフトが OpenBot のウィンドウを停止した可能性があります。セキュリティソフト（Kaspersky など）で OpenBot.exe を信頼するアプリケーションに追加してから、OpenBot をもう一度起動してください。",
} as const satisfies PartialTranslation<typeof source>;
