import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/backend";

export const messages = {
  "error.backend.eventsUnavailable": "Sự kiện không khả dụng trên máy tính này.",
  "error.backend.databaseIntegrity": "Cơ sở dữ liệu OpenBot không vượt qua kiểm tra toàn vẹn.",
  "error.backend.webhookRouteLimit": "Một máy tính chỉ có tối đa {limit} nhiệm vụ định kỳ webhook.",
  "error.backend.webhookSettingsInvalid": "Kiểm tra cài đặt webhook rồi thử lại.",
  "error.backend.webhookSenderSecretInvalid":
    "Dán toàn bộ bí mật ký từ bên gửi. Nó dài từ 16 đến 1024 ký tự và không có khoảng trắng.",
  "error.backend.webhookRouteUnavailable":
    "Tuyến webhook công khai chưa sẵn sàng. Kiểm tra kết nối máy tính rồi thử lại.",
  "error.backend.webhookTestUnavailable":
    "Máy tính không nhận được sự kiện thử nghiệm lúc này. Hãy chắc chắn nó đã đăng nhập, rồi thử lại.",
  "error.backend.webhookTestFailed": "Sự kiện thử nghiệm không đến được nhiệm vụ định kỳ. Hãy thử lại.",
  // Errors that the backend services send: channels, messages, routines, memories, MCP, browser and remote desktop.
  "error.backend.browserViewRemoteOnly": "Chế độ xem trình duyệt trực tiếp chỉ dành cho máy tính từ xa.",
  "error.backend.browserViewUnsupported": "Máy tính từ xa này không hỗ trợ xem trình duyệt trực tiếp.",
  "error.backend.browserViewLimit": "Quá nhiều cửa sổ xem trình duyệt đang mở trên máy tính này.",
  "error.backend.browserViewEnded": "Chế độ xem trực tiếp của trang này đã kết thúc.",
  "error.backend.browserViewFailed": "Chế độ xem trực tiếp của trang này đã thất bại.",
  "error.backend.windowTemporarilyUnavailable": "Cửa sổ OpenBot tạm thời không khả dụng.",
  "error.backend.windowUnavailable": "Cửa sổ OpenBot không khả dụng.",
  "error.backend.sunshineApiHttp": "Sunshine API thất bại với HTTP {status}.",
  "error.backend.sunshinePortsUnavailable": "Không thể dành sẵn một nhóm cổng Sunshine trống cho Remote Desktop.",
  "error.backend.moonlightPortsUnavailable":
    "Không thể dành sẵn một dải cổng Moonlight WebRTC trống cho Remote Desktop.",
  "error.backend.iceServerNoPort": "Máy chủ ICE của Remote Desktop không có cổng.",
  "error.backend.remoteDesktopStoppedWhileStarting":
    "Môi trường chạy của remote desktop đã bị dừng giữa chừng lúc khởi động.",
  "error.backend.sunshineNotStarted": "Sunshine không khởi động được trên nhóm cổng đã dành sẵn.",
  "error.backend.moonlightNoHost": "Moonlight không có máy tính cục bộ nào đã ghép nối.",
  "error.backend.sunshineNoDesktop": "Sunshine không phát hành ứng dụng Desktop.",
  "error.backend.sunshineAmbiguousPairing": "Sunshine trả về các yêu cầu ghép nối cục bộ không rõ ràng.",
  "error.backend.sunshineNoPairingRequest": "Sunshine không nhận được yêu cầu ghép nối cục bộ như mong đợi.",
  "error.backend.moonlightPairingHttp": "Ghép nối Moonlight thất bại với HTTP {status}.",
  "error.backend.moonlightRejectedPairing": "Moonlight từ chối ghép nối Sunshine.",
  "error.backend.moonlightNoPin": "Moonlight không trả về mã PIN ghép nối.",
  "error.backend.moonlightPairingIncomplete": "Ghép nối Moonlight không hoàn tất.",
  "error.backend.moonlightWebNotEmbedded": "Moonlight Web không phải bản nhúng của OpenBot.",
  "error.backend.moonlightEmptyResponse": "Moonlight trả về phản hồi rỗng.",
  "error.backend.remoteDesktopTimeout": "Yêu cầu remote desktop đã hết thời gian chờ.",
  "error.backend.moonlightApiHttp": "Moonlight API thất bại với HTTP {status}.",
  "error.backend.sunshineExited": "Sunshine đã thoát trước khi HTTPS API của nó trên cổng {port} sẵn sàng.",
  "error.backend.sunshineNoAnswer": "Sunshine không phản hồi.",
  "error.backend.sunshineTlsUnexpected": "Sunshine trả về chứng thư TLS không mong muốn.",
  "error.backend.moonlightWebExited": "Moonlight Web đã thoát trước khi {url} sẵn sàng.",
  "error.backend.moonlightWebNotReady": "Moonlight Web không sẵn sàng.",
  "error.backend.channelDeleteUnsupported": "Máy chủ này không hỗ trợ xóa kênh.",
  "error.backend.browserNavigateUnsupported":
    "Máy tính từ xa này không hỗ trợ điều hướng bằng thanh địa chỉ trong một thẻ đang mở.",
  "error.backend.browserUserControlBusy": "Thẻ trình duyệt này đang chờ một bí mật. Hãy trả lời yêu cầu bí mật trước.",
  "error.backend.browserUserControlUnsupported": "Máy tính từ xa này không hỗ trợ điều khiển thẻ trình duyệt.",
  "error.backend.browserSignInUnsupported": "Máy tính từ xa này không nhận được thông tin đăng nhập từ máy tính này.",
  "error.backend.browserSignInOpenFailed": "OpenBot không thể mở cửa sổ đăng nhập.",
  "error.backend.browserSignInReadFailed": "OpenBot không thể đọc thông tin đăng nhập từ cửa sổ.",
  "error.backend.browserStopUnsupported": "Máy tính từ xa này không thể dừng việc tải trang.",
  "error.backend.sharedDataLocalOnly": "Dữ liệu dùng chung được quản lý trên máy tính chạy các trợ lý này.",
  "error.backend.browserUrlProtocol": "Chỉ cho phép URL trình duyệt HTTP(S).",
  "error.backend.sunshineNotReady": "Sunshine không sẵn sàng.",
  "error.backend.sunshineNotReadyReason": "Sunshine không sẵn sàng. {reason}",
  "error.backend.channelLeadModelUnavailable": "Mô hình của người phụ trách kênh không khả dụng.",
  "error.backend.contextCompactionIneffective":
    "Nén ngữ cảnh không làm cuộc trò chuyện này nhỏ lại: sau hai lần nén, nó vẫn chiếm {percent}% cửa sổ ngữ cảnh của mô hình, nên OpenBot ngừng nén. Công cụ và chỉ dẫn chiếm phần lớn cửa sổ. Hãy tắt các máy chủ MCP hoặc Điều khiển máy tính mà trợ lý này không cần, hoặc chọn mô hình có cửa sổ lớn hơn. Rồi bắt đầu cuộc trò chuyện mới.",
  "error.backend.contextCompactionStopped":
    "Hai lần nén cuộc trò chuyện này thất bại liên tiếp, nên OpenBot ngừng tự động nén. Mỗi lần thử đều gửi toàn bộ cuộc trò chuyện tới mô hình và dùng hạn mức gói của bạn. Chọn Nén ngay để thử lại, hoặc bắt đầu cuộc trò chuyện mới.",
  "error.backend.providerRetrying":
    "Nhà cung cấp đã thất bại yêu cầu này {attempts} lần và đang thử lại. Nếu trợ lý không tiếp tục, hãy dừng lượt.",
  "error.backend.providerRetryingLargeContext":
    "Nhà cung cấp đã thất bại yêu cầu này {attempts} lần và đang thử lại. Cuộc trò chuyện này dùng {percent}% cửa sổ ngữ cảnh của mô hình. Nếu trợ lý không tiếp tục, hãy dừng lượt: OpenBot sẽ nén cuộc trò chuyện trước tin nhắn tiếp theo.",
  "error.backend.sharedDataUnavailable": "Dữ liệu dùng chung không khả dụng.",
  "error.backend.shuttingDown": "OpenBot đang tắt.",
  "error.backend.channelUnconfirmedStart":
    "Kênh có một lần bắt đầu phân công chưa được xác nhận. Hãy kiểm tra kết quả trước khi xóa.",
  "error.backend.channelNotFound": "Không tìm thấy kênh.",
  "error.backend.channelMemberUnavailable": "Một thành viên của kênh không khả dụng.",
  "error.backend.channelWaitBeforeNewConversation":
    "Hãy đợi công việc trong kênh này dừng lại, rồi bắt đầu một cuộc hội thoại mới.",
  "error.backend.channelWaitBeforeCompact": "Hãy đợi công việc trong kênh này dừng lại, rồi nén ngữ cảnh của nó.",
  "error.backend.channelWaitBeforeDeleteHistory":
    "Hãy đợi công việc trong kênh này dừng lại, rồi xóa lịch sử của kênh.",
  "error.backend.channelCompactUnavailable":
    "Không thành viên nào của kênh này có thể nén ngữ cảnh lúc này. Một thành viên phải trả lời trong kênh trước, và nhà cung cấp của thành viên đó phải hỗ trợ nén.",
  "error.backend.channelArchived": "Khôi phục kênh này trước khi gửi tin nhắn hoặc thay đổi tác vụ.",
  "error.backend.channelReferenceUnavailable": "Tin nhắn kênh được tham chiếu không khả dụng.",
  "error.backend.channelTaskNotFound": "Không tìm thấy tác vụ của kênh.",
  "error.backend.channelTaskComplete": "Tác vụ này đã hoàn tất.",
  "error.backend.channelTaskNotStopped": "Chỉ tác vụ đã dừng hoặc thất bại mới có thể hủy.",
  "error.backend.channelSelectAgent": "Chọn một trợ lý.",
  "error.backend.channelLeadRequired":
    "Chọn một người phụ trách kênh khả dụng hoặc giao tác vụ này cho một thành viên.",
  "error.backend.channelRoutingTooLong":
    "Yêu cầu này vượt quá giới hạn ngữ cảnh định tuyến. Chọn một thành viên hoặc gửi yêu cầu ngắn hơn.",
  "error.backend.channelTaskMemberRequired": "Chọn một thành viên cho tác vụ này.",
  "error.backend.channelTaskStopped": "Đã dừng. Hãy tiếp tục hoặc giao lại tác vụ này.",
  "error.backend.channelRoutingUnreadable":
    "Người phụ trách không thể định tuyến tin nhắn này. Hãy giao lại cho một thành viên.",
  "error.backend.channelRoutingFailed": "Định tuyến thất bại. Hãy chọn một thành viên hoặc thử lại.",
  "error.backend.channelLeadTimedOut": "Người phụ trách kênh không trả lời kịp. Hãy chọn một thành viên hoặc thử lại.",
  "error.backend.channelLeadFailed":
    "Người phụ trách kênh không thể định tuyến tin nhắn này. Hãy chọn một thành viên hoặc thử lại.",
  "error.backend.channelRequestMemberRequired": "Chọn một thành viên cho yêu cầu này.",
  "error.backend.channelDeliveryNotCreated": "Chưa tạo được phần giao của kênh.",
  "error.backend.channelAssignmentStopped": "Phân công kênh này đã bị dừng hoặc thay thế.",
  "error.backend.channelAssigneeUnavailable": "Trợ lý được giao không khả dụng.",
  "error.backend.channelAssigneeRemoved": "Thành viên được giao đã bị gỡ bỏ.",
  "error.backend.channelAssigneeReassign": "Thành viên được giao không khả dụng. Hãy giao lại tác vụ này.",
  "error.backend.channelAssignmentChanged": "Phân công kênh này đã thay đổi.",
  "error.backend.channelMemberRequired": "Chọn một thành viên khả dụng của kênh này.",
  "error.backend.memoryEssentialBudget":
    "Các trí nhớ thiết yếu vượt quá giới hạn câu lệnh. Hãy đặt một mục để tìm khi cần, rồi thử lại.",
  "error.backend.memorySelectionConflict": "Trí nhớ đã thay đổi. Hãy tải lại rồi thử lại.",
  "error.backend.memorySelectionUserControlled":
    "Người dùng kiểm soát lựa chọn trí nhớ này. Hãy giữ lựa chọn của người dùng.",
  "error.backend.memorySearchQuery": "Nhập một hoặc nhiều từ tìm kiếm, tối đa 256 ký tự.",
  "error.backend.memoryOperationFailed": "Thao tác với trí nhớ thất bại. Hãy thử lại.",
  "error.backend.memoryGone": "Trí nhớ này không còn tồn tại.",
  "error.backend.routineGone": "Nhiệm vụ định kỳ này không còn tồn tại.",
  "error.backend.turnNotStarted": "Nhà cung cấp không bắt đầu lượt này.",
  "error.backend.routineResultConnectionOff": "Kết nối nhắn tin này đã tắt hoặc bị gỡ bỏ. Hãy chọn nơi khác.",
  "error.backend.routineResultNoDelivery": "Lần chạy này không có câu trả lời để gửi lại.",
  "error.backend.channelMemoryLimit": "Một kênh chỉ có tối đa {limit} trí nhớ.",
  "error.backend.channelRoutineLimit": "Một kênh chỉ có tối đa {limit} nhiệm vụ định kỳ.",
  "error.backend.agentRoutineLimit": "Một trợ lý chỉ có tối đa {limit} nhiệm vụ định kỳ.",
  "error.backend.agentMemoryLimit": "Một trợ lý chỉ có tối đa {limit} trí nhớ.",
  "error.backend.agentMemoryLimitReached":
    "Bạn đã có {saved} trong {limit} trí nhớ. Để chỗ trống, hãy cập nhật một trí nhớ theo memoryId bằng văn bản gộp của hai trí nhớ liên quan, rồi quên trí nhớ kia, hoặc quên một trí nhớ không còn đúng. Rồi thử lại.",
  "error.backend.agentMemoryLimitExceeded":
    "Bạn đã có {saved} trí nhớ, và giới hạn là {limit}. Người dùng đã đặt giới hạn thấp hơn số trí nhớ đã lưu. Đừng quên trí nhớ để chỗ trống. Hãy báo người dùng rằng trí nhớ này chưa được lưu.",
  "error.backend.channelHistoryArriving": "Một tin nhắn dùng chung vẫn đang tới. Hãy tiếp tục khi nó hoàn tất.",
  "error.backend.channelHistoryLeadRequired": "Chọn một người phụ trách kênh để chuẩn bị lịch sử dùng chung.",
  "error.backend.channelHistoryInvalid": "Tóm tắt lịch sử không hợp lệ. Hãy tiếp tục để thử lại.",
  "error.backend.channelContextTooLong":
    "Phân công này vượt quá giới hạn ngữ cảnh dùng chung. Hãy gửi yêu cầu ngắn hơn hoặc giao lại nó.",
  "error.backend.draftAttachmentLimit": "Chỉ giữ tối đa {limit} tệp đính kèm trong bản nháp.",
  "error.backend.recipientRequired": "Cần ít nhất một người nhận.",
  "error.backend.recipientLimit": "Một tin nhắn chỉ có tối đa {limit} người nhận.",
  "error.backend.attachmentDraftGone": "Bản nháp tệp đính kèm không còn tồn tại: {id}",
  "error.backend.attachmentInQueueEdit": "Một tệp đính kèm thuộc về một bản sửa trong hàng đợi.",
  "error.backend.messageEmpty": "Tin nhắn không được để trống.",
  "error.backend.attachLimit": "Đính kèm tối đa {limit} tệp.",
  "error.backend.queuedMessageNotFound": "Không tìm thấy tin nhắn trong hàng đợi.",
  "error.backend.cancelQueuedOnly": "Chỉ tin nhắn trong hàng đợi mới có thể hủy.",
  "error.backend.messageBeingEdited": "Tin nhắn này đang được sửa. Hãy lưu hoặc hủy bản sửa trước.",
  "error.backend.queuedMessageUnavailable": "Tin nhắn trong hàng đợi này không còn khả dụng.",
  "error.backend.editedOnOtherDevice": "Tin nhắn này đang được sửa trên một thiết bị khác.",
  "error.backend.editUnavailable": "Bản sửa này không còn khả dụng.",
  "error.backend.attachmentInOtherEdit": "Một tệp đính kèm thuộc về một bản sửa khác.",
  "error.backend.messageBeingSaved": "Tin nhắn này đang được lưu. Hãy thử lại sau khi lưu xong.",
  "error.backend.editQueuedOnly": "Chỉ tin nhắn trong hàng đợi mới có thể sửa.",
  "error.backend.attachmentNotInMessage": "Một tệp đính kèm không thuộc về tin nhắn trong hàng đợi.",
  "error.backend.queueOrderStale": "Thứ tự hàng đợi đã cũ. Hãy làm mới hàng đợi rồi thử lại.",
  "error.backend.fileGone": "Tệp không tồn tại hoặc đã bị xóa.",
  "error.backend.managedAttachmentChanged": "Tệp đính kèm được quản lý không có hoặc đã thay đổi: {name}",
  "error.backend.mailboxStateCorrupt":
    "Trạng thái hộp thư bị hỏng hoặc đến từ phiên bản OpenBot mới hơn; OpenBot từ chối ghi đè nó.",
  "error.backend.recipientDeleting": "Người nhận đang bị xóa. Hãy thử lại sau khi xóa xong.",
  "error.backend.recipientHidden": "Trợ lý này đang bị ẩn. Hãy khôi phục nó để gửi tin nhắn.",
  "error.backend.replyReferenceUnknown":
    "replyToMessageId {id} không nêu tin nhắn nào. Hãy dùng Message ID của tin nhắn bạn đang trả lời, hoặc bỏ qua replyToMessageId.",
  "error.backend.replyReferenceRequests": "Tin nhắn từ những người nhận này trong lượt này: {ids}.",
  "error.backend.attachBetween": "Đính kèm từ 1 đến {limit} tệp.",
  "error.backend.attachmentNotFile": "Tệp đính kèm không phải là tệp: {path}",
  "error.backend.generatedImageTooLarge": "Ảnh đã tạo vượt quá giới hạn 100 MB.",
  "error.backend.attachmentNotRegularFile": "Chỉ có thể đính kèm tệp thông thường: {name}",
  "error.backend.attachmentCopyFailed": "OpenBot không thể sao chép {name}.",
  "error.backend.routineNameRequired": "Cần có tên nhiệm vụ định kỳ.",
  "error.backend.routineNameTooLong": "Tên nhiệm vụ định kỳ quá dài.",
  "error.backend.routineInstructionRequired": "Cần có chỉ dẫn cho nhiệm vụ định kỳ.",
  "error.backend.routineInstructionTooLong": "Chỉ dẫn của nhiệm vụ định kỳ quá dài.",
  "error.backend.routineScheduleInvalid": "Lịch của nhiệm vụ định kỳ không hợp lệ.",
  "error.backend.routineIntervalTooShort":
    "Khoảng giữa của nhiệm vụ định kỳ phải ít nhất là {minutes} phút. Hãy dùng {minutes} phút trở lên, hoặc lịch hằng ngày, hằng tuần hoặc cron.",
  "error.backend.routineIntervalTooShortFixed":
    "Khoảng giữa của nhiệm vụ định kỳ phải ít nhất là {minutes} phút. Hãy dùng {minutes} phút trở lên, hoặc một giờ cố định.",
  "error.backend.routineCronTooOften": "Lịch tùy chỉnh không được chạy thường xuyên hơn mỗi {minutes} phút.",
  "error.backend.routineAnchorInvalid": "Mốc của khoảng giữa nhiệm vụ định kỳ không hợp lệ.",
  "error.backend.routineNoOccurrence": "Lịch không có lần chạy nào trong năm năm tới.",
  "error.backend.routineOncePassed":
    "Thời điểm của nhiệm vụ định kỳ chạy một lần này đã qua. Hãy chọn ngày hoặc giờ muộn hơn.",
  "error.backend.routineTimezoneInvalid": "Múi giờ của nhiệm vụ định kỳ không hợp lệ.",
  "error.backend.routineCronFields": "Lịch tùy chỉnh phải dùng năm trường cron.",
  "error.backend.routineCronValueInvalid": "Giá trị cron của {field} không hợp lệ.",
  "error.backend.routineCronFieldEmpty": "Trường cron {field} để trống.",
  "error.backend.routineDeletionBusy": "Một thao tác xóa nhiệm vụ định kỳ khác đang chạy cho trợ lý này.",
  "error.backend.routineWaitForAgent": "Hãy đợi thao tác của trợ lý hoàn tất trước khi chạy một nhiệm vụ định kỳ.",
  "error.backend.routineRunStarting":
    "Lần chạy nhiệm vụ định kỳ này vẫn đang khởi động. Hãy thử lại sau khi lượt của nó bắt đầu.",
  "error.backend.routineRunNoSession":
    "OpenBot không thể ngắt lần chạy nhiệm vụ định kỳ đang hoạt động vì phiên nhà cung cấp của nó không khả dụng.",
  "error.backend.interruptSelf": "Một trợ lý không thể tự ngắt chính nó.",
  "error.backend.interruptOtherWork":
    "Trợ lý này đang làm một tác vụ không phải do tin nhắn của bạn bắt đầu. Chỉ người dùng hoặc người gửi tác vụ đó mới có thể dừng nó.",
  "error.backend.interruptStarting": "Trợ lý này vẫn đang bắt đầu một lượt. Hãy thử lại sau khi lượt bắt đầu.",
  "error.backend.interruptNoSession": "OpenBot không thể ngắt trợ lý này vì phiên nhà cung cấp của nó không khả dụng.",
  "error.backend.memoryTextRequired": "Cần có nội dung trí nhớ.",
  "error.backend.memoryTextTooLong": "Nội dung trí nhớ quá dài.",
  "error.backend.mcpServerGone": "Máy chủ MCP này không còn tồn tại.",
  "error.backend.routineFlowLinkGone": "Kết nối này không còn tồn tại.",
  "error.backend.routineFlowSameAgent": "Một trợ lý không thể giao việc cho chính nó.",
  "error.backend.routineFlowIntoOwner":
    "Nhiệm vụ định kỳ bắt đầu bằng trợ lý của chính nó, nên trợ lý đó không thể nhận việc từ trợ lý khác.",
  "error.backend.routineFlowNotOnPath":
    "Trợ lý này chưa thuộc nhiệm vụ định kỳ. Hãy kết nối nó với nhiệm vụ định kỳ trước.",
  "error.backend.routineFlowDuplicate": "Những trợ lý này đã được kết nối trong nhiệm vụ định kỳ này.",
  "error.backend.routineFlowCycle": "Kết nối này sẽ tạo ra một vòng lặp.",
  "error.backend.routineFlowLinkLimit": "Một nhiệm vụ định kỳ chỉ có tối đa {limit} kết nối.",
  "error.backend.agentWaitLimit":
    "Trợ lý này đã có {count} lượt chờ đang mở. Hãy đóng một lượt chờ bằng openbot.close_wait trước khi mở lượt chờ khác.",
  "error.backend.agentWaitGone": "Lượt chờ này không còn mở. Trợ lý đã đóng nó, hoặc ai đó đã hủy nó.",
  "error.backend.agentWaitNoRequest": "Một lượt chờ cần một tin nhắn để tiếp tục. Lượt này không có tin nhắn.",
  "error.backend.agentWaitOwnChatOnly":
    "Chỉ mở lượt chờ trong cuộc trò chuyện của bạn. Tác vụ kênh hoặc nhắn tin không thể chờ.",
  "error.backend.agentWaitNoteRequired": "Hãy ghi một ghi chú ngắn nói lượt chờ dành cho việc gì.",
  "error.backend.agentWaitRoutineGone": "Trợ lý này không có nhiệm vụ định kỳ với id này.",
  "error.backend.agentWaitNoRoutine":
    "Chỉ một lần chạy của một nhiệm vụ định kỳ của bạn mới đánh thức được lượt chờ, và bạn không có nhiệm vụ định kỳ nào. Hãy tạo một nhiệm vụ bằng openbot.create_routine, rồi mở lượt chờ.",
  "error.backend.agentWaitRemoteUnsupported": "Lượt chờ mở chỉ dành cho các trợ lý trên máy tính này.",
  "error.backend.markUnreadRemoteUnsupported":
    "Đánh dấu tin nhắn là chưa đọc chỉ dành cho các trợ lý trên máy tính này.",
  "error.backend.messageDeleteUnsupported": "Máy chủ này không hỗ trợ xóa tin nhắn.",
  "error.backend.messageDeleteNotFound": "Tin nhắn này không có trong cuộc trò chuyện.",
  "error.backend.messageDeleteBusy": "Tin nhắn này thuộc về một lượt đang chạy. Hãy xóa nó khi lượt kết thúc.",
  "error.backend.messageDeleteForbidden": "Bạn chỉ có thể xóa những tin nhắn do bạn gửi.",
  "error.backend.routineFlowHandoffFailed": "Nhiệm vụ định kỳ không thể chuyển việc cho trợ lý này.",
  "error.backend.mcpServerLimit": "OpenBot giữ tối đa {limit} máy chủ MCP.",
  "error.backend.mcpServerNameTaken": "Đã có một máy chủ MCP tên {name}.",
  "error.backend.mcpServerInvalid": "OpenBot không thể lưu cấu hình máy chủ MCP này.",
  "error.backend.mcpServerNoAnswer": "Máy chủ không phản hồi trong {seconds} giây.",
  "error.backend.mcpSignInNotAccepted": "Máy chủ không chấp nhận thông tin đăng nhập đó.",
  "error.backend.mcpSignInClientRefused":
    "Máy chủ đăng nhập không chấp nhận OpenBot khi nó hoàn tất đăng nhập. Hãy đăng nhập lại: OpenBot sẽ đăng ký với máy chủ một lần nữa.",
  "error.backend.mcpCommandNotFound": "Không tìm thấy lệnh: {command}",
  "error.backend.mcpRegistrationRefused":
    "Máy chủ đăng nhập chưa chấp nhận OpenBot làm ứng dụng. Tài khoản của bạn không phải là nguyên nhân. Hãy dùng cách kết nối khác, chẳng hạn một máy chủ MCP cục bộ.",
  "error.backend.mcpSignInAbandonedGeneric": "Việc đăng nhập đã bị bỏ dở.",
  "error.backend.mcpSignInForgotten": "Việc đăng nhập MCP bị quên khi đang chạy.",
  "error.backend.mcpSignInAbandoned": "Việc đăng nhập MCP đã bị bỏ dở.",
  "error.backend.mcpSignInNoBrowser": "Việc đăng nhập MCP này không thể mở trình duyệt.",
  "error.backend.mcpSignInNotWebPage": "Địa chỉ đăng nhập không phải là một trang web.",
  "error.backend.mcpSignInRequired":
    "Máy chủ này yêu cầu bạn đăng nhập. Hãy chọn Đăng nhập để tiếp tục trong trình duyệt của bạn.",
  "error.backend.mcpSignInOnHost":
    "Máy chủ này yêu cầu đăng nhập. Hãy đăng nhập vào nó trong OpenBot trên máy tính chủ.",
  "error.backend.mcpSignInNeedsHttps":
    "Máy chủ này yêu cầu đăng nhập, và OpenBot chỉ đăng nhập qua https. Hãy đổi URL thành {url}.",
  "error.backend.mcpSignInCancelled": "Việc đăng nhập đã bị hủy.",
  "error.backend.mcpSignInTimedOut": "Việc đăng nhập không hoàn tất trong trình duyệt.",
  "error.backend.mcpSignInResponseTimedOut": "Phản hồi đăng nhập không đến kịp thời.",
  "error.backend.mcpSignInMetadataUnreadable":
    "OpenBot không thể đọc thông tin đăng nhập của máy chủ này. Hãy kiểm tra địa chỉ máy chủ rồi thử lại.",
  "error.backend.mcpServerExited":
    "Máy chủ đã dừng trước khi phản hồi. Hãy chạy lệnh trong một terminal để xem lỗi của nó.",
  "error.backend.mcpServerFailedToStart": "Máy chủ không khởi động được: {reason}",
  "error.backend.mcpServerSignInForProvider":
    "{provider} không thể dùng máy chủ MCP {name}, vì máy chủ yêu cầu đăng nhập. Hãy mở cài đặt MCP và chọn Đăng nhập.",
  "error.backend.mcpServerFailedForProvider":
    "{provider} không thể khởi động máy chủ MCP {name}. Hãy mở cài đặt MCP và chọn Kiểm tra kết nối để xem nguyên nhân.",
  "error.backend.mcpOAuthProxyUnavailable":
    "OpenBot không thể khởi động kết nối đăng nhập cục bộ cho máy chủ này. Hãy khởi động lại OpenBot, rồi thử lại.",
  "error.backend.mcpOAuthSignInNeeded":
    "Việc đăng nhập vào máy chủ MCP này đã kết thúc. Người dùng phải đăng nhập vào nó lại trong OpenBot.",
  "error.backend.mcpServerUnreachable": "OpenBot không thể kết nối tới máy chủ. Hãy kiểm tra URL và mạng của bạn.",
  "error.backend.mcpLocalServerOff":
    "Không có máy chủ nào phản hồi tại {address} trên máy tính này. Hãy khởi động máy chủ, hoặc bật nó trong ứng dụng chạy nó, rồi thử lại.",
  "error.backend.mcpServerBlocked":
    "Máy tính này đã chặn kết nối tới máy chủ. Hãy kiểm tra tường lửa hoặc phần mềm bảo mật, rồi thử lại.",
  "error.backend.mcpServerIncompatible":
    "Có thứ gì đó phản hồi tại địa chỉ này, nhưng không phải là máy chủ MCP qua Streamable HTTP. Hãy kiểm tra URL và cập nhật ứng dụng chạy máy chủ.",
  "error.backend.mcpRemoteBridge":
    "{reason} Lệnh này chạy cầu nối mcp-remote. Hãy chọn Streamable HTTP với URL {url} thay thế, và OpenBot sẽ đăng nhập cho bạn.",
  "error.backend.oauthNotHttps":
    "Điểm cuối OAuth {origin} không phải https, nên thông tin đăng nhập không được gửi đi.",
  "error.backend.oauthTooManyRedirects": "Điểm cuối OAuth chuyển hướng quá nhiều lần.",
  "error.backend.oauthRedirectOrigin":
    "Điểm cuối OAuth chuyển hướng tới {origin}, nên thông tin đăng nhập không được chuyển tiếp.",
  "error.backend.oauthTimedOut": "Điểm cuối OAuth {origin} không phản hồi kịp thời.",
  "error.backend.oauthResponseTooLarge": "Điểm cuối OAuth {origin} đã gửi một phản hồi quá lớn.",
  "error.backend.oauthResponseUnreadable": "Không thể đọc phản hồi của điểm cuối OAuth {origin}.",
  "error.backend.mcpOAuthPrivateEndpoint":
    "Điểm cuối OAuth {origin} nằm trong một mạng riêng, nhưng máy chủ MCP là công khai, nên thông tin đăng nhập không được gửi đi.",
  "error.backend.sidebarSectionLimit": "Một máy chủ chỉ có tối đa {limit} mục trong thanh bên.",
  "error.backend.sectionNameRequired": "Cần có tên mục.",
  "error.backend.sectionNameTooLong": "Tên mục quá dài.",
  "error.backend.sidebarFolderTooDeep": "Thư mục chỉ có thể sâu tối đa ba cấp.",
  "error.backend.sidebarFolderMoveInvalid": "Không thể chuyển thư mục này sang đó.",
  "error.backend.sectionNameDuplicate": "Tên mục phải là duy nhất.",
  "error.backend.directMessageRequired": "Hãy viết một tin nhắn trước.",
  "error.backend.directMessageTooLong": "Một tin nhắn trực tiếp chỉ có tối đa {limit} ký tự.",
  "error.backend.directMessageSelf": "Bạn không thể gửi tin nhắn trực tiếp cho chính mình.",
  "error.backend.readBoundaryUnavailable": "Ranh giới đã đọc không còn khả dụng.",
  "error.backend.sharedFileOutside": "Tệp dùng chung phải nằm trong thư mục dùng chung.",
  "error.backend.sharedPathIsFolder": "Đường dẫn dùng chung là một thư mục, không phải tệp.",
  "error.backend.sharedPathNotFile": "Đường dẫn dùng chung không phải là tệp.",
  "error.backend.workspaceFileOutside": "Tệp trong không gian làm việc phải nằm trong không gian làm việc của trợ lý.",
  "error.backend.workspacePathNotFile": "Đường dẫn trong không gian làm việc không phải là tệp.",
  "error.backend.workspacePathNotDirectory": "Đường dẫn trong không gian làm việc không phải là thư mục.",
  "error.backend.workspacePathMissing": "Không có gì tồn tại ở {path} trong không gian làm việc của trợ lý {root}.",
  "error.backend.workspacePathMissingForMember": "Không có gì tồn tại ở {path} trong không gian làm việc của trợ lý.",
  "error.backend.useChannelTaskControls": "Hãy dùng các nút điều khiển tác vụ của kênh cho phân công này.",
  "error.backend.editFinished": "Bản sửa này đã hoàn tất.",
  "error.backend.editCancelled": "Bản sửa này đã bị hủy, nên tin nhắn giữ nguyên văn bản gốc.",
  "error.backend.editSaved": "Bản sửa này đã được lưu.",
  "error.backend.editSavedDifferent": "Bản sửa này đã được lưu với nội dung khác. Thay đổi của bạn chưa được lưu.",
  "error.backend.useChannelTaskControlsWork": "Hãy dùng các nút điều khiển tác vụ của kênh cho công việc trong kênh.",
  "error.backend.steerTurnChanged": "Lượt đang hoạt động đã thay đổi trước khi tin nhắn này có thể được dẫn hướng.",
  "error.backend.steerUnsupported":
    "Nhà cung cấp này không thể dẫn hướng một lượt đang chạy. Tin nhắn của bạn vẫn nằm trong hàng đợi.",
  "error.backend.steerRoutineRun":
    "Một nhiệm vụ định kỳ đang chạy. Tin nhắn của bạn vẫn nằm trong hàng đợi và bắt đầu sau nhiệm vụ đó.",
  "error.backend.steerQueuedOnly": "Chỉ tin nhắn trong hàng đợi mới có thể được dẫn hướng.",
  "error.backend.promptInactive": "Câu lệnh này không còn hoạt động.",
  "error.backend.promptAnswerMismatch": "Câu trả lời không khớp với một câu hỏi đang hoạt động.",
  "error.backend.uiBlockAnswerInvalid": "Câu trả lời này không hợp với khối của trợ lý.",
  "error.backend.uiBlockActionNotAllowed": "Chỉ chủ sở hữu máy chủ hoặc quản trị viên mới có thể chọn hành động này.",
  "error.backend.approvalInactive": "Lần phê duyệt này không còn hoạt động.",
  "error.backend.approvalOwnerOnly": "Chỉ chủ sở hữu máy chủ mới có thể phê duyệt hành động này.",
  "error.backend.takeoverInactive": "Lần tiếp quản trình duyệt này không còn hoạt động.",
  "error.backend.authSubmitting": "Yêu cầu xác thực đã đang được gửi.",
  "error.backend.apiKeySaveFailed": "OpenBot không thể lưu khóa API. Hãy thử lại.",
  "error.backend.apiKeyNotAllowed": "Chỉ chủ sở hữu máy chủ hoặc quản trị viên mới có thể nhập khóa API.",
  "error.backend.apiKeySaving": "Khóa API đã đang được lưu.",
  "error.backend.vaultItemNotAllowed": "Chỉ chủ sở hữu máy chủ hoặc quản trị viên mới có thể thêm một mục vào Kho.",
  "error.backend.vaultItemSaving": "Mục trong Kho đã đang được lưu.",
  "error.backend.authRequestInactive": "Yêu cầu xác thực bảo mật này không còn hoạt động.",
  "error.backend.secureAuthUnavailable": "Xác thực bảo mật không khả dụng.",
  "error.backend.browserUrlRequired": "Cần có URL trình duyệt.",
  "error.backend.browserUrlTooLong": "URL trình duyệt quá dài.",
  "error.backend.browserTabLimit": "Trình duyệt chỉ có tối đa {limit} thẻ đang mở.",
  "error.backend.browserProfileMissing":
    "Hồ sơ trình duyệt của trợ lý này không còn tồn tại. Hãy chọn hồ sơ khác trong cài đặt trợ lý.",
  "error.backend.browserProfileNotFound": "Hồ sơ trình duyệt này không còn tồn tại.",
  "error.backend.browserProfileNameTaken": "Đã có một hồ sơ trình duyệt với tên này.",
  "error.backend.browserSessionInUse": "Một thẻ vẫn đang dùng phiên trình duyệt này. Hãy thử lại.",
  "error.backend.browserProfileLimit": "Bạn chỉ có tối đa {limit} hồ sơ trình duyệt.",
  "error.backend.browserProxyNotFound": "Proxy này không còn tồn tại.",
  "error.backend.browserProxyAddressInvalid":
    "Nhập địa chỉ proxy, ví dụ socks5://host:1080 hoặc http://user:password@host:3128.",
  "error.backend.browserProxyLimit": "Bạn chỉ có tối đa {limit} proxy.",
  "error.backend.browserProxyTaken": "Đã có một proxy với địa chỉ này.",
  "error.backend.browserProxyChanged": "Proxy này đã thay đổi sau khi bạn mở nó. Hãy xem lại nó, rồi thử lại.",
  "error.backend.browserProxyUnreachable": "Proxy {name} không phản hồi, nên trang không mở được.",
  "error.backend.browserProxySignInRefused": "Proxy {name} từ chối đăng nhập, nên trang không mở được.",
  "error.backend.browserProxyComputerUnreachable":
    "Máy tính mà hồ sơ này dùng không phản hồi, nên trang không mở được.",
  "error.backend.browserCertificateUntrusted":
    "Chứng thư bảo mật của trang này không được tin cậy, nên trang không mở được.",
  "error.backend.browserLowMemory":
    "Máy chủ này cạn bộ nhớ, nên trình duyệt không thể mở thêm một thẻ. Hãy đóng một thẻ, hoặc đợi các trợ lý khác hoàn tất.",
  "error.backend.browserOpenFailed": "Không thể mở {url}: {reason}",
  "error.backend.popupSecureInput":
    "Cửa sổ bật lên bị chặn trong khi nhập dữ liệu bảo mật. Hãy hoàn tất hoặc hủy việc nhập dữ liệu bảo mật, rồi thử lại từ trang.",
  "error.backend.popupUnsupportedType":
    "Loại cửa sổ bật lên này không được hỗ trợ. Hãy dùng một liên kết thường hoặc nút đăng nhập trên trang.",
  "error.backend.popupUnsupportedAddress":
    "Cửa sổ bật lên này dùng một địa chỉ không được hỗ trợ. Hãy dùng một tùy chọn đăng nhập HTTP hoặc HTTPS trên trang.",
  "error.backend.popupTabLimit": "Đã đạt giới hạn thẻ trình duyệt. Hãy đóng một thẻ, rồi thử lại từ trang.",
  "error.backend.popupLoadFailed": "Không thể tải cửa sổ bật lên. Hãy thử lại việc đăng nhập từ trang ban đầu.",
  "error.backend.browserTabNotFound": "Không tìm thấy thẻ trình duyệt.",
  "error.backend.authActive": "Xác thực đã đang hoạt động.",
  "error.backend.authHttpsRequired": "Xác thực bảo mật cần HTTPS.",
  "error.backend.authDigitsRange": "Mã xác thực cần 4–12 chữ số.",
  "error.backend.authExpired": "Yêu cầu xác thực đã hết hạn.",
  "error.backend.authDigitsRequired": "Nhập số chữ số được yêu cầu.",
  "error.backend.browserViewProtected": "Chế độ xem trình duyệt được bảo vệ trong khi xác thực.",
  "error.backend.browserPreviewPageChanged": "Trang trình duyệt đã thay đổi trong khi xem trước. Hãy thử lại.",
  "error.backend.browserInputProtected": "Phần nhập của trình duyệt được bảo vệ trong khi xác thực.",
  "error.backend.browserTypingFocusMoved":
    "Trang đã chuyển tiêu điểm khỏi mục tiêu trước khi nhập. Không có gì được nhập. Hãy đọc lại trang.",
  "error.backend.browserTypingFocusMovedWhileTyping":
    "Trang đã chuyển tiêu điểm khỏi trước khi nhập hết văn bản. Chỉ phần đầu của văn bản nằm trong ô nhập. Hãy đọc lại trang và kiểm tra ô nhập trước khi nhập lại.",
  "error.backend.browserTypingSubmitSkipped":
    "Văn bản đã nằm trong ô nhập, nhưng trang đã chuyển tiêu điểm khỏi, nên phím Enter không được gửi. Đừng nhập lại văn bản. Hãy đọc lại trang.",
  "error.backend.mcpServerHttpCredentials":
    "Máy chủ đã phản hồi {status}. Hãy kiểm tra khóa API hoặc thông tin đăng nhập khác.",
  "error.backend.mcpServerHttpUrl":
    "Máy chủ đã phản hồi {status}. Hãy kiểm tra URL. Liên kết có thể sai, đã hết hạn hoặc đã bị xóa.",
  "error.backend.mcpSignInAppUrl": "Ứng dụng đăng nhập cần một URL máy chủ hợp lệ.",
  "error.backend.mcpSignInAppClientId": "Nhập client ID của ứng dụng đăng nhập.",
  "error.backend.mcpSignInAppIssuerChanged":
    "Máy chủ đăng nhập của máy chủ MCP này đã thay đổi, nên OpenBot không gửi ứng dụng đăng nhập cho nó. Nếu thay đổi là đúng, hãy gỡ ứng dụng đăng nhập rồi thêm lại.",
  "error.backend.mcpSignInAppNoServer":
    "Hãy lưu máy chủ MCP này dưới dạng máy chủ URL trước khi thêm ứng dụng đăng nhập.",
  "error.backend.mcpSignInAppUnavailable": "Máy tính này không thể lưu giữ ứng dụng đăng nhập.",
  // Tasks: conversations of one agent that run beside its own chat.
  "error.backend.taskMoveRefused": "Chỉ tin nhắn bạn gửi riêng cho trợ lý này mới có thể chạy thành tác vụ.",
  "error.backend.taskNotFound": "Tác vụ này không khả dụng.",
  "error.backend.taskClosed": "Tác vụ này đã đóng. Hãy mở lại nó để gửi tin nhắn.",
  "error.backend.taskStillRunning": "Tác vụ này vẫn đang chạy. Hãy đợi nó dừng, rồi đóng nó.",
  // Side threads. Hosts before side threads send the task texts above, so those keys stay.
  "error.backend.threadNotFound": "Luồng này không khả dụng.",
  "error.backend.threadStillRunning": "Luồng này vẫn đang chạy. Hãy dừng nó, rồi thử lại.",
  "error.backend.threadArchived": "Luồng này đã được lưu trữ. Hãy khôi phục nó để gửi tin nhắn.",
  "error.backend.threadTitleRequired": "Hãy đặt một tiêu đề ngắn cho luồng.",
  "error.backend.threadOpenLimitReached":
    "Trợ lý này có {count} luồng đang mở. Hãy lưu trữ một luồng, rồi bắt đầu hoặc khôi phục luồng khác.",
  "error.backend.threadRemoteUnsupported": "Luồng chỉ dành cho các trợ lý trên máy tính này.",
  "error.backend.branchSourceBusy": "Hãy dừng lượt hiện tại trước khi tạo nhánh cho cuộc trò chuyện này.",
  "error.backend.branchMessageNotFound": "Bạn chỉ có thể tạo nhánh từ một câu trả lời đã hoàn tất của trợ lý.",
  "error.backend.branchRemoteUnsupported": "Nhánh chỉ dành cho các trợ lý trên máy tính này.",
  "error.backend.threadMoveRefused": "Chỉ tin nhắn bạn gửi riêng cho trợ lý này mới có thể chạy trong một luồng mới.",
  "error.backend.taskTitleRequired": "Hãy đặt một tiêu đề ngắn cho tác vụ.",
  "error.backend.taskToolInvalid": "Hãy đặt cho tác vụ một tiêu đề tối đa 120 ký tự và một mô tả ngắn nói cần làm gì.",
  "error.backend.taskOwnChatOnly":
    "Chỉ bắt đầu tác vụ từ cuộc trò chuyện của bạn. Một kênh, một cuộc hội thoại nhắn tin hoặc một tác vụ khác không thể bắt đầu tác vụ.",
  "error.backend.taskUnfinishedLimit":
    "Trợ lý này đã có {count} tác vụ chưa hoàn tất. Hãy bắt đầu tác vụ khác khi một tác vụ kết thúc.",
  "error.backend.taskOpenLimitReached":
    "Trợ lý này có {count} tác vụ đang mở. Hãy đóng một tác vụ, rồi bắt đầu hoặc mở tác vụ khác.",
  "error.backend.taskRemoteUnsupported": "Tác vụ chỉ dành cho các trợ lý trên máy tính này.",
  "error.backend.taskStartFailed": "OpenBot không thể bắt đầu tác vụ. Hãy làm việc đó trong lượt này.",
} as const satisfies PartialTranslation<typeof source>;
