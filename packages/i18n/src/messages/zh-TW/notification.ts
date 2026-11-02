import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  // Desktop notifications, raised by the main process while the window may be closed, and browser
  // notifications, raised by the web client while its tab is open.
  "notification.needsInput": "需要你輸入。",
  "notification.needsApproval": "需要你批准。",
  "notification.needsBrowserStep": "需要你在瀏覽器中完成一個步驟。",
  "notification.needsApprovalFor": "需要你批准：{action}",
  "notification.finished": "工作已完成。",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "一個步驟正在等待你批准。",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "一個工作流有了新結果。",
  "notification.failed": "因錯誤而停止。",
  // The title of a notification about an agent in a channel: the agent and the channel name.
  "notification.channelTitle": "{channel} 中的 {agent}",
  // The body of a channel reply notification when the preview of agent words is off.
  "notification.channelMessage": "發來一條訊息。",
  "notification.usageLimit.title": "{provider} 帳號已達上限",
  "notification.usageLimit.body": {
    one: "{count} 個助理在等待，OpenBot 稍後會重試。",
    other: "{count} 個助理在等待，OpenBot 稍後會重試。",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} 個助理在等待，{reset} 重置。",
    other: "{count} 個助理在等待，{reset} 重置。",
  },
  "notification.machineAlert.disk": "{server}：磁碟已用 {percent}",
  "notification.machineAlert.memory": "{server}：記憶體已用 {percent}",
  "notification.machineAlert.cpu": "{server}：CPU 佔用 {percent}",
  "notification.machineAlert.body": "已超過 {level} 的警報閾值。請檢視「伺服器設定 > 儲存」。",
  "notification.test": "通知功能正常。",
  "notification.welcome": "當助理需要你時，OpenBot 會在這裡通知你。",
  // The toast region in each window.
  "notification.toast.region": "通知",
  "notification.toast.close": "關閉通知",
} as const satisfies PartialTranslation<typeof source>;
