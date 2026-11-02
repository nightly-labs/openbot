import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "登入後即可分享",
  "mobile.share.signInDescription": "掃描電腦上 OpenBot 顯示的 QR Code，然後就能選擇由哪個助理接收你分享的內容。",
  "mobile.share.reading": "正在讀取你分享的內容…",
  "mobile.share.readFailed": "OpenBot 無法讀取你分享的內容，請重新分享。",
  "mobile.share.content": "待分享內容",
  "mobile.share.footer": "對話會帶著這段內容開啟並填入輸入框，在你傳送之前不會發出任何內容。",
  "mobile.share.lastUsed": "最近使用",
  "mobile.share.noAgents": "沒有助理",
  "mobile.share.chooseAgent": "選擇助理",
  "mobile.share.action": "分享給{name}",
  "mobile.share.extension.send": "傳送",
  "mobile.share.extension.footer": "OpenBot 現在會把這些內容傳送給代理，不會開啟應用。",
  "mobile.share.extension.sending": "正在傳送給 {name}…",
  "mobile.share.extension.sent": "已傳送給 {name}",
  "mobile.share.extension.failed": "OpenBot 無法傳送這些內容。請開啟應用，從應用中傳送。",
  "mobile.share.extension.unconfirmed": "伺服器沒有確認這條訊息。再次傳送前，請先檢視聊天。",
  "mobile.share.extension.openApp": "開啟 OpenBot",
} as const satisfies PartialTranslation<typeof source>;
