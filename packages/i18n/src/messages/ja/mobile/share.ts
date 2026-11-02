import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "サインインして共有",
  "mobile.share.signInDescription":
    "コンピューターの OpenBot に表示される QR コードをスキャンしてください。その後、共有した内容を受け取るエージェントを選べます。",
  "mobile.share.reading": "共有された内容を読み込んでいます…",
  "mobile.share.readFailed": "OpenBot は共有された内容を読み込めませんでした。もう一度共有してください。",
  "mobile.share.content": "共有する内容",
  "mobile.share.footer": "チャットが開き、この内容がメッセージ欄に入ります。送信するまで何も送られません。",
  "mobile.share.lastUsed": "前回使用",
  "mobile.share.noAgents": "エージェントがありません",
  "mobile.share.chooseAgent": "エージェントを選択",
  "mobile.share.action": "{name} と共有",
  "mobile.share.extension.send": "送信",
  "mobile.share.extension.footer": "OpenBot がこの内容を今すぐエージェントに送信します。アプリは開きません。",
  "mobile.share.extension.sending": "{name} に送信中…",
  "mobile.share.extension.sent": "{name} に送信しました",
  "mobile.share.extension.failed": "OpenBot はこれを送信できませんでした。アプリを開いて、そこから送信してください。",
  "mobile.share.extension.unconfirmed":
    "サーバーがメッセージを確認しませんでした。もう一度送信する前にチャットを確認してください。",
  "mobile.share.extension.openApp": "OpenBot を開く",
} as const satisfies PartialTranslation<typeof source>;
