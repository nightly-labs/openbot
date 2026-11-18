import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "Lịch sử không khả dụng cho yêu cầu này. Hãy đọc lại lịch sử gần đây, hoặc dùng channel_history cho công việc trong kênh.",
  "error.agent.historyArgumentsInvalid":
    "Đối số lịch sử không đúng: {detail} Hãy sửa đối số và thử lại. openbot.tool_describe cung cấp lược đồ.",
  "error.agent.toolRequestInvalid":
    "Đối số khám phá công cụ không hợp lệ. Hãy dùng lược đồ đã khai báo và tên công cụ đầy đủ gốc.",
  "error.agent.toolCallArgumentsNotObject":
    "Công cụ không chạy. Trong tool_call, arguments phải là một đối tượng JSON, không phải văn bản. Hãy gửi lại lệnh gọi với arguments là một đối tượng.",
  "error.agent.toolCallDiscoveryTool":
    "Công cụ không chạy. tool_call không thể chạy openbot.tool_search hoặc openbot.tool_describe. Hãy gọi trực tiếp chúng với cùng đối số.",
  "error.agent.toolCallEnvelopeKeys":
    "Công cụ không chạy. tool_call chỉ nhận name và arguments. Hãy đặt đối số của công cụ vào arguments dưới dạng đối tượng, rồi gửi lại lệnh gọi.",
  "error.agent.toolCallMissingName":
    "Công cụ không chạy. tool_call không có name. Hãy đặt tên đầy đủ mà tool_search trả về vào name, ví dụ openbot.history_read, rồi gửi lại lệnh gọi.",
  "error.agent.toolCallUnknownTool":
    "Công cụ không chạy. tool_call không tìm thấy công cụ nào có tên này. Hãy dùng đúng tên đầy đủ mà tool_search trả về, ví dụ openbot_browser.snapshot.",
  "error.agent.toolCallUnknownToolSuggest":
    "Công cụ không chạy. tool_call không tìm thấy công cụ nào có tên này. Tên đầy đủ có thể là {name}. Nếu đúng, hãy gửi lại lệnh gọi với tên đó.",
  "error.agent.toolDescribeUnknownNames":
    "tool_describe không tìm thấy công cụ OpenBot nào tên {names}. Nó chỉ mô tả các công cụ OpenBot và trình duyệt mà openbot.tool_search liệt kê, không mô tả công cụ MCP.",
  "error.agent.toolDescribeDiscoveryNames":
    "Hãy gọi trực tiếp {names}. tool_describe không mô tả các công cụ khám phá.",
  "error.agent.routineScheduleArgumentsInvalid":
    "Lịch chạy của tác vụ định kỳ không hợp lệ: {detail} Hãy sửa lịch chạy và thử lại. openbot.tool_describe cung cấp lược đồ.",
  "error.agent.approvalWhileDeleting": "Không thể phê duyệt khi agent đang bị xóa.",
  "error.agent.accessLocalOnly": "Chỉ có thể thay đổi quyền truy cập của agent trên máy tính chạy agent đó.",
  "error.agent.duplicateCleanupFailed": "Nhân bản agent thất bại và không thể xóa bản sao chưa hoàn chỉnh.",
  "error.agent.commitEffectsFailed": "Giao dịch đã được xác nhận, nhưng các tác động đã lưu thất bại.",
  "error.agent.settingsLocalOnly": "Chỉ có thể thay đổi cài đặt agent trên máy tính chạy agent đó.",
  "error.agent.skillsLocalOnly": "Chỉ có thể thay đổi kỹ năng trên máy tính chạy agent.",
  "error.agent.addLocalOnly": "Chỉ có thể thêm agent trên máy tính chạy chúng.",
  "error.agent.joinedServerUpdate": "Không thể cập nhật agent trên máy chủ đã tham gia từ đây.",
  "error.agent.searchQueryRequired": "Cần có truy vấn tìm kiếm.",
  "error.agent.messageTooLong": "Tin nhắn quá dài.",
  "error.agent.messageOrAttachmentRequired": "Cần có tin nhắn hoặc tệp đính kèm.",
  "error.agent.promptAnswersTooLong": "Câu trả lời cho prompt quá dài.",
  "error.agent.gone": "Agent này không còn tồn tại.",
  "error.agent.instructionsTooLarge":
    "Tệp hướng dẫn quá lớn để mở tại đây. Hãy rút gọn tệp trong trình soạn thảo văn bản.",
  "error.agent.instructionsOutside":
    "Tệp hướng dẫn liên kết tới một vị trí bên ngoài không gian làm việc của agent, nên OpenBot không mở tệp.",
  "error.agent.instructionsReadFailed": "Không thể đọc tệp hướng dẫn.",
  "error.agent.instructionsSaveFailed": "Không thể lưu tệp hướng dẫn.",
  "error.agent.profileGenerationBusy": "Đang bận tạo hồ sơ. Hãy thử lại sau ít phút.",
  "error.agent.instructionsChanged":
    "Agent đã thay đổi tệp hướng dẫn. Thay đổi gần nhất của bạn chưa được lưu. Hãy thực hiện lại.",
  "error.agent.initialMessageRequired": "Cần có tin nhắn đầu tiên.",
  "error.agent.initialMessageTooLong": "Tin nhắn đầu tiên quá dài.",
  "error.agent.setupCleanupFailed": "Thiết lập agent thất bại và không thể xóa agent chưa hoàn chỉnh.",
  "error.agent.modelUnavailable": "Mô hình đã chọn cho agent không khả dụng.",
  "error.agent.modelProviderNotConnected":
    "Mô hình đã chọn cho agent “{model}” không khả dụng: {provider} chưa được kết nối.",
  "error.agent.modelListEmpty":
    "Mô hình đã chọn cho agent “{model}” không khả dụng: {provider} không liệt kê mô hình nào. Lỗi gần nhất: {detail}",
  "error.agent.modelListEmptyNoError":
    "Mô hình đã chọn cho agent “{model}” không khả dụng: {provider} không liệt kê mô hình nào.",
  "error.agent.modelNotInProviderList":
    "Mô hình đã chọn cho agent “{model}” không khả dụng: {provider} không liệt kê mô hình này.",
  "error.agent.modelVariantNotListed":
    "Mô hình đã chọn cho agent “{model}” không khả dụng: {provider} không liệt kê mô hình này. Hãy dùng một trong các giá trị mà {provider} liệt kê cho mô hình này: {models}.",
  "error.agent.modelProviderMismatch": "Mô hình đã chọn không thuộc nhà cung cấp đó.",
  "error.agent.modelNotListed": "Mô hình “{model}” không khả dụng. Các mô hình khả dụng: {models}.",
  "error.agent.providerNotListed":
    "Hiện không có mô hình {provider} nào khả dụng. Hãy gọi list_models để xem các mô hình khả dụng.",
  "error.agent.creatorModelNotListed":
    "Mô hình “{model}” của bạn hiện không có trong danh sách mô hình, nên agent mới không thể khởi động với mô hình này. Hãy thử lại sau vài giây, hoặc đặt provider và model thành một mô hình mà list_models hiển thị.",
  "error.agent.reasoningEffortUnsupported":
    "Mô hình “{model}” không hỗ trợ mức suy luận “{effort}”. Các mức được hỗ trợ: {efforts}.",
  "error.agent.reasoningEffortNotConfigurable":
    "Mô hình “{model}” không có cài đặt mức suy luận, nên bạn không thể thay đổi mức này.",
  "error.agent.noStartingModelInSettings":
    "{provider} không có mô hình nào khả dụng, và không nhà cung cấp nào khác đã đăng nhập có mô hình. Hãy đăng nhập vào một nhà cung cấp, hoặc đổi nhà cung cấp mặc định trong Cài đặt máy chủ → Nhà cung cấp.",
  "error.agent.noStartingModel":
    "{provider} không có mô hình nào khả dụng, và không nhà cung cấp nào khác đã đăng nhập có mô hình. Hãy đăng nhập vào một nhà cung cấp, hoặc đổi nhà cung cấp mặc định trong Nhà cung cấp & quyền.",
  "error.agent.waitBeforeProviderChange": "Hãy đợi lượt hiện tại và hàng đợi hoàn tất trước khi đổi nhà cung cấp.",
  "error.agent.waitForTasksBeforeProviderChange":
    "Các tác vụ của agent này đang chạy. Hãy đợi chúng hoàn tất, hoặc dừng chúng, trước khi đổi nhà cung cấp.",
  "error.agent.waitBeforeClearContext":
    "Hãy đợi lượt hiện tại và hàng đợi hoàn tất trước khi bắt đầu cuộc trò chuyện mới.",
  "error.agent.waitBeforeCompactContext": "Hãy đợi lượt hiện tại và hàng đợi hoàn tất trước khi thu gọn ngữ cảnh.",
  "error.agent.waitBeforeDeleteHistory": "Hãy đợi lượt hiện tại và hàng đợi hoàn tất trước khi xóa lịch sử.",
  "error.agent.compactContextUnavailable": "Agent này hiện không thể thu gọn ngữ cảnh.",
  "error.agent.unknown": "Agent không xác định: {id}",
  "error.agent.onlyUserWidensSettings":
    "Chỉ người dùng mới có thể cấp Toàn quyền cho agent hoặc bật Điều khiển máy tính. Hãy nhờ người dùng thay đổi trong cài đặt của agent.",
  "error.agent.queuedMessageCreateFailed": "Không thể tạo tin nhắn trong hàng đợi.",
  "error.agent.messageUnavailable": "Tin nhắn không còn khả dụng.",
  "error.agent.hostLimit": "Một host chỉ có thể có tối đa {limit} agent.",
  "error.agent.changedWhileDuplicating": "Agent đã thay đổi trong khi đang được nhân bản. Hãy thử lại.",
  "error.agent.duplicatedAgentGone": "Agent được nhân bản không còn tồn tại.",
  "error.agent.stateCorrupt": "Trạng thái agent bị hỏng hoặc đến từ phiên bản OpenBot mới hơn; từ chối ghi đè.",
  "error.agent.oldRoleField":
    "Hồ sơ agent đã lưu dùng trường role cũ; hãy cập nhật dữ liệu trước khi khởi động OpenBot.",
  "error.agent.duplicateIds": "Trạng thái agent chứa id agent trùng lặp; từ chối ghi đè.",
  "error.agent.copyNameFailed": "OpenBot không thể tạo tên riêng cho bản sao agent.",
  "error.agent.endpointRemoved": "Endpoint mà agent này dùng đã bị xóa. Hãy chọn mô hình khác cho agent.",
  "error.agent.turnStalled":
    "{provider} đã ngừng phản hồi, nên OpenBot đã kết thúc lượt này. Hãy gửi lại tin nhắn, hoặc chọn mô hình khác.",
  "error.agent.promptCancelled": "{provider} đã hủy tin nhắn này trước khi bắt đầu. Hãy gửi lại tin nhắn.",
  "error.agent.toolLoopStopped":
    "{provider} lặp lại một bước thất bại nhiều lần, nên OpenBot đã dừng lượt này. Hãy gửi lại tin nhắn, hoặc chọn mô hình khác.",
  "error.agent.answerCutOff":
    "Agent đã dừng trước khi trả lời xong, nên câu trả lời chưa đầy đủ. Hãy gửi lại tin nhắn.",
  "error.agent.compactionConnectionLost":
    "Kết nối bị ngắt trong lúc agent thu gọn ngữ cảnh, nên tác vụ đã dừng. Hãy kiểm tra kết nối internet, rồi gửi tin nhắn để tiếp tục.",
  "error.agent.compactionConnectionLostAddress":
    "Kết nối bị ngắt trong lúc agent thu gọn ngữ cảnh, nên tác vụ đã dừng. Hãy kiểm tra kết nối internet. Đồng thời đảm bảo {variable} trong mục Biến của cài đặt {provider} là địa chỉ API của dịch vụ mô hình, thường kết thúc bằng /v1. Sau đó gửi tin nhắn.",
  "error.agent.compactionLoopStopped":
    "{provider} đã thu gọn ngữ cảnh nhiều lần liên tiếp, và lần nào ngữ cảnh cũng vẫn quá đầy để tiếp tục, nên OpenBot đã dừng lượt này. Hãy tắt các máy chủ MCP hoặc điều khiển máy tính mà agent này không cần, rồi gửi tin nhắn. Nếu bạn hoặc agent đã thay đổi thời điểm {provider} thu gọn ngữ cảnh, hãy hoàn tác thay đổi đó.",
  "error.agent.selectedGone": "Agent đã chọn không còn tồn tại.",
  "error.agent.profileEndpointsChanged": "Các endpoint tùy chỉnh đã thay đổi trong lúc tạo. Hãy thử lại.",
  "error.agent.profileInvalid": "Nhà cung cấp trả về hồ sơ không hợp lệ. Hãy thử sửa prompt của bạn.",
  "error.agent.profileSectionUnavailable": "Phần được tạo không khả dụng. Hãy thử lại hoặc tự chọn một phần.",
  "error.agent.profileTimedOut": "Tạo hồ sơ đã hết thời gian chờ. Hãy thử lại.",
  "error.agent.profileDisconnected": "Nhà cung cấp đã ngắt kết nối trong lúc tạo hồ sơ.",
  "error.agent.profileToolUse": "Nhà cung cấp đã cố dùng một công cụ. Hãy thử sửa prompt của bạn.",
  "error.agent.profileFailed": "Nhà cung cấp không thể tạo hồ sơ. Hãy thử lại.",
  "error.agent.profileTooLarge": "Hồ sơ được tạo quá lớn. Hãy thử prompt ngắn hơn.",
  "error.agent.profileNotStarted": "Nhà cung cấp không thể bắt đầu tạo hồ sơ.",
  "error.agent.deletionBusy": "Agent đang được xóa.",
  "error.agent.stopBeforeDelete": "Hãy dừng agent và hủy các tin nhắn trong hàng đợi trước khi xóa.",
  "error.agent.deleteIncomplete": "Không thể xóa hoàn toàn dữ liệu agent. Hãy thử xóa agent lại.",
  "error.agent.deleteFolderInUse":
    "Công việc của một agent khác vẫn đang dùng thư mục của agent này. Hãy xóa lại agent này khi công việc đó kết thúc, hoặc sau khi khởi động lại OpenBot.",
  "error.agent.duplicationBusy": "Agent này đang được nhân bản.",
  "error.agent.waitBeforeDuplicate": "Hãy đợi agent hoàn tất và xóa hết hàng đợi trước khi nhân bản.",
  "error.agent.saveOtherAgent": "Bản lưu này thuộc về một agent khác.",
  "error.agent.savedGone": "Agent đã lưu không còn tồn tại.",
  "error.agent.storedProfileUnreadable":
    "Một hồ sơ agent đã lưu có giá trị “{field}” không đọc được; hãy cập nhật dữ liệu trước khi khởi động OpenBot.",
  "error.agent.storedProfileUnreadableId":
    "Hồ sơ agent đã lưu {id} có giá trị “{field}” không đọc được; hãy cập nhật dữ liệu trước khi khởi động OpenBot.",
  "error.agent.queueEditRejected": "Sửa hàng đợi bị từ chối: {reason}",
  "error.agent.computerUseLocalOnly": "Chỉ có thể thay đổi Điều khiển máy tính trên máy tính chạy agent.",
  "error.agent.automationLocalOnly": "Chỉ có thể cho phép tập lệnh cục bộ trên máy tính chạy agent.",
  "error.agent.newChatLocalOnly": "Chỉ máy tính chạy agent mới có thể cho phép agent bắt đầu cuộc trò chuyện mới.",
  "error.agent.quickAcknowledgementLocalOnly": "Chỉ máy tính chạy agent mới có thể thay đổi cài đặt này.",
  "error.agent.sideQuestionBusy": "Có quá nhiều câu hỏi phụ đang chạy. Hãy thử lại sau ít phút.",
  "error.agent.sideQuestionFailed": "Agent không thể trả lời câu hỏi phụ. Hãy thử lại.",
  "error.agent.webSearchSignIn": "Tìm kiếm web cần đăng nhập Codex bằng tài khoản ChatGPT.",
  "error.agent.webSearchBusy": "Có quá nhiều lượt tìm kiếm và câu hỏi phụ đang chạy. Hãy thử lại sau ít phút.",
  "error.agent.webSearchFailed": "Tìm kiếm web chưa hoàn tất. Hãy thử lại.",
  "error.agent.busyMessageModeLocalOnly":
    "Chỉ có thể đặt cách xử lý tin nhắn khi agent đang làm việc trên máy tính chạy agent.",
  "error.agent.backupModelsLocalOnly": "Chỉ có thể đặt mô hình dự phòng trên máy tính chạy agent.",
  "error.agent.taskLimitLocalOnly": "Chỉ có thể đặt giới hạn tác vụ trên máy tính chạy agent.",
  "error.agent.localScriptsOff": "Agent này không cho phép tập lệnh cục bộ.",
  "error.agent.localScriptsRateLimited":
    "Tập lệnh cục bộ đã gửi cho agent này {limit} yêu cầu tin nhắn hoặc tác vụ định kỳ trong giờ qua. Hãy thử lại sau.",
  "error.agent.automationOff": "Agent này không cho phép tập lệnh cục bộ chạy các tác vụ định kỳ của nó.",
  "error.agent.automationPayloadTooLong": "Payload dài hơn {limit} ký tự.",
  "error.agent.automationRateLimited":
    "Tập lệnh cục bộ đã chạy các tác vụ định kỳ của agent này {limit} lần trong giờ qua. Hãy thử lại sau.",
  "error.agent.workspaceOnlyMacOnly":
    "Với nhà cung cấp này, Chỉ không gian làm việc chỉ có trên macOS. Hãy chọn Toàn quyền trong cài đặt agent.",
  "error.agent.lowMemory":
    "Máy chủ này sắp hết bộ nhớ. Tin nhắn của bạn đang chờ trong hàng đợi và sẽ bắt đầu khi có bộ nhớ trống. Gói lớn hơn cung cấp thêm bộ nhớ cho máy chủ.",
  "error.agent.lowMemoryServer":
    "Máy chủ này sắp hết bộ nhớ. Tin nhắn của bạn đang chờ trong hàng đợi và sẽ bắt đầu khi có bộ nhớ trống.",
  "error.agent.workspaceOnlyToolMissing":
    "Chỉ không gian làm việc cần {tool}, nhưng OpenBot không tìm thấy. Hãy cài đặt nó, hoặc chọn Toàn quyền trong cài đặt agent.",
  "error.agent.codexSandboxUnavailable":
    "Chỉ không gian làm việc cần sandbox của Codex, nhưng Codex không thể khởi động sandbox trên máy tính này, nên các lệnh của agent thất bại. Hãy chọn Hỏi trước hoặc Toàn quyền trong cài đặt agent.",
  "error.agent.claudeSandboxUnavailable":
    "Chỉ không gian làm việc cần sandbox của Claude, nhưng Claude không thể khởi động sandbox trên máy tính này: {reason}. Hãy chọn Toàn quyền hoặc nhà cung cấp khác trong cài đặt agent.",
  "error.agent.claudeNoSandbox":
    "Claude không thể dùng sandbox trên máy tính này, nên Chỉ không gian làm việc không hoạt động với Claude. Hãy chọn Toàn quyền hoặc nhà cung cấp khác trong cài đặt agent.",
  "error.agent.claudeSandboxBlocked":
    "Chỉ không gian làm việc cần sandbox của Claude, nhưng Claude không thể khởi động sandbox trên máy tính này, nên các lệnh của agent thất bại. Hãy chọn Toàn quyền hoặc nhà cung cấp khác trong cài đặt agent.",
  "error.agent.screenCaptureOff":
    "Chụp màn hình đang tắt cho agent này. Người dùng có thể bật Điều khiển máy tính trong cài đặt agent.",
  "error.agent.screenCaptureUnavailable": "Chụp màn hình không khả dụng trên máy tính này.",
  "error.agent.screenCaptureShared":
    "Chụp màn hình không hoạt động trong cuộc trò chuyện Slack, Discord hoặc Telegram, vì người khác sẽ nhận được tệp chụp.",
  "error.agent.screenCaptureDeclined": "Người dùng không cho phép lần chụp màn hình này. Không có gì được chụp.",
  "error.agent.mcpServerDeclined": "Người dùng không cho phép thay đổi máy chủ MCP này. Không có gì thay đổi.",
  "error.agent.mcpToolDeclined": "Người dùng không cho phép lệnh gọi công cụ MCP này. Công cụ không chạy.",
  "error.agent.mcpServerNotSaved": "Máy chủ MCP không phản hồi, nên chưa được lưu. {error}",
  "error.agent.mcpServerKeysMove":
    "Máy chủ MCP {name} giữ khóa cho máy chủ hiện tại của nó. Hãy nhờ người dùng thay đổi địa chỉ, lệnh, đối số hoặc phương thức truyền trong Cửa hàng, Ứng dụng, {name}.",
  "error.agent.mcpServerBuiltIn":
    "{name} là một phần của OpenBot, nên công cụ MCP không thể kiểm tra, bật, tắt hay xóa nó. Người dùng điều khiển nó trên máy tính chạy OpenBot: kết nối GitHub trong Cửa hàng, Ứng dụng, GitHub, và Điều khiển máy tính trong Cài đặt, Điều khiển máy tính.",
  "error.agent.mcpServerUnknown": "Không có máy chủ MCP nào tên {name}. Hãy gọi list_mcp_servers để xem tên.",
  "error.agent.screenCaptureWindowMissing":
    "Cửa sổ đó hiện không mở. Hãy gọi list_capture_sources để lấy id cửa sổ hiện tại.",
  "error.agent.screenCaptureDisplayMissing":
    "Màn hình đó hiện không được kết nối. Hãy gọi list_capture_sources để lấy id màn hình hiện tại.",
  "error.agent.screenCaptureRegionOutside":
    "Vùng chụp không nằm trong một màn hình. Hãy dùng các điểm desktop nằm trong giới hạn của một màn hình từ list_capture_sources.",
  "error.agent.screenCapturePermissionMissing":
    "OpenBot chưa có quyền Ghi màn hình. Hãy nhờ người dùng mở System Settings > Privacy & Security > Screen & System Audio Recording, bật OpenBot, rồi thoát và mở lại OpenBot.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows trả về ảnh trống. Hãy nhờ người dùng mở khóa máy tính và đóng nội dung được bảo vệ. Chính sách của tổ chức cũng có thể chặn chụp màn hình.",
  "error.agent.screenCaptureFailed": "Chụp màn hình thất bại. Hãy thử lại.",
} as const satisfies PartialTranslation<typeof source>;
