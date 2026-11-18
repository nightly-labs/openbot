import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "Lịch sử không có cho yêu cầu này. Hãy đọc lại lịch sử gần đây, hoặc dùng channel_history cho công việc kênh.",
  "error.agent.toolRequestInvalid":
    "Tham số tìm công cụ không hợp lệ. Hãy dùng lược đồ đã khai báo và một tên công cụ định tính gốc.",
  // Agent errors that the main process and the backend send.
  "error.agent.approvalWhileDeleting": "Không thể cấp quyền phê duyệt khi trợ lý đang bị xóa.",
  "error.agent.accessLocalOnly": "Quyền truy cập của trợ lý chỉ có thể thay đổi trên máy tính đang chạy trợ lý.",
  "error.agent.duplicateCleanupFailed": "Nhân bản trợ lý thất bại và bản sao chưa hoàn chỉnh không thể bị gỡ bỏ.",
  "error.agent.commitEffectsFailed": "Giao dịch đã được commit, nhưng các tác động đã lưu của nó đã thất bại.",
  "error.agent.settingsLocalOnly": "Cài đặt của trợ lý chỉ có thể thay đổi trên máy tính đang chạy trợ lý.",
  "error.agent.skillsLocalOnly": "Kỹ năng chỉ có thể thay đổi trên máy tính đang chạy trợ lý.",
  "error.agent.addLocalOnly": "Trợ lý chỉ có thể được thêm trên máy tính đang chạy chúng.",
  "error.agent.joinedServerUpdate": "Trợ lý trên một máy chủ đã tham gia không thể được cập nhật từ đây.",
  "error.agent.searchQueryRequired": "Cần có một từ khóa tìm kiếm.",
  "error.agent.messageTooLong": "Tin nhắn quá dài.",
  "error.agent.messageOrAttachmentRequired": "Cần có một tin nhắn hoặc tệp đính kèm.",
  "error.agent.promptAnswersTooLong": "Các câu trả lời của câu lệnh quá dài.",
  "error.agent.gone": "Trợ lý này không còn tồn tại.",
  "error.agent.instructionsTooLarge":
    "Tệp chỉ dẫn quá lớn để mở ở đây. Hãy rút ngắn nó trong một trình soạn thảo văn bản.",
  "error.agent.instructionsOutside":
    "Tệp chỉ dẫn trỏ tới một nơi ngoài không gian làm việc của trợ lý, nên OpenBot không mở nó.",
  "error.agent.instructionsReadFailed": "Không thể đọc tệp chỉ dẫn.",
  "error.agent.instructionsSaveFailed": "Không thể lưu tệp chỉ dẫn.",
  "error.agent.profileGenerationBusy": "Tạo hồ sơ đang bận. Hãy thử lại sau ít phút.",
  "error.agent.instructionsChanged":
    "Trợ lý đã thay đổi tệp chỉ dẫn. Thay đổi cuối của bạn chưa được lưu. Hãy thay đổi lại.",
  "error.agent.initialMessageRequired": "Cần có tin nhắn ban đầu.",
  "error.agent.initialMessageTooLong": "Tin nhắn ban đầu quá dài.",
  "error.agent.setupCleanupFailed": "Thiết lập trợ lý thất bại và trợ lý chưa hoàn chỉnh không thể bị gỡ bỏ.",
  "error.agent.modelUnavailable": "Mô hình trợ lý đã chọn không có sẵn.",
  "error.agent.modelProviderNotConnected":
    'Mô hình trợ lý đã chọn "{model}" không có sẵn: {provider} chưa được kết nối.',
  "error.agent.modelListEmpty":
    'Mô hình trợ lý đã chọn "{model}" không có sẵn: {provider} không liệt kê mô hình nào. Lỗi cuối: {detail}',
  "error.agent.modelListEmptyNoError":
    'Mô hình trợ lý đã chọn "{model}" không có sẵn: {provider} không liệt kê mô hình nào.',
  "error.agent.modelNotInProviderList": 'Mô hình trợ lý đã chọn "{model}" không có sẵn: {provider} không liệt kê nó.',
  "error.agent.modelVariantNotListed":
    'Mô hình trợ lý đã chọn "{model}" không có sẵn: {provider} không liệt kê nó. Hãy dùng một trong các giá trị mà {provider} liệt kê cho mô hình này: {models}.',
  "error.agent.modelProviderMismatch": "Mô hình đã chọn không thuộc về nhà cung cấp đó.",
  "error.agent.modelNotListed": 'Mô hình "{model}" không có sẵn. Các mô hình có sẵn: {models}.',
  "error.agent.providerNotListed":
    "Hiện không có mô hình {provider} nào. Hãy gọi list_models để xem các mô hình có sẵn.",
  "error.agent.reasoningEffortUnsupported":
    'Mô hình "{model}" không hỗ trợ mức độ suy luận "{effort}". Các mức được hỗ trợ: {efforts}.',
  "error.agent.noStartingModelInSettings":
    "{provider} không có mô hình nào, và không nhà cung cấp nào khác đã đăng nhập có mô hình. Hãy đăng nhập một nhà cung cấp, hoặc đổi nhà cung cấp mặc định trong Cài đặt máy chủ → Nhà cung cấp.",
  "error.agent.noStartingModel":
    "{provider} không có mô hình nào, và không nhà cung cấp nào khác đã đăng nhập có mô hình. Hãy đăng nhập một nhà cung cấp, hoặc đổi nhà cung cấp mặc định trong Nhà cung cấp & quyền.",
  "error.agent.waitBeforeProviderChange": "Hãy đợi lượt đang chạy và hàng đợi hoàn tất trước khi đổi nhà cung cấp.",
  "error.agent.waitForTasksBeforeProviderChange":
    "Các nhiệm vụ của trợ lý này đang chạy. Hãy đợi chúng hoàn tất, hoặc dừng chúng, trước khi đổi nhà cung cấp.",
  "error.agent.waitBeforeClearContext":
    "Hãy đợi lượt đang chạy và hàng đợi hoàn tất trước khi bắt đầu một cuộc trò chuyện mới.",
  "error.agent.waitBeforeCompactContext": "Hãy đợi lượt đang chạy và hàng đợi hoàn tất trước khi nén ngữ cảnh.",
  "error.agent.waitBeforeDeleteHistory": "Hãy đợi lượt đang chạy và hàng đợi hoàn tất trước khi xóa lịch sử.",
  "error.agent.compactContextUnavailable": "Trợ lý này không thể nén ngữ cảnh lúc này.",
  "error.agent.unknown": "Trợ lý không xác định: {id}",
  "error.agent.onlyUserWidensSettings":
    "Chỉ người dùng mới có thể cấp Toàn quyền truy cập cho một trợ lý hoặc bật Điều khiển máy tính. Hãy nhờ người dùng đổi nó trong cài đặt của trợ lý.",
  "error.agent.queuedMessageCreateFailed": "Không thể tạo tin nhắn trong hàng đợi.",
  "error.agent.messageUnavailable": "Tin nhắn không còn có sẵn.",
  "error.agent.hostLimit": "Một máy tính có thể có tối đa {limit} trợ lý.",
  "error.agent.changedWhileDuplicating": "Trợ lý đã thay đổi khi nó đang được nhân bản. Hãy thử lại.",
  "error.agent.duplicatedAgentGone": "Trợ lý được nhân bản không còn tồn tại.",
  "error.agent.stateCorrupt":
    "Trạng thái của trợ lý bị hỏng hoặc đến từ phiên bản OpenBot mới hơn; OpenBot từ chối ghi đè nó.",
  "error.agent.oldRoleField":
    "Hồ sơ trợ lý đã lưu dùng trường vai trò cũ; hãy cập nhật dữ liệu trước khi khởi động OpenBot.",
  "error.agent.duplicateIds": "Trạng thái của trợ lý chứa các ID trợ lý trùng lặp; OpenBot từ chối ghi đè nó.",
  "error.agent.copyNameFailed": "OpenBot không thể tạo tên bản sao trợ lý duy nhất.",
  "error.agent.endpointRemoved": "Điểm cuối mà trợ lý này dùng đã bị gỡ bỏ. Hãy chọn một mô hình khác cho nó.",
  "error.agent.turnStalled":
    "{provider} đã ngừng phản hồi, nên OpenBot đã kết thúc lượt này. Hãy gửi lại tin nhắn, hoặc chọn một mô hình khác.",
  "error.agent.compactionConnectionLost":
    "Kết nối đã dừng khi trợ lý nén ngữ cảnh, nên tác vụ đã dừng. Hãy kiểm tra kết nối internet, rồi gửi một tin nhắn để tiếp tục.",
  "error.agent.selectedGone": "Trợ lý đã chọn không còn tồn tại.",
  "error.agent.profileEndpointsChanged":
    "Các điểm cuối tùy chỉnh đã thay đổi khi nội dung này đang được tạo. Hãy thử lại.",
  "error.agent.profileInvalid": "Nhà cung cấp đã trả về một hồ sơ không hợp lệ. Hãy sửa lại câu lệnh của bạn.",
  "error.agent.profileSectionUnavailable":
    "Phần được tạo không có sẵn. Hãy thử lại hoặc chọn một phần theo cách thủ công.",
  "error.agent.profileTimedOut": "Tạo hồ sơ đã hết thời gian. Hãy thử lại.",
  "error.agent.profileDisconnected": "Nhà cung cấp đã ngắt kết nối khi tạo hồ sơ.",
  "error.agent.profileToolUse": "Nhà cung cấp đã cố dùng một công cụ. Hãy sửa lại câu lệnh của bạn.",
  "error.agent.profileFailed": "Nhà cung cấp không thể tạo hồ sơ. Hãy thử lại.",
  "error.agent.profileTooLarge": "Hồ sơ được tạo quá lớn. Hãy dùng câu lệnh ngắn hơn.",
  "error.agent.profileNotStarted": "Nhà cung cấp không thể bắt đầu tạo hồ sơ.",
  "error.agent.deletionBusy": "Việc xóa trợ lý đang được thực hiện.",
  "error.agent.stopBeforeDelete": "Hãy dừng trợ lý và hủy các tin nhắn trong hàng đợi của nó trước khi xóa.",
  "error.agent.deleteIncomplete": "Dữ liệu của trợ lý không thể bị gỡ bỏ hoàn toàn. Hãy thử xóa trợ lý lại.",
  "error.agent.duplicationBusy": "Trợ lý này đang được nhân bản.",
  "error.agent.waitBeforeDuplicate": "Hãy đợi trợ lý hoàn tất và dọn hàng đợi trước khi nhân bản nó.",
  "error.agent.saveOtherAgent": "Bản lưu này thuộc về một trợ lý khác.",
  "error.agent.savedGone": "Trợ lý đã lưu không còn tồn tại.",
  "error.agent.storedProfileUnreadable":
    'Một hồ sơ trợ lý đã lưu có giá trị "{field}" không đọc được; hãy cập nhật dữ liệu trước khi khởi động OpenBot.',
  "error.agent.storedProfileUnreadableId":
    'Hồ sơ trợ lý đã lưu {id} có giá trị "{field}" không đọc được; hãy cập nhật dữ liệu trước khi khởi động OpenBot.',
  // Written by `QueueEditRejectedError` in @openbot/contracts, which cannot import this package.
  "error.agent.queueEditRejected": "Chỉnh sửa hàng đợi bị từ chối: {reason}",
  "error.agent.computerUseLocalOnly": "Điều khiển máy tính chỉ có thể thay đổi trên máy tính đang chạy trợ lý.",
  "error.agent.automationLocalOnly": "Chỉ có thể cho phép tập lệnh cục bộ trên máy tính đang chạy trợ lý.",
  "error.agent.newChatLocalOnly": "Chỉ máy tính đang chạy trợ lý mới có thể cho phép nó bắt đầu cuộc trò chuyện mới.",
  "error.agent.quickAcknowledgementLocalOnly": "Chỉ máy tính đang chạy trợ lý mới có thể thay đổi cài đặt này.",
  "error.agent.sideQuestionBusy": "Có quá nhiều câu hỏi phụ đang chạy. Hãy thử lại sau ít phút.",
  "error.agent.sideQuestionFailed": "Trợ lý không thể trả lời câu hỏi phụ. Hãy thử lại.",
  "error.agent.webSearchSignIn": "Tìm kiếm web cần một lượt đăng nhập Codex bằng tài khoản ChatGPT.",
  "error.agent.webSearchBusy": "Có quá nhiều tìm kiếm và câu hỏi phụ đang chạy. Hãy thử lại sau ít phút.",
  "error.agent.webSearchFailed": "Tìm kiếm web không hoàn tất. Hãy thử lại.",
  "error.agent.busyMessageModeLocalOnly":
    "Cách xử lý tin nhắn khi trợ lý đang làm việc chỉ có thể đặt trên máy tính đang chạy trợ lý.",
  "error.agent.backupModelsLocalOnly": "Mô hình dự phòng chỉ có thể đặt trên máy tính đang chạy trợ lý.",
  "error.agent.taskLimitLocalOnly": "Giới hạn tác vụ chỉ có thể đặt trên máy tính đang chạy trợ lý.",
  "error.agent.localScriptsOff": "Trợ lý này không cho phép tập lệnh cục bộ.",
  "error.agent.localScriptsRateLimited":
    "Tập lệnh cục bộ đã gửi cho trợ lý này {limit} yêu cầu tin nhắn hoặc nhiệm vụ định kỳ trong giờ qua. Hãy thử lại sau.",
  "error.agent.automationOff": "Trợ lý này không cho phép tập lệnh cục bộ chạy các nhiệm vụ định kỳ của nó.",
  "error.agent.automationPayloadTooLong": "Dữ liệu gửi đi dài hơn {limit} ký tự.",
  "error.agent.automationRateLimited":
    "Tập lệnh cục bộ đã chạy các nhiệm vụ định kỳ của trợ lý này {limit} lần trong giờ qua. Hãy thử lại sau.",
  "error.agent.workspaceOnlyMacOnly":
    "Chỉ không gian làm việc chỉ có sẵn cho nhà cung cấp này trên macOS. Hãy chọn Toàn quyền truy cập trong cài đặt của trợ lý.",
  "error.agent.lowMemory":
    "Máy chủ này hết bộ nhớ. Tin nhắn của bạn đang chờ trong hàng đợi và sẽ bắt đầu khi có bộ nhớ trống. Gói lớn hơn cho máy chủ nhiều bộ nhớ hơn.",
  "error.agent.lowMemoryServer":
    "Máy chủ này hết bộ nhớ. Tin nhắn của bạn đang chờ trong hàng đợi và sẽ bắt đầu khi có bộ nhớ trống.",
  "error.agent.workspaceOnlyToolMissing":
    "Chỉ không gian làm việc cần {tool}, mà OpenBot không tìm thấy. Hãy cài đặt nó, hoặc chọn Toàn quyền truy cập trong cài đặt của trợ lý.",
  "error.agent.claudeSandboxUnavailable":
    "Chỉ không gian làm việc cần sandbox của Claude, mà Claude không thể khởi động trên máy tính này: {reason}. Hãy chọn Toàn quyền truy cập hoặc một nhà cung cấp khác trong cài đặt của trợ lý.",
  "error.agent.screenCaptureOff":
    "Chụp màn hình đang tắt cho trợ lý này. Người dùng có thể bật Điều khiển máy tính trong cài đặt của trợ lý.",
  "error.agent.screenCaptureUnavailable": "Chụp màn hình không có sẵn trên máy tính này.",
  "error.agent.screenCaptureShared":
    "Chụp màn hình không hoạt động trong cuộc trò chuyện Slack, Discord hoặc Telegram, vì những người khác sẽ nhận được tệp của nó.",
  "error.agent.screenCaptureDeclined": "Người dùng không cho phép chụp màn hình này. Không có gì được chụp.",
  "error.agent.mcpServerDeclined": "Người dùng không cho phép thay đổi máy chủ MCP này. Không có gì thay đổi.",
  "error.agent.mcpServerNotSaved": "Máy chủ MCP không trả lời, nên nó không được lưu. {error}",
  "error.agent.mcpServerKeysMove":
    "Máy chủ MCP {name} giữ các khóa của máy chủ hiện tại của nó. Hãy nhờ người dùng đổi địa chỉ, lệnh, tham số hoặc phương thức truyền của nó trong Cài đặt máy chủ, MCP.",
  "error.agent.mcpServerUnknown": "Không có máy chủ MCP nào tên {name}. Hãy gọi list_mcp_servers để biết các tên.",
  "error.agent.screenCaptureWindowMissing":
    "Cửa sổ đó hiện không mở. Hãy gọi list_capture_sources để lấy các ID cửa sổ hiện tại.",
  "error.agent.screenCaptureDisplayMissing":
    "Màn hình đó hiện không được kết nối. Hãy gọi list_capture_sources để lấy các ID màn hình hiện tại.",
  "error.agent.screenCaptureRegionOutside":
    "Vùng đó không nằm trong một màn hình. Hãy dùng các điểm trên màn hình nằm trong giới hạn của một màn hình từ list_capture_sources.",
  "error.agent.screenCapturePermissionMissing":
    "OpenBot không có quyền Ghi hình màn hình. Hãy nhờ người dùng mở System Settings > Privacy & Security > Screen & System Audio Recording, bật OpenBot, rồi thoát và mở OpenBot lại.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows trả về một hình ảnh trống. Hãy nhờ người dùng mở khóa máy tính và đóng nội dung được bảo vệ. Chính sách của tổ chức cũng có thể chặn chụp màn hình.",
  "error.agent.screenCaptureFailed": "Chụp màn hình thất bại. Hãy thử lại.",
} as const satisfies PartialTranslation<typeof source>;
