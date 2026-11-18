import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.mcpConfig":
    "OpenBot không thể đăng ký máy chủ MCP trong cấu hình Codex. Hãy kiểm tra rằng tệp config.toml của Codex hợp lệ và có thể ghi, rồi khởi động lại OpenBot.",
  "error.provider.computerUseConfig":
    "OpenBot không thể đăng ký Điều khiển máy tính trong cấu hình Codex. Hãy kiểm tra rằng tệp config.toml của Codex hợp lệ và có thể ghi, rồi khởi động lại OpenBot. Bạn có thể tắt Điều khiển máy tính trong cài đặt của đồng đội để tiếp tục mà không dùng tính năng này.",
  "error.provider.codexUnresponsive": "Codex ngừng phản hồi, nên OpenBot đã kết thúc tiến trình của nó.",
  "error.provider.acpUnresponsive": "{provider} không phản hồi kịp thời, nên OpenBot đã kết thúc tiến trình của nó.",
  "error.provider.acpSignInLost": "{provider} bị mất đăng nhập, nên OpenBot đã kết thúc tiến trình của nó. Hãy gửi lại tin nhắn.",
  "error.provider.acpRefusedUntilRestart":
    "{provider} đã từ chối một tin nhắn, nên OpenBot đã kết thúc tiến trình của nó. Hãy gửi lại tin nhắn.",
  "error.provider.acpServerLost": "{provider} bị mất kết nối. Hãy gửi lại tin nhắn.",
  "error.provider.acpServerLostEnded": "{provider} bị mất kết nối, nên OpenBot đã kết thúc tiến trình của nó.",
  "error.provider.acpSettingsTimedOut": "{provider} không phản hồi kịp thời. Hãy thử lại sau giây lát.",
  "error.provider.acpPlanUsedUp":
    "{provider} cho biết gói của bạn đã dùng hết. Hãy chọn mô hình khác hoặc nâng cấp gói {provider}.",
  "error.provider.acpMcpNotLoaded":
    "{provider} không tải công cụ của OpenBot, nên agent này không thể dùng chúng hoặc liên lạc với đồng đội. Chính sách nhóm của {provider} có thể chặn máy chủ MCP cục bộ. Hãy nhờ quản trị viên nhóm cho phép, rồi thử lại.",
  "error.provider.acpOwnMcpServerFailed":
    "{provider} không thể khởi động máy chủ MCP {name}, nên câu trả lời đã dừng. Máy chủ này nằm trong cài đặt {provider} của riêng bạn, không phải trong OpenBot. Hãy xóa hoặc sửa máy chủ ở đó, rồi bắt đầu cuộc trò chuyện mới.",
  "error.provider.endpointsReadOnly":
    "Các điểm cuối đã lưu được ghi bởi phiên bản OpenBot mới hơn, hoặc không thể đọc tệp. Hãy cập nhật OpenBot để thay đổi chúng.",
  "error.provider.endpointNoSecureStorage":
    "Máy tính này không có kho lưu trữ an toàn, nên không thể lưu khóa API hoặc header. Hãy xóa chúng, hoặc dùng điểm cuối không cần thông tin xác thực.",
  "error.provider.endpointDuplicate":
    "Đã lưu một điểm cuối có ID nhà cung cấp này. Hãy xóa nó trước, hoặc dùng ID khác.",
  "error.provider.endpointNotSaved": "Điểm cuối này chưa được lưu. Hãy làm mới danh sách và thử lại.",
  "error.provider.endpointKeyForNewAddress":
    "Địa chỉ có host hoặc cổng mới. Hãy nhập lại khóa API và các header, để khóa và header đã lưu không bị gửi tới địa chỉ đó.",
  "error.provider.endpointSecretUnreadable":
    "Máy tính này không thể đọc khóa API và header đã lưu. Hãy nhập lại khóa API và các header để không mất thông tin nào.",
  "error.provider.discoveryTimeout": "{host} không phản hồi kịp thời.",
  "error.provider.discoveryUnreachable": "OpenBot không thể kết nối tới {host}.",
  "error.provider.discoveryRedirect": "{host} đã gửi chuyển hướng. Hãy nhập địa chỉ cuối cùng của máy chủ.",
  "error.provider.discoveryRefused": "{host} đã từ chối yêu cầu. Hãy kiểm tra khóa API và các header.",
  "error.provider.discoveryHttp": "{host} phản hồi với mã HTTP {status}.",
  "error.provider.discoveryTooLarge": "Danh sách mô hình từ {host} quá lớn.",
  "error.provider.discoveryInvalid": "{host} không gửi danh sách mô hình tương thích OpenAI.",
  "error.provider.detectionSettingsReadOnly":
    "Cài đặt phát hiện được ghi bởi phiên bản OpenBot mới hơn, hoặc không thể đọc tệp. Hãy cập nhật OpenBot để thay đổi chúng.",
  "error.provider.detectionEntryInvalid":
    "Địa chỉ phải là URL http:// hoặc https:// không chứa mật khẩu, và thư mục phải là đường dẫn tuyệt đối.",
  "error.provider.detectionEntriesTooMany": "Có quá nhiều địa chỉ hoặc thư mục.",
  "error.provider.credentialFileUnreadable": "Không thể đọc tệp thông tin xác thực của nhà cung cấp.",
  "error.provider.credentialFileTooLarge": "Tệp thông tin xác thực của nhà cung cấp quá lớn.",
  "error.provider.environmentNameInvalid":
    "{name} không phải là tên biến hợp lệ. Hãy dùng chữ cái, chữ số và _, và không bắt đầu bằng chữ số.",
  "error.provider.environmentNameReserved": "OpenBot đặt {name} cho nhà cung cấp này. Hãy xóa biến này.",
  "error.provider.environmentNameDuplicate": "{name} xuất hiện trong danh sách nhiều hơn một lần.",
  "error.provider.environmentValueTooLong": "Giá trị của {name} quá dài.",
  "error.provider.environmentTooMany": "Một nhà cung cấp có thể có tối đa {limit} biến.",
  "error.provider.environmentSecretsTooLarge":
    "Tổng độ dài các giá trị nhạy cảm quá lớn. Hãy lưu giá trị ngắn hơn hoặc ít giá trị hơn.",
  "error.provider.archiveSpecialFile": "Tệp nén runtime chứa liên kết hoặc tệp đặc biệt.",
  "error.provider.archiveUnsafePath": "Tệp nén runtime chứa đường dẫn không an toàn.",
  "error.provider.runtimeSpecialFile": "Runtime chứa liên kết hoặc tệp đặc biệt.",
  "error.provider.codexArchivePath": "Tệp nén Codex có đường dẫn không mong đợi.",
  "error.provider.codexVersionUnexpected": "Phiên bản runtime Codex không như mong đợi.",
  "error.provider.claudeArchivePath": "Tệp nén Claude có đường dẫn không mong đợi.",
  "error.provider.claudePackageMismatch": "Gói Claude không khớp với danh mục runtime.",
  "error.provider.claudeChecksum": "Checksum của runtime Claude không khớp.",
  "error.provider.claudeLicenseChecksum": "Checksum của giấy phép Claude không khớp.",
  "error.provider.opencodeArchivePath": "Tệp nén OpenCode có đường dẫn không mong đợi.",
  "error.provider.opencodePackageMismatch": "Gói OpenCode không khớp với danh mục runtime.",
  "error.provider.opencodeChecksum": "Checksum của runtime OpenCode không khớp.",
  "error.provider.opencodeLicenseChecksum": "Checksum của giấy phép OpenCode không khớp.",
  "error.provider.grokChecksum": "Checksum của runtime Grok không khớp.",
  "error.provider.grokLicenseChecksum": "Checksum của giấy phép Grok không khớp.",
  "error.provider.grokNoticesChecksum": "Checksum của tệp thông báo Grok không khớp.",
  "error.provider.bunArchivePath": "Tệp nén Bun có đường dẫn không mong đợi.",
  "error.provider.bunPackageMismatch": "Gói Bun không khớp với danh mục runtime.",
  "error.provider.bunChecksum": "Checksum của runtime Bun không khớp.",
  "error.provider.bunLicenseChecksum": "Checksum của giấy phép Bun không khớp.",
  "error.provider.bunxDamaged": "Trình chạy của trình quản lý gói Bun bị thiếu hoặc bị hỏng.",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot không thể truy cập nguồn phát hành của nhà cung cấp. Hãy kiểm tra kết nối và thử lại.",
  "error.provider.runtimesUnsupported": "Runtime của nhà cung cấp không khả dụng trên nền tảng này.",
  "error.provider.closing": "OpenBot đang đóng.",
  "error.provider.removeWhileOn": "Hãy tắt nhà cung cấp trước khi xóa bản tải xuống của nó.",
  "error.provider.removeWhileDownloading": "Hãy chờ quá trình tải xuống kết thúc, rồi xóa nó.",
  "error.provider.removeIncomplete": "Một chương trình đang dùng một số tệp của CLI này. Hãy đóng chương trình đó, rồi thử lại.",
  "error.provider.removeDownloadsFailed": "Không thể xóa các bản tải xuống CLI của {providers}.",
  "error.provider.cliOverride": "Hãy xóa đường dẫn CLI ghi đè trước khi cập nhật trong OpenBot.",
  "error.provider.runtimeUpdateIncomplete": "Bản cập nhật runtime chưa hoàn tất.",
  "error.provider.downloadHttp": "Tải runtime thất bại với mã HTTP {status}.",
  "error.provider.downloadNoData": "Tải runtime không trả về dữ liệu.",
  "error.provider.downloadSize": "Bản tải runtime có kích thước không như mong đợi.",
  "error.provider.downloadIntegrity": "Bản tải runtime không vượt qua bước kiểm tra tính toàn vẹn.",
  "error.provider.runtimeReplacing": "Không thể cài đặt runtime vì một phiên bản khác đang thay thế nó.",
  "error.provider.runtimeFilesInUse":
    "Không thể cài đặt runtime vì một chương trình khác đang mở các tệp của nó. Hãy đóng chương trình đó và thử lại.",
  "error.provider.metadataHttp": "Tải siêu dữ liệu runtime thất bại với mã HTTP {status}.",
  "error.provider.metadataIntegrity": "Siêu dữ liệu runtime không vượt qua bước kiểm tra tính toàn vẹn.",
  "error.provider.diskSpace": "Không đủ dung lượng đĩa trống cho nhà cung cấp này.",
  "error.provider.unexpectedVersion": "Runtime của nhà cung cấp trả về phiên bản không như mong đợi.",
  "error.provider.metadataNoData": "Tải siêu dữ liệu runtime không trả về dữ liệu.",
  "error.provider.metadataTooLarge": "Siêu dữ liệu runtime quá lớn.",
  "error.provider.requestFailed": "OpenBot không thể tải xuống {url}. {reason}",
  "error.provider.installRecordMismatch": "Bản ghi cài đặt runtime không khớp.",
  "error.provider.runtimeChecksum": "Checksum của runtime nhà cung cấp không khớp.",
  "error.provider.codexReleaseShape": "Bản phát hành Codex có cấu trúc không như mong đợi.",
  "error.provider.codexReleaseNoDownload": "Bản phát hành Codex không có bản tải xuống có thể xác minh cho máy tính này.",
  "error.provider.claudeReleaseShape": "Bản phát hành Claude có cấu trúc không như mong đợi.",
  "error.provider.grokReleaseVersion": "Bản phát hành Grok có phiên bản không như mong đợi.",
  "error.provider.blockedListShape": "Danh sách phiên bản bị chặn có cấu trúc không như mong đợi.",
  "error.provider.releaseNoDownload": "Bản phát hành {name} không có bản tải xuống có thể xác minh.",
  "error.provider.releaseSizeUnknown": "Không rõ kích thước của bản tải xuống.",
  "error.provider.releaseMetadataNotObject": "Siêu dữ liệu bản phát hành không phải là đối tượng JSON.",
  "error.provider.releaseCheckHttp": "Kiểm tra bản phát hành thất bại với mã HTTP {status}.",
  "error.provider.releaseMetadataTooLarge": "Siêu dữ liệu bản phát hành quá lớn.",
  "error.provider.idInvalid": "ID nhà cung cấp chỉ được gồm chữ cái thường, chữ số, `-` hoặc `_`.",
  "error.provider.baseUrlInvalid": "URL gốc không phải là URL.",
  "error.provider.baseUrlProtocol": "URL gốc phải bắt đầu bằng http:// hoặc https://.",
  "error.provider.baseUrlCredentials":
    "URL gốc không được chứa tên người dùng hoặc mật khẩu. Hãy đặt thông tin xác thực trong header.",
  "error.provider.modelsRequired": "Cần có ít nhất một mô hình.",
  "error.provider.modelsTooMany": "Có quá nhiều mô hình.",
  "error.provider.modelIdCharacter": "Một ID mô hình chứa ký tự không dùng được.",
  "error.provider.modelIdDuplicate": "Hai mô hình có cùng ID.",
  "error.provider.contextWindowInvalid":
    "Cửa sổ ngữ cảnh của mô hình phải là số token nguyên từ {min} đến {max}.",
  "error.provider.maxOutputInvalid": "Đầu ra tối đa của mô hình phải là số token nguyên từ {min} đến {max}.",
  "error.provider.reasoningEffortsInvalid": "Các mức suy luận của mô hình không hợp lệ.",
  "error.provider.inputsInvalid": "Các loại đầu vào của mô hình không hợp lệ.",
  "error.provider.headersTooMany": "Có quá nhiều header.",
  "error.provider.headerNameCharacter": "Tên header chứa ký tự mà HTTP không cho phép.",
  "error.provider.headerNameTooLong": "Tên header quá dài.",
  "error.provider.headerNameDuplicate": "Hai header có cùng tên.",
  "error.provider.headerValueInvalid": "Giá trị header bị thiếu hoặc quá dài.",
  "error.provider.headerValueMissing": "Header {name} cần có giá trị.",
  "error.provider.apiKeyTooLong": "Khóa API quá dài.",
  "error.provider.localOnly": "Chỉ có thể thay đổi nhà cung cấp trên máy tính chạy các agent.",
  "error.provider.keyRequired": "Cần có khóa nhà cung cấp.",
  "error.provider.keyTooLong": "Khóa nhà cung cấp quá dài.",
  "error.provider.keyInvalidCharacters": "Khóa nhà cung cấp chứa dấu cách hoặc ký tự không được phép trong khóa.",
  "error.provider.noModel": "Nhà cung cấp đã chọn không có mô hình khả dụng.",
  "error.provider.noModelNamed": "{provider} không có mô hình khả dụng.",
  "error.provider.acpNoModels": "ACP CLI không công bố mô hình ACP nào. OpenBot sẽ không đoán mô hình dự phòng.",
  "error.provider.endpointRemoveBusy": "Hãy chờ lượt đang chạy và hàng đợi hoàn tất trước khi xóa điểm cuối này.",
  "error.provider.codexOutdated": "Codex CLI {version} đã quá cũ. OpenBot yêu cầu phiên bản 0.156.0 trở lên.",
  "error.provider.codexNotStarted": "Đã tìm thấy Codex CLI nhưng không thể khởi động.",
  "error.provider.codexNotStartedHint":
    "Đã tìm thấy Codex CLI nhưng không thể khởi động. Hãy chạy `codex --version` trong một terminal mới.",
  "error.provider.codexManagedNotStarted":
    "Đã tải ChatGPT xuống nhưng không thể khởi động. Hãy tải lại trong OpenBot.",
  "error.provider.codexMissing": "Chưa tải ChatGPT xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.claudeOutdated": "Claude Code {version} đã quá cũ. OpenBot yêu cầu phiên bản 2.1.232 trở lên.",
  "error.provider.claudeNotStarted": "Đã tìm thấy Claude CLI nhưng không thể khởi động.",
  "error.provider.claudeNotStartedHint":
    "Đã tìm thấy Claude CLI nhưng không thể khởi động. Hãy chạy `claude --version` trong một terminal mới.",
  "error.provider.claudeManagedNotStarted":
    "Đã tải Claude xuống nhưng không thể khởi động. Hãy tải lại trong OpenBot.",
  "error.provider.claudeMissing": "Chưa tải Claude xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.grokOutdated": "Grok CLI {version} đã quá cũ. OpenBot yêu cầu phiên bản 1.0.5 trở lên.",
  "error.provider.grokNotStarted": "Đã tìm thấy Grok CLI nhưng không thể khởi động.",
  "error.provider.grokNotStartedHint":
    "Đã tìm thấy Grok CLI nhưng không thể khởi động. Hãy chạy `grok --version` trong một terminal mới.",
  "error.provider.grokMissing": "Chưa tải Grok xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.opencodeNotStarted": "OpenCode không thể khởi động. Hãy chạy `opencode --version` trong terminal.",
  "error.provider.opencodeMissing": "Chưa tải OpenCode xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.codexVersionUnreadable": "Không thể đọc phiên bản Codex CLI.",
  "error.provider.claudeVersionUnreadable": "Không thể đọc phiên bản Claude CLI.",
  "error.provider.grokVersionUnreadable": "Không thể đọc phiên bản Grok CLI.",
  "error.provider.opencodeVersionUnreadable": "Không thể đọc phiên bản OpenCode CLI.",
  "error.provider.bunVersionUnreadable": "Không thể đọc phiên bản runtime Bun.",
  "error.provider.connectBeforeProfile": "Hãy kết nối nhà cung cấp đã chọn trước khi tạo hồ sơ.",
  "error.provider.cliNotReady": "{provider} CLI chưa sẵn sàng hoặc chưa đăng nhập.",
  "error.provider.cliTimedOut": "{provider} không phản hồi kịp thời. Máy tính có thể đang bận. OpenBot sẽ thử lại.",
  "error.provider.cliTimedOutRefresh":
    "{provider} không phản hồi kịp thời. Máy tính có thể đang bận. Hãy làm mới danh sách nhà cung cấp để thử lại.",
  "error.provider.stoppedBeforeStart": "{provider} đã dừng trước khi tin nhắn này bắt đầu. Hãy gửi lại tin nhắn.",
  "error.provider.serviceUnreachable":
    "{provider} không thể kết nối tới dịch vụ của nó. Hãy kiểm tra kết nối internet. OpenBot sẽ thử lại.",
  "error.provider.serviceUnreachableRefresh":
    "{provider} không thể kết nối tới dịch vụ của nó. Hãy kiểm tra kết nối internet, rồi làm mới danh sách nhà cung cấp.",
  "error.provider.acpStartTimedOut": "{provider} không khởi động xong trong vòng {seconds} giây. Máy tính có thể đang bận.",
  "error.provider.acpModelsTimedOut":
    "{provider} không liệt kê mô hình trong vòng {seconds} giây. Máy tính có thể đang bận.",
  "error.provider.startStopped":
    "{provider} không khởi động được nhiều lần liên tiếp, nên OpenBot đã ngừng thử. Hãy làm mới danh sách nhà cung cấp để thử lại.",
  "error.provider.tempDiskSpace":
    "{provider} cần ít nhất 1 GB dung lượng đĩa trống để khởi động. Hãy giải phóng dung lượng, rồi làm mới danh sách nhà cung cấp.",
  "error.provider.noCodeSignIn": "Không thể đăng nhập {provider} bằng mã.",
  "error.provider.codeLoginNoLink": "Nhà cung cấp không hiển thị liên kết đăng nhập. Hãy thử lại.",
  "error.provider.hostSignInEnded": "{provider} chưa hoàn tất đăng nhập. Hãy thử lại.",
  "error.provider.codeLoginNotWaiting": "Không có phiên đăng nhập nào đang chờ mã. Hãy bắt đầu đăng nhập lại.",
  "error.provider.codeLoginBadCode": "Hãy dán mã mà trang đăng nhập hiển thị.",
  "error.provider.codeLoginRefused": "Nhà cung cấp không chấp nhận mã. Hãy bắt đầu đăng nhập lại.",
  "error.provider.codeLoginUnsupported":
    "Máy chủ này không thể đăng nhập bằng mã dán vào. Hãy đăng nhập trên máy tính chạy máy chủ, trong trình duyệt của máy đó.",
  "error.provider.claudeLoginNotSaved":
    "Claude không thể lưu thông tin đăng nhập trên máy Mac. Hãy khởi động lại máy Mac chạy OpenBot, rồi kết nối lại Claude.",
  "error.provider.cliBusyRetry": "{provider} CLI đang xử lý một lượt. Hãy chờ xử lý xong, rồi thử lại.",
  "error.provider.cliSigningIn": "{provider} CLI đang đăng nhập. Hãy hoàn tất hoặc hủy đăng nhập, rồi cập nhật.",
  "error.provider.cliBusyUpdate": "{provider} CLI đang xử lý một lượt. Hãy chờ xử lý xong, rồi cập nhật.",
  "error.provider.cliSelectFailed": "OpenBot không thể chọn CLI được quản lý đã cài đặt.",
  "error.provider.noAuthenticatedAccount": "{provider} không trả về tài khoản đã xác thực.",
  "error.provider.codexModelProvider":
    "Codex trên máy tính này dùng một nhà cung cấp mô hình khác, và nhà cung cấp đó không dùng đăng nhập ChatGPT hay khóa API OpenAI. Các agent ChatGPT hiện có thể dùng nhà cung cấp đó. Để dùng tài khoản ChatGPT của bạn, hãy đặt lại nhà cung cấp mô hình của Codex thành OpenAI.",
  "error.provider.signInExpired": "Phiên đăng nhập {provider} của bạn đã hết hạn. Hãy đăng nhập lại để tiếp tục.",
  "error.provider.cliActivateFailed": "OpenBot không thể kích hoạt CLI được quản lý.",
  "error.provider.noMainlandChinaSignIn": "{provider} không hỗ trợ đăng nhập tại Trung Quốc đại lục.",
  "error.provider.cliNewVersionNotStarted": "Phiên bản mới không khởi động được.",
  "error.provider.cliBusyReconnect": "{provider} CLI đang xử lý một lượt. Hãy chờ xử lý xong, rồi kết nối lại.",
  "error.provider.cliBusySignOut": "{provider} CLI đang xử lý một lượt. Hãy chờ xử lý xong, rồi ngắt kết nối.",
  "error.provider.opencodeCredentialsRejected":
    "Nhà cung cấp mô hình đã từ chối khóa API. Hãy sửa khóa OpenCode trong Cài đặt, hoặc sửa khóa của nhà cung cấp bằng `opencode auth login`. Sau đó thử lại hoặc chọn mô hình khác.\n{detail}",
  "error.provider.opencodeAuthRequired":
    "OpenCode chưa đăng nhập vào nhà cung cấp mô hình “{provider}”. Hãy chọn mô hình có nhãn “Miễn phí”, hoặc kết nối nhà cung cấp: dán khóa OpenCode Go vào cài đặt OpenCode, hoặc chạy `opencode auth login` trong terminal. Sau đó thử lại.",
  "error.provider.opencodeAuthRequiredUnknown":
    "OpenCode chưa đăng nhập vào nhà cung cấp của mô hình này. Hãy chọn mô hình có nhãn “Miễn phí”, hoặc kết nối nhà cung cấp: dán khóa OpenCode Go vào cài đặt OpenCode, hoặc chạy `opencode auth login` trong terminal. Sau đó thử lại.",
  "error.provider.opencodeProviderRefused":
    "Nhà cung cấp mô hình “{provider}” đã từ chối yêu cầu. OpenCode có khóa cho nhà cung cấp này, nên nguyên nhân có thể là mạng của bạn: một số nhà cung cấp chặn VPN, proxy hoặc một số quốc gia. Hãy tắt VPN hoặc dùng mạng khác, rồi thử lại. Nếu lỗi vẫn tiếp diễn, khóa có thể không đúng: hãy chạy `opencode auth login` trong terminal và nhập lại khóa.",
  "error.provider.opencodeFreeModelRefused":
    "OpenCode đã từ chối mô hình miễn phí này. Một số mô hình miễn phí không khả dụng ở mọi quốc gia. Hãy chọn một mô hình khác có nhãn “Miễn phí”, hoặc dán khóa OpenCode Go vào cài đặt OpenCode và chọn một mô hình OpenCode Go.",
  "error.provider.customEndpointKeyRefused":
    "Điểm cuối “{provider}” đã từ chối khóa API hoặc header của nó. Hãy nhập lại trong Cài đặt máy chủ → Nhà cung cấp, rồi thử lại.",
  "error.provider.customEndpointKeyMissing":
    "Điểm cuối “{provider}” cần khóa API. Hãy thêm khóa trong Cài đặt máy chủ → Nhà cung cấp, rồi thử lại.",
  "error.provider.opencodeKeyExpired":
    "Khóa API OpenCode của bạn đã hết hạn. Hãy tạo khóa mới trong OpenCode Console, dán vào cài đặt OpenCode, rồi thử lại.",
  "error.provider.opencodeKeyRefused":
    "OpenCode Go đã từ chối khóa API đã lưu của bạn. Khóa có thể đã hết hạn. Hãy tạo khóa mới trong OpenCode Console, dán vào cài đặt OpenCode, rồi thử lại.",
  "error.provider.opencodeServiceFailure":
    "OpenCode không thể hoàn tất lượt này vì dịch vụ cục bộ của nó bị lỗi. Hãy thử lại. Nếu lỗi vẫn tiếp diễn, hãy kết nối lại OpenCode trong Cài đặt.",
  "error.provider.opencodeRateLimited":
    "Nhà cung cấp mô hình đã từ chối yêu cầu do giới hạn tốc độ. Hãy chờ vài phút hoặc chọn mô hình khác, rồi thử lại.\n{detail}",
  "error.provider.opencodeBilling":
    "Nhà cung cấp mô hình đã từ chối yêu cầu do vấn đề thanh toán của tài khoản. Chờ đợi không khắc phục được lỗi này. Hãy thêm phương thức thanh toán hoặc nạp tiền vào tài khoản nhà cung cấp, hoặc chọn mô hình khác.\n{detail}",
  "error.provider.opencodeInvalidUpload":
    "Nhà cung cấp mô hình của OpenCode báo cáo yêu cầu tải lên không hợp lệ. Hãy chọn mô hình khác và tiếp tục. Hãy kiểm tra các tác vụ định kỳ đã lưu trước khi tạo lại chúng.\n{detail}",
  "error.provider.opencodeUnreadableContent":
    "Mô hình này không thể đọc một tệp hoặc hình ảnh trong cuộc trò chuyện này. OpenBot đã bắt đầu một phiên OpenCode mới với lịch sử trò chuyện. Hãy gửi lại tin nhắn mà không kèm tệp, hoặc chọn mô hình có thể đọc tệp. Nếu bạn đã thêm mô hình này vào một nhà cung cấp tùy chỉnh, hãy bỏ chọn “Hình ảnh” ở mục “Chấp nhận” trong cài đặt của nó.",
  "error.provider.opencodeContextTooSmall":
    "Cuộc trò chuyện này không vừa cửa sổ ngữ cảnh của mô hình. Trong Ollama hoặc LM Studio, hãy tải mô hình với độ dài ngữ cảnh lớn hơn, và nhập cùng kích thước cửa sổ đó trong cài đặt nhà cung cấp OpenBot của mô hình. Hoặc chọn một mô hình lớn hơn.",
  "error.provider.opencodeFreeLimit":
    "Các mô hình OpenCode miễn phí đã chạm giới hạn sử dụng. Tất cả mô hình miễn phí dùng chung giới hạn này. Để tiếp tục, hãy dán khóa OpenCode Go vào cài đặt OpenCode, hoặc chọn mô hình từ nhà cung cấp khác.",
  "error.provider.opencodeProviderFailed":
    "Nhà cung cấp mô hình gặp lỗi ở phía họ. Kết nối của bạn không phải là nguyên nhân. Hãy thử lại sau hoặc chọn mô hình khác.\n{detail}",
  "error.provider.opencodeModelUnavailable":
    "Bạn không thể dùng mô hình này. Hãy chọn mô hình khác cho agent này.\n{detail}",
  "error.provider.opencodeIncompleteReply":
    "Câu trả lời của mô hình bị cắt ngang hoặc không hợp lệ. Hãy gửi lại tin nhắn, hoặc chọn mô hình khác.\n{detail}",
  "error.provider.opencodeReasoningOverlap":
    "OpenCode không thể đọc phần suy luận của mô hình này ở mức suy luận này. Hãy chọn mức thấp hơn hoặc mô hình khác, rồi gửi lại tin nhắn.",
  "error.provider.opencodeNetwork":
    "OpenCode không thể kết nối tới nhà cung cấp mô hình. Hãy kiểm tra kết nối mạng của máy tính chạy OpenBot, rồi thử lại.\n{detail}",
  "error.provider.codexStateBusy":
    "ChatGPT vẫn đang chuẩn bị lịch sử cục bộ sau lần khởi động trước. Hãy chờ vài phút, rồi thử lại.",
  "error.provider.codexThreadInUse":
    "Một ứng dụng Codex khác đang mở cuộc trò chuyện này, chẳng hạn ứng dụng Codex cho máy tính, Codex CLI hoặc một tiện ích mở rộng IDE. Mỗi lúc chỉ một ứng dụng có thể ghi vào cuộc trò chuyện Codex. Hãy đóng cuộc trò chuyện trong ứng dụng đó, rồi gửi lại tin nhắn.",
  "error.provider.realtimeLimitZero":
    "Linux đã dừng nhà cung cấp vì OpenBot có giới hạn CPU thời gian thực bằng 0. Giới hạn này đến từ hệ thống của bạn. Hãy cài đặt và khởi động rtkit (`rtkit-daemon`), chạy `systemctl --user restart xdg-desktop-portal`, rồi khởi động lại OpenBot. Chỉ khởi động lại xdg-desktop-portal sẽ không có tác dụng khi còn thiếu rtkit.",
  "error.provider.cpuUnsupported": "Bộ xử lý của máy tính này không thể chạy nhà cung cấp này. Hãy dùng nhà cung cấp khác.",
  "error.provider.opencodeDatabaseNewer":
    "OpenCode không thể mở cơ sở dữ liệu vì một phiên bản OpenCode mới hơn đã thay đổi nó. Hãy cập nhật OpenCode lên phiên bản 2 trở lên, rồi thử lại.",
  "error.provider.opencodeNoAnswer":
    "Mô hình OpenCode đã kết thúc lượt mà không có câu trả lời. Hãy thử lại, hoặc chọn mô hình khác.",
  "error.provider.opencodeReasoningWithoutAnswer":
    "Mô hình OpenCode đã kết thúc lượt sau phần suy luận mà không có câu trả lời. Hãy thử lại, hoặc chọn mô hình khác.",
  "error.provider.acpNoAnswer":
    "{provider} đã kết thúc lượt mà không có câu trả lời. Hãy gửi lại tin nhắn, hoặc bắt đầu cuộc trò chuyện mới.",
  "error.provider.noAnswerAfterSteps":
    "{provider} đã thực hiện một số bước, rồi kết thúc lượt mà không có câu trả lời. Hãy hỏi agent xem nó đã làm gì trước khi gửi lại cùng yêu cầu.",
  "error.provider.chatgptPageFailed": "OpenBot không thể mở trang kết nối ChatGPT.",
  "error.provider.noneReady": "Chưa có nhà cung cấp agent nào sẵn sàng.",
  "error.provider.claudeTurnActive": "Hãy chờ lượt Claude đang chạy kết thúc trước khi làm mới ngữ cảnh của nó.",
  "error.provider.codexLoginRequired": "Codex yêu cầu đăng nhập bằng gói đăng ký ChatGPT. Hãy chạy `codex login`.",
  "error.provider.cliUpdateFailed": "OpenBot không thể cập nhật {provider} CLI. {reason}",
  "error.provider.tryAgain": "Hãy thử lại.",
  "error.provider.noAgentProcess": "{provider} không có tiến trình nào đang chạy cho agent này.",
  "error.provider.stoppedBeforeAgentProcess": "{provider} đã dừng trước khi tiến trình của agent khởi động.",
  "error.provider.archiveUnreadable": "Không thể đọc tệp nén runtime hoặc tệp dùng định dạng không được hỗ trợ.",
  "error.provider.antigravityMissing": "Chưa tải Gemini xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.antigravityNotStarted": "Đã tìm thấy máy chủ Gemini, nhưng không thể đọc phiên bản của nó.",
  "error.provider.antigravityOverrideInvalid":
    "Máy chủ Gemini trong OPENBOT_ANTIGRAVITY_PATH bị thiếu hoặc không thể thực thi. Hãy sửa đường dẫn hoặc xóa biến, rồi khởi động lại OpenBot.",
  "error.provider.antigravityVersionUnreadable": "Không thể đọc phiên bản máy chủ Gemini.",
