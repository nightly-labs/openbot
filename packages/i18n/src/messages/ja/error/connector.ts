import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "このビルドの OpenBot には GitHub App がありません。",
  "error.connector.githubDenied": "GitHub へのサインインが拒否されました。",
  "error.connector.githubCodeExpired": "GitHub のコードの有効期限が切れました。もう一度 GitHub に接続してください。",
  "error.connector.githubDeviceFlowDisabled": "この GitHub App はデバイスでのサインインを許可していません。",
  "error.connector.githubClientUnknown": "GitHub はこの GitHub App の Client ID を認識していません。",
  "error.connector.githubUnexpected": "GitHub から予期しない応答がありました: {detail}",
  "error.connector.githubUnreachable": "OpenBot は GitHub に接続できません: {detail}",
  "error.connector.githubExpired": "GitHub の接続の有効期限が切れました。もう一度 GitHub に接続してください。",
  "error.connector.githubFileUnreadable": "GitHub の接続ファイルを読み取れません。",
  "error.connector.githubFileTooLarge": "GitHub の接続ファイルが大きすぎます。",
  "error.connector.onePasswordCliMissing":
    "OpenBot は 1Password CLI を見つけられません。インストールして 1Password アプリで連携をオンにするか、サービスアカウントのトークンを使用してください。",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot は 1Password CLI をインストールできませんでした。インターネット接続を確認してから、もう一度お試しください。",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI はサインインしていません。1Password アプリで連携をオンにしてから、もう一度接続してください。",
  "error.connector.onePasswordCliFailed": "1Password CLI が失敗しました: {detail}",
  "error.connector.onePasswordUnexpected": "1Password から予期しない応答がありました: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password はサービスアカウントのトークンを受け付けませんでした。",
  "error.connector.onePasswordNoVault":
    "サービスアカウントは保管庫を読み取れません。保管庫へのアクセス権を付与してから、もう一度お試しください。",
  "error.connector.onePasswordFileUnreadable": "1Password の接続ファイルを読み取れません。",
  "error.connector.onePasswordFileTooLarge": "1Password の接続ファイルが大きすぎます。",
  "error.connector.bitwardenFailed":
    "Bitwarden を読み取れませんでした。bw CLI をインストールし、サインインしてロックを解除し、Shared with OpenBot という名前のフォルダーを 1 つ作成してください。新しいセッションキーで接続してください。",
} as const satisfies PartialTranslation<typeof source>;
