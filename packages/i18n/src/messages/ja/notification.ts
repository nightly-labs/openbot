import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "入力が必要です。",
  "notification.needsApproval": "承認が必要です。",
  "notification.finished": "作業が完了しました。",
  "notification.failed": "エラーで停止しました。",
  "notification.test": "通知は正常に動作しています。",
  "notification.welcome": "エージェントが対応を必要とするときは、ここでお知らせします。",
  "notification.toast.region": "通知",
  "notification.toast.close": "通知を閉じる",
} as const satisfies PartialTranslation<typeof source>;
