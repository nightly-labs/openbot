import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  // Text that OpenBot posts in a Slack conversation. Slack users read it. It names no agent: in
  // Slack, every answer comes from OpenBot.
  "status.messaging.working": "正在处理…",
  "status.messaging.queued": "等待中：OpenBot 正在处理另一个请求，回答会发到这里。",
  "status.messaging.busy": "等待中的请求太多，请稍后再试。",
  "status.messaging.failed": "OpenBot 未能完成该请求，详情请见 OpenBot 主机。",
  "status.messaging.noAnswer": "OpenBot 已完成，但没有书面回答。",
  "status.messaging.noAgent": "这里还没有助手能回答。请在 OpenBot 中添加 Slack 调度助手。",
  "status.messaging.delegated": "团队成员正在处理，回答会发到这里。",
  "status.messaging.stopped": "已停止。",
  "status.messaging.stop": "停止",
  "status.messaging.approvalTitle": "OpenBot 请求批准以继续。",
  "status.messaging.approvalCommand": "运行命令",
  "status.messaging.approvalFileChange": "修改文件",
  "status.messaging.approvalPermissions": "获取更多权限",
  "status.messaging.approve": "批准",
  "status.messaging.deny": "拒绝",
  "status.messaging.approvedBy": "已由 {user} 批准。",
  "status.messaging.deniedBy": "已由 {user} 拒绝。",
  "status.messaging.answeredOnHost": "已在 OpenBot 主机上回答。",
  "status.messaging.requestInactive": "该请求已失效。",
  "status.messaging.onlyRequester": "只有 {user} 可以操作，OpenBot 主机也可以回答。",
  "status.messaging.hostOnly": "只有 OpenBot 主机可以回答该请求。",
  "status.messaging.filesSkipped": "部分文件未发送：{names}。",
  // The name and title of the agent that OpenBot adds to answer in Slack. The user can rename it.
  "status.messaging.orchestratorName": "Slack 调度助手",
  "status.messaging.orchestratorTitle": "在 Slack 中回答并调度团队",
  // The same texts for Discord. Discord users read the first one.
  "status.messaging.discordNoAgent": "这里还没有助手能回答。请在 OpenBot 中添加 Discord 调度助手。",
  "status.messaging.discordOrchestratorName": "Discord 调度助手",
  "status.messaging.discordOrchestratorTitle": "在 Discord 中回答并调度团队",
  // The sidebar section that OpenBot puts the Slack Orchestrator in. The user can rename it.
  "status.messaging.integrationsSection": "集成",
  // The page a development Slack install ends on.
  "status.messaging.signInReceived": "OpenBot 已收到 Slack 安装请求，你可以关闭该标签页。",
  "status.messaging.signInUnknown": "该 Slack 安装不是由 OpenBot 发起的，请在 OpenBot 中重新开始。",
  // Text that OpenBot posts in a Telegram chat, and the Telegram Orchestrator agent. Telegram users
  // read the posts. The user can rename the agent.
  "status.messaging.telegramNoAgent": "这里还没有助手能回答。请在 OpenBot 中添加 Telegram 调度助手。",
  "status.messaging.telegramLinked": "OpenBot 已连接到该聊天。提及 {bot} 或回复 OpenBot 的消息即可向助手提问。",
  "status.messaging.telegramOrchestratorName": "Telegram 调度助手",
  "status.messaging.telegramOrchestratorTitle": "在 Telegram 中回答并调度团队",
  // Text that OpenBot posts from a linked WhatsApp number, and the WhatsApp Orchestrator agent.
  // WhatsApp users read the posts. Personal WhatsApp has no buttons, so a person answers with a number.
  "status.messaging.whatsappNoAgent": "这里还没有助手能回答。请在 OpenBot 中添加 WhatsApp 调度助手。",
  "status.messaging.whatsappApprovalMenu": "回复 1 批准，回复 2 拒绝。",
  "status.messaging.whatsappStopMenu": "回复“stop”即可停止。",
  "status.messaging.whatsappPairingCode": "该号码只回答其所有者允许的人。请把这个代码交给所有者：{code}",
  "status.messaging.whatsappPairingApproved": "你现在可以向该号码发送请求了。",
  "status.messaging.whatsappOwnChat": "给自己发消息",
  "status.messaging.whatsappOrchestratorName": "WhatsApp 调度助手",
  "status.messaging.whatsappOrchestratorTitle": "在 WhatsApp 中回答并调度团队",
} as const satisfies PartialTranslation<typeof source>;
