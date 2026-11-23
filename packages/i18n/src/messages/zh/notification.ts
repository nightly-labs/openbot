import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "需要你输入。",
  "notification.needsApproval": "需要你批准。",
  "notification.needsBrowserStep": "需要你在浏览器中完成一个步骤。",
  "notification.waitsForSignIn": "正在等待登录 {provider}。",
  "notification.needsApprovalFor": "需要你批准：{action}",
  "notification.finished": "工作已完成。",
  "notification.workflowApproval": "一个步骤正在等待你批准。",
  "notification.workflowOutput": "一个工作流有了新结果。",
  "notification.failed": "因错误而停止。",
  "notification.subagentFailed": "一个子助手因错误而停止。",
  "notification.subagentFailedFor": "一个子助手因错误而停止：{task}",
  "notification.channelTitle": "{channel} 中的 {agent}",
  "notification.channelMessage": "发来一条消息。",
  "notification.usageLimit.title": "{provider} 账号已达上限",
  "notification.usageLimit.body": {
    one: "{count} 个助手在等待，OpenBot 稍后会重试。",
    other: "{count} 个助手在等待，OpenBot 稍后会重试。",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} 个助手在等待，{reset} 重置。",
    other: "{count} 个助手在等待，{reset} 重置。",
  },
  "notification.machineAlert.disk": "{server}：磁盘已用 {percent}",
  "notification.machineAlert.memory": "{server}：内存已用 {percent}",
  "notification.machineAlert.cpu": "{server}：CPU 占用 {percent}",
  "notification.machineAlert.body": "已超过 {level} 的警报阈值。请查看“服务器设置 > 存储”。",
  "notification.test": "通知功能正常。",
  "notification.welcome": "当助手需要你时，OpenBot 会在这里通知你。",
  "notification.toast.region": "通知",
  "notification.toast.close": "关闭通知",
} as const satisfies PartialTranslation<typeof source>;
