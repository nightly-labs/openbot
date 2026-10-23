import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  // Desktop notifications, raised by the main process while the window may be closed, and browser
  // notifications, raised by the web client while its tab is open.
  "notification.needsInput": "需要你输入。",
  "notification.needsApproval": "需要你批准。",
  "notification.needsBrowserStep": "需要你在浏览器中完成一个步骤。",
  "notification.needsApprovalFor": "需要你批准：{action}",
  "notification.finished": "工作已完成。",
  "notification.failed": "因错误而停止。",
  "notification.usageLimit.title": "{provider} 账号已达上限",
  "notification.usageLimit.body": {
    one: "{count} 个助手在等待，OpenBot 稍后会重试。",
    other: "{count} 个助手在等待，OpenBot 稍后会重试。",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} 个助手在等待，{reset} 重置。",
    other: "{count} 个助手在等待，{reset} 重置。",
  },
  "notification.test": "通知功能正常。",
  "notification.welcome": "当助手需要你时，OpenBot 会在这里通知你。",
  // The toast region in each window.
  "notification.toast.region": "通知",
  "notification.toast.close": "关闭通知",
} as const satisfies PartialTranslation<typeof source>;
