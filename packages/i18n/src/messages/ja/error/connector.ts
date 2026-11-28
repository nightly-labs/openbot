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
  "error.connector.githubOffline":
    "OpenBot は GitHub に接続できません。OpenBot を実行しているコンピューターまたはサーバーのインターネット接続と DNS 設定を確認してから、もう一度お試しください。",
  "error.connector.githubExpired": "GitHub の接続の有効期限が切れました。もう一度 GitHub に接続してください。",
  "error.connector.githubFileUnreadable": "GitHub の接続ファイルを読み取れません。",
  "error.connector.githubFileTooLarge": "GitHub の接続ファイルが大きすぎます。",
  "error.connector.nearSignIn": "暗号資産ウォレットを使うには OpenBot にサインインしてください。",
  "error.connector.nearServiceUnavailable":
    "暗号資産ウォレットのサービスを利用できません。しばらくしてからもう一度お試しください。",
  "error.connector.nearWalletNotFound": "このウォレットは、この OpenBot アカウントまたはサーバーのものではありません。",
  "error.connector.nearWalletLimit": "今日作成された新しいウォレットが多すぎます。明日もう一度お試しください。",
  "error.connector.nearProviderBusy": "NEAR Intents が現在応答しません。数分後にもう一度お試しください。",
  "error.connector.nearNoWallet":
    "暗号資産ウォレットが設定されていません。サーバー設定 > Vault > 暗号資産 で設定してください。",
  "error.connector.nearWalletExists": "暗号資産ウォレットはすでに設定されています。",
  "error.connector.nearFrozen":
    "暗号資産ウォレットからの支払いは一時停止中です。サーバー設定 > Vault > 暗号資産 で再開してください。",
  "error.connector.nearAgentNotAllowed":
    "このエージェントは暗号資産ウォレットから支払えません。サーバー設定 > Vault > 暗号資産 でオンにしてください。",
  "error.connector.nearGrantExpired":
    "OpenBot には暗号資産ウォレットの支払い許可がありません。サーバー設定 > Vault > 暗号資産 で更新してください。",
  "error.connector.nearUnknownAsset": "暗号資産ウォレットに資産 {asset} はありません。",
  "error.connector.nearAmountInvalid": "{amount} は {asset} の有効な金額ではありません。",
  "error.connector.nearRecipientInvalid": "{recipient} は NEAR アカウントでも chain:address でもありません。",
  "error.connector.nearRefused": "NEAR Intents Agent API がリクエストを拒否しました: {detail}",
  "error.connector.nearUnexpected": "NEAR Intents Agent API から予期しない応答がありました: {detail}",
  "error.connector.nearUnreachable": "OpenBot は NEAR Intents Agent API に接続できません: {detail}",
  "error.connector.nearFileUnreadable": "暗号資産ウォレットのファイルを読み取れません。",
  "error.connector.nearFileTooLarge": "暗号資産ウォレットのファイルが大きすぎます。",
  "error.connector.nearSigningCanceled": "署名はキャンセルされました。",
  "error.connector.nearSigningExpired": "署名が時間内に届きませんでした。もう一度お試しください。",
  "error.connector.nearSigningInvalid": "ブラウザーからの署名が無効です。",
  "error.connector.nearSigningBusy": "別の署名がブラウザーで待機中です。先にそれを完了するか、キャンセルしてください。",
  "error.connector.nearPolicyCooldown": "ウォレットのルールは {time} 以降にもう一度変更できます。",
  "error.connector.nearPolicyPending": "ポリシーの変更が完了しませんでした。数分後にもう一度お試しください。",
  "error.connector.nearDeclined": "オーナーが支払いを拒否しました。",
  "error.connector.nearUncertain":
    "OpenBot は支払いが送信されたかどうかを確認できません。もう一度支払わないでください。オーナーはウォレットの履歴を確認できます。",
  "error.connector.nearPaymentFailed": "支払いに失敗しました: {detail}",
  "error.connector.nearPaymentUnknown": "この支払いはもう応答を待っていません。",
  "error.connector.nearRuleFull": "1 つの支払いルールに設定できる受取人は最大 {limit} 件です。",
  "error.connector.nearRulesFull": "ウォレットに設定できる支払いルールは最大 {limit} 件です。",
  "error.connector.onePasswordCliMissing":
    "OpenBot は 1Password CLI を見つけられません。インストールして 1Password アプリで連携をオンにするか、サービスアカウントのトークンを使用してください。",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot は 1Password CLI をインストールできませんでした。インターネット接続を確認してから、もう一度お試しください。",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI はサインインしていません。1Password アプリで連携をオンにしてから、もう一度接続してください。",
  "error.connector.onePasswordAppUnreachable":
    "OpenBot が 1Password アプリに接続できません。1Password を開いてロックを解除してください。「設定」>「開発者」で「1Password CLI と連携」がオンになっていることを確認し、もう一度お試しください。",
  "error.connector.onePasswordCliFailed": "1Password CLI が失敗しました: {detail}",
  "error.connector.onePasswordCliForbidden":
    "この 1Password アカウントには、共有保管庫やサービスアカウントを作成する権限がありません。アカウントのオーナーまたは管理者にこの権限を依頼するか、サービスアカウントのトークンを受け取って「トークンを使う」をクリックしてください。",
  "error.connector.onePasswordUnexpected": "1Password から予期しない応答がありました: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password はサービスアカウントのトークンを受け付けませんでした。",
  "error.connector.onePasswordUnreachable":
    "OpenBot は 1Password に接続できませんでした。インターネット接続を確認してから、もう一度お試しください。",
  "error.connector.onePasswordRateLimited":
    "1Password へのリクエストが多すぎます。数分待ってから、もう一度お試しください。",
  "error.connector.onePasswordRequestLimit":
    "サービスアカウントから 1Password へのリクエストが多すぎます。1 時間後にもう一度お試しください。それでも失敗する場合は、1Password アカウントが 1 日の上限に達しています。24 時間後にもう一度お試しください。アカウント内のすべてのサービスアカウントがこの上限に含まれます。",
  "error.connector.onePasswordNoVault":
    "サービスアカウントは保管庫を読み取れません。保管庫へのアクセス権を付与してから、もう一度お試しください。",
  "error.connector.onePasswordReadFailed":
    "OpenBot は 1Password のログイン情報を読み取れません。1Password を切断してから、もう一度接続してください。",
  "error.connector.onePasswordFileUnreadable": "1Password の接続ファイルを読み取れません。",
  "error.connector.onePasswordFileTooLarge": "1Password の接続ファイルが大きすぎます。",
  "error.connector.bitwardenFailed":
    "Bitwarden を読み取れませんでした。bw CLI をインストールし、サインインしてロックを解除し、Shared with OpenBot という名前のフォルダーを 1 つ作成してください。新しいセッションキーで接続してください。",
  "error.connector.bitwardenCliMissing":
    "OpenBot が Bitwarden CLI を見つけられません。bw をインストールし、新しいターミナルで動くことを確認してから、もう一度接続してください。",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden には Shared with OpenBot という名前のフォルダーがちょうど 1 つ必要です。作成するか余分なフォルダーを削除してから、もう一度接続してください。",
  "error.connector.bitwardenHostInput":
    "HTTPS のサーバーのアドレス、API キーの client_id と client_secret、マスターパスワードを入力してください。",
  "error.connector.bitwardenHostFailed":
    "このサーバーで Bitwarden を開けませんでした。サーバーのアドレス、API キー、マスターパスワードを確認し、Shared with OpenBot という名前のフォルダーが 1 つあることを確認してから、もう一度接続してください。",
  "error.connector.bitwardenHostSignInFailed":
    "このサーバーで Bitwarden にサインインできませんでした。サーバーのアドレスと API キーを確認してから、もう一度接続してください。",
  "error.connector.bitwardenHostUnlockFailed":
    "このサーバーで Bitwarden のロックを解除できませんでした。マスターパスワードを確認してから、もう一度接続してください。",
  "error.connector.bitwardenCliInstallFailed":
    "このサーバーに Bitwarden CLI をインストールできませんでした。ネットワーク接続を確認してから、もう一度接続してください。",
  "error.connector.bitwardenCliCannotStart":
    "このサーバーで Bitwarden CLI が起動しませんでした。もう一度接続してください。それでも起動しない場合は、ヘルプ > 問題を報告 を選んでください。",
  "error.connector.bitwardenFileUnreadable": "Bitwarden の接続ファイルを読み取れません。",
  "error.connector.passwordManagerUnknown": "OpenBot はこのパスワードマネージャーに対応していません。",
  "error.connector.passwordManagerMethod": "このパスワードマネージャーはこの方法では接続できません。",
  "error.connector.passwordManagerNoSignIn": "サインインページが開いていません。もう一度接続してください。",
  "error.connector.protonPassFailed": "Proton Pass に接続できませんでした。もう一度接続してください。",
  "error.connector.protonPassCliInstallFailed":
    "Proton Pass CLI をインストールできませんでした。ネットワーク接続を確認してから、もう一度接続してください。",
  "error.connector.protonPassPlan":
    "ご利用の Proton プランでは Proton Pass CLI を使用できません。プランを変更してから、もう一度接続してください。",
  "error.connector.protonPassPlanMissing":
    "ご利用の Proton プランには Proton Pass CLI が含まれていません。Pass Plus を含む Proton プランが必要です。プランを変更してから、もう一度接続してください。",
  "error.connector.protonPassExpired": "Proton Pass へのアクセスが終了しました。もう一度接続してください。",
  "error.connector.protonPassKeyInvalid": "pst_ で始まる Proton Pass のアクセスキーを入力してください。",
  "error.connector.protonPassExtraPassword": "追加パスワードが正しくありません。もう一度入力してください。",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass は追加パスワードを求めていません。",
  "error.connector.protonPassFileUnreadable": "Proton Pass の接続ファイルを読み取れません。",
  "error.connector.protonPassSignInTimeout":
    "Proton へのサインインに時間がかかりすぎました。もう一度接続してください。",
  "error.connector.protonPassSetupFailed":
    "Proton Pass で保管庫 Shared with OpenBot またはそのアクセスキーを作成できませんでした。もう一度接続してください。",
} as const satisfies PartialTranslation<typeof source>;
