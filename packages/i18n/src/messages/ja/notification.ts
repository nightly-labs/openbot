import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "入力が必要です。",
  "notification.needsApproval": "承認が必要です。",
  "notification.finished": "作業が完了しました。",
  "notification.failed": "エラーで停止しました。",
  "notification.usageLimit.title": "{provider} のアカウントが上限に達しました",
  "notification.usageLimit.body": { other: "エージェント {count} 件が待機中です。OpenBot は後でもう一度試します。" },
  "notification.usageLimit.bodyResets": { other: "エージェント {count} 件が待機中です。{reset} にリセットされます。" },
  "notification.test": "通知は正常に動作しています。",
  "notification.welcome": "エージェントが対応を必要とするときは、ここでお知らせします。",
  "notification.toast.region": "通知",
  "notification.toast.close": "通知を閉じる",
} as const satisfies PartialTranslation<typeof source>;
