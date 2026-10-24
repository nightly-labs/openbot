import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "連携アプリ",
  "mobile.deviceApps.apps": "アプリ",
  "mobile.deviceApps.appsFooter":
    "このiPhoneのこれらのアプリをエージェントが使えるようにします。アプリをオンにすると、iPhoneがその許可を求めます。オフの間は、エージェントが初めて使うときにOpenBotが確認します。",
  "mobile.deviceApps.writes": "項目の追加",
  "mobile.deviceApps.writesFooter":
    "「常に許可」を選ぶまで、エージェントが予定やリマインダーを追加する前にOpenBotが確認します。",
  "mobile.deviceApps.app.calendar": "カレンダー",
  "mobile.deviceApps.app.reminders": "リマインダー",
  "mobile.deviceApps.app.contacts": "連絡先",
  "mobile.deviceApps.app.location": "位置情報",
  "mobile.deviceApps.app.denied": "{app}（拒否）",
  "mobile.deviceApps.write.calendar": "確認なしで予定を追加",
  "mobile.deviceApps.write.reminders": "確認なしでリマインダーを追加",
  "mobile.deviceApps.osDenied": "iPhoneの設定で{app}を許可",
  "mobile.deviceApps.consent.heading": "{app}を許可しますか？",
  "mobile.deviceApps.consent.calendarListEvents": "エージェントがカレンダーの予定を読み取ろうとしています。",
  "mobile.deviceApps.consent.calendarAddEvent": "エージェントがこの予定をカレンダーに追加しようとしています：{title}",
  "mobile.deviceApps.consent.remindersList": "エージェントがリマインダーを読み取ろうとしています。",
  "mobile.deviceApps.consent.remindersAdd": "エージェントがこのリマインダーを追加しようとしています：{title}",
  "mobile.deviceApps.consent.contactsFind": "エージェントが連絡先から人を検索しようとしています。",
  "mobile.deviceApps.consent.locationCurrent":
    "エージェントがあなたの現在地を約100メートルの精度で知ろうとしています。",
  "mobile.deviceApps.consent.privacy":
    "エージェントが読み取った内容は、そのコンピュータに送られ、モデルプロバイダーに届くことがあります。",
  "mobile.deviceApps.consent.once": "1回だけ許可",
  "mobile.deviceApps.consent.always": "常に許可",
  "mobile.deviceApps.consent.deny": "拒否",
} as const satisfies PartialTranslation<typeof source>;
