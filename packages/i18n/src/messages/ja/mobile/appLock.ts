import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "アプリロック",
  "mobile.appLock.method.pin": "PIN コード",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "スマートフォンのロック解除",
  "mobile.appLock.methods.title": "ロック解除の方法",
  "mobile.appLock.methods.footer":
    "PIN、{method}、またはその両方をオンにしてください。OpenBot を離れるとロックされ、戻ったときにいずれかを求めます。",
  "mobile.appLock.methods.footerPinOnly":
    "PIN をオンにしてください。OpenBot を離れるとロックされ、戻ったときに PIN を求めます。",
  "mobile.appLock.changePin": "PIN を変更",
  "mobile.appLock.lockAfter.title": "OpenBot をロック",
  "mobile.appLock.lockAfter.immediately": "すぐに",
  "mobile.appLock.lockAfter.minutes": { other: "{count} 分後" },
  "mobile.appLock.lockAfter.hours": { other: "{count} 時間後" },
  "mobile.appLock.lockWithPhone": "スマートフォンのロック時",
  "mobile.appLock.lockAfter.footer":
    "OpenBot を離れた時点から時間を計ります。OpenBot は再起動すると必ずロックされます。",
  "mobile.appLock.device.turnOnPrompt": "OpenBot で {method} をオンにする",
  "mobile.appLock.device.failed": "{method} で確認できませんでした。もう一度お試しください。",
  "mobile.appLock.device.unavailable": "先にスマートフォンでパスコードを設定してください。",
  "mobile.appLock.pinSetup.title": "PIN コード",
  "mobile.appLock.pinSetup.enter": "新しい 4 桁の PIN を入力",
  "mobile.appLock.pinSetup.confirm": "PIN をもう一度入力",
  "mobile.appLock.pinSetup.mismatch": "PIN が一致しません。もう一度お試しください。",
  "mobile.appLock.pinSetup.saveFailed": "PIN を保存できませんでした。もう一度お試しください。",
  "mobile.appLock.lock.title": "OpenBot はロックされています",
  "mobile.appLock.lock.confirmTitle": "本人確認",
  "mobile.appLock.lock.enterPin": "PIN を入力",
  "mobile.appLock.lock.unlockPrompt": "OpenBot のロックを解除",
  "mobile.appLock.lock.useDevice": "{method} を使用",
  "mobile.appLock.lock.unlock": "ロックを解除",
  "mobile.appLock.lock.wrongPin": "PIN が正しくありません。",
  "mobile.appLock.lock.attemptsLeft": {
    other: "PIN が正しくありません。あと {count} 回間違えるとサインアウトします。",
  },
  "mobile.appLock.lock.waitSeconds": {
    other: "試行回数が多すぎます。{count} 秒後にもう一度お試しください。",
  },
  "mobile.appLock.lock.waitMinutes": {
    other: "試行回数が多すぎます。{count} 分後にもう一度お試しください。",
  },
  "mobile.appLock.lock.checkFailed": "PIN を確認できませんでした。もう一度お試しください。",
  "mobile.appLock.lock.pinMissing":
    "このスマートフォンには OpenBot の PIN がありません。サインアウトしてアプリロックをリセットしてください。",
  "mobile.appLock.lock.loadFailed": "アプリロックの設定を読み込めませんでした。",
  "mobile.appLock.lock.retry": "もう一度試す",
  "mobile.appLock.lock.forgotPin": "PIN を忘れた場合",
  "mobile.appLock.lock.signOut": "サインアウト",
  "mobile.appLock.lock.signOutTitle": "OpenBot からサインアウトしますか？",
  "mobile.appLock.lock.signOutBody":
    "アプリロックを解除し、このスマートフォンからサインアウトします。デスクトップの OpenBot で新しいコードをスキャンして再接続してください。",
  "mobile.appLock.lock.signedOut": "PIN の誤りが多すぎたため、OpenBot はこのスマートフォンからサインアウトしました。",
  "mobile.appLock.lock.delete": "1 桁削除",
  "mobile.appLock.lock.progress": { other: "4 桁中 {count} 桁を入力済み" },
} as const satisfies PartialTranslation<typeof source>;
