import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "页面无法加载",
  "sitePage.error.body": "请检查网络连接并重新加载页面。如果仍无法加载，请返回首页。",
  "sitePage.error.reload": "重新加载页面",
  "sitePage.error.home": "返回首页",
  "sitePage.join.title": "加入 OpenBot 服务器",
  "sitePage.join.description": "在 OpenBot 中打开私密服务器邀请。",
  "sitePage.join.eyebrow": "私密邀请",
  "sitePage.join.intro": "在 OpenBot 中打开该邀请。应用会检查该服务器，并在连接前请你确认。",
  "sitePage.join.invalid": "该邀请链接无效或不完整。请向服务器所有者索取新的邀请。",
  "sitePage.join.open": "打开 OpenBot",
  "sitePage.join.browser": "在浏览器中打开",
  "sitePage.join.download": "下载 OpenBot",
  // {download} and {browser} are the labels of the two buttons above this note.
  "sitePage.join.notOpened":
    "如果 OpenBot 没有打开，请通过“{download}”安装，或先启动一次 OpenBot，使它能打开邀请链接。你也可以使用“{browser}”。",
  // {open} is the label of the button above this note.
  "sitePage.join.mobile": "如果已安装 OpenBot，请点按“{open}”。你也可以把该链接粘贴到应用的“添加服务器”中。",
  "sitePage.join.singleUse":
    "一次性链接只能使用一次，之后即失效。永久链接在所有者撤销之前一直有效。加入前，OpenBot 会显示有效期。",
  "sitePage.join.email": "如果邀请是通过电子邮件发来的，请用该邮箱地址登录 OpenBot。",
  "sitePage.join.share": "该链接可访问服务器。只分享给你想邀请的人。",
  // {name} is Slack or Discord on all the connect keys.
  "sitePage.connect.title": "返回 OpenBot",
  "sitePage.connect.failedTitle": "连接未完成",
  "sitePage.connect.openApp": "打开 OpenBot",
  "sitePage.connect.tryAgainApp": "在 OpenBot 中重试",
  "sitePage.connect.tryAgainBrowser": "在浏览器中重试",
  "sitePage.connect.doneInWebClient": "你的 OpenBot 标签页会完成 {name} 连接。你可以关闭该标签页。",
  "sitePage.connect.doneInApp": "OpenBot 会在你的电脑上完成 {name} 连接。",
  "sitePage.connect.failure.cancelled": "{name} 连接已取消，没有任何更改。",
  "sitePage.connect.failure.expired": "{name} 登录已过期。请重新开始连接。",
  "sitePage.connect.failure.exchange": "{name} 未确认连接。请重试。",
  "sitePage.connect.failure.enterprise": "请连接单个 Slack 工作区，而不是整个组织。",
  "sitePage.connect.failure.takenSlack":
    "另一台 OpenBot 服务器已在响应该 Slack 工作区。请先在那台服务器上断开连接，然后重试。",
  "sitePage.connect.failure.takenDiscord":
    "另一台 OpenBot 服务器已在响应该 Discord 服务器。请先在那台服务器上断开连接，然后重试。",
  "sitePage.connect.failure.unavailable": "OpenBot 现在无法连接 {name}。请稍后重试。",
  "sitePage.connect.failure.tabClosed":
    "发起 {name} 连接的 OpenBot 标签页没有响应。请在浏览器中打开 OpenBot，再次连接 {name}。",
  "sitePage.connect.failure.failed": "{name} 未完成连接。请重试。",
  // {marketplace}, {apps} and {connect} are the names of these screens and that button in the app.
  "sitePage.connect.restartHint":
    "在 OpenBot 中打开“{marketplace}”，再打开“{apps}”，然后打开“{name}”并选择“{connect}”。",
  "sitePage.connect.notOpened": "请启动 OpenBot，然后重试。如果这台电脑上没有 OpenBot，请下载并在应用中连接 {name}。",
  "sitePage.openApp.title": "没有打开？",
  "sitePage.openApp.dismiss": "暂不",
  "sitePage.billing.pageTitle": "OpenBot 账单",
  "sitePage.billing.updatedTitle": "账单已更新",
  "sitePage.billing.updatedBody": "返回 OpenBot。你可以关闭该页面。",
  "sitePage.billing.cancelledTitle": "结账已取消",
  "sitePage.billing.cancelledBody": "没有扣款。请返回 OpenBot。",
  "sitePage.report.pageTitle": "举报托管站点 — OpenBot",
  "sitePage.report.title": "举报托管站点",
  "sitePage.report.intro": "举报 openbot.site 地址上的有害或违法内容。",
  "sitePage.report.hostnameLabel": "站点地址",
  "sitePage.report.hostnameMissing": "请输入站点地址",
  "sitePage.report.reasonLabel": "原因",
  "sitePage.report.reason.phishing": "网络钓鱼",
  "sitePage.report.reason.malware": "恶意软件",
  "sitePage.report.reason.abuse": "滥用",
  "sitePage.report.reason.copyright": "版权",
  "sitePage.report.reason.other": "其他",
  "sitePage.report.detailsLabel": "详情",
  "sitePage.report.optional": "可选",
  "sitePage.report.detailsPlaceholder": "该站点有什么问题？",
  "sitePage.report.send": "发送举报",
  "sitePage.report.sending": "正在发送…",
  "sitePage.report.tooMany": "举报过多。请稍后重试。",
  "sitePage.report.sendFailed": "无法发送举报。请重试。",
  // {email} is the contact address. The page shows it as a link.
  "sitePage.report.writeTo": "你也可以写信到 {email}。",
  "sitePage.report.sentTitle": "举报已发送",
  "sitePage.report.sentBody": "谢谢，我们已收到你的举报。",
  "sitePage.report.home": "前往首页",
  "sitePage.pricing.title": "OpenBot 价格",
  "sitePage.pricing.description": "托管服务器和团队许可证。在你自己的电脑上个人使用 OpenBot 免费。",
  "sitePage.pricing.heading": "价格",
  "sitePage.pricing.enterprise.title": "企业版",
  // {count} is the largest number of members that the page sells, such as 25.
  "sitePage.pricing.enterprise.body": "更大的服务器、超过 {count} 名成员，或你需要的其他任何内容，并提供企业级支持。",
  "sitePage.pricing.enterprise.contact": "联系销售",
} as const satisfies PartialTranslation<typeof source>;
