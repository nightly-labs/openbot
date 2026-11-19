import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Quy trình này không còn tồn tại.",
  "error.workflow.versionMissing": "Phiên bản này của quy trình không còn tồn tại.",
  "error.workflow.annotation": "Văn bản, ghi chú và hình khối không thể có kết nối.",
  "error.workflow.port": "Một bước không thể nhận loại đầu vào này.",
  "error.workflow.branch": "Chỉ điều kiện mới có thể có kết nối có và không.",
  "error.workflow.conditionBranch": "Mỗi kết nối từ một điều kiện phải là có hoặc không.",
  "error.workflow.duplicateEdge": "Hai bước này đã có kết nối này.",
  "error.workflow.serverTooOld": "Máy chủ này không hỗ trợ quy trình. Hãy cập nhật OpenBot trên máy tính chạy máy chủ.",
  "error.workflow.nodeUnsupported": "Phiên bản OpenBot này chưa thể chạy các bước hình ảnh, tệp và tin nhắn.",
  "error.workflow.interrupted": "OpenBot đã dừng trong khi bước này đang chạy. Hãy chạy lại.",
  "error.workflow.agentMissing": "Chọn một agent cho bước này.",
  "error.workflow.handoffFailed": "OpenBot không thể gửi bước này cho agent của nó.",
  "error.workflow.agentStepEnded": "Tin nhắn của agent cho bước này đã bị xóa trước khi agent trả lời.",
  "error.workflow.conditionUnclear": "Mô hình không trả lời có hoặc không.",
  "error.workflow.modelFailed": "Mô hình không thể trả lời. Hãy chạy lại bước này.",
  "error.workflow.modelTimedOut":
    "Mô hình không trả lời kịp thời. Hãy chọn mức suy luận thấp hơn hoặc mô hình nhanh hơn cho bước này, rồi chạy lại.",
  "error.workflow.modelToolUse":
    "Mô hình đã cố dùng một công cụ, nhưng bước này chỉ có thể trả lời bằng văn bản. Hãy chạy lại bước này, hoặc chọn mô hình khác cho nó.",
  "error.workflow.modelUnavailable": "Mô hình của bước này không khả dụng. Hãy chọn mô hình khác cho bước này.",
  "error.workflow.providerBusy": "Nhà cung cấp đang bận. Hãy chờ vài phút, rồi chạy lại bước này.",
  "error.workflow.providerOffline":
    "OpenBot không thể kết nối tới nhà cung cấp. Hãy kiểm tra kết nối internet, rồi chạy lại bước này.",
  "error.workflow.modelBusy": "Một yêu cầu mô hình khác đang chạy. Hãy chạy lại bước này sau ít phút.",
  "error.workflow.mediaFailed": "Mô hình không thể tạo hình ảnh hoặc video. Hãy chạy lại bước này.",
  "error.workflow.pictureMissing": "Hình ảnh không còn trên máy chủ. Hãy gửi lại.",
  "error.workflow.pictureType": "Hãy dùng hình ảnh PNG, JPEG hoặc WebP.",
  "error.workflow.mediaInputMissing": "Hình ảnh từ một bước trước bước này không khả dụng. Hãy chạy lại bước đó.",
  "error.workflow.mediaEmptyRequest":
    "Hãy viết mô tả, hoặc chạy các bước trước bước này để có văn bản hoặc hình ảnh đầu vào.",
  "error.workflow.mediaInputNotImage": "Bước này chỉ nhận hình ảnh, không nhận video. Hãy gỡ kết nối từ video.",
  "error.workflow.stepMissing": "Bước này không còn tồn tại.",
  "error.workflow.nodeMissing": "Bước này không có trong quy trình.",
  "error.workflow.runMissing": "Lần chạy này không còn tồn tại.",
  "error.workflow.notRetryable": "Chỉ bước đã thất bại hoặc đã dừng mới có thể chạy lại.",
  "error.workflow.noDecision": "Bước này không chờ quyết định.",
  "error.workflow.outputPlaceMissing": "Chọn nơi nhắn tin cho đầu ra này.",
  "error.workflow.outputChannelMissing": "Chọn kênh cho đầu ra này.",
  "error.workflow.outputChannelFailed": "OpenBot không thể đăng kết quả vào kênh. Hãy chạy lại bước này.",
  "error.workflow.discordNoMessage":
    "Đầu ra này tác động lên tin nhắn Discord đã bắt đầu lần chạy. Hãy bắt đầu lần chạy từ một lượt nhắc đến trên Discord, hoặc chọn Đăng trong kênh.",
  "error.workflow.slackNoMessage":
    "Đầu ra này tác động lên tin nhắn Slack đã bắt đầu lần chạy. Hãy bắt đầu lần chạy từ một lượt nhắc đến trên Slack, hoặc chọn Đăng trong kênh.",
  "error.workflow.telegramNoMessage":
    "Đầu ra này tác động lên tin nhắn Telegram đã bắt đầu lần chạy. Hãy bắt đầu lần chạy từ một lượt nhắc đến trên Telegram, hoặc chọn Đăng trong cuộc trò chuyện.",
  "error.workflow.outputConnectionOff":
    "Kết nối nhắn tin của đầu ra này đã tắt hoặc đã bị gỡ. Hãy chọn lại nơi nhắn tin.",
  "error.workflow.outputNotRunning": "Kết nối nhắn tin hiện không chạy. Hãy thử lại khi kết nối chạy.",
  "error.workflow.outputRefused": "Nơi nhắn tin đã từ chối bài đăng. Hãy đảm bảo OpenBot có thể đăng ở đó.",
  "error.workflow.outputUncertain":
    "Bài đăng đã dừng giữa chừng. Một phần có thể đã có ở nơi nhắn tin. Hãy kiểm tra ở đó trước khi thử lại.",
  "error.workflow.tooLarge": "Quy trình này quá lớn để lưu. Hãy gỡ bớt hình vẽ hoặc văn bản dài, rồi thử lại.",
  "error.workflow.tooLargeToSend":
    "Quy trình này quá lớn để gửi sang máy tính khác. Hãy mở trên máy tính chạy máy chủ.",
  "error.workflow.webhookMissing": "Bước này không phải trình kích hoạt webhook. Hãy lưu quy trình, rồi thử lại.",
  "error.workflow.githubActionMissing": "Chọn việc đầu ra này làm trên GitHub.",
  "error.workflow.githubRepositoryMissing": "Chọn kho mã cho đầu ra này.",
  "error.workflow.githubItemMissing":
    "Đầu ra này không có issue hoặc pull request. Hãy bắt đầu lần chạy từ một sự kiện GitHub, hoặc đưa số vào đầu vào của nó.",
  "error.workflow.githubPullRequestOnly": "Thao tác này chỉ dùng được với pull request.",
  "error.workflow.githubTextMissing": "Đầu ra này không có văn bản để gửi. Hãy kết nối một bước viết văn bản đó.",
  "error.workflow.githubEventText":
    "Đầu ra này không thể gửi sự kiện thô của trình kích hoạt. Hãy đặt một agent giữa trình kích hoạt và đầu ra này.",
  "error.workflow.githubChoiceMissing": "Chọn nhãn hoặc người cho đầu ra này.",
  "error.workflow.githubChoseNothing": "Mô hình không chọn nhãn hoặc người nào của kho mã này.",
  "error.workflow.githubNotConnected": "Kết nối GitHub trên máy tính chạy quy trình này.",
  "error.workflow.githubNoAccess":
    "OpenBot GitHub App không thấy kho mã hoặc mục này. Hãy mở GitHub và cấp quyền truy cập cho ứng dụng.",
  "error.workflow.githubNoWrite":
    "OpenBot GitHub App không thể thay đổi kho mã này. Hãy mở GitHub và cấp quyền truy cập cho ứng dụng.",
  "error.workflow.githubLocked": "Cuộc trò chuyện này đã bị khóa trên GitHub.",
  "error.workflow.githubRefused": "GitHub đã từ chối thay đổi: {detail}",
  "error.workflow.githubUnreachable": "OpenBot không thể kết nối tới GitHub. Hãy chạy lại bước này.",
  "error.workflow.githubUncertain":
    "Thay đổi đã dừng giữa chừng. Thay đổi có thể đã có trên GitHub. Hãy kiểm tra ở đó trước khi chạy lại bước này.",
  "error.workflow.githubNoEvent": "GitHub không có issue hoặc pull request nào để trình kích hoạt này bắt đầu.",
  "error.workflow.sunraSignIn": "Đăng nhập Sunra trong Ứng dụng để dùng các mô hình Sunra.",
  "error.workflow.sunraNoCredits":
    "Tài khoản Sunra của bạn không đủ tín dụng. Hãy nạp thêm tín dụng tại sunra.ai/pricing, rồi chạy lại bước này.",
  "error.workflow.sunraNeedsPlan":
    "Mô hình Sunra này cần gói Sunra. Hãy đăng ký gói tại sunra.ai/pricing, hoặc chọn mô hình khác.",
  "error.workflow.sunraTeamInputs":
    "Sunra chỉ dùng hình ảnh đầu vào với tài khoản Personal. Hãy chọn tài khoản Personal trong Sunra, hoặc gỡ các kết nối hình ảnh.",
  "error.workflow.sunraFailed": "Sunra không thể tạo tệp: {reason}",
  "error.workflow.sunraTimeout":
    "Sunra không tạo xong tệp kịp thời. Hãy xem trong dự án OpenBot trên sunra.ai trước khi chạy lại bước này.",
  "error.workflow.higgsfieldSignIn": "Đăng nhập Higgsfield trong Ứng dụng để dùng các mô hình Higgsfield.",
  "error.workflow.higgsfieldNoCredits":
    "Tài khoản Higgsfield của bạn không đủ tín dụng. Hãy nạp thêm tín dụng tại higgsfield.ai/pricing, rồi chạy lại bước này.",
  "error.workflow.higgsfieldNeedsPlan":
    "Mô hình Higgsfield này cần gói Higgsfield. Hãy đăng ký gói tại higgsfield.ai/pricing, hoặc chọn mô hình khác.",
  "error.workflow.higgsfieldBlocked":
    "Higgsfield không tạo tệp vì bộ kiểm duyệt nội dung đã chặn. Hãy thay đổi prompt hoặc hình ảnh đầu vào, rồi chạy lại bước này.",
  "error.workflow.higgsfieldFailed": "Higgsfield không thể tạo tệp: {reason}",
  "error.workflow.higgsfieldTimeout":
    "Higgsfield không tạo xong tệp kịp thời. Hãy xem lịch sử của bạn trên higgsfield.ai trước khi chạy lại bước này.",
} as const satisfies PartialTranslation<typeof source>;
