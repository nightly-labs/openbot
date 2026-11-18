import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Đang xử lý…",
  "status.messaging.queued": "Đang chờ yêu cầu trước đó hoàn tất. Câu trả lời sẽ xuất hiện ở đây.",
  "status.messaging.busy": "Có quá nhiều yêu cầu đang chờ. Hãy thử lại sau.",
  "status.messaging.failed": "OpenBot không thể hoàn tất yêu cầu này. Host OpenBot có thông tin chi tiết.",
  "status.messaging.noAnswer": "OpenBot đã hoàn tất mà không có câu trả lời bằng văn bản.",
  "status.messaging.noAgent": "Chưa có agent nào có thể trả lời ở đây. Hãy thêm Slack Orchestrator trong OpenBot.",
  "status.messaging.delegated": "Một thành viên trong nhóm đang xử lý. Câu trả lời sẽ xuất hiện ở đây.",
  "status.messaging.stopped": "Đã dừng.",
  "status.messaging.stop": "Dừng",
  "status.messaging.approvalTitle": "OpenBot cần bạn phê duyệt để tiếp tục.",
  "status.messaging.approvalCommand": "Chạy lệnh",
  "status.messaging.approvalFileChange": "Thay đổi tệp",
  "status.messaging.approvalPermissions": "Cấp thêm quyền",
  "status.messaging.approve": "Phê duyệt",
  "status.messaging.deny": "Từ chối",
  "status.messaging.approvedBy": "{user} đã phê duyệt.",
  "status.messaging.deniedBy": "{user} đã từ chối.",
  "status.messaging.answeredOnHost": "Đã được trả lời trên host OpenBot.",
  "status.messaging.requestInactive": "Yêu cầu này không còn hiệu lực.",
  "status.messaging.onlyRequester": "Chỉ {user} mới có thể làm việc này. Host OpenBot cũng có thể trả lời.",
  "status.messaging.hostOnly": "Chỉ host OpenBot mới có thể trả lời yêu cầu này.",
  "status.messaging.filesSkipped": "Một số tệp chưa được gửi: {names}.",
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Trả lời trong Slack và hỏi ý kiến nhóm",
  "status.messaging.discordNoAgent":
    "Chưa có agent nào có thể trả lời ở đây. Hãy thêm Discord Orchestrator trong OpenBot.",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Trả lời trong Discord và hỏi ý kiến nhóm",
  "status.messaging.integrationsSection": "Tích hợp",
  "status.messaging.signInReceived": "OpenBot đã nhận bản cài đặt Slack. Bạn có thể đóng thẻ này.",
  "status.messaging.signInUnknown": "OpenBot không khởi tạo bản cài đặt Slack này. Hãy bắt đầu lại trong OpenBot.",
  "status.messaging.telegramNoAgent":
    "Chưa có agent nào có thể trả lời ở đây. Hãy thêm Telegram Orchestrator trong OpenBot.",
  "status.messaging.telegramLinked":
    "OpenBot đã kết nối với cuộc trò chuyện này. Hãy nhắc đến {bot} hoặc trả lời một tin nhắn của OpenBot để hỏi các agent.",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "Trả lời trong Telegram và hỏi ý kiến nhóm",
  "status.messaging.whatsappNoAgent":
    "Chưa có agent nào có thể trả lời ở đây. Hãy thêm WhatsApp Orchestrator trong OpenBot.",
  "status.messaging.whatsappApprovalMenu": "Trả lời 1 để phê duyệt hoặc 2 để từ chối.",
  "status.messaging.whatsappStopMenu": "Trả lời stop để dừng.",
  "status.messaging.whatsappPairingCode":
    "Số này chỉ trả lời những người mà chủ sở hữu cho phép. Hãy đưa mã này cho chủ sở hữu: {code}",
  "status.messaging.whatsappPairingApproved": "Giờ bạn có thể gửi yêu cầu đến số này.",
  "status.messaging.whatsappOwnChat": "Nhắn tin cho chính bạn",
  "status.messaging.whatsappWelcomeOwn":
    "👋 *OpenBot đã kết nối*\n\nViết ở đây để hỏi các agent của bạn. WhatsApp Orchestrator sẽ trả lời, hoặc giao việc cho đúng agent.\n\nGửi *stop* để dừng một yêu cầu.",
  "status.messaging.whatsappWelcomeDedicated":
    "👋 *OpenBot đã kết nối*\n\nNhững người bạn cho phép trong OpenBot giờ có thể nhắn tin đến số này. Người mới sẽ nhận được một mã: hãy phê duyệt mã đó trong OpenBot, mục Yêu cầu.\n\nGửi *stop* để dừng một yêu cầu.",
  "status.messaging.whatsappOtherOpenBot":
    "Một OpenBot khác đã liên kết với số WhatsApp này, nên bạn có thể nhận hai câu trả lời. Để khắc phục, hãy mở Thiết bị đã liên kết trong WhatsApp trên điện thoại và đăng xuất OpenBot mà bạn không dùng.",
  "status.messaging.whatsappPaused":
    "OpenBot đã ngừng trả lời ở đây trong 10 phút: có quá nhiều tin nhắn đến trong thời gian ngắn. Nếu một OpenBot khác đã liên kết với số này, hãy mở Thiết bị đã liên kết trong WhatsApp trên điện thoại và đăng xuất OpenBot mà bạn không dùng.",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "Trả lời trong WhatsApp và hỏi ý kiến nhóm",
} as const satisfies PartialTranslation<typeof source>;
