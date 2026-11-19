import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/backend";

export const messages = {
  "error.backend.eventsUnavailable": "Host này không hỗ trợ sự kiện.",
  "error.backend.databaseIntegrity": "Cơ sở dữ liệu OpenBot không vượt qua kiểm tra tính toàn vẹn.",
  "error.backend.webhookRouteLimit": "Một host chỉ có thể có tối đa {limit} tác vụ định kỳ webhook.",
  "error.backend.webhookSettingsInvalid": "Hãy kiểm tra cài đặt webhook và thử lại.",
  "error.backend.webhookSenderSecretInvalid":
    "Hãy dán toàn bộ khóa ký (signing secret) từ bên gửi. Khóa dài từ 16 đến 1024 ký tự và không có dấu cách.",
  "error.backend.webhookRouteUnavailable":
    "Đường dẫn webhook công khai chưa sẵn sàng. Hãy kiểm tra kết nối của host và thử lại.",
  "error.backend.webhookTestUnavailable":
    "Host hiện không thể nhận sự kiện thử. Hãy đảm bảo host đã đăng nhập, rồi thử lại.",
  "error.backend.webhookTestFailed": "Sự kiện thử không đến được tác vụ định kỳ. Hãy thử lại.",
  "error.backend.browserViewRemoteOnly": "Chế độ xem trình duyệt trực tiếp chỉ dành cho host từ xa.",
  "error.backend.browserViewUnsupported": "Host từ xa này không hỗ trợ chế độ xem trình duyệt trực tiếp.",
  "error.backend.browserViewLimit": "Có quá nhiều chế độ xem trình duyệt đang mở trên host này.",
  "error.backend.browserViewEnded": "Chế độ xem trực tiếp của trang này đã kết thúc.",
  "error.backend.browserViewFailed": "Chế độ xem trực tiếp của trang này thất bại.",
  "error.backend.windowTemporarilyUnavailable": "Cửa sổ OpenBot tạm thời không khả dụng.",
  "error.backend.windowUnavailable": "Cửa sổ OpenBot không khả dụng.",
  "error.backend.sunshineApiHttp": "API Sunshine thất bại với HTTP {status}.",
  "error.backend.sunshinePortsUnavailable": "Không thể dành riêng một nhóm cổng Sunshine trống cho Remote Desktop.",
  "error.backend.moonlightPortsUnavailable":
    "Không thể dành riêng một dải cổng WebRTC Moonlight trống cho Remote Desktop.",
  "error.backend.iceServerNoPort": "Máy chủ ICE của Remote Desktop không nhận được cổng.",
  "error.backend.remoteDesktopStoppedWhileStarting": "Môi trường chạy remote desktop đã bị dừng trong lúc khởi động.",
  "error.backend.sunshineNotStarted": "Sunshine không khởi động trên nhóm cổng đã dành riêng.",
  "error.backend.moonlightNoHost": "Moonlight không có host cục bộ nào đã ghép nối.",
  "error.backend.sunshineNoDesktop": "Sunshine không công bố ứng dụng Desktop.",
  "error.backend.sunshineAmbiguousPairing": "Sunshine trả về các yêu cầu ghép nối cục bộ không rõ ràng.",
  "error.backend.sunshineNoPairingRequest": "Sunshine không nhận được yêu cầu ghép nối cục bộ như mong đợi.",
  "error.backend.moonlightPairingHttp": "Ghép nối Moonlight thất bại với HTTP {status}.",
  "error.backend.moonlightRejectedPairing": "Moonlight đã từ chối ghép nối Sunshine.",
  "error.backend.moonlightNoPin": "Moonlight không trả về mã PIN ghép nối.",
  "error.backend.moonlightPairingIncomplete": "Ghép nối Moonlight chưa hoàn tất.",
  "error.backend.moonlightWebNotEmbedded": "Moonlight Web không phải là bản build nhúng của OpenBot.",
  "error.backend.moonlightEmptyResponse": "Moonlight trả về phản hồi trống.",
  "error.backend.remoteDesktopTimeout": "Yêu cầu remote desktop đã hết thời gian chờ.",
  "error.backend.moonlightApiHttp": "API Moonlight thất bại với HTTP {status}.",
  "error.backend.sunshineExited": "Sunshine đã thoát trước khi API HTTPS trên cổng {port} sẵn sàng.",
  "error.backend.sunshineNoAnswer": "Sunshine không phản hồi.",
  "error.backend.sunshineTlsUnexpected": "Sunshine trả về chứng chỉ TLS không mong đợi.",
  "error.backend.moonlightWebExited": "Moonlight Web đã thoát trước khi {url} sẵn sàng.",
  "error.backend.moonlightWebNotReady": "Moonlight Web chưa sẵn sàng.",
  "error.backend.channelDeleteUnsupported": "Máy chủ này không hỗ trợ xóa kênh.",
  "error.backend.browserNavigateUnsupported":
    "Host từ xa này không hỗ trợ điều hướng bằng thanh địa chỉ trong thẻ đang mở.",
  "error.backend.browserUserControlBusy": "Thẻ trình duyệt này đang chờ một bí mật. Hãy trả lời yêu cầu bí mật trước.",
  "error.backend.browserTeachBusy": "Một người khác đang điều khiển thẻ trình duyệt này. Hãy thử lại khi họ xong.",
  "error.backend.browserTeachUnavailable": "Thẻ trình duyệt này không có agent nào có thể học tác vụ.",
  "error.backend.browserTeachUnsupported": "Host từ xa này không hỗ trợ ghi lại tác vụ.",
  "error.backend.browserUserControlUnsupported": "Host từ xa này không hỗ trợ tiếp quản thẻ trình duyệt.",
  "error.backend.browserSignInUnsupported": "Host từ xa này không thể nhận thông tin đăng nhập từ máy tính này.",
  "error.backend.browserSignInOpenFailed": "OpenBot không thể mở cửa sổ đăng nhập.",
  "error.backend.browserSignInReadFailed": "OpenBot không thể đọc thông tin đăng nhập từ cửa sổ.",
  "error.backend.browserStopUnsupported": "Host từ xa này không thể dừng tải trang.",
  "error.backend.sharedDataLocalOnly": "Dữ liệu dùng chung được quản lý trên máy tính chạy các agent này.",
  "error.backend.browserUrlProtocol": "Chỉ cho phép URL trình duyệt HTTP(S).",
  "error.backend.sunshineNotReady": "Sunshine chưa sẵn sàng.",
  "error.backend.sunshineNotReadyReason": "Sunshine chưa sẵn sàng. {reason}",
  "error.backend.channelLeadModelUnavailable": "Mô hình của trưởng nhóm kênh không khả dụng.",
  "error.backend.contextCompactionIneffective":
    "Thu gọn không làm cuộc trò chuyện này nhỏ hơn: sau hai lần thu gọn, nó vẫn dùng {percent}% cửa sổ ngữ cảnh của mô hình, nên OpenBot ngừng thu gọn. Công cụ và hướng dẫn chiếm phần lớn cửa sổ. Hãy tắt các máy chủ MCP hoặc điều khiển máy tính mà agent này không cần, hoặc chọn mô hình có cửa sổ lớn hơn. Sau đó bắt đầu cuộc trò chuyện mới.",
  "error.backend.contextCompactionStopped":
    "Hai lần thu gọn cuộc trò chuyện này liên tiếp thất bại, nên OpenBot ngừng tự động thu gọn. Mỗi lần thử sẽ gửi toàn bộ cuộc trò chuyện tới mô hình và dùng hạn mức gói của bạn. Hãy chọn Thu gọn ngay để thử lại, hoặc bắt đầu cuộc trò chuyện mới.",
  "error.backend.providerModelAtCapacity":
    "Mô hình đang quá tải. Nhà cung cấp sẽ thử lại sau vài phút. Để tiếp tục ngay, hãy dừng lượt và chọn mô hình khác.",
  "error.backend.providerRetrying":
    "Nhà cung cấp đã thất bại {attempts} lần với yêu cầu này và đang thử lại. Nếu agent không tiếp tục, hãy dừng lượt.",
  "error.backend.providerRetryingLargeContext":
    "Nhà cung cấp đã thất bại {attempts} lần với yêu cầu này và đang thử lại. Cuộc trò chuyện này dùng {percent}% cửa sổ ngữ cảnh của mô hình. Nếu agent không tiếp tục, hãy dừng lượt: OpenBot sẽ thu gọn cuộc trò chuyện trước tin nhắn tiếp theo.",
  "error.backend.sharedDataUnavailable": "Dữ liệu dùng chung không khả dụng.",
  "error.backend.shuttingDown": "OpenBot đang tắt.",
  "error.backend.channelUnconfirmedStart":
    "Kênh có một lượt giao việc bắt đầu chưa được xác nhận. Hãy kiểm tra kết quả trước khi xóa kênh.",
  "error.backend.channelNotFound": "Không tìm thấy kênh.",
  "error.backend.channelMemberUnavailable": "Một thành viên của kênh không khả dụng.",
  "error.backend.channelInstructionsTooLong":
    "Hãy rút gọn hướng dẫn xuống 2.000 ký tự. Hướng dẫn dài hơn sẽ không được lưu.",
  "error.backend.channelWaitBeforeNewConversation":
    "Hãy đợi công việc trong kênh này dừng, rồi bắt đầu cuộc trò chuyện mới.",
  "error.backend.channelWaitBeforeCompact": "Hãy đợi công việc trong kênh này dừng, rồi thu gọn kênh.",
  "error.backend.channelWaitBeforeDeleteHistory": "Hãy đợi công việc trong kênh này dừng, rồi xóa lịch sử.",
  "error.backend.channelCompactUnavailable":
    "Hiện không thành viên nào của kênh này có thể thu gọn ngữ cảnh. Một thành viên phải trả lời trong kênh trước, và nhà cung cấp của thành viên đó phải hỗ trợ thu gọn.",
  "error.backend.channelCompactNoSession":
    "Các thành viên của kênh này chưa có cuộc trò chuyện nào để thu gọn. Hãy thu gọn sau khi một thành viên trả lời trong kênh.",
  "error.backend.channelCompactNotSupported":
    "Không thành viên nào của kênh này có thể thu gọn theo yêu cầu. Các thành viên hỗ trợ sẽ tự động thu gọn ngữ cảnh khi gần đầy.",
  "error.backend.channelArchived": "Hãy khôi phục kênh này trước khi gửi tin nhắn hoặc thay đổi tác vụ.",
  "error.backend.channelArchiveRunning": "Hãy dừng công việc đang chạy trong kênh này, rồi xóa kênh.",
  "error.backend.channelReferenceUnavailable": "Tin nhắn kênh được tham chiếu không khả dụng.",
  "error.backend.channelTaskNotFound": "Không tìm thấy tác vụ của kênh.",
  "error.backend.channelTaskComplete": "Tác vụ này đã hoàn tất.",
  "error.backend.channelTaskNotStopped": "Chỉ có thể hủy tác vụ đã dừng hoặc thất bại.",
  "error.backend.channelSelectAgent": "Hãy chọn một agent.",
  "error.backend.channelLeadRequired":
    "Hãy chọn một trưởng nhóm kênh khả dụng hoặc giao tác vụ này cho một thành viên.",
  "error.backend.channelRoutingTooLong":
    "Yêu cầu này vượt quá giới hạn ngữ cảnh điều phối. Hãy chọn một thành viên hoặc gửi yêu cầu ngắn hơn.",
  "error.backend.channelTaskMemberRequired": "Hãy chọn một thành viên cho tác vụ này.",
  "error.backend.channelTaskStopped": "Đã dừng. Hãy tiếp tục hoặc giao lại tác vụ này.",
  "error.backend.channelRoutingUnreadable":
    "Trưởng nhóm không thể điều phối tin nhắn này. Hãy giao lại cho một thành viên.",
  "error.backend.channelRoutingFailed": "Điều phối thất bại. Hãy chọn một thành viên hoặc thử lại.",
  "error.backend.channelLeadTimedOut": "Trưởng nhóm kênh không trả lời kịp. Hãy chọn một thành viên hoặc thử lại.",
  "error.backend.channelLeadFailed":
    "Trưởng nhóm kênh không thể điều phối tin nhắn này. Hãy chọn một thành viên hoặc thử lại.",
  "error.backend.channelRequestMemberRequired": "Hãy chọn một thành viên cho yêu cầu này.",
  "error.backend.channelDeliveryNotCreated": "Chưa tạo được lượt gửi trong kênh.",
  "error.backend.channelAssignmentStopped": "Lượt giao việc trong kênh này đã bị dừng hoặc thay thế.",
  "error.backend.channelAssigneeUnavailable": "Agent được giao không khả dụng.",
  "error.backend.channelAssigneeRemoved": "Thành viên được giao đã bị xóa.",
  "error.backend.channelAssigneeReassign": "Thành viên được giao không khả dụng. Hãy giao lại tác vụ này.",
  "error.backend.channelAssignmentChanged": "Lượt giao việc trong kênh này đã thay đổi.",
  "error.backend.channelMemberRequired": "Hãy chọn một thành viên khả dụng của kênh này.",
  "error.backend.memoryEssentialBudget":
    "Các mục bộ nhớ thiết yếu vượt quá giới hạn prompt. Hãy đặt một mục thành tìm kiếm khi cần, rồi thử lại.",
  "error.backend.memorySelectionConflict": "Bộ nhớ đã thay đổi. Hãy tải lại và thử lại.",
  "error.backend.memorySelectionUserControlled":
    "Người dùng kiểm soát lựa chọn bộ nhớ này. Hãy giữ lựa chọn của người dùng.",
  "error.backend.memorySearchQuery": "Hãy nhập một hoặc nhiều từ tìm kiếm, tối đa 256 ký tự.",
  "error.backend.memoryOperationFailed": "Thao tác bộ nhớ thất bại. Hãy thử lại.",
  "error.backend.memoryGone": "Mục bộ nhớ này không còn tồn tại.",
  "error.backend.routineGone": "Tác vụ định kỳ này không còn tồn tại.",
  "error.backend.routineRunGone": "Lượt chạy tác vụ định kỳ này không còn tồn tại.",
  "error.backend.routineRunFailedNoReason":
    "Lượt chạy đã dừng do lỗi nhưng không kèm lý do. Hãy mở lượt chạy để xem agent đã làm gì.",
  "error.backend.turnNotStarted": "Nhà cung cấp không bắt đầu lượt này.",
  "error.backend.routineResultConnectionOff": "Kết nối nhắn tin này đã tắt hoặc bị xóa. Hãy chọn nơi khác.",
  "error.backend.routineResultNoDelivery": "Lượt chạy này không có câu trả lời nào để gửi lại.",
  "error.backend.channelMemoryLimit": "Một kênh chỉ có thể có tối đa {limit} mục bộ nhớ.",
  "error.backend.channelRoutineLimit": "Một kênh chỉ có thể có tối đa {limit} tác vụ định kỳ.",
  "error.backend.agentRoutineLimit": "Một agent chỉ có thể có tối đa {limit} tác vụ định kỳ.",
  "error.backend.agentMemoryLimit": "Một agent chỉ có thể có tối đa {limit} mục bộ nhớ.",
  "error.backend.agentMemoryLimitReached":
    "Bạn có {saved}/{limit} mục bộ nhớ. Để có chỗ trống, hãy cập nhật một mục bộ nhớ theo memoryId bằng nội dung gộp của hai mục liên quan, rồi quên mục còn lại, hoặc quên một mục không còn đúng. Sau đó thử lại.",
  "error.backend.agentMemoryLimitExceeded":
    "Bạn có {saved} mục bộ nhớ, và giới hạn là {limit}. Người dùng đã đặt giới hạn thấp hơn số mục bộ nhớ đã lưu. Không được quên mục bộ nhớ để lấy chỗ. Hãy báo cho người dùng rằng mục bộ nhớ này chưa được lưu.",
  "error.backend.channelHistoryArriving": "Một tin nhắn dùng chung vẫn đang đến. Hãy tiếp tục khi tin nhắn đến đủ.",
  "error.backend.channelHistoryLeadRequired": "Hãy chọn một trưởng nhóm kênh để chuẩn bị lịch sử dùng chung.",
  "error.backend.channelHistoryInvalid": "Bản tóm tắt lịch sử không hợp lệ. Hãy tiếp tục để thử lại.",
  "error.backend.channelContextTooLong":
    "Lượt giao việc này vượt quá giới hạn ngữ cảnh dùng chung. Hãy gửi yêu cầu ngắn hơn hoặc giao lại.",
  "error.backend.draftAttachmentLimit": "Chỉ giữ tối đa {limit} tệp đính kèm nháp.",
  "error.backend.recipientRequired": "Cần ít nhất một người nhận.",
  "error.backend.recipientLimit": "Một tin nhắn chỉ có thể có tối đa {limit} người nhận.",
  "error.backend.attachmentDraftGone": "Tệp đính kèm nháp không còn tồn tại: {id}",
  "error.backend.attachmentInQueueEdit": "Một tệp đính kèm thuộc về một lượt sửa hàng đợi.",
  "error.backend.messageEmpty": "Tin nhắn không được để trống.",
  "error.backend.attachLimit": "Chỉ đính kèm tối đa {limit} tệp.",
  "error.backend.queuedMessageNotFound": "Không tìm thấy tin nhắn trong hàng đợi.",
  "error.backend.cancelQueuedOnly": "Chỉ có thể hủy tin nhắn trong hàng đợi.",
  "error.backend.messageBeingEdited": "Tin nhắn này đang được sửa. Hãy lưu hoặc hủy bản sửa trước.",
  "error.backend.queuedMessageUnavailable": "Tin nhắn trong hàng đợi này không còn khả dụng.",
  "error.backend.editedOnOtherDevice": "Tin nhắn này đang được sửa trên thiết bị khác.",
  "error.backend.editUnavailable": "Bản sửa này không còn khả dụng.",
  "error.backend.attachmentInOtherEdit": "Một tệp đính kèm thuộc về một bản sửa khác.",
  "error.backend.messageBeingSaved": "Tin nhắn này đang được lưu. Hãy thử lại sau khi lưu xong.",
  "error.backend.editQueuedOnly": "Chỉ có thể sửa tin nhắn trong hàng đợi.",
  "error.backend.attachmentNotInMessage": "Một tệp đính kèm không thuộc về tin nhắn trong hàng đợi.",
  "error.backend.queueOrderStale": "Thứ tự hàng đợi đã cũ. Hãy làm mới hàng đợi và thử lại.",
  "error.backend.fileGone": "Tệp không tồn tại hoặc đã bị xóa.",
  "error.backend.managedAttachmentChanged": "Tệp đính kèm được quản lý bị thiếu hoặc đã thay đổi: {name}",
  "error.backend.mailboxStateCorrupt":
    "Trạng thái hộp thư bị hỏng hoặc đến từ phiên bản OpenBot mới hơn; từ chối ghi đè.",
  "error.backend.recipientDeleting": "Người nhận đang bị xóa. Hãy thử lại sau khi xóa xong.",
  "error.backend.recipientHidden": "Agent này đang bị ẩn. Hãy khôi phục để gửi tin nhắn.",
  "error.backend.agentIdUnknown": "Không có agent nào có id {id}. Hãy lấy id từ openbot.list_agents, rồi thử lại.",
  "error.backend.agentIdNear":
    "Không có agent nào có id {id}. Agent {name} có id {nearId}, gần như giống hệt. Nếu bạn muốn nói tới agent đó, hãy thử lại với id của nó.",
  "error.backend.replyReferenceUnknown":
    "replyToMessageId {id} không trỏ tới tin nhắn nào. Hãy dùng Message ID của tin nhắn mà bạn trả lời, hoặc bỏ replyToMessageId.",
  "error.backend.replyReferenceRequests": "Tin nhắn từ những người nhận này trong lượt này: {ids}.",
  "error.backend.attachBetween": "Hãy đính kèm từ 1 đến {limit} tệp.",
  "error.backend.attachmentNotFile": "Tệp đính kèm không phải là tệp: {path}",
  "error.backend.generatedImageTooLarge": "Hình ảnh được tạo vượt quá giới hạn 100 MB.",
  "error.backend.generatedVideoTooLarge": "Video được tạo vượt quá giới hạn 100 MB.",
  "error.backend.videoGenerationFailed": "Tạo video thất bại.",
  "error.backend.videoGenerationNoVideo": "Tạo video không trả về video nào.",
  "error.backend.videoGenerationInterrupted": "Tạo video bị gián đoạn.",
  "error.backend.attachmentNotRegularFile": "Chỉ có thể đính kèm tệp thông thường: {name}",
  "error.backend.attachmentCopyFailed": "OpenBot không thể sao chép {name}.",
  "error.backend.routineNameRequired": "Cần có tên tác vụ định kỳ.",
  "error.backend.routineNameTooLong": "Tên tác vụ định kỳ quá dài.",
  "error.backend.routineInstructionRequired": "Cần có hướng dẫn cho tác vụ định kỳ.",
  "error.backend.routineInstructionTooLong": "Hướng dẫn cho tác vụ định kỳ quá dài.",
  "error.backend.routineScheduleInvalid": "Lịch chạy của tác vụ định kỳ không hợp lệ.",
  "error.backend.routineIntervalTooShort":
    "Khoảng thời gian của tác vụ định kỳ phải ít nhất {minutes} phút. Hãy dùng {minutes} phút trở lên, hoặc lịch hằng ngày, hằng tuần hay cron.",
  "error.backend.routineIntervalTooShortFixed":
    "Khoảng thời gian của tác vụ định kỳ phải ít nhất {minutes} phút. Hãy dùng {minutes} phút trở lên, hoặc một thời điểm cố định.",
  "error.backend.routineCronTooOften": "Lịch tùy chỉnh không được chạy thường xuyên hơn mỗi {minutes} phút.",
  "error.backend.routineAnchorInvalid": "Mốc thời gian của khoảng lặp không hợp lệ.",
  "error.backend.routineNoOccurrence": "Lịch này không có lần chạy nào trong năm năm tới.",
  "error.backend.routineOncePassed":
    "Thời điểm của tác vụ định kỳ chạy một lần này đã qua. Hãy chọn ngày hoặc giờ muộn hơn.",
  "error.backend.routineTimezoneInvalid": "Múi giờ của tác vụ định kỳ không hợp lệ.",
  "error.backend.routineCronFields": "Lịch tùy chỉnh phải dùng năm trường cron.",
  "error.backend.routineCronValueInvalid": "Giá trị cron {field} không hợp lệ.",
  "error.backend.routineCronFieldEmpty": "Trường cron {field} đang trống.",
  "error.backend.routineDeletionBusy": "Một thao tác xóa tác vụ định kỳ khác đang diễn ra cho agent này.",
  "error.backend.routineWaitForAgent": "Hãy đợi thao tác của agent hoàn tất trước khi chạy tác vụ định kỳ.",
  "error.backend.routineRunStarting":
    "Lượt chạy tác vụ định kỳ này vẫn đang khởi động. Hãy thử lại sau khi lượt bắt đầu.",
  "error.backend.routineRunNoSession":
    "OpenBot không thể ngắt lượt chạy tác vụ định kỳ đang hoạt động vì phiên của nhà cung cấp không khả dụng.",
  "error.backend.interruptSelf": "Agent không thể tự ngắt chính mình.",
  "error.backend.interruptOtherWork":
    "Agent này đang làm một tác vụ không do tin nhắn của bạn khởi tạo. Chỉ người dùng hoặc người gửi tác vụ đó mới có thể dừng nó.",
  "error.backend.interruptSharedWork":
    "Lượt của agent này đang xử lý tin nhắn của bạn và cả tin nhắn từ người dùng hoặc agent khác. Chỉ người dùng mới có thể dừng, bằng Dừng agent trong cuộc trò chuyện của agent đó.",
  "error.backend.interruptStarting": "Agent này vẫn đang bắt đầu một lượt. Hãy thử lại sau khi lượt bắt đầu.",
  "error.backend.interruptNoSession": "OpenBot không thể ngắt agent này vì phiên của nhà cung cấp không khả dụng.",
  "error.backend.memoryTextRequired": "Cần có nội dung bộ nhớ.",
  "error.backend.memoryTextTooLong": "Nội dung bộ nhớ quá dài.",
  "error.backend.mcpServerGone": "Máy chủ MCP này không còn tồn tại.",
  "error.backend.routineFlowLinkGone": "Kết nối này không còn tồn tại.",
  "error.backend.routineFlowSameAgent": "Agent không thể chuyển việc cho chính mình.",
  "error.backend.routineFlowIntoOwner":
    "Tác vụ định kỳ bắt đầu bằng agent của chính nó, nên agent đó không thể nhận việc từ agent khác.",
  "error.backend.routineFlowNotOnPath":
    "Agent này chưa thuộc tác vụ định kỳ. Hãy kết nối agent với tác vụ định kỳ trước.",
  "error.backend.routineFlowDuplicate": "Các agent này đã được kết nối trong tác vụ định kỳ này.",
  "error.backend.routineFlowCycle": "Kết nối này sẽ tạo thành vòng lặp.",
  "error.backend.routineFlowLinkLimit": "Một tác vụ định kỳ chỉ có thể có tối đa {limit} kết nối.",
  "error.backend.agentWaitLimit":
    "Agent này đã có {count} lượt chờ đang mở. Hãy đóng một lượt chờ bằng openbot.close_wait trước khi mở lượt khác.",
  "error.backend.agentWaitGone": "Lượt chờ này không mở. Agent đã đóng nó, hoặc ai đó đã hủy nó.",
  "error.backend.agentWaitNoRequest": "Lượt chờ cần một tin nhắn để tiếp tục. Lượt này không có tin nhắn.",
  "error.backend.agentWaitOwnChatOnly":
    "Chỉ mở lượt chờ trong cuộc trò chuyện của chính bạn. Tác vụ của kênh hoặc nhắn tin không thể chờ.",
  "error.backend.agentWaitNoteRequired": "Hãy viết một ghi chú ngắn cho biết lượt chờ dùng để làm gì.",
  "error.backend.agentWaitRoutineGone": "Agent này không có tác vụ định kỳ nào với id này.",
  "error.backend.agentWaitNoRoutine":
    "Chỉ một lượt chạy của một trong các tác vụ định kỳ của bạn mới đánh thức được lượt chờ, và bạn chưa có tác vụ định kỳ nào. Hãy tạo một tác vụ bằng openbot.create_routine, rồi mở lượt chờ.",
  "error.backend.markUnreadRemoteUnsupported": "Chỉ có thể đánh dấu tin nhắn là chưa đọc cho agent trên máy tính này.",
  "error.backend.messageDeleteUnsupported": "Máy chủ này không hỗ trợ xóa tin nhắn.",
  "error.backend.messageDeleteNotFound": "Tin nhắn này không có trong cuộc trò chuyện.",
  "error.backend.messageDeleteBusy": "Tin nhắn này thuộc một lượt đang chạy. Hãy xóa khi lượt kết thúc.",
  "error.backend.messageDeleteForbidden": "Bạn chỉ có thể xóa tin nhắn do bạn gửi.",
  "error.backend.messagePinNotFound": "Tin nhắn cần ghim không có trong cuộc trò chuyện này.",
  "error.backend.messagePinLimit":
    "Cuộc trò chuyện này có 50 tin nhắn đã ghim. Hãy bỏ ghim một tin nhắn trước khi ghim tin khác.",
  "error.backend.routineFlowHandoffFailed": "Tác vụ định kỳ không thể chuyển tiếp công việc cho agent này.",
  "error.backend.mcpServerLimit": "OpenBot chỉ giữ tối đa {limit} máy chủ MCP.",
  "error.backend.mcpServerNameTaken": "Đã có máy chủ MCP tên {name}.",
  "error.backend.mcpServerInvalid": "OpenBot không thể lưu cấu hình máy chủ MCP này.",
  "error.backend.mcpServerNoAnswer": "Máy chủ không phản hồi trong {seconds} giây.",
  "error.backend.mcpSignInNotAccepted": "Máy chủ không chấp nhận lần đăng nhập đó.",
  "error.backend.mcpSignInAccountRefused":
    "Máy chủ đã từ chối tài khoản bạn dùng để đăng nhập. Hãy kiểm tra xem tài khoản này có dùng được dịch vụ không. Để dùng tài khoản khác, hãy đăng xuất, rồi đăng nhập lại.",
  "error.backend.mcpSignInClientRefused":
    "Máy chủ đăng nhập không chấp nhận OpenBot khi hoàn tất đăng nhập. Hãy đăng nhập lại: OpenBot sẽ đăng ký lại với máy chủ.",
  "error.backend.mcpSignInAppRefused":
    "Máy chủ đăng nhập không chấp nhận ứng dụng đăng nhập của máy chủ này. Hãy kiểm tra client ID và client secret của ứng dụng đăng nhập, rồi đăng nhập lại.",
  "error.backend.mcpCommandNotFound": "Không tìm thấy lệnh: {command}",
  "error.backend.mcpProviderLimit":
    "Agent này chỉ dùng được một số lượng máy chủ MCP có hạn. Để dùng máy chủ này, hãy tắt một máy chủ MCP mà agent không cần.",
  "error.backend.mcpRegistrationRefused":
    "Máy chủ đăng nhập chưa chấp nhận OpenBot như một ứng dụng. Nguyên nhân không phải do tài khoản của bạn. Hãy dùng cách kết nối khác, chẳng hạn máy chủ MCP cục bộ.",
  "error.backend.mcpRegistrationUnavailable":
    "Máy chủ đăng nhập không thể đăng ký OpenBot như một ứng dụng. Nguyên nhân không phải do tài khoản của bạn. Để kết nối, hãy lưu máy chủ này trong Cửa hàng, Ứng dụng, rồi thêm một ứng dụng đăng nhập cho nó.",
  "error.backend.mcpSignInAbandonedGeneric": "Đăng nhập đã bị bỏ dở.",
  "error.backend.mcpSignInForgotten": "Đăng nhập MCP đã bị xóa trong lúc đang chạy.",
  "error.backend.mcpSignInAbandoned": "Đăng nhập MCP đã bị bỏ dở.",
  "error.backend.mcpSignInNoBrowser": "Đăng nhập MCP này không thể mở trình duyệt.",
  "error.backend.mcpSignInNotWebPage": "Địa chỉ đăng nhập không phải là trang web.",
  "error.backend.mcpSignInRequired":
    "Máy chủ này yêu cầu bạn đăng nhập. Hãy chọn Đăng nhập để tiếp tục trong trình duyệt.",
  "error.backend.mcpSignInOnHost": "Máy chủ này yêu cầu đăng nhập. Hãy đăng nhập trong OpenBot trên máy tính host.",
  "error.backend.mcpSignInNeedsHttps":
    "Máy chủ này yêu cầu đăng nhập, và OpenBot chỉ đăng nhập qua https. Hãy đổi URL thành {url}.",
  "error.backend.mcpSignInCancelled": "Đăng nhập đã bị hủy.",
  "error.backend.mcpSignInTimedOut": "Đăng nhập chưa được hoàn tất trong trình duyệt.",
  "error.backend.mcpSignInRefused": "Trang đăng nhập đã từ chối truy cập. Hãy đăng nhập lại.",
  "error.backend.mcpSignInResponseTimedOut": "Phản hồi đăng nhập không đến kịp.",
  "error.backend.mcpSignInMetadataUnreadable":
    "OpenBot không thể đọc thông tin đăng nhập của máy chủ này. Hãy kiểm tra địa chỉ máy chủ và thử lại.",
  "error.backend.mcpSignInAnswerUnreadable":
    "Máy chủ đăng nhập gửi một phản hồi mà OpenBot không đọc được. Nếu dịch vụ cấp cho bạn khóa API hoặc token, hãy thêm vào cài đặt của máy chủ này, rồi kiểm tra kết nối lại.",
  "error.backend.mcpServerExited": "Máy chủ đã dừng trước khi phản hồi. Hãy chạy lệnh trong terminal để xem lỗi.",
  "error.backend.mcpServerExitedWithOutput": "Máy chủ đã dừng trước khi phản hồi. Nội dung xuất ra: {detail}",
  "error.backend.mcpServerFailedToStart": "Máy chủ không khởi động được: {reason}",
  "error.backend.mcpServerStartAbandoned":
    "{provider} đã ngừng chờ trước khi máy chủ khởi động, nên các agent của nó không nhận được công cụ của máy chủ này.",
  "error.backend.mcpServerStoppedDuringCall": "Máy chủ MCP đã dừng trước khi phản hồi lệnh gọi này.",
  "error.backend.mcpToolSchemaRefused":
    "Công cụ {tool} của máy chủ có định dạng đầu vào mà nhà cung cấp này không đọc được. Agent trên các nhà cung cấp khác vẫn nhận được máy chủ.",
  "error.backend.mcpServerSignInForProvider":
    "{provider} không thể dùng máy chủ MCP {name} vì máy chủ yêu cầu đăng nhập. Hãy mở {name} trong Cửa hàng, Ứng dụng, rồi chọn Đăng nhập.",
  "error.backend.mcpServerFailedForProvider":
    "{provider} không thể khởi động máy chủ MCP {name}. Hãy mở {name} trong Cửa hàng, Ứng dụng, rồi chọn Kiểm tra kết nối để xem nguyên nhân.",
  "error.backend.mcpServerFailedInProvider":
    "{provider} không thể khởi động máy chủ MCP {name}. Công cụ của máy chủ không khả dụng cho {provider}. {provider} tự khởi động máy chủ, nên kiểm tra kết nối trong OpenBot vẫn có thể thành công. Hãy bắt đầu cuộc trò chuyện mới để thử lại.",
  "error.backend.mcpServerTimedOutInProvider":
    "{provider} không thể khởi động máy chủ MCP {name} vì máy chủ không phản hồi kịp. Hãy bắt đầu cuộc trò chuyện mới để thử lại.",
  "error.backend.mcpAppReconnect":
    "{name} trên ChatGPT yêu cầu bạn đăng nhập lại. Hãy kết nối lại {name} trên ChatGPT, rồi hỏi lại agent.",
  "error.backend.mcpServerSignInPage":
    "Máy chủ MCP {name} yêu cầu bạn đăng nhập trên một trang web. OpenBot không mở trang này cho máy chủ, nên đã từ chối. Hãy mở {name} trong Cửa hàng, Ứng dụng và đăng nhập, rồi hỏi lại agent.",
  "error.backend.mcpServerRequestDeclined":
    "Máy chủ MCP {name} yêu cầu một nội dung mà OpenBot không thể hiển thị, nên OpenBot đã từ chối.",
  "error.backend.mcpRequestDeclined":
    "Một máy chủ MCP yêu cầu một nội dung mà OpenBot không thể hiển thị, nên OpenBot đã từ chối.",
  "error.backend.mcpOAuthProxyUnavailable":
    "OpenBot không thể khởi động kết nối đăng nhập cục bộ cho máy chủ này. Hãy khởi động lại OpenBot, rồi thử lại.",
  "error.backend.mcpOAuthSignInNeeded":
    "Phiên đăng nhập vào máy chủ MCP này đã kết thúc. Người dùng phải đăng nhập lại trong OpenBot.",
  "error.backend.mcpOAuthRenewalFailed":
    "OpenBot hiện không thể gia hạn phiên đăng nhập vào máy chủ MCP này. Phiên đăng nhập vẫn được giữ, và yêu cầu tiếp theo sẽ thử lại. Nếu lỗi này tiếp diễn, người dùng có thể đăng xuất khỏi máy chủ trong OpenBot và đăng nhập lại.",
  "error.backend.mcpOAuthRequestRefused":
    "Máy chủ MCP đã từ chối yêu cầu này, nhưng phiên đăng nhập vẫn còn hiệu lực. Có thể tài khoản không dùng được công cụ này, hoặc lần đăng nhập chưa cấp đủ quyền truy cập cần thiết. Người dùng có thể kiểm tra gói và quyền truy cập của tài khoản tại dịch vụ, hoặc đăng nhập lại máy chủ trong OpenBot và cho phép mọi quyền truy cập được yêu cầu.",
  "error.backend.mcpServerUnreachable": "OpenBot không thể kết nối tới máy chủ. Hãy kiểm tra URL và mạng của bạn.",
  "error.backend.mcpLocalServerOff":
    "Không có máy chủ nào phản hồi tại {address} trên máy tính này. Hãy khởi động máy chủ, hoặc bật nó trong ứng dụng chạy máy chủ, rồi thử lại.",
  "error.backend.mcpServerBlocked":
    "Máy tính này đã chặn kết nối tới máy chủ. Hãy kiểm tra tường lửa hoặc phần mềm bảo mật, rồi thử lại.",
  "error.backend.mcpServerIncompatible":
    "Có dịch vụ phản hồi tại địa chỉ này, nhưng không phải là máy chủ MCP qua Streamable HTTP. Hãy kiểm tra URL, và cập nhật ứng dụng chạy máy chủ.",
  "error.backend.mcpRemoteBridge":
    "{reason} Lệnh này chạy cầu nối mcp-remote. Thay vào đó, hãy chọn Streamable HTTP với URL {url}, và OpenBot sẽ đăng nhập cho bạn.",
  "error.backend.oauthNotHttps": "Endpoint OAuth {origin} không dùng https, nên thông tin xác thực không được gửi.",
  "error.backend.oauthTooManyRedirects": "Endpoint OAuth đã chuyển hướng quá nhiều lần.",
  "error.backend.oauthRedirectOrigin":
    "Endpoint OAuth đã chuyển hướng tới {origin}, nên thông tin xác thực không được chuyển tiếp.",
  "error.backend.oauthTimedOut": "Endpoint OAuth {origin} không phản hồi kịp.",
  "error.backend.oauthResponseTooLarge": "Endpoint OAuth {origin} gửi phản hồi quá lớn.",
  "error.backend.oauthResponseUnreadable": "Không thể đọc phản hồi của endpoint OAuth {origin}.",
  "error.backend.mcpOAuthPrivateEndpoint":
    "Endpoint OAuth {origin} nằm trong mạng riêng, nhưng máy chủ MCP là công khai, nên thông tin xác thực không được gửi.",
  "error.backend.sidebarSectionLimit": "Một máy chủ chỉ có thể có tối đa {limit} mục thanh bên.",
  "error.backend.sectionNameRequired": "Cần có tên mục.",
  "error.backend.sectionNameTooLong": "Tên mục quá dài.",
  "error.backend.sidebarFolderTooDeep": "Thư mục chỉ có thể lồng tối đa ba cấp.",
  "error.backend.sidebarFolderMoveInvalid": "Không thể chuyển thư mục này tới đó.",
  "error.backend.libraryFolderName": "Tên thư mục phải có từ 1 đến {limit} ký tự.",
  "error.backend.libraryFolderLimit": "Một máy chủ chỉ có thể có tối đa {limit} thư mục Thư viện.",
  "error.backend.libraryFolderFileLimit": "Có quá nhiều tệp trong các thư mục Thư viện.",
  "error.backend.libraryFolderTooDeep": "Thư mục Thư viện chỉ có thể lồng tối đa {limit} cấp.",
  "error.backend.libraryFolderGone": "Thư mục không tồn tại hoặc đã bị xóa.",
  "error.backend.libraryFolderOtherAgent": "Một tệp chỉ có thể nằm trong thư mục của agent sở hữu nó.",
  "error.backend.libraryFolderMoveInvalid": "Không thể chuyển thư mục này tới đó.",
  "error.backend.sectionNameDuplicate": "Tên mục không được trùng nhau.",
  "error.backend.directMessageRequired": "Hãy viết tin nhắn trước.",
  "error.backend.directMessageTooLong": "Tin nhắn trực tiếp chỉ có thể có tối đa {limit} ký tự.",
  "error.backend.directMessageSelf": "Bạn không thể gửi tin nhắn trực tiếp cho chính mình.",
  "error.backend.readBoundaryUnavailable": "Mốc đã đọc không còn khả dụng.",
  "error.backend.sharedFileOutside": "Tệp dùng chung phải nằm trong thư mục dùng chung.",
  "error.backend.sharedPathIsFolder": "Đường dẫn dùng chung là thư mục, không phải tệp.",
  "error.backend.sharedPathNotFile": "Đường dẫn dùng chung không phải là tệp.",
  "error.backend.workspaceFileOutside": "Tệp không gian làm việc phải nằm trong không gian làm việc của agent.",
  "error.backend.workspacePathNotFile": "Đường dẫn không gian làm việc không phải là tệp.",
  "error.backend.workspacePathNotDirectory": "Đường dẫn không gian làm việc không phải là thư mục.",
  "error.backend.workspacePathMissing": "Không có gì tại {path} trong không gian làm việc {root} của agent.",
  "error.backend.workspacePathMissingForMember": "Không có gì tại {path} trong không gian làm việc của agent.",
  "error.backend.useChannelTaskControls": "Hãy dùng các nút điều khiển tác vụ của kênh cho lượt giao việc này.",
  "error.backend.editFinished": "Bản sửa này đã hoàn tất.",
  "error.backend.editCancelled": "Bản sửa này đã bị hủy, nên tin nhắn giữ nguyên nội dung gốc.",
  "error.backend.editSaved": "Bản sửa này đã được lưu.",
  "error.backend.editSavedDifferent": "Bản sửa này đã được lưu với nội dung khác. Các thay đổi của bạn chưa được lưu.",
  "error.backend.useChannelTaskControlsWork": "Hãy dùng các nút điều khiển tác vụ của kênh cho công việc trong kênh.",
  "error.backend.steerTurnChanged": "Lượt hiện tại đã thay đổi trước khi tin nhắn này kịp định hướng.",
  "error.backend.steerUnsupported":
    "Nhà cung cấp này không thể định hướng lượt đang chạy. Tin nhắn của bạn vẫn nằm trong hàng đợi.",
  "error.backend.steerRoutineRun":
    "Một tác vụ định kỳ đang chạy. Tin nhắn của bạn vẫn nằm trong hàng đợi và sẽ bắt đầu sau tác vụ định kỳ.",
  "error.backend.steerQueuedOnly": "Chỉ có thể định hướng bằng tin nhắn trong hàng đợi.",
  "error.backend.promptInactive": "Prompt này không còn hoạt động.",
  "error.backend.promptAnswerMismatch": "Một câu trả lời không khớp với câu hỏi đang hoạt động.",
  "error.backend.uiBlockAnswerInvalid": "Câu trả lời này không phù hợp với khối của agent.",
  "error.backend.uiBlockActionNotAllowed": "Chỉ chủ sở hữu máy chủ hoặc quản trị viên mới có thể chọn hành động này.",
  "error.backend.approvalInactive": "Yêu cầu phê duyệt này không còn hoạt động.",
  "error.backend.approvalOwnerOnly": "Chỉ chủ sở hữu máy chủ mới có thể phê duyệt hành động này.",
  "error.backend.feedbackNeedsPhone":
    "Chỉ ứng dụng OpenBot trên điện thoại mới có thể gửi báo cáo này, vì nó thêm phiên bản điện thoại và nhật ký hỗ trợ. Hãy mở cuộc trò chuyện này trên điện thoại. Nếu bạn thấy thông báo này trên điện thoại, hãy cập nhật ứng dụng.",
  "error.backend.takeoverInactive": "Lượt tiếp quản trình duyệt này không còn hoạt động.",
  "error.backend.authSubmitting": "Đang gửi thông tin xác thực.",
  "error.backend.apiKeySaveFailed": "OpenBot không thể lưu khóa API. Hãy thử lại.",
  "error.backend.apiKeyNotAllowed": "Chỉ chủ sở hữu máy chủ hoặc quản trị viên mới có thể nhập khóa API.",
  "error.backend.apiKeySaving": "Khóa API đang được lưu.",
  "error.backend.vaultItemNotAllowed": "Chỉ chủ sở hữu máy chủ hoặc quản trị viên mới có thể thêm mục vào Kho bảo mật.",
  "error.backend.vaultItemSaving": "Mục Kho bảo mật đang được lưu.",
  "error.backend.authRequestInactive": "Yêu cầu xác thực bảo mật này không còn hoạt động.",
  "error.backend.secureAuthUnavailable": "Xác thực bảo mật không khả dụng.",
  "error.backend.browserUrlRequired": "Cần có URL trình duyệt.",
  "error.backend.browserUrlTooLong": "URL trình duyệt quá dài.",
  "error.backend.browserTabLimit": "Trình duyệt chỉ có thể mở tối đa {limit} thẻ.",
  "error.backend.browserProfileMissing":
    "Hồ sơ trình duyệt của agent này không còn tồn tại. Hãy chọn hồ sơ khác trong cài đặt agent.",
  "error.backend.browserProfileNotFound": "Hồ sơ trình duyệt này không còn tồn tại.",
  "error.backend.browserProfileNameTaken": "Đã có hồ sơ trình duyệt với tên này.",
  "error.backend.browserSessionInUse": "Vẫn có một thẻ đang dùng phiên trình duyệt này. Hãy thử lại.",
  "error.backend.browserProfileLimit": "Bạn chỉ có thể có tối đa {limit} hồ sơ trình duyệt.",
  "error.backend.browserProxyNotFound": "Proxy này không còn tồn tại.",
  "error.backend.browserProxyAddressInvalid":
    "Hãy nhập địa chỉ proxy, ví dụ socks5://host:1080 hoặc http://user:password@host:3128.",
  "error.backend.browserProxyLimit": "Bạn chỉ có thể có tối đa {limit} proxy.",
  "error.backend.browserProxyTaken": "Đã có proxy với địa chỉ này.",
  "error.backend.browserProxyChanged": "Proxy này đã thay đổi sau khi bạn mở. Hãy xem lại, rồi thử lại.",
  "error.backend.browserProxyUnreachable": "Proxy {name} không phản hồi, nên trang không mở được.",
  "error.backend.browserProxySignInRefused": "Proxy {name} đã từ chối đăng nhập, nên trang không mở được.",
  "error.backend.browserSystemProxyFailed":
    "Proxy trong cài đặt của máy tính chạy OpenBot không phản hồi hoặc đã từ chối kết nối, nên trang không mở được. Hãy kiểm tra cài đặt proxy của máy tính đó.",
  "error.backend.browserProxyComputerUnreachable":
    "Máy tính mà hồ sơ này dùng không phản hồi, nên trang không mở được.",
  "error.backend.browserProxyComputerLocalAddress":
    "Máy tính mà hồ sơ này dùng chỉ mở trang web công khai. Nó không mở địa chỉ trong mạng cục bộ, nên trang không mở được.",
  "error.backend.browserCertificateUntrusted":
    "Chứng chỉ bảo mật của trang web này không đáng tin cậy, nên trang không mở được.",
  "error.backend.browserLowMemory":
    "Máy chủ này sắp hết bộ nhớ, nên trình duyệt không thể mở thêm thẻ. Hãy đóng một thẻ, hoặc đợi các agent khác hoàn tất.",
  "error.backend.browserOpenFailed": "Không thể mở {url}: {reason}",
  "error.backend.popupSecureInput":
    "Cửa sổ bật lên bị chặn trong lúc nhập bảo mật. Hãy hoàn tất hoặc hủy nhập bảo mật, rồi thử lại từ trang.",
  "error.backend.popupUnsupportedType":
    "Loại cửa sổ bật lên này không được hỗ trợ. Hãy dùng liên kết hoặc nút đăng nhập thông thường trên trang.",
  "error.backend.popupUnsupportedAddress":
    "Cửa sổ bật lên này dùng địa chỉ không được hỗ trợ. Hãy dùng tùy chọn đăng nhập HTTP hoặc HTTPS trên trang.",
  "error.backend.popupTabLimit": "Đã đạt giới hạn thẻ trình duyệt. Hãy đóng một thẻ, rồi thử lại từ trang.",
  "error.backend.popupLoadFailed": "Không thể tải cửa sổ bật lên. Hãy thử đăng nhập lại từ trang gốc.",
  "error.backend.browserTabNotFound": "Không tìm thấy thẻ trình duyệt.",
  "error.backend.authActive": "Xác thực đang diễn ra.",
  "error.backend.authHttpsRequired": "Xác thực bảo mật yêu cầu HTTPS.",
  "error.backend.authDigitsRange": "Mã xác thực phải có 4–12 chữ số.",
  "error.backend.authExpired": "Yêu cầu xác thực đã hết hạn.",
  "error.backend.authDigitsRequired": "Hãy nhập đúng số chữ số được yêu cầu.",
  "error.backend.browserViewProtected": "Chế độ xem trình duyệt được bảo vệ trong lúc xác thực.",
  "error.backend.browserPreviewPageChanged": "Trang trình duyệt đã thay đổi trong lúc xem trước. Hãy thử lại.",
  "error.backend.browserInputProtected": "Thao tác nhập trên trình duyệt được bảo vệ trong lúc xác thực.",
  "error.backend.browserClickMoved":
    "Không có gì được nhấp. Trang đã di chuyển mục tiêu khi con trỏ đến gần, và lần nhấn rơi vào {element}. Hãy chụp snapshot mới.",
  "error.backend.browserTypingFocusMoved":
    "Trang đã chuyển tiêu điểm khỏi mục tiêu trước khi gõ. Không có gì được gõ. Hãy chụp snapshot mới.",
  "error.backend.browserTypingFocusMovedWhileTyping":
    "Trang đã chuyển tiêu điểm đi trước khi gõ hết văn bản. Chỉ phần đầu của văn bản có trong ô. Hãy chụp snapshot mới và kiểm tra ô trước khi gõ lại.",
  "error.backend.browserTypingSubmitSkipped":
    "Văn bản đã có trong ô, nhưng trang đã chuyển tiêu điểm đi, nên phím Enter chưa được gửi. Đừng gõ lại văn bản. Hãy chụp snapshot mới.",
  "error.backend.mcpServerHttpCredentials":
    "Máy chủ trả về {status}. Hãy kiểm tra khóa API hoặc thông tin xác thực khác.",
  "error.backend.mcpServerHttpUrl":
    "Máy chủ trả về {status}. Hãy kiểm tra URL. Liên kết có thể sai, đã hết hạn hoặc đã bị xóa.",
  "error.backend.mcpServerBearerKey":
    "Máy chủ này nhận khóa API, không phải đăng nhập. Trong mục Headers, hãy đặt khóa là Authorization và giá trị là Bearer, một dấu cách, rồi đến khóa API của bạn.",
  "error.backend.mcpSignInAppUrl": "Ứng dụng đăng nhập cần URL máy chủ hợp lệ.",
  "error.backend.mcpSignInAppClientId": "Hãy nhập client ID của ứng dụng đăng nhập.",
  "error.backend.mcpSignInAppIssuerChanged":
    "Máy chủ đăng nhập của máy chủ MCP này đã thay đổi, nên OpenBot không gửi ứng dụng đăng nhập cho nó. Nếu thay đổi là đúng, hãy xóa ứng dụng đăng nhập và thêm lại.",
  "error.backend.mcpSignInAppNoServer":
    "Hãy lưu máy chủ MCP này dưới dạng máy chủ URL trước khi thêm ứng dụng đăng nhập.",
  "error.backend.mcpSignInAppUnavailable": "Máy tính này không thể lưu ứng dụng đăng nhập.",
  "error.backend.taskMoveRefused": "Chỉ tin nhắn bạn gửi riêng cho agent này mới có thể chạy như một tác vụ.",
  "error.backend.taskNotFound": "Tác vụ này không khả dụng.",
  "error.backend.taskClosed": "Tác vụ này đã đóng. Hãy mở lại để gửi tin nhắn.",
  "error.backend.taskStillRunning": "Tác vụ này vẫn đang chạy. Hãy đợi đến khi nó dừng, rồi đóng.",
  "error.backend.threadNotFound": "Luồng này không khả dụng.",
  "error.backend.threadStillRunning": "Luồng này vẫn đang chạy. Hãy dừng nó, rồi thử lại.",
  "error.backend.threadArchived": "Luồng này đã được lưu trữ. Hãy khôi phục để gửi tin nhắn.",
  "error.backend.threadTitleRequired": "Hãy đặt cho luồng một tiêu đề ngắn.",
  "error.backend.threadOpenLimitReached":
    "Agent này có {count} luồng đang mở. Hãy lưu trữ một luồng, rồi bắt đầu hoặc khôi phục luồng khác.",
  "error.backend.threadRemoteUnsupported": "Luồng chỉ khả dụng cho agent trên máy tính này.",
  "error.backend.branchSourceBusy": "Hãy dừng lượt hiện tại trước khi tạo nhánh cho cuộc trò chuyện này.",
  "error.backend.branchMessageNotFound": "Bạn chỉ có thể tạo nhánh từ một câu trả lời đã hoàn tất của agent.",
  "error.backend.branchRemoteUnsupported": "Nhánh chỉ khả dụng cho agent trên máy tính này.",
  "error.backend.feedbackWithdrawRemoteUnsupported": "Để xóa báo cáo này, hãy yêu cầu agent xóa nó.",
  "error.backend.threadMoveRefused": "Chỉ tin nhắn bạn gửi riêng cho agent này mới có thể chạy trong luồng mới.",
  "error.backend.taskTitleRequired": "Hãy đặt cho tác vụ một tiêu đề ngắn.",
  "error.backend.taskToolInvalid":
    "Hãy đặt cho tác vụ một tiêu đề tối đa 120 ký tự và một mô tả ngắn cho biết cần làm gì.",
  "error.backend.taskOwnChatOnly":
    "Chỉ bắt đầu tác vụ từ cuộc trò chuyện của chính bạn. Kênh, cuộc trò chuyện nhắn tin hoặc tác vụ khác không thể bắt đầu tác vụ.",
  "error.backend.taskUnfinishedLimit":
    "Agent này đã có {count} tác vụ chưa hoàn tất. Hãy bắt đầu tác vụ khác khi một trong số đó kết thúc.",
  "error.backend.taskOpenLimitReached":
    "Agent này có {count} tác vụ đang mở. Hãy đóng một tác vụ, rồi bắt đầu hoặc mở tác vụ khác.",
  "error.backend.taskRemoteUnsupported": "Tác vụ chỉ khả dụng cho agent trên máy tính này.",
  "error.backend.taskStartFailed": "OpenBot không thể bắt đầu tác vụ. Hãy làm việc này ngay trong lượt hiện tại.",
} as const satisfies PartialTranslation<typeof source>;
