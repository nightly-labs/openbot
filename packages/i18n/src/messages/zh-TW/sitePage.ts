import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "頁面無法載入",
  "sitePage.error.body": "請檢查網路連線並重新載入頁面。如果仍無法載入，請返回首頁。",
  "sitePage.error.reload": "重新載入頁面",
  "sitePage.error.home": "返回首頁",
  "sitePage.join.title": "加入 OpenBot 伺服器",
  "sitePage.join.description": "在 OpenBot 中開啟私密伺服器邀請。",
  "sitePage.join.eyebrow": "私密邀請",
  "sitePage.join.intro": "在 OpenBot 中開啟該邀請。應用會檢查該伺服器，並在連線前請你確認。",
  "sitePage.join.invalid": "該邀請連結無效或不完整。請向伺服器所有者索取新的邀請。",
  "sitePage.join.open": "開啟 OpenBot",
  "sitePage.join.browser": "在瀏覽器中開啟",
  "sitePage.join.download": "下載 OpenBot",
  // {download} and {browser} are the labels of the two buttons above this note.
  "sitePage.join.notOpened":
    "如果 OpenBot 沒有開啟，請透過「{download}」安裝，或先啟動一次 OpenBot，使它能開啟邀請連結。你也可以使用「{browser}」。",
  // {open} is the label of the button above this note.
  "sitePage.join.mobile": "如果已安裝 OpenBot，請點按「{open}」。你也可以把該連結貼上到應用的「新增伺服器」中。",
  "sitePage.join.singleUse":
    "一次性連結只能使用一次，之後即失效。永久連結在所有者撤銷之前一直有效。加入前，OpenBot 會顯示有效期。",
  "sitePage.join.email": "如果邀請是透過電子郵件發來的，請用該電子郵件地址登入 OpenBot。",
  "sitePage.join.share": "該連結可訪問伺服器。只分享給你想邀請的人。",
  // {name} is Slack or Discord on all the connect keys.
  "sitePage.connect.title": "返回 OpenBot",
  "sitePage.connect.failedTitle": "連線未完成",
  "sitePage.connect.openApp": "開啟 OpenBot",
  "sitePage.connect.tryAgainApp": "在 OpenBot 中重試",
  "sitePage.connect.tryAgainBrowser": "在瀏覽器中重試",
  "sitePage.connect.doneInWebClient": "你的 OpenBot 標籤頁會完成 {name} 連線。你可以關閉該標籤頁。",
  "sitePage.connect.doneInApp": "OpenBot 會在你的電腦上完成 {name} 連線。",
  "sitePage.connect.failure.cancelled": "{name} 連線已取消，沒有任何更改。",
  "sitePage.connect.failure.expired": "{name} 登入已過期。請重新開始連線。",
  "sitePage.connect.failure.exchange": "{name} 未確認連線。請重試。",
  "sitePage.connect.failure.enterprise": "請連線單個 Slack 工作區，而不是整個組織。",
  "sitePage.connect.failure.takenSlack":
    "另一臺 OpenBot 伺服器已在回應該 Slack 工作區。請先在那臺伺服器上斷開連線，然後重試。",
  "sitePage.connect.failure.takenDiscord":
    "另一臺 OpenBot 伺服器已在回應該 Discord 伺服器。請先在那臺伺服器上斷開連線，然後重試。",
  "sitePage.connect.failure.unavailable": "OpenBot 現在無法連線 {name}。請稍後重試。",
  "sitePage.connect.failure.tabClosed":
    "發起 {name} 連線的 OpenBot 標籤頁沒有回應。請在瀏覽器中開啟 OpenBot，再次連線 {name}。",
  "sitePage.connect.failure.failed": "{name} 未完成連線。請重試。",
  // {marketplace}, {apps} and {connect} are the names of these screens and that button in the app.
  "sitePage.connect.restartHint":
    "在 OpenBot 中開啟「{marketplace}」，再開啟「{apps}」，然後開啟「{name}」並選擇「{connect}」。",
  "sitePage.connect.notOpened": "請啟動 OpenBot，然後重試。如果這臺電腦上沒有 OpenBot，請下載並在應用中連線 {name}。",
  "sitePage.openApp.title": "沒有開啟？",
  "sitePage.openApp.dismiss": "暫不",
  "sitePage.billing.pageTitle": "OpenBot 帳單",
  "sitePage.billing.updatedTitle": "帳單已更新",
  "sitePage.billing.updatedBody": "返回 OpenBot。你可以關閉該頁面。",
  "sitePage.billing.cancelledTitle": "結帳已取消",
  "sitePage.billing.cancelledBody": "沒有扣款。請返回 OpenBot。",
  "sitePage.report.pageTitle": "舉報託管站點 — OpenBot",
  "sitePage.report.title": "舉報託管站點",
  "sitePage.report.intro": "舉報 openbot.site 地址上的有害或違法內容。",
  "sitePage.report.hostnameLabel": "站點地址",
  "sitePage.report.hostnameMissing": "請輸入站點地址",
  "sitePage.report.reasonLabel": "原因",
  "sitePage.report.reason.phishing": "網路釣魚",
  "sitePage.report.reason.malware": "惡意軟體",
  "sitePage.report.reason.abuse": "濫用",
  "sitePage.report.reason.copyright": "版權",
  "sitePage.report.reason.other": "其他",
  "sitePage.report.detailsLabel": "詳情",
  "sitePage.report.optional": "可選",
  "sitePage.report.detailsPlaceholder": "該站點有什麼問題？",
  "sitePage.report.send": "傳送舉報",
  "sitePage.report.sending": "正在傳送…",
  "sitePage.report.tooMany": "舉報過多。請稍後重試。",
  "sitePage.report.sendFailed": "無法傳送舉報。請重試。",
  // {email} is the contact address. The page shows it as a link.
  "sitePage.report.writeTo": "你也可以寫信到 {email}。",
  "sitePage.report.sentTitle": "舉報已傳送",
  "sitePage.report.sentBody": "謝謝，我們已收到你的舉報。",
  "sitePage.report.home": "前往首頁",
  "sitePage.pricing.title": "OpenBot 價格",
  "sitePage.pricing.description": "託管伺服器和團隊許可證。在你自己的電腦上個人使用 OpenBot 免費。",
  "sitePage.pricing.heading": "價格",
  "sitePage.pricing.enterprise.title": "企業版",
  // {count} is the largest number of members that the page sells, such as 25.
  "sitePage.pricing.enterprise.body": "更大的伺服器、超過 {count} 名成員，或你需要的其他任何內容，並提供企業級支援。",
  "sitePage.pricing.enterprise.contact": "聯絡銷售",
} as const satisfies PartialTranslation<typeof source>;
