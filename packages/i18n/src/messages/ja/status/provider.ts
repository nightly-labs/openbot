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
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude は標準の速度で応答しました。Claude サブスクリプションでは、高速モードは使用クレジットを使います。Claude アカウントでオンにしてください。",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude は標準の速度で応答しました。ご利用の Claude プランには高速モードが含まれていません。",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude は標準の速度で応答しました。高速モードは Anthropic API キーまたは Claude サブスクリプションでのみ使えます。Bedrock、Vertex、Foundry、ゲートウェイでは使えません。",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude は標準の速度で応答しました。このモデルはお使いのアカウントで高速モードを使えません。",
  "status.provider.claudeFastModeTurnedOff":
    "Claude は標準の速度で応答しました。高速モードは Claude Code の設定または組織によってオフになっています。",
  "status.provider.claudeFastModeUnavailable":
    "Claude は標準の速度で応答しました。Claude Code はこのターンで高速モードを使えませんでした。",
} as const satisfies PartialTranslation<typeof source>;
