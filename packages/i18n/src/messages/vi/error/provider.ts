import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  // Provider, provider runtime and custom endpoint errors.
  "error.provider.mcpConfig":
    "OpenBot không thể đăng ký các máy chủ MCP trong cấu hình Codex. Hãy kiểm tra rằng tệp config.toml của Codex hợp lệ và ghi được, rồi khởi động lại OpenBot.",
  "error.provider.computerUseConfig":
    "OpenBot không thể đăng ký Điều khiển máy tính trong cấu hình Codex. Hãy kiểm tra rằng tệp config.toml của Codex hợp lệ và ghi được, rồi khởi động lại OpenBot. Bạn có thể tắt Điều khiển máy tính trong cài đặt đồng đội để tiếp tục mà không cần nó.",
  "error.provider.codexUnresponsive": "Codex ngừng phản hồi, nên OpenBot đã kết thúc tiến trình của nó.",
  "error.provider.acpUnresponsive": "{provider} không phản hồi kịp thời, nên OpenBot đã kết thúc tiến trình của nó.",
  "error.provider.acpSignInLost":
    "{provider} đã mất đăng nhập, nên OpenBot đã kết thúc tiến trình của nó. Hãy gửi lại tin nhắn của bạn.",
  "error.provider.acpPlanUsedUp":
    "{provider} cho biết gói của bạn đã hết. Hãy chọn mô hình khác, hoặc nâng cấp gói {provider} của bạn.",
  "error.provider.acpMcpNotLoaded":
    "{provider} không tải được các công cụ của OpenBot, nên trợ lý này không dùng được chúng và cũng không liên hệ được với các đồng đội. Chính sách nhóm {provider} có thể chặn các máy chủ MCP cục bộ. Hãy nhờ quản trị viên nhóm cho phép, rồi thử lại.",
  "error.provider.endpointsReadOnly":
    "Các điểm cuối đã lưu được ghi bởi phiên bản OpenBot mới hơn, hoặc không thể đọc tệp. Hãy cập nhật OpenBot để thay đổi chúng.",
  "error.provider.endpointNoSecureStorage":
    "Máy tính này không có nơi lưu trữ an toàn, nên không thể lưu khóa API hay tiêu đề. Hãy gỡ bỏ chúng, hoặc dùng một điểm cuối không cần thông tin đăng nhập.",
  "error.provider.endpointDuplicate":
    "Một điểm cuối với ID nhà cung cấp này đã được lưu. Hãy gỡ bỏ nó trước, hoặc dùng ID khác.",
  "error.provider.endpointNotSaved": "Điểm cuối này chưa được lưu. Hãy làm mới danh sách và thử lại.",
  "error.provider.endpointKeyForNewAddress":
    "Địa chỉ này có máy tính hoặc cổng mới. Hãy nhập lại khóa API và các tiêu đề, để khóa đã lưu không bị gửi tới đó.",
  "error.provider.endpointSecretUnreadable":
    "Máy tính này không thể đọc khóa API và các tiêu đề đã lưu. Hãy nhập lại khóa API và các tiêu đề, để không mục nào bị mất.",
  "error.provider.discoveryTimeout": "{host} không phản hồi kịp thời.",
  "error.provider.discoveryUnreachable": "OpenBot không thể kết nối tới {host}.",
  "error.provider.discoveryRedirect": "{host} đã gửi một chuyển hướng. Hãy nhập địa chỉ cuối cùng của máy chủ.",
  "error.provider.discoveryRefused": "{host} đã từ chối yêu cầu. Hãy kiểm tra khóa API và các tiêu đề.",
  "error.provider.discoveryHttp": "{host} đã trả lời bằng HTTP {status}.",
  "error.provider.discoveryTooLarge": "Danh sách mô hình từ {host} quá lớn.",
  "error.provider.discoveryInvalid": "{host} không gửi danh sách mô hình tương thích OpenAI.",
  "error.provider.detectionSettingsReadOnly":
    "Cài đặt phát hiện được ghi bởi phiên bản OpenBot mới hơn, hoặc không thể đọc tệp. Hãy cập nhật OpenBot để thay đổi chúng.",
  "error.provider.detectionEntryInvalid":
    "Một địa chỉ phải là URL http:// hoặc https:// không có mật khẩu, và một thư mục phải là đường dẫn tuyệt đối.",
  "error.provider.detectionEntriesTooMany": "Có quá nhiều địa chỉ hoặc thư mục.",
  "error.provider.credentialFileUnreadable": "Không thể đọc tệp thông tin đăng nhập của nhà cung cấp.",
  "error.provider.credentialFileTooLarge": "Tệp thông tin đăng nhập của nhà cung cấp quá lớn.",
  "error.provider.archiveSpecialFile": "Tệp nén runtime chứa liên kết hoặc tệp đặc biệt.",
  "error.provider.archiveUnsafePath": "Tệp nén runtime chứa đường dẫn không an toàn.",
  "error.provider.runtimeSpecialFile": "Runtime chứa liên kết hoặc tệp đặc biệt.",
  "error.provider.codexArchivePath": "Tệp nén Codex có đường dẫn không mong đợi.",
  "error.provider.codexVersionUnexpected": "Phiên bản runtime Codex không mong đợi.",
  "error.provider.claudeArchivePath": "Tệp nén Claude có đường dẫn không mong đợi.",
  "error.provider.claudePackageMismatch": "Gói Claude không khớp với danh mục runtime.",
  "error.provider.claudeChecksum": "Tổng kiểm tra runtime Claude không khớp.",
  "error.provider.claudeLicenseChecksum": "Tổng kiểm tra giấy phép Claude không khớp.",
  "error.provider.opencodeArchivePath": "Tệp nén OpenCode có đường dẫn không mong đợi.",
  "error.provider.opencodePackageMismatch": "Gói OpenCode không khớp với danh mục runtime.",
  "error.provider.opencodeChecksum": "Tổng kiểm tra runtime OpenCode không khớp.",
  "error.provider.opencodeLicenseChecksum": "Tổng kiểm tra giấy phép OpenCode không khớp.",
  "error.provider.grokChecksum": "Tổng kiểm tra runtime Grok không khớp.",
  "error.provider.grokLicenseChecksum": "Tổng kiểm tra giấy phép Grok không khớp.",
  "error.provider.grokNoticesChecksum": "Tổng kiểm tra thông báo Grok không khớp.",
  "error.provider.bunArchivePath": "Tệp nén Bun có đường dẫn không mong đợi.",
  "error.provider.bunPackageMismatch": "Gói Bun không khớp với danh mục runtime.",
  "error.provider.bunChecksum": "Tổng kiểm tra runtime Bun không khớp.",
  "error.provider.bunLicenseChecksum": "Tổng kiểm tra giấy phép Bun không khớp.",
  "error.provider.bunxDamaged": "Bộ chạy trình quản lý gói Bun bị thiếu hoặc hỏng.",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot không thể truy cập các nguồn phát hành của nhà cung cấp. Hãy kiểm tra kết nối và thử lại.",
  "error.provider.runtimesUnsupported": "Runtime của nhà cung cấp không khả dụng trên nền tảng này.",
  "error.provider.closing": "OpenBot đang đóng lại.",
  "error.provider.removeWhileOn": "Hãy tắt nhà cung cấp trước khi gỡ bỏ bản tải xuống của nó.",
  "error.provider.removeWhileDownloading": "Hãy đợi bản tải xuống kết thúc, rồi gỡ bỏ.",
  "error.provider.removeIncomplete": "Một chương trình đang dùng một số tệp của CLI này. Hãy đóng nó, rồi thử lại.",
  "error.provider.removeDownloadsFailed": "Không thể gỡ bỏ các bản tải xuống CLI của {providers}.",
  "error.provider.cliOverride": "Hãy gỡ bỏ ghi đè đường dẫn CLI trước khi cập nhật trong OpenBot.",
  "error.provider.runtimeUpdateIncomplete": "Bản cập nhật runtime không hoàn tất.",
  "error.provider.downloadHttp": "Tải xuống runtime thất bại với HTTP {status}.",
  "error.provider.downloadNoData": "Tải xuống runtime không trả về dữ liệu.",
  "error.provider.downloadSize": "Bản tải xuống runtime có kích thước không mong đợi.",
  "error.provider.downloadIntegrity": "Bản tải xuống runtime không vượt qua kiểm tra toàn vẹn.",
  "error.provider.runtimeReplacing": "Không thể cài runtime vì một bản sao khác đang thay thế nó.",
  "error.provider.runtimeFilesInUse":
    "Không thể cài runtime vì một chương trình khác đang mở các tệp của nó. Hãy đóng nó và thử lại.",
  "error.provider.metadataHttp": "Tải xuống siêu dữ liệu runtime thất bại với HTTP {status}.",
  "error.provider.metadataIntegrity": "Siêu dữ liệu runtime không vượt qua kiểm tra toàn vẹn.",
  "error.provider.diskSpace": "Không đủ dung lượng đĩa trống cho nhà cung cấp này.",
  "error.provider.unexpectedVersion": "Runtime của nhà cung cấp trả về phiên bản không mong đợi.",
  "error.provider.metadataNoData": "Tải xuống siêu dữ liệu runtime không trả về dữ liệu.",
  "error.provider.metadataTooLarge": "Siêu dữ liệu runtime quá lớn.",
  "error.provider.requestFailed": "OpenBot không thể tải xuống {url}. {reason}",
  "error.provider.installRecordMismatch": "Bản ghi cài đặt runtime không khớp.",
  "error.provider.runtimeChecksum": "Tổng kiểm tra runtime của nhà cung cấp không khớp.",
  "error.provider.codexReleaseShape": "Bản phát hành Codex có cấu trúc không mong đợi.",
  "error.provider.codexReleaseNoDownload": "Bản phát hành Codex không có bản tải xuống xác minh được cho máy tính này.",
  "error.provider.claudeReleaseShape": "Bản phát hành Claude có cấu trúc không mong đợi.",
  "error.provider.grokReleaseVersion": "Bản phát hành Grok có phiên bản không mong đợi.",
  "error.provider.blockedListShape": "Danh sách phiên bản bị chặn có cấu trúc không mong đợi.",
  "error.provider.releaseNoDownload": "Bản phát hành {name} không có bản tải xuống nào xác minh được.",
  "error.provider.releaseSizeUnknown": "Bản tải xuống phát hành không có kích thước đã biết.",
  "error.provider.releaseMetadataNotObject": "Siêu dữ liệu phát hành không phải là một đối tượng JSON.",
  "error.provider.releaseCheckHttp": "Kiểm tra phát hành thất bại với HTTP {status}.",
  "error.provider.releaseMetadataTooLarge": "Siêu dữ liệu phát hành quá lớn.",
  "error.provider.idInvalid": "ID nhà cung cấp phải là chữ thường, chữ số, `-` hoặc `_`.",
  "error.provider.baseUrlInvalid": "URL cơ sở không phải là một URL.",
  "error.provider.baseUrlProtocol": "URL cơ sở phải bắt đầu bằng http:// hoặc https://.",
  "error.provider.baseUrlCredentials":
    "URL cơ sở không được chứa tên người dùng hoặc mật khẩu. Hãy đặt thông tin đăng nhập vào một tiêu đề.",
  "error.provider.modelsRequired": "Cần ít nhất một mô hình.",
  "error.provider.modelsTooMany": "Có quá nhiều mô hình.",
  "error.provider.modelIdCharacter": "ID mô hình chứa ký tự không dùng được.",
  "error.provider.modelIdDuplicate": "Hai mô hình có cùng ID.",
  "error.provider.contextWindowInvalid": "Cửa sổ ngữ cảnh của một mô hình phải là số token nguyên từ {min} đến {max}.",
  "error.provider.maxOutputInvalid": "Đầu ra tối đa của một mô hình phải là số token nguyên từ {min} đến {max}.",
  "error.provider.reasoningEffortsInvalid": "Mức độ suy luận của một mô hình không hợp lệ.",
  "error.provider.inputsInvalid": "Các loại đầu vào của một mô hình không hợp lệ.",
  "error.provider.headersTooMany": "Có quá nhiều tiêu đề.",
  "error.provider.headerNameCharacter": "Tên tiêu đề chứa ký tự mà HTTP không cho phép.",
  "error.provider.headerNameTooLong": "Tên tiêu đề quá dài.",
  "error.provider.headerNameDuplicate": "Hai tiêu đề có cùng tên.",
  "error.provider.headerValueInvalid": "Giá trị tiêu đề bị thiếu hoặc quá dài.",
  "error.provider.headerValueMissing": "Tiêu đề {name} cần một giá trị.",
  "error.provider.apiKeyTooLong": "Khóa API quá dài.",
  "error.provider.localOnly": "Chỉ có thể thay đổi nhà cung cấp trên máy tính đang chạy các trợ lý.",
  "error.provider.keyRequired": "Cần có khóa nhà cung cấp.",
  "error.provider.keyTooLong": "Khóa nhà cung cấp quá dài.",
  "error.provider.keyInvalidCharacters": "Khóa nhà cung cấp chứa khoảng trắng hoặc ký tự mà khóa không thể chứa.",
  "error.provider.noModel": "Nhà cung cấp đã chọn không có mô hình nào khả dụng.",
  "error.provider.noModelNamed": "{provider} không có mô hình nào khả dụng.",
  "error.provider.acpNoModels": "ACP CLI không công bố mô hình ACP nào. OpenBot sẽ không đoán một mô hình dự phòng.",
  "error.provider.endpointRemoveBusy": "Hãy đợi lượt đang chạy và hàng đợi hoàn tất trước khi gỡ bỏ điểm cuối này.",
  "error.provider.codexOutdated": "Codex CLI {version} quá cũ. OpenBot yêu cầu 0.156.0 trở lên.",
  "error.provider.codexNotStarted": "Đã tìm thấy Codex CLI nhưng không thể khởi động.",
  "error.provider.codexNotStartedHint":
    "Đã tìm thấy Codex CLI nhưng không thể khởi động. Hãy chạy `codex --version` trong một terminal mới.",
  "error.provider.codexManagedNotStarted":
    "ChatGPT đã được tải xuống nhưng không thể khởi động. Hãy tải xuống lại trong OpenBot.",
  "error.provider.codexMissing": "ChatGPT chưa được tải xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.claudeOutdated": "Claude Code {version} quá cũ. OpenBot yêu cầu 2.1.232 trở lên.",
  "error.provider.claudeNotStarted": "Đã tìm thấy Claude CLI nhưng không thể khởi động.",
  "error.provider.claudeNotStartedHint":
    "Đã tìm thấy Claude CLI nhưng không thể khởi động. Hãy chạy `claude --version` trong một terminal mới.",
  "error.provider.claudeManagedNotStarted":
    "Claude đã được tải xuống nhưng không thể khởi động. Hãy tải xuống lại trong OpenBot.",
  "error.provider.claudeMissing": "Claude chưa được tải xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.grokOutdated": "Grok CLI {version} quá cũ. OpenBot yêu cầu 1.0.5 trở lên.",
  "error.provider.grokNotStarted": "Đã tìm thấy Grok CLI nhưng không thể khởi động.",
  "error.provider.grokNotStartedHint":
    "Đã tìm thấy Grok CLI nhưng không thể khởi động. Hãy chạy `grok --version` trong một terminal mới.",
  "error.provider.grokMissing": "Grok chưa được tải xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.opencodeNotStarted":
    "OpenCode không thể khởi động. Hãy chạy `opencode --version` trong một terminal.",
  "error.provider.opencodeMissing": "OpenCode chưa được tải xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.codexVersionUnreadable": "Không thể đọc phiên bản Codex CLI.",
  "error.provider.claudeVersionUnreadable": "Không thể đọc phiên bản Claude CLI.",
  "error.provider.grokVersionUnreadable": "Không thể đọc phiên bản Grok CLI.",
  "error.provider.opencodeVersionUnreadable": "Không thể đọc phiên bản OpenCode CLI.",
  "error.provider.bunVersionUnreadable": "Không thể đọc phiên bản runtime Bun.",
  "error.provider.connectBeforeProfile": "Hãy kết nối nhà cung cấp đã chọn trước khi tạo hồ sơ.",
  "error.provider.cliNotReady": "CLI {provider} chưa sẵn sàng hoặc chưa đăng nhập.",
  "error.provider.cliTimedOut": "{provider} không phản hồi kịp thời. Máy tính có thể đang bận. OpenBot sẽ thử lại.",
  "error.provider.cliTimedOutRefresh":
    "{provider} không phản hồi kịp thời. Máy tính có thể đang bận. Hãy làm mới các nhà cung cấp để thử lại.",
  "error.provider.acpStartTimedOut": "{provider} không khởi động xong trong {seconds} giây. Máy tính có thể đang bận.",
  "error.provider.acpModelsTimedOut":
    "{provider} không liệt kê được mô hình trong {seconds} giây. Máy tính có thể đang bận.",
  "error.provider.startStopped":
    "{provider} không khởi động được nhiều lần liên tiếp, nên OpenBot đã ngừng thử. Hãy làm mới các nhà cung cấp để thử lại.",
  "error.provider.tempDiskSpace":
    "{provider} cần ít nhất 1 GB dung lượng đĩa trống để khởi động. Hãy giải phóng dung lượng, rồi làm mới các nhà cung cấp.",
  "error.provider.noCodeSignIn": "Không thể đăng nhập {provider} bằng mã.",
  "error.provider.codeLoginNoLink": "Nhà cung cấp không hiển thị liên kết đăng nhập. Hãy thử lại.",
  "error.provider.hostSignInEnded": "{provider} không đăng nhập xong. Hãy thử lại.",
  "error.provider.codeLoginNotWaiting": "Không có đăng nhập nào đang chờ mã. Hãy bắt đầu đăng nhập lại.",
  "error.provider.codeLoginBadCode": "Hãy dán mã mà trang đăng nhập hiển thị.",
  "error.provider.codeLoginRefused": "Nhà cung cấp không chấp nhận mã. Hãy bắt đầu đăng nhập lại.",
  "error.provider.codeLoginUnsupported":
    "Máy chủ này không thể đăng nhập bằng mã dán. Hãy đăng nhập trên máy tính của máy chủ, trong trình duyệt của nó.",
  "error.provider.cliBusyRetry": "CLI {provider} đang xử lý một lượt. Hãy đợi nó xong, rồi thử lại.",
  "error.provider.cliSigningIn": "CLI {provider} đang đăng nhập. Hãy hoàn tất hoặc hủy đăng nhập, rồi cập nhật.",
  "error.provider.cliBusyUpdate": "CLI {provider} đang xử lý một lượt. Hãy đợi nó xong, rồi cập nhật.",
  "error.provider.cliSelectFailed": "OpenBot không thể chọn CLI được quản lý đã cài đặt.",
  "error.provider.noAuthenticatedAccount": "{provider} không trả về tài khoản đã xác thực.",
  "error.provider.signInExpired": "Đăng nhập {provider} của bạn đã hết hạn. Hãy đăng nhập lại để tiếp tục.",
  "error.provider.cliActivateFailed": "OpenBot không thể kích hoạt CLI được quản lý.",
  "error.provider.noMainlandChinaSignIn": "{provider} không có đăng nhập cho Trung Quốc đại lục.",
  "error.provider.cliNewVersionNotStarted": "Phiên bản mới không khởi động được.",
  "error.provider.cliBusyReconnect": "CLI {provider} đang xử lý một lượt. Hãy đợi nó xong, rồi kết nối lại.",
  "error.provider.cliBusySignOut": "CLI {provider} đang xử lý một lượt. Hãy đợi nó xong, rồi ngắt kết nối.",
  "error.provider.opencodeCredentialsRejected":
    "Nhà cung cấp mô hình đã từ chối khóa API. Hãy sửa khóa OpenCode trong Cài đặt, hoặc khóa của nhà cung cấp bằng `opencode auth login`. Rồi thử lại hoặc chọn mô hình khác.\n{detail}",
  "error.provider.opencodeAuthRequired":
    'OpenCode không có đăng nhập cho nhà cung cấp mô hình "{provider}". Hãy chọn một mô hình có nhãn Miễn phí, hoặc kết nối nhà cung cấp: dán khóa OpenCode Go trong cài đặt OpenCode, hoặc chạy `opencode auth login` trong một terminal. Rồi thử lại.',
  "error.provider.opencodeAuthRequiredUnknown":
    "OpenCode không có đăng nhập cho nhà cung cấp của mô hình này. Hãy chọn một mô hình có nhãn Miễn phí, hoặc kết nối nhà cung cấp: dán khóa OpenCode Go trong cài đặt OpenCode, hoặc chạy `opencode auth login` trong một terminal. Rồi thử lại.",
  "error.provider.customEndpointKeyRefused":
    'Điểm cuối "{provider}" đã từ chối khóa API hoặc tiêu đề của nó. Hãy nhập lại chúng trong Cài đặt máy chủ → Nhà cung cấp, rồi thử lại.',
  "error.provider.customEndpointKeyMissing":
    'Điểm cuối "{provider}" cần một khóa API. Hãy thêm khóa trong Cài đặt máy chủ → Nhà cung cấp, rồi thử lại.',
  "error.provider.opencodeKeyExpired":
    "Khóa API OpenCode của bạn đã hết hạn. Hãy tạo khóa mới trong OpenCode Console, dán vào cài đặt OpenCode, rồi thử lại.",
  "error.provider.opencodeServiceFailure":
    "OpenCode không thể hoàn tất lượt này vì dịch vụ cục bộ của nó gặp sự cố. Hãy thử lại. Nếu lỗi vẫn tiếp diễn, hãy kết nối lại OpenCode trong Cài đặt.",
  "error.provider.opencodeRateLimited":
    "Nhà cung cấp mô hình đã từ chối yêu cầu vì giới hạn tần suất của nó. Hãy đợi vài phút hoặc chọn mô hình khác, rồi thử lại.\n{detail}",
  "error.provider.opencodeBilling":
    "Nhà cung cấp mô hình đã từ chối yêu cầu vì thông tin thanh toán của tài khoản. Việc chờ sẽ không khắc phục được. Hãy thêm phương thức thanh toán hoặc số dư trong tài khoản nhà cung cấp, hoặc chọn mô hình khác.\n{detail}",
  "error.provider.opencodeInvalidUpload":
    "Nhà cung cấp mô hình của OpenCode báo yêu cầu tải lên không hợp lệ. Hãy chọn mô hình khác và tiếp tục. Hãy kiểm tra các nhiệm vụ định kỳ đã lưu trước khi tạo lại chúng.\n{detail}",
  "error.provider.opencodeUnreadableContent":
    "Mô hình này không thể đọc tệp hoặc hình ảnh trong cuộc hội thoại này. Hãy chọn một mô hình có thể đọc tệp, rồi gửi lại tin nhắn của bạn.",
  "error.provider.opencodeFreeLimit":
    "Các mô hình OpenCode miễn phí đã đạt giới hạn mức dùng. Mọi mô hình miễn phí đều dùng chung giới hạn này. Để tiếp tục, hãy dán khóa OpenCode Go trong cài đặt OpenCode, hoặc chọn một mô hình của nhà cung cấp khác.",
  "error.provider.opencodeProviderFailed":
    "Nhà cung cấp mô hình đã gặp sự cố ở phía họ. Kết nối của bạn không phải nguyên nhân. Hãy thử lại sau hoặc chọn mô hình khác.\n{detail}",
  "error.provider.opencodeNetwork":
    "OpenCode không thể kết nối tới nhà cung cấp mô hình. Hãy kiểm tra kết nối mạng của máy tính đang chạy OpenBot, rồi thử lại.\n{detail}",
  "error.provider.codexStateBusy":
    "ChatGPT vẫn đang chuẩn bị lịch sử cục bộ sau lần khởi động trước. Hãy đợi vài phút, rồi thử lại.",
  "error.provider.realtimeLimitZero":
    "Linux đã dừng nhà cung cấp vì OpenBot có giới hạn CPU thời gian thực bằng 0. Giới hạn này đến từ hệ thống của bạn. Hãy cài đặt và khởi động rtkit (`rtkit-daemon`), chạy `systemctl --user restart xdg-desktop-portal`, rồi khởi động lại OpenBot. Chỉ khởi động lại xdg-desktop-portal không giúp ích khi rtkit còn thiếu.",
  "error.provider.opencodeDatabaseNewer":
    "OpenCode không thể mở cơ sở dữ liệu của nó vì một phiên bản OpenCode mới hơn đã thay đổi nó. Hãy cập nhật OpenCode lên phiên bản 2 trở lên, rồi thử lại.",
  "error.provider.opencodeNoAnswer":
    "Mô hình OpenCode đã kết thúc lượt mà không có câu trả lời. Hãy thử lại, hoặc chọn mô hình khác.",
  "error.provider.opencodeReasoningWithoutAnswer":
    "Mô hình OpenCode đã kết thúc lượt sau bước suy luận, mà không có câu trả lời. Hãy thử lại, hoặc chọn mô hình khác.",
  "error.provider.acpNoAnswer":
    "{provider} đã kết thúc lượt mà không có câu trả lời. Hãy gửi lại tin nhắn, hoặc bắt đầu một cuộc hội thoại mới.",
  "error.provider.chatgptPageFailed": "OpenBot không thể mở trang kết nối ChatGPT.",
  "error.provider.noneReady": "Không có nhà cung cấp trợ lý nào sẵn sàng.",
  "error.provider.claudeTurnActive": "Hãy đợi lượt Claude đang chạy kết thúc trước khi làm mới ngữ cảnh của nó.",
  "error.provider.codexLoginRequired": "Codex yêu cầu đăng nhập bằng gói đăng ký ChatGPT. Hãy chạy `codex login`.",
  "error.provider.cliUpdateFailed": "OpenBot không thể cập nhật CLI {provider}. {reason}",
  "error.provider.tryAgain": "Hãy thử lại.",
  "error.provider.noAgentProcess": "{provider} không có tiến trình nào đang chạy cho trợ lý này.",
  "error.provider.stoppedBeforeAgentProcess": "{provider} đã dừng trước khi tiến trình của trợ lý khởi động.",
  "error.provider.archiveUnreadable": "Không thể đọc tệp nén runtime hoặc nó dùng định dạng không được hỗ trợ.",
  "error.provider.antigravityArchivePath": "Tệp nén Gemini chứa tệp không mong đợi.",
  "error.provider.antigravityChecksum": "Tổng kiểm tra runtime Gemini không khớp.",
  "error.provider.antigravityReleaseShape": "Bản phát hành Gemini có cấu trúc không mong đợi.",
  "error.provider.antigravityMissing": "Gemini chưa được tải xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.antigravityNotStarted": "Đã tìm thấy máy chủ Gemini nhưng không thể đọc phiên bản của nó.",
  "error.provider.antigravityOverrideInvalid":
    "Máy chủ Gemini trong OPENBOT_ANTIGRAVITY_PATH bị thiếu hoặc không thể chạy. Hãy sửa đường dẫn hoặc gỡ bỏ biến, rồi khởi động lại OpenBot.",
  "error.provider.antigravityVersionUnreadable": "Không thể đọc phiên bản máy chủ Gemini.",
  "error.provider.antigravitySignIn": "Hãy đăng nhập bằng Google để dùng Gemini.",
  "error.provider.antigravityRateLimited":
    "Gemini đã từ chối yêu cầu vì đã đạt giới hạn tần suất hoặc hạn mức của gói. Hãy đợi vài phút hoặc chọn mô hình khác, rồi thử lại.\n{detail}",
  "error.provider.antigravityQuotaReached":
    "Google cho biết đã đạt giới hạn mức dùng của Gemini. Giới hạn có thể chỉ áp dụng cho một mô hình, nên trang mức dùng của gói vẫn còn lượt. Hãy chọn mô hình Gemini khác, hoặc đợi đến khi đặt lại.\n{detail}",
  "error.provider.antigravityModelUnavailable":
    "Gemini không thể dùng mô hình này lúc này. Hãy chọn mô hình khác, rồi thử lại.\n{detail}",
  "error.provider.antigravityServiceFailure":
    "Dịch vụ Gemini của Google không hoàn tất yêu cầu. Hãy thử lại sau vài phút.\n{detail}",
  "error.provider.cursorArchivePath": "Tệp nén Cursor chứa tệp không mong đợi.",
  "error.provider.cursorChecksum": "Tổng kiểm tra runtime Cursor không khớp.",
  "error.provider.cursorReleaseShape": "Bản phát hành Cursor có cấu trúc không mong đợi.",
  "error.provider.cursorMissing": "Cursor chưa được tải xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.cursorNotStarted": "Đã tìm thấy trợ lý Cursor nhưng không thể đọc phiên bản của nó.",
  "error.provider.cursorVersionUnreadable": "Không thể đọc phiên bản trợ lý Cursor.",
  "error.provider.cursorSignIn": "Hãy đăng nhập bằng Cursor hoặc đặt CURSOR_API_KEY để dùng Cursor.",
  "error.provider.clineArchivePath": "Tệp nén Cline có đường dẫn không mong đợi.",
  "error.provider.clinePackageMismatch": "Gói Cline không khớp với danh mục runtime.",
  "error.provider.clineChecksum": "Tổng kiểm tra runtime Cline không khớp.",
  "error.provider.clineLicenseChecksum": "Tổng kiểm tra giấy phép Cline không khớp.",
  "error.provider.clineMissing": "Cline chưa được tải xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.clineOutdated": "Cline CLI {version} quá cũ. OpenBot yêu cầu 3.0.68 trở lên.",
  "error.provider.clineNotStarted": "Cline không thể khởi động. Hãy chạy `cline --version` trong một terminal.",
  "error.provider.clineVersionUnreadable": "Không thể đọc phiên bản Cline CLI.",
  "error.provider.clineSignIn": "Hãy đăng nhập bằng Cline hoặc đặt CLINE_API_KEY để dùng Cline.",
  "error.provider.kimiArchivePath": "Tệp nén Kimi có đường dẫn không mong đợi.",
  "error.provider.kimiChecksum": "Tổng kiểm tra runtime Kimi không khớp.",
  "error.provider.kimiLicenseChecksum": "Tổng kiểm tra giấy phép Kimi không khớp.",
  "error.provider.kimiMissing": "Kimi chưa được tải xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.kimiOutdated": "Kimi CLI {version} quá cũ. OpenBot yêu cầu 1.52.0 trở lên.",
  "error.provider.kimiNotStarted": "Kimi không thể khởi động. Hãy chạy `kimi --version` trong một terminal.",
  "error.provider.kimiVersionUnreadable": "Không thể đọc phiên bản Kimi CLI.",
  "error.provider.kimiSignIn": "Hãy đăng nhập bằng Kimi Code để dùng Kimi.",
  "error.provider.devinSignIn": "Hãy đăng nhập bằng Devin để dùng Devin.",
  "error.provider.copilotSignIn": "Hãy đăng nhập bằng GitHub hoặc đặt COPILOT_GITHUB_TOKEN để dùng GitHub Copilot.",
  "error.provider.mistralSignIn": "Hãy đăng nhập bằng Mistral hoặc đặt MISTRAL_API_KEY để dùng Mistral.",
  "error.provider.hermesMissing": "Hermes Agent chưa được cài đặt. Hãy cài đặt, rồi thử lại.",
  "error.provider.hermesNotStarted":
    "Hermes Agent không thể khởi động. Hãy chạy `hermes --version` trong một terminal.",
  "error.provider.hermesVersionUnreadable": "Không thể đọc phiên bản Hermes Agent.",
  "error.provider.hermesSignIn":
    "Hãy đăng nhập bằng Nous Portal, hoặc chạy `hermes setup` trong một terminal, để dùng Hermes.",
  "error.provider.usageLimitReached": "Tài khoản đã đạt giới hạn mức dùng.",
  "error.provider.claudeApiKeyNoCredit":
    "Số dư tín dụng của khóa API Anthropic quá thấp. Gói Claude không trả phí cho các yêu cầu dùng khóa API. Hãy nạp thêm tín dụng trong Anthropic Console, hoặc đăng nhập Claude trong Cài đặt và chọn tài khoản Claude trong menu mô hình của trợ lý.",
  "error.provider.foreignReasoning":
    "{provider} không chấp nhận phần suy luận trước đó trong cuộc hội thoại này, vì một tài khoản hoặc khóa API khác đã nhận nó. OpenBot đã mở một phiên {provider} mới kèm lịch sử cuộc hội thoại. Hãy thử lại.",
  "error.provider.opencodeSessionRejected":
    "OpenCode đã từ chối yêu cầu mà không cho biết nguyên nhân. Điều này có thể xảy ra trong một cuộc hội thoại dài hoặc sau khi đổi mô hình. OpenBot đã mở một phiên OpenCode mới kèm lịch sử cuộc hội thoại. Hãy thử lại. Nếu lỗi vẫn tiếp diễn, hãy chọn mô hình khác hoặc mức độ suy luận thấp hơn.",
  "error.provider.museMcpStartupFault":
    "Muse không thể khởi động một máy chủ MCP và đã chặn MCP trong phiên này. OpenBot đã mở một phiên Muse mới kèm lịch sử cuộc hội thoại. Hãy thử lại. Nếu lỗi vẫn tiếp diễn, hãy tắt Điều khiển máy tính hoặc máy chủ MCP bị lỗi cho trợ lý này.",
  "error.provider.claudeSessionMissing":
    "Claude Code không thể tìm thấy phiên đã lưu của cuộc hội thoại này. OpenBot đã mở một phiên Claude Code mới kèm lịch sử cuộc hội thoại. Hãy thử lại.",
  "error.provider.grokSignIn": "Hãy chạy `grok login` hoặc đặt XAI_API_KEY để dùng Grok.",
  "error.provider.acpSignInTimedOut": "Đăng nhập đã hết thời gian chờ.",
  "error.provider.acpSignInStopped": "Đăng nhập đã dừng trước khi hoàn tất.",
  "error.provider.geminiBrowserUnavailable":
    "Gemini không thể mở trang đăng nhập. Hãy cài đặt một trình duyệt và xdg-utils, rồi kết nối từ một phiên desktop trên máy tính này. Một máy chủ không có desktop không thể hoàn tất đăng nhập này.",
  "error.provider.geminiBrowserOpenFailed":
    "Gemini không thể mở trang đăng nhập trong trình duyệt của bạn. Hãy kiểm tra trình duyệt mặc định, rồi kết nối lại.",
  "error.provider.acpSignInFailed": "Đăng nhập không hoàn tất.",
  "error.provider.acpSignInFailedReason": "Đăng nhập không hoàn tất: {reason}",
  "error.provider.acpSignOutFailed": "Đăng xuất không hoàn tất.",
  "error.provider.acpSignOutFailedReason": "Đăng xuất không hoàn tất: {reason}",
  "error.provider.acpSignInMethodMissing":
    "Nhà cung cấp này không cung cấp cách đăng nhập này trên máy tính này. Hãy cập nhật nhà cung cấp, rồi thử lại.",
  "error.provider.httpsSignInLinkOnly": "Chỉ liên kết đăng nhập HTTPS mới mở được trong trình duyệt.",
  "error.provider.geminiKeyRefused":
    "Gemini đã từ chối khóa API đã lưu. Hãy thay hoặc gỡ bỏ khóa trong Cài đặt, rồi kết nối lại.",
  "error.provider.geminiVerificationRequired":
    "Google phải xác minh tài khoản của bạn trước khi Gemini có thể trả lời. Hãy xác minh tài khoản Google trong một trình duyệt, rồi gửi lại tin nhắn của bạn.",
  "error.provider.keyProviderRefused":
    "{provider} đã từ chối khóa API đã lưu. Hãy thay hoặc gỡ bỏ khóa trong Cài đặt, rồi thử lại.",
  "error.provider.keyProviderNoBalance":
    "Tài khoản {provider} của khóa API đã lưu không có số dư. Hãy nạp thêm tín dụng vào tài khoản, rồi thử lại.",
  "error.provider.messageTooLarge": "OpenBot đã dừng {provider} vì nó gửi một tin nhắn lớn hơn {limit} MB.",
  "error.provider.customAgentIdInvalid":
    "ID trợ lý phải là chữ thường, chữ số hoặc `-`, và không được là ID của một nhà cung cấp tích hợp.",
  "error.provider.customAgentEnvInvalid":
    "Tên biến phải là chữ, chữ số hoặc `_`, và không được bắt đầu bằng chữ số. Hãy dùng mỗi tên một lần, tối đa 16 tên.",
  "error.provider.customAgentUsagePromptInvalid": "Lệnh sử dụng phải là một dòng dài tối đa 256 ký tự.",
  "error.provider.customAgentCommandInvalid":
    "Lệnh phải là một đường dẫn đầy đủ, một đường dẫn bắt đầu bằng ~/, hoặc một tên lệnh không có khoảng trắng.",
  "error.provider.customAgentArgsInvalid": "Một tham số không được chứa ký tự xuống dòng. Hãy dùng tối đa 32 tham số.",
  "error.provider.customAgentWindowsScript":
    "Lệnh .cmd hoặc .bat chỉ nhận chữ, số và - _ . , : = @ + / \\ trong các tham số của nó.",
  "error.provider.customAgentNotFound": "OpenBot không thể tìm thấy {command}. Hãy nhập đường dẫn đầy đủ của lệnh.",
  "error.provider.customAgentCheckTimedOut": "Trợ lý không phản hồi trong 20 giây.",
  "error.provider.customAgentCheckStopped": "Trợ lý đã dừng trước khi phản hồi.",
  "error.provider.customAgentProtocolVersion": "Trợ lý dùng phiên bản ACP {version}. OpenBot dùng phiên bản 1.",
  "error.provider.customAgentCheckFailed": "Trợ lý không phản hồi với tư cách là trợ lý ACP.",
  "error.provider.customAgentRemoveBusy":
    "Hãy đợi lượt đang chạy và hàng đợi hoàn tất trước khi gỡ bỏ trợ lý tùy chỉnh này.",
  "error.provider.customAgentNone": "Không có trợ lý tùy chỉnh nào được lưu.",
  "error.provider.customAgentsUnavailable":
    "Máy chủ này không thể thay đổi các trợ lý tùy chỉnh của nó. Hãy cập nhật OpenBot trên máy chủ đó.",
  "error.provider.customAgentMissing": "Trợ lý tùy chỉnh này hiện không được lưu. Hãy chọn mô hình khác.",
  "error.provider.customAgentSignIn": "Hãy đăng nhập bằng lệnh riêng của trợ lý, rồi thử lại.",
  "error.provider.customAgentsReadOnly":
    "Các trợ lý tùy chỉnh đã lưu được ghi bởi phiên bản OpenBot mới hơn, hoặc không thể đọc tệp. Hãy cập nhật OpenBot để thay đổi chúng.",
  "error.provider.customAgentNoSecureStorage":
    "Máy tính này không có nơi lưu trữ an toàn, nên không thể lưu giá trị biến môi trường. Hãy gỡ bỏ chúng và thử lại.",
  "error.provider.customAgentNotSaved": "Trợ lý tùy chỉnh này chưa được lưu. Hãy làm mới danh sách và thử lại.",
  "error.provider.customAgentWorkspaceOnly":
    "{reason}. Chỉ không gian làm việc chặn điều này. Hãy thử Toàn quyền truy cập.",
  "error.provider.customAgentTooMany": "Bạn có thể lưu tối đa {count} trợ lý tùy chỉnh.",
  "error.provider.customAgentEnvValueMissing": "Hãy nhập một giá trị cho {name}.",
  "error.provider.off": "{provider} đang tắt trong OpenBot. Hãy bật nó trong cài đặt nhà cung cấp trước.",
  "error.provider.inUse": "Một trợ lý đang dùng {provider}. Hãy đổi mô hình của nó trước khi tắt nhà cung cấp này.",
  "error.provider.useBusy": "Hãy đợi kiểm tra nhà cung cấp hoặc đăng nhập hoàn tất, rồi thử lại.",
  "error.provider.useSettingsReadOnly":
    "Cài đặt nhà cung cấp đã lưu không thể đọc được. Hãy cập nhật OpenBot trước khi thay đổi chúng.",
  "error.provider.useChangeFailed": "OpenBot không thể thay đổi cài đặt nhà cung cấp.",
  "error.provider.accountsUnsupported": "{provider} chỉ chứa được một tài khoản.",
  "error.provider.accountNeedsConnection": "Hãy kết nối {provider} trước khi thêm một tài khoản khác.",
  "error.provider.usageResetUnsupported": "{provider} không thể đặt lại giới hạn mức dùng.",
  "error.provider.signOutUnsupported": "OpenBot không thể ngắt đăng nhập {provider}.",
  "error.provider.usageResetNotConnected":
    "Hãy đăng nhập lại vào tài khoản {provider} này trước khi đặt lại mức dùng của nó.",
  "error.provider.accountLimit": "{provider} chỉ chứa được tối đa {limit} tài khoản.",
  "error.provider.accountNotFound": "Tài khoản {provider} này không có trên máy tính này. Hãy làm mới và thử lại.",
  "error.provider.accountAlreadyAdded": "Tài khoản {provider} này đã được kết nối.",
  "error.provider.accountDefault": "Không thể gỡ bỏ tài khoản {provider} đầu tiên.",
  "error.provider.accountUsesKey":
    "Tài khoản {provider} này dùng khóa API đã lưu và không có đăng nhập. Hãy đổi khóa trong Cài đặt máy chủ → Nhà cung cấp.",
  "error.provider.accountInUse": "Một trợ lý trên tài khoản này đang chạy. Hãy thử lại khi trợ lý dừng.",
  "error.provider.accountsReadOnly":
    "Các tài khoản nhà cung cấp đã lưu không thể đọc được. Hãy cập nhật OpenBot trước khi thay đổi chúng.",
  "error.provider.accountSignedOut": "Tài khoản {provider} này đã đăng xuất. Hãy đăng nhập lại.",
  "error.provider.sessionSettingUnavailable": "Cài đặt này không khả dụng trong phiên nhà cung cấp hiện tại.",
  "error.provider.sessionSettingInvalid": "Giá trị này không khả dụng cho cài đặt đó.",
  "error.provider.sessionSettingsBusy": "Hãy đợi lượt hiện tại kết thúc trước khi thay đổi một cài đặt phiên.",
  "error.provider.piOutdated": "Pi {version} quá cũ. Hãy cài Pi 1.1.0 trở lên để hỗ trợ RPC gốc và MCP.",
  "error.provider.nativeMissing": "CLI {provider} chưa được cài đặt. Hãy tải xuống trong Cài đặt.",
  "error.provider.nativeNotStarted": "CLI {provider} không thể khởi động.",
  "error.provider.nativeVersionUnreadable": "Không thể đọc phiên bản CLI {provider}.",
  "error.provider.piSessionBusy": "Hãy đợi lượt Pi hiện tại kết thúc.",
  "error.provider.piStopped": "Pi không đang chạy. Hãy kết nối Pi và thử lại.",
  "error.provider.piSessionMissing": "Tệp phiên Pi không khả dụng trên máy tính này.",
  "error.provider.piResumeCancelled": "Pi đã hủy việc tiếp tục phiên. Hãy thử lại.",
  "error.provider.piSessionIdentity": "Pi trả về một phiên khác. Phiên đã lưu không bị thay thế.",
  "error.provider.piModelInvalid": "Hãy chọn một mô hình Pi bao gồm nhà cung cấp của nó.",
  "error.provider.piToolInvalid": "Công cụ trả về kết quả không hợp lệ.",
  "error.provider.piSignIn": "Hãy dùng /login trong Pi trên máy tính chủ. Đóng Pi khi đăng nhập hoàn tất.",
  "error.provider.museBusy": "Phiên Muse đang bận.",
  "error.provider.museStopped": "Máy khách Muse không đang chạy.",
  "error.provider.museUnexpectedProvider": "Muse trả về một nhà cung cấp mô hình không mong đợi.",
  "error.provider.museNoActiveTurn": "Muse không có lượt đang chạy để dẫn hướng.",
  "error.provider.museInvalidProtocol": "Muse trả về một phản hồi giao thức không hợp lệ.",
  "error.provider.museNotStarted": "Muse không khởi động.",
  "error.provider.museNativeWindows": "Muse cần một tệp thực thi gốc trên Windows.",
  "error.provider.museStartTimeout": "Khởi tạo Muse đã hết thời gian chờ.",
  "error.provider.museStartStopped": "Muse đã dừng trong lúc khởi tạo.",
  "error.provider.museProtocolVersion": "Phiên bản giao thức Muse không được hỗ trợ.",
  "error.provider.museHistoryRequired": "Muse phải giữ lịch sử phiên.",
  "error.provider.museRequestUnsupported": "Yêu cầu máy chủ Muse không được hỗ trợ.",
  "error.provider.museConnectionFailed":
    "Kết nối Muse thất bại. Hãy tiếp tục cuộc hội thoại để khôi phục lịch sử đã lưu của nó.",
  "error.provider.museUnknownSession": "Phiên Muse không xác định.",
  "error.provider.museInvalidToolResult": "Kết quả công cụ OpenBot không hợp lệ.",
  "error.provider.museMcpRequired": "Muse phải hỗ trợ các máy chủ MCP của phiên.",
  "error.provider.museSessionMismatch": "Muse trả về một phiên khác.",
  "error.provider.museCompactRejected": "Muse không chấp nhận việc nén lịch sử.",
  "error.provider.museTurnMismatch": "Muse trả về một lượt khác.",
  "error.provider.museHistoryMismatch": "Lịch sử Muse đã vượt qua các phiên.",
  "error.provider.museRecoveryFailed": "Muse không thể khôi phục các sự kiện bị thiếu.",
  "error.provider.museHistoryStalled": "Con trỏ lịch sử Muse không tiến triển.",
  "error.provider.museApprovalUnavailable": "Muse không đưa ra phản hồi phê duyệt này.",
  "error.provider.museHistoryOwner": "Lịch sử Muse thuộc về một phiên khác.",
  "error.provider.museHistoryMissing": "Muse không trả về lịch sử phiên.",
  "error.provider.museEmptyInput": "Muse cần văn bản hoặc hình ảnh.",
  "error.provider.museMethodUnsupported": "Muse không hỗ trợ {method}.",
  "error.provider.museTurnFailed": "Lượt Muse thất bại.",
  "error.provider.museModelUnavailable":
    "Muse không thể dùng mô hình này. Muse có thể không khả dụng ở quốc gia nơi trợ lý này chạy, hoặc tài khoản này không có quyền truy cập mô hình đó. Hãy chọn mô hình khác, rồi thử lại.\n{detail}",
  "error.provider.museProfileUnsupported":
    "Muse không thể tạo hồ sơ khi không có quyền truy cập công cụ bên ngoài. Hãy dùng nhà cung cấp khác để tạo hồ sơ, rồi chọn Muse cho trợ lý.",
  "error.provider.museAuthUnverified":
    "Xác thực Muse chưa được xác minh. Hãy kết nối trên máy tính chủ, hoặc đặt khóa API Meta.",
  "error.provider.museSignIn": "Hãy đăng nhập Muse trên máy tính chủ để tiếp tục.",
  "error.provider.inceptionSignIn": "Hãy thêm khóa API Inception để tiếp tục.",
  "error.provider.deepseekSignIn": "Hãy thêm khóa API DeepSeek để tiếp tục.",
  "error.provider.openrouterSignIn": "Hãy thêm khóa API OpenRouter để tiếp tục.",
  "error.provider.terminalLoginFailed":
    "Không thể mở terminal đăng nhập. Hãy mở CLI của nhà cung cấp trên máy tính này và đăng nhập tại đó, rồi làm mới các nhà cung cấp.",
  "error.provider.nativeArchiveInvalid": "Bản tải xuống của nhà cung cấp không chứa bản cài đặt hợp lệ.",
  "error.provider.nativeChecksum": "Bản cài đặt của nhà cung cấp không vượt qua kiểm tra toàn vẹn.",
  "error.provider.registryUnavailable": "Sổ đăng ký ACP không khả dụng. Hãy thử lại.",
  "error.provider.registryInvalid": "Sổ đăng ký ACP trả về dữ liệu không hợp lệ.",
  "error.provider.registryMissing": "Trợ lý này không có trong sổ đăng ký ACP.",
  "error.provider.registryBusy": "Một lượt cài đặt đang chạy cho trợ lý này.",
  "error.provider.registryCancelled": "Việc cài đặt trợ lý đã bị hủy.",
  "error.provider.registryPrerequisite": "Hãy cài đặt {tool} trên máy tính chủ trước khi cài trợ lý này.",
  "error.provider.registryBindingChanged": "Trợ lý tùy chỉnh đã thay đổi trong lúc cài đặt. Hãy thử lại.",
  "error.provider.registryInstallFailed": "Việc cài đặt trợ lý thất bại. Bản cài đặt trước đó không thay đổi.",
  "error.provider.hermesInstallFailed": "Hermes Agent không cài được. Hãy thử lại, hoặc dùng hướng dẫn cài đặt.",
  "error.provider.hermesNeedsGitCurl": "Hermes Agent cần git và curl. Hãy cài đặt chúng, rồi thử lại.",
  "error.provider.registryRemoveBusy":
    "Hãy đợi việc cài đặt trợ lý và công việc ACP đang chạy hoàn tất trước khi gỡ bỏ nó.",
} as const satisfies PartialTranslation<typeof source>;
