import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  // Text that OpenBot posts in a Slack conversation. Slack users read it. It names no agent: in
  // Slack, every answer comes from OpenBot.
  "status.messaging.working": "正在處理…",
  "status.messaging.queued": "等待中：OpenBot 正在處理另一個請求，回答會發到這裡。",
  "status.messaging.busy": "等待中的請求太多，請稍後再試。",
  "status.messaging.failed": "OpenBot 未能完成該請求，詳情請見 OpenBot 主機。",
  "status.messaging.noAnswer": "OpenBot 已完成，但沒有書面回答。",
  "status.messaging.noAgent": "這裡還沒有助理能回答。請在 OpenBot 中新增 Slack 排程助理。",
  "status.messaging.delegated": "團隊成員正在處理，回答會發到這裡。",
  "status.messaging.stopped": "已停止。",
  "status.messaging.stop": "停止",
  "status.messaging.approvalTitle": "OpenBot 請求批准以繼續。",
  "status.messaging.approvalCommand": "執行命令",
  "status.messaging.approvalFileChange": "修改檔案",
  "status.messaging.approvalPermissions": "獲取更多權限",
  "status.messaging.approve": "批准",
  "status.messaging.deny": "拒絕",
  "status.messaging.approvedBy": "已由 {user} 批准。",
  "status.messaging.deniedBy": "已由 {user} 拒絕。",
  "status.messaging.answeredOnHost": "已在 OpenBot 主機上回答。",
  "status.messaging.requestInactive": "該請求已失效。",
  "status.messaging.onlyRequester": "只有 {user} 可以操作，OpenBot 主機也可以回答。",
  "status.messaging.hostOnly": "只有 OpenBot 主機可以回答該請求。",
  "status.messaging.filesSkipped": "部分檔案未傳送：{names}。",
  // The name and title of the agent that OpenBot adds to answer in Slack. The user can rename it.
  "status.messaging.orchestratorName": "Slack 排程助理",
  "status.messaging.orchestratorTitle": "在 Slack 中回答並排程團隊",
  // The same texts for Discord. Discord users read the first one.
  "status.messaging.discordNoAgent": "這裡還沒有助理能回答。請在 OpenBot 中新增 Discord 排程助理。",
  "status.messaging.discordOrchestratorName": "Discord 排程助理",
  "status.messaging.discordOrchestratorTitle": "在 Discord 中回答並排程團隊",
  // The sidebar section that OpenBot puts the Slack Orchestrator in. The user can rename it.
  "status.messaging.integrationsSection": "整合",
  // The page a development Slack install ends on.
  "status.messaging.signInReceived": "OpenBot 已收到 Slack 安裝請求，你可以關閉該標籤頁。",
  "status.messaging.signInUnknown": "該 Slack 安裝不是由 OpenBot 發起的，請在 OpenBot 中重新開始。",
  // Text that OpenBot posts in a Telegram chat, and the Telegram Orchestrator agent. Telegram users
  // read the posts. The user can rename the agent.
  "status.messaging.telegramNoAgent": "這裡還沒有助理能回答。請在 OpenBot 中新增 Telegram 排程助理。",
  "status.messaging.telegramLinked": "OpenBot 已連線到該聊天。提及 {bot} 或回覆 OpenBot 的訊息即可向助理提問。",
  "status.messaging.telegramOrchestratorName": "Telegram 排程助理",
  "status.messaging.telegramOrchestratorTitle": "在 Telegram 中回答並排程團隊",
} as const satisfies PartialTranslation<typeof source>;
