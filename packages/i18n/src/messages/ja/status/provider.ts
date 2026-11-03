import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "ダウンロードを停止しました。もう一度お試しください。",
  "status.provider.downloadFailed": "ダウンロードに失敗しました。もう一度お試しください。",
  "status.provider.updateWaiting": "現在のターンが終わるとアップデートが始まります。",
  "status.provider.confirmContinue": "続行",
  "status.provider.confirmCancel": "キャンセル",
  "status.provider.retryUnreachable": "{provider} がサーバーに接続できません。再試行 {attempt}/{maxAttempts}。",
  "status.provider.retryServerError":
    "{provider} のサーバーが混雑しているか、エラーが発生しています。再試行 {attempt}/{maxAttempts}。",
  "status.provider.retryRecovered": "{provider} がサーバーから再び応答を受け取っています。",
} as const satisfies PartialTranslation<typeof source>;
