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
  "status.provider.modelRetryUnreachable":
    "{provider} がモデルプロバイダーに接続できません。再試行しています: {attempt} 回目。",
  "status.provider.modelRetryServerError":
    "モデルプロバイダーが混雑しているか、エラーが発生しています。{provider} が再試行しています: {attempt} 回目。",
  "status.provider.modelRetryOutOfMemory":
    "モデルサーバーのメモリーがこのチャットには足りません。{provider} が再試行しています: {attempt} 回目。新しいチャットなら必要なメモリーが少なくなります。",
  "status.provider.modelRetryRecovered": "モデルプロバイダーが再び応答しています。",
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
  "status.provider.claudeOwnApiKey":
    "Claude Code は Anthropic API キーを使うように設定されています。Anthropic は各リクエストを Claude プランではなく、キーの API クレジットに請求します。プランを使うには、Claude Code の設定または環境変数からキーを削除し、OpenBot を再起動してください。",
} as const satisfies PartialTranslation<typeof source>;
