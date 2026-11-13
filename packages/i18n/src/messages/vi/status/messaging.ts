import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  // Text that OpenBot posts in a Slack conversation. Slack users read it. It names no agent: in
  // Slack, every answer comes from OpenBot.
  "status.messaging.working": "Đang xử lý…",
  "status.messaging.queued": "Đang chờ: OpenBot đang xử lý một yêu cầu khác. Câu trả lời sẽ đến đây.",
  "status.messaging.busy": "Có quá nhiều yêu cầu đang chờ. Hãy thử lại sau.",
  "status.messaging.failed": "OpenBot không thể hoàn tất yêu cầu này. Máy tính OpenBot có thông tin chi tiết.",
  "status.messaging.noAnswer": "OpenBot đã hoàn tất mà không có câu trả lời bằng chữ.",
  "status.messaging.noAgent": "Chưa có trợ lý nào trả lời ở đây. Thêm Slack Orchestrator trong OpenBot.",
  "status.messaging.delegated": "Một đồng đội đang xử lý. Câu trả lời sẽ đến đây.",
  "status.messaging.stopped": "Đã dừng.",
  "status.messaging.stop": "Dừng",
  "status.messaging.approvalTitle": "OpenBot đề nghị phê duyệt để tiếp tục.",
  "status.messaging.approvalCommand": "Chạy một lệnh",
  "status.messaging.approvalFileChange": "Thay đổi tệp",
  "status.messaging.approvalPermissions": "Cần thêm quyền",
  "status.messaging.approve": "Phê duyệt",
  "status.messaging.deny": "Từ chối",
  "status.messaging.approvedBy": "Được {user} phê duyệt.",
  "status.messaging.deniedBy": "Bị {user} từ chối.",
  "status.messaging.answeredOnHost": "Đã trả lời trên máy tính OpenBot.",
  "status.messaging.requestInactive": "Yêu cầu này không còn hoạt động.",
  "status.messaging.onlyRequester": "Chỉ {user} mới làm được. Máy tính OpenBot cũng có thể trả lời.",
  "status.messaging.hostOnly": "Chỉ máy tính OpenBot mới có thể trả lời yêu cầu này.",
  "status.messaging.filesSkipped": "Một số tệp chưa được gửi: {names}.",
  // The name and title of the agent that OpenBot adds to answer in Slack. The user can rename it.
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Trả lời trong Slack và hỏi nhóm",
  // The same texts for Discord. Discord users read the first one.
  "status.messaging.discordNoAgent": "Chưa có trợ lý nào trả lời ở đây. Thêm Discord Orchestrator trong OpenBot.",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Trả lời trong Discord và hỏi nhóm",
  // The sidebar section that OpenBot puts the Slack Orchestrator in. The user can rename it.
  "status.messaging.integrationsSection": "Tích hợp",
  // The page a development Slack install ends on.
  "status.messaging.signInReceived": "OpenBot đã nhận bản cài đặt Slack. Bạn có thể đóng tab này.",
  "status.messaging.signInUnknown": "OpenBot chưa bắt đầu bản cài đặt Slack này. Hãy bắt đầu lại trong OpenBot.",
  // Text that OpenBot posts in a Telegram chat, and the Telegram Orchestrator agent. Telegram users
  // read the posts. The user can rename the agent.
  "status.messaging.telegramNoAgent": "Chưa có trợ lý nào trả lời ở đây. Thêm Telegram Orchestrator trong OpenBot.",
  "status.messaging.telegramLinked":
    "OpenBot đã kết nối với cuộc trò chuyện này. Nhắn tới {bot} hoặc trả lời một tin nhắn của OpenBot để hỏi các trợ lý.",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "Trả lời trong Telegram và hỏi nhóm",
  // Text that OpenBot posts from a linked WhatsApp number, and the WhatsApp Orchestrator agent.
  // WhatsApp users read the posts. Personal WhatsApp has no buttons, so a person answers with a number.
  "status.messaging.whatsappNoAgent": "Chưa có trợ lý nào trả lời ở đây. Thêm WhatsApp Orchestrator trong OpenBot.",
  "status.messaging.whatsappApprovalMenu": "Trả lời 1 để phê duyệt hoặc 2 để từ chối.",
  "status.messaging.whatsappStopMenu": "Trả lời stop để dừng.",
  "status.messaging.whatsappPairingCode":
    "Số này chỉ trả lời những người mà chủ sở hữu đã cho phép. Đưa mã này cho chủ sở hữu: {code}",
  "status.messaging.whatsappPairingApproved": "Bây giờ bạn có thể gửi yêu cầu tới số này.",
  "status.messaging.whatsappOwnChat": "Nhắn tin cho chính mình",
  // The first message after a link, in the linked number's own "Message yourself" chat.
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot đã kết nối*\n\nViết ở đây để hỏi các trợ lý của bạn. WhatsApp Orchestrator sẽ trả lời hoặc giao việc cho trợ lý phù hợp.\n\nGửi *stop* để dừng một yêu cầu.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot đã kết nối*\n\nNhững người bạn cho phép trong OpenBot giờ có thể viết tin tới số này. Người mới sẽ nhận một mã: hãy phê duyệt mã đó trong OpenBot ở mục Yêu cầu.\n\nGửi *stop* để dừng một yêu cầu.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "Trả lời trong WhatsApp và hỏi nhóm",
} as const satisfies PartialTranslation<typeof source>;
