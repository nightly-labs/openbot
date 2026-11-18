import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Quy trình này không còn tồn tại.",
  "error.workflow.versionMissing": "Phiên bản này của quy trình không còn tồn tại.",
  "error.workflow.annotation": "Văn bản, ghi chú và hình không thể có kết nối.",
  "error.workflow.port": "Một bước không thể nhận loại đầu vào này.",
  "error.workflow.branch": "Chỉ một điều kiện mới có thể có kết nối có và không.",
  "error.workflow.conditionBranch": "Mỗi kết nối từ một điều kiện phải là có hoặc không.",
  "error.workflow.duplicateEdge": "Hai bước này đã có kết nối đó.",
  "error.workflow.serverTooOld": "Máy chủ này không hỗ trợ quy trình. Hãy cập nhật OpenBot trên máy tính đang chạy nó.",
  "error.workflow.nodeUnsupported": "Phiên bản này của OpenBot chưa chạy được các bước hình ảnh, tệp và tin nhắn.",
  "error.workflow.interrupted": "OpenBot đã dừng khi bước này đang chạy. Hãy chạy lại.",
  "error.workflow.agentMissing": "Hãy chọn một trợ lý cho bước này.",
  "error.workflow.handoffFailed": "OpenBot không thể gửi bước này tới trợ lý của nó.",
  "error.workflow.agentStepEnded": "Tin nhắn của trợ lý cho bước này đã bị xóa trước khi nó trả lời.",
  "error.workflow.conditionUnclear": "Mô hình không trả lời có hoặc không.",
  "error.workflow.modelFailed": "Mô hình không thể trả lời. Hãy chạy lại bước.",
  "error.workflow.modelBusy": "Một yêu cầu mô hình khác đang chạy. Hãy chạy lại bước sau ít phút.",
  "error.workflow.stepMissing": "Bước này không còn tồn tại.",
  "error.workflow.nodeMissing": "Bước này không có trong quy trình.",
  "error.workflow.runMissing": "Lần chạy này không còn tồn tại.",
  "error.workflow.notRetryable": "Chỉ bước đã thất bại hoặc đã dừng mới chạy lại được.",
  "error.workflow.noDecision": "Bước này không chờ quyết định.",
  "error.workflow.outputPlaceMissing": "Hãy chọn một nơi nhắn tin cho kết quả này.",
  "error.workflow.outputChannelMissing": "Hãy chọn một kênh cho kết quả này.",
  "error.workflow.outputChannelFailed": "OpenBot không thể đăng kết quả vào kênh. Hãy chạy lại bước.",
  "error.workflow.discordNoMessage":
    "Kết quả này tác động tới tin nhắn Discord đã mở lần chạy. Hãy mở lần chạy từ một lượt nhắc tới trên Discord, hoặc chọn Đăng trong kênh.",
  "error.workflow.slackNoMessage":
    "Kết quả này tác động tới tin nhắn Slack đã mở lần chạy. Hãy mở lần chạy từ một lượt nhắc tới trên Slack, hoặc chọn Đăng trong kênh.",
  "error.workflow.telegramNoMessage":
    "Kết quả này tác động tới tin nhắn Telegram đã mở lần chạy. Hãy mở lần chạy từ một lượt nhắc tới trên Telegram, hoặc chọn Đăng trong trò chuyện.",
  "error.workflow.outputConnectionOff": "Kết nối nhắn tin của kết quả này đã tắt hoặc bị gỡ bỏ. Hãy chọn nơi khác.",
  "error.workflow.outputNotRunning": "Kết nối nhắn tin hiện không chạy. Hãy thử lại khi nó chạy.",
  "error.workflow.outputRefused": "Nơi đó đã từ chối bài đăng. Hãy đảm bảo OpenBot có thể đăng ở đó.",
  "error.workflow.outputUncertain":
    "Bài đăng đã dừng giữa đường. Một phần có thể đã tới nơi. Hãy kiểm tra ở đó trước khi thử lại.",
  "error.workflow.tooLarge": "Quy trình này quá lớn để lưu. Hãy bỏ bớt hình vẽ hoặc văn bản dài, rồi thử lại.",
  "error.workflow.tooLargeToSend":
    "Quy trình này quá lớn để gửi tới máy tính khác. Hãy mở nó trên máy tính đang chạy máy chủ.",
  "error.workflow.webhookMissing": "Bước này không phải là trình kích hoạt webhook. Hãy lưu quy trình, rồi thử lại.",
  "error.workflow.githubActionMissing": "Hãy chọn kết quả này làm gì trên GitHub.",
  "error.workflow.githubRepositoryMissing": "Hãy chọn một kho mã cho kết quả này.",
  "error.workflow.githubItemMissing":
    "Kết quả này không có issue hoặc pull request nào. Hãy mở lần chạy từ một sự kiện GitHub, hoặc nhập số vào đầu vào của nó.",
  "error.workflow.githubPullRequestOnly": "Hành động này chỉ hoạt động với pull request.",
  "error.workflow.githubTextMissing": "Kết quả này không có văn bản để gửi. Hãy kết nối một bước ghi văn bản đó.",
  "error.workflow.githubEventText":
    "Kết quả này không thể gửi sự kiện gốc của trình kích hoạt. Hãy đặt một trợ lý giữa trình kích hoạt và kết quả này.",
  "error.workflow.githubChoiceMissing": "Hãy chọn các nhãn hoặc người cho kết quả này.",
  "error.workflow.githubChoseNothing": "Mô hình không chọn nhãn hoặc người nào của kho mã này.",
  "error.workflow.githubNotConnected": "Hãy kết nối GitHub trên máy tính đang chạy quy trình này.",
  "error.workflow.githubNoAccess":
    "OpenBot GitHub App không thấy kho mã hoặc mục này. Hãy mở GitHub và cấp cho nó quyền truy cập.",
  "error.workflow.githubNoWrite":
    "OpenBot GitHub App không thể thay đổi kho mã này. Hãy mở GitHub và cấp cho nó quyền truy cập.",
  "error.workflow.githubLocked": "Cuộc hội thoại này bị khóa trên GitHub.",
  "error.workflow.githubRefused": "GitHub đã từ chối thay đổi: {detail}",
  "error.workflow.githubUnreachable": "OpenBot không thể kết nối tới GitHub. Hãy chạy lại bước.",
  "error.workflow.githubUncertain":
    "Thay đổi đã dừng giữa đường. Nó có thể đã tới GitHub. Hãy kiểm tra ở đó trước khi chạy lại bước.",
  "error.workflow.githubNoEvent": "GitHub không có issue hoặc pull request nào mà trình kích hoạt này bắt đầu.",
} as const satisfies PartialTranslation<typeof source>;
