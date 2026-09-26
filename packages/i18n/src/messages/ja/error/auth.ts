import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  // Errors from the OpenBot account service.
  "error.auth.serviceUnavailable":
    "OpenBot がアカウントサービスに接続できませんでした。API が動作していることを確認してから、再試行してください。",
  "error.auth.signInFirst": "先に OpenBot にサインインしてください。",
  "error.auth.signInRequired": "サインインが必要です。",
  "error.auth.accountChangedDuringRegister": "このサーバーの登録中に、サインイン中のアカウントが変わりました。",
  "error.auth.hostCredentialUnavailable": "リモートホストの認証情報を利用できません。ホストを再登録してください。",
  "error.auth.codeNotVerified": "サインインコードを確認できませんでした。",
  "error.auth.serviceError": "アカウントサービスがエラーを返しました。",
  "error.auth.codeNotSent": "OpenBot がサインインコードを送信できませんでした。",
  "error.auth.deliveryTimeout":
    "OpenBot が時間内に配信を確認できませんでした。コードが後で届く場合があります。再送信する前に配信を確認してください。",
  "error.auth.deliveryInterrupted":
    "OpenBot が配信を確認する前に接続が終了しました。別のコードを送信しないように、配信を確認してください。",
  "error.auth.deliveryUnknown":
    "サインインコードが送信されたかどうかを OpenBot が確認できませんでした。再送信する前に配信を確認してください。",
} as const satisfies PartialTranslation<typeof source>;
