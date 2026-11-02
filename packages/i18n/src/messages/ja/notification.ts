import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "入力が必要です。",
  "notification.needsApproval": "承認が必要です。",
  "notification.needsBrowserStep": "ブラウザーでの操作が必要です。",
  "notification.needsApprovalFor": "承認が必要です: {action}",
  "notification.finished": "作業が完了しました。",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "ステップがあなたの承認を待っています。",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "ワークフローに新しい結果があります。",
  "notification.failed": "エラーで停止しました。",
  "notification.channelTitle": "{channel} の {agent}",
  "notification.channelMessage": "メッセージを送信しました。",
  "notification.usageLimit.title": "{provider} のアカウントが上限に達しました",
  "notification.usageLimit.body": { other: "エージェント {count} 件が待機中です。OpenBot は後でもう一度試します。" },
  "notification.usageLimit.bodyResets": { other: "エージェント {count} 件が待機中です。{reset} にリセットされます。" },
  "notification.machineAlert.disk": "{server}: ディスク使用率 {percent}",
  "notification.machineAlert.memory": "{server}: メモリ使用率 {percent}",
  "notification.machineAlert.cpu": "{server}: CPU 使用率 {percent}",
  "notification.machineAlert.body":
    "アラートのしきい値 {level} を超えました。「サーバーの設定」→「ストレージ」を確認してください。",
  "notification.test": "通知は正常に動作しています。",
  "notification.welcome": "エージェントが対応を必要とするときは、ここでお知らせします。",
  "notification.toast.region": "通知",
  "notification.toast.close": "通知を閉じる",
} as const satisfies PartialTranslation<typeof source>;
