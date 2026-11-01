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
  "error.connector.bitwardenHostInput":
    "HTTPS のサーバーのアドレス、API キーの client_id と client_secret、マスターパスワードを入力してください。",
  "error.connector.bitwardenHostFailed":
    "このサーバーで Bitwarden を開けませんでした。サーバーのアドレス、API キー、マスターパスワードを確認し、Shared with OpenBot という名前のフォルダーが 1 つあることを確認してから、もう一度接続してください。",
  "error.connector.bitwardenCliInstallFailed":
    "このサーバーに Bitwarden CLI をインストールできませんでした。ネットワーク接続を確認してから、もう一度接続してください。",
  "error.connector.bitwardenFileUnreadable": "Bitwarden の接続ファイルを読み取れません。",
  "error.connector.telegramAccountCredentialsMissing":
    "Telegram アプリの api_id と api_hash を入力してください。my.telegram.org で取得できます。",
  "error.connector.telegramAccountCredentialsInvalid":
    "api_id は数字で、api_hash は 0-9 と a-f の 32 文字です。my.telegram.org からもう一度コピーしてください。",
  "error.connector.telegramAccountApiRejected":
    "Telegram はこの api_id と api_hash を受け付けません。my.telegram.org からもう一度コピーしてください。",
  "error.connector.telegramAccountPhoneFormat": "電話番号を国番号付きで入力してください（例: +48 600 100 200）。",
  "error.connector.telegramAccountPhoneInvalid":
    "Telegram はこの番号を認識できません。国番号を含めてください（例: +48）。",
  "error.connector.telegramAccountCodeInvalid": "このコードは正しくありません。確認してもう一度お試しください。",
  "error.connector.telegramAccountCodeEmpty": "Telegram から届いたコードを入力してください。",
  "error.connector.telegramAccountCodeExpired":
    "コードの有効期限が切れました。もう一度始めて新しいコードを受け取ってください。",
  "error.connector.telegramAccountPasswordInvalid": "このパスワードは正しくありません。もう一度お試しください。",
  "error.connector.telegramAccountPasswordEmpty": "2 段階認証のパスワードを入力してください。",
  "error.connector.telegramAccountPasswordNeeded": "Telegram が 2 段階認証のパスワードを求めています。",
  "error.connector.telegramAccountNoAccount":
    "この番号には Telegram アカウントがありません。すでに Telegram を使っている番号でサインインしてください。",
  "error.connector.telegramAccountPhoneBanned": "この番号は Telegram で利用停止になっています。",
  "error.connector.telegramAccountQrExpired":
    "スキャンする前に QR コードの有効期限が切れました。もう一度始めてください。",
  "error.connector.telegramAccountFloodWait":
    "Telegram から待つよう求められています。{count} 分後にもう一度お試しください。",
  "error.connector.telegramAccountCancelled": "Telegram へのサインインはキャンセルされました。",
  "error.connector.telegramAccountTimedOut":
    "10 分間操作がなかったため、サインインを停止しました。もう一度始めてください。",
  "error.connector.telegramAccountMovedOn": "サインインは別のステップに進んでいます。もう一度始めてください。",
  "error.connector.telegramAccountRefused": "Telegram がサインインを拒否しました: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot は Telegram の接続を保存できませんでした: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram がこのセッションを終了しました（例: 設定 > デバイス）。Telegram アカウントをもう一度接続してください。",
  "error.connector.telegramAccountFileUnreadable": "Telegram アカウントの接続ファイルを読み取れません。",
  "error.connector.telegramAccountFileTooLarge": "Telegram アカウントの接続ファイルが大きすぎます。",
} as const satisfies PartialTranslation<typeof source>;
