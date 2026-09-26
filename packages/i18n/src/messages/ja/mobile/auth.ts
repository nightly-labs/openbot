import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "OpenBot のロゴを動かす",
  "mobile.auth.logo.animateHint": "ロゴがウインクします",
  "mobile.auth.scanQrCode": "QRコードをスキャン",
  "mobile.auth.closeScanner": "スキャナーを閉じる",
  "mobile.auth.scanner.connectFailed": "接続できませんでした",
  "mobile.auth.scanner.codeFailed": "このコードは使用できません",
  "mobile.auth.scanner.scanAgain": "もう一度スキャン",
  "mobile.auth.scanner.connecting": "スマートフォンを接続しています…",
  "mobile.auth.scanner.readingInvitation": "招待を読み込んでいます…",
  "mobile.auth.scanner.scanDesktop": "デスクトップのコードをスキャンしてください",
  "mobile.auth.scanner.scanInvitation": "招待コードをスキャンしてください",
  "mobile.auth.scanner.verifying": "ワンタイムコードを確認しています。",
  "mobile.auth.scanner.checkingServer": "サーバーの ID を確認しています。",
  "mobile.auth.scanner.keepCentered": "QRコードを枠の中央に合わせてください。",
  "mobile.auth.scanner.connectFallback": "OpenBot はこのスマートフォンを接続できませんでした。",
  "mobile.auth.scanner.cameraFailed": "カメラを起動できませんでした。もう一度お試しください。",
  "mobile.auth.camera.title": "カメラへのアクセスが必要です",
  "mobile.auth.camera.pairingReason":
    "OpenBot はデスクトップアプリに表示されるワンタイム QRコードをスキャンするためにのみカメラを使用します。",
  "mobile.auth.camera.invitationReason": "OpenBot は招待の QRコードをスキャンするためにのみカメラを使用します。",
  "mobile.auth.camera.blocked":
    "カメラへのアクセスがブロックされています。端末の設定で OpenBot のカメラを許可してから、ここに戻ってコードをスキャンしてください。",
  "mobile.auth.camera.allow": "カメラへのアクセスを許可",
  "mobile.auth.camera.openSettings": "設定を開く",
  "mobile.auth.signIn.title": "エージェントを、どこでも。",
  "mobile.auth.signIn.subtitle": "コンピューターの OpenBot に接続します。",
  "mobile.auth.signIn.helpTitle": "QRコードはどこにありますか?",
  "mobile.auth.signIn.helpStep1": "1. コンピューターで OpenBot を開きます。",
  "mobile.auth.signIn.helpStep2": "2. 設定 → Mobile Connect に移動します。",
  "mobile.auth.signIn.helpStep3": "3. 「QRコードを生成」を選択して、ここでスキャンします。",
  "mobile.auth.error.sessionEnded":
    "セッションが終了しました。デスクトップの OpenBot から新しいコードをスキャンしてください。",
  "mobile.auth.error.connectionInProgress": "別の接続が進行中です。完了するまでお待ちください。",
  "mobile.auth.error.invalidCode": "これは有効な OpenBot Mobile Connect コードではありません。",
  "mobile.auth.error.codeOutdated": "最新のデスクトップアプリで新しい Mobile Connect コードを生成してください。",
  "mobile.auth.error.alreadySignedIn":
    "すでにサインインしています。別のアカウントを接続する前にサインアウトしてください。",
  "mobile.auth.error.desktopUnreachable":
    "OpenBot はデスクトップに接続できませんでした。両方の端末を同じ Wi-Fi ネットワークに接続し、ローカルネットワークへのアクセスを許可してください。",
  "mobile.auth.error.accountServiceUnreachable":
    "OpenBot はアカウントサービスに接続できませんでした。接続を確認して、もう一度お試しください。",
  "mobile.auth.error.codeExpired": "この Mobile Connect コードは無効か、有効期限が切れています。",
  "mobile.auth.error.revokePreviousFailed":
    "以前のモバイルセッションを取り消せませんでした。接続を確認して、もう一度スキャンしてください。",
  "mobile.auth.error.verifyFailed": "OpenBot はこのモバイルセッションを確認できませんでした。",
  "mobile.auth.error.sessionsLoadFailed": "アカウントのセッションを読み込めませんでした。もう一度お試しください。",
  "mobile.auth.error.useSignOut": "この端末の接続を解除するには「サインアウト」を使用してください。",
  "mobile.auth.error.desktopSession": "デスクトップのセッションはモバイルから接続解除できません。",
  "mobile.auth.error.disconnectFailed": "このセッションを接続解除できませんでした。更新してもう一度お試しください。",
  "mobile.auth.error.nameLength": "3〜20文字の表示名を入力してください。",
  "mobile.auth.error.photoTooLarge": "512 KB 未満の写真を選択してください。",
  "mobile.auth.error.photoInvalid": "選択した写真は無効です。別の画像を選択してください。",
  "mobile.auth.error.tooManyChanges": "変更が多すぎます。しばらく待ってから、もう一度お試しください。",
  "mobile.auth.error.photoConflict": "別の端末で写真が変更されました。もう一度お試しください。",
  "mobile.auth.error.profileSaveFailed": "プロフィールを保存できませんでした。接続を確認して、もう一度お試しください。",
  "mobile.auth.error.signOutUnconfirmed":
    "サインアウトを確認できませんでした。接続を確認して、もう一度お試しください。",
} as const satisfies PartialTranslation<typeof source>;
