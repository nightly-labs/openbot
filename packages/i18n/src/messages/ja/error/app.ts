import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  // Errors from app, notification, and secret storage actions.
  "error.app.externalLinkProtocol": "外部ブラウザーで開けるのは HTTP(S) リンクのみです。",
  "error.app.notificationsUnsupported": "このシステムはデスクトップ通知に対応していません。",
  "error.app.notificationSettingsMissing": "このシステムには通知設定のページがありません。",
  "error.app.notReady": "OpenBot の準備ができていません。",
  "error.app.macSecureStorageUnavailable": "macOS のセキュアストレージを利用できません。",
  "error.app.secretStorageUnavailable": "システムのシークレットストレージを利用できません。",
  "error.app.remoteIdentityUnavailable": "リモートホストの ID を利用できません。",
  "error.app.iceServersMissing": "Remote Signal からまだ ICE サーバーが提供されていません。",
  "error.app.finishLocalTest": "ディスプレイを切り替える前に、ローカルテストを終了してください。",
} as const satisfies PartialTranslation<typeof source>;
