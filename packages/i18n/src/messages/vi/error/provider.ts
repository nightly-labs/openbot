import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.mcpConfig":
    "OpenBot không thể đăng ký máy chủ MCP trong cấu hình Codex. Hãy kiểm tra rằng tệp config.toml của Codex hợp lệ và có thể ghi, rồi khởi động lại OpenBot.",
  "error.provider.computerUseConfig":
    "OpenBot không thể đăng ký Điều khiển máy tính trong cấu hình Codex. Hãy kiểm tra rằng tệp config.toml của Codex hợp lệ và có thể ghi, rồi khởi động lại OpenBot. Bạn có thể tắt Điều khiển máy tính trong cài đặt của đồng đội để tiếp tục mà không dùng tính năng này.",
  "error.provider.codexUnresponsive": "Codex ngừng phản hồi, nên OpenBot đã kết thúc tiến trình của nó.",
  "error.provider.acpUnresponsive": "{provider} không phản hồi kịp thời, nên OpenBot đã kết thúc tiến trình của nó.",
  "error.provider.acpSignInLost":
    "{provider} bị mất đăng nhập, nên OpenBot đã kết thúc tiến trình của nó. Hãy gửi lại tin nhắn.",
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
  "error.provider.removeIncomplete":
    "Một chương trình đang dùng một số tệp của CLI này. Hãy đóng chương trình đó, rồi thử lại.",
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
  "error.provider.codexReleaseNoDownload":
    "Bản phát hành Codex không có bản tải xuống có thể xác minh cho máy tính này.",
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
  "error.provider.contextWindowInvalid": "Cửa sổ ngữ cảnh của mô hình phải là số token nguyên từ {min} đến {max}.",
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
  "error.provider.codexManagedNotStarted": "Đã tải ChatGPT xuống nhưng không thể khởi động. Hãy tải lại trong OpenBot.",
  "error.provider.codexMissing": "Chưa tải ChatGPT xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.claudeOutdated": "Claude Code {version} đã quá cũ. OpenBot yêu cầu phiên bản 2.1.232 trở lên.",
  "error.provider.claudeNotStarted": "Đã tìm thấy Claude CLI nhưng không thể khởi động.",
  "error.provider.claudeNotStartedHint":
    "Đã tìm thấy Claude CLI nhưng không thể khởi động. Hãy chạy `claude --version` trong một terminal mới.",
  "error.provider.claudeManagedNotStarted": "Đã tải Claude xuống nhưng không thể khởi động. Hãy tải lại trong OpenBot.",
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
  "error.provider.acpStartTimedOut":
    "{provider} không khởi động xong trong vòng {seconds} giây. Máy tính có thể đang bận.",
  "error.provider.acpModelsTimedOut":
    "{provider} không liệt kê mô hình trong vòng {seconds} giây. Máy tính có thể đang bận.",
  "error.provider.startStopped":
    "{provider} không khởi động được nhiều lần liên tiếp, nên OpenBot đã ngừng thử. Hãy làm mới danh sách nhà cung cấp để thử lại.",
  "error.provider.startPaused":
    "{provider} không khởi động được nhiều lần liên tiếp. OpenBot sẽ thử lại khi có tin nhắn hoặc tác vụ định kỳ tiếp theo. Để thử ngay, hãy làm mới danh sách nhà cung cấp.",
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
  "error.provider.cpuUnsupported":
    "Bộ xử lý của máy tính này không thể chạy nhà cung cấp này. Hãy dùng nhà cung cấp khác.",
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
  "error.provider.antigravitySignIn": "Hãy đăng nhập bằng Google để dùng Gemini.",
  "error.provider.antigravityModelAtCapacity":
    "Google hiện không còn dung lượng trống cho mô hình Gemini này. Hạn mức của gói bạn không phải là nguyên nhân. Hãy thử lại sau vài phút, hoặc chọn mô hình khác.\n{detail}",
  "error.provider.antigravityRateLimited":
    "Gemini đã từ chối yêu cầu vì đã chạm giới hạn tốc độ hoặc hạn mức của gói. Hãy chờ vài phút hoặc chọn mô hình khác, rồi thử lại.\n{detail}",
  "error.provider.antigravityQuotaReached":
    "Google cho biết đã chạm giới hạn sử dụng Gemini. Giới hạn này có thể chỉ áp dụng cho một mô hình, nên trang mức sử dụng của gói bạn có thể vẫn hiển thị còn hạn mức. Hãy chọn mô hình Gemini khác, hoặc chờ giới hạn được đặt lại.\n{detail}",
  "error.provider.antigravityModelUnavailable":
    "Gemini hiện không thể dùng mô hình này. Hãy chọn mô hình khác, rồi thử lại.\n{detail}",
  "error.provider.antigravityServiceFailure":
    "Dịch vụ Gemini của Google không hoàn tất yêu cầu. Hãy thử lại sau vài phút.\n{detail}",
  "error.provider.antigravitySignInRefused":
    "Google không chấp nhận thông tin đăng nhập Gemini cho yêu cầu này. Hãy gửi lại tin nhắn. Nếu lỗi vẫn tiếp diễn, hãy kết nối lại Gemini trong Cài đặt.\n{detail}",
  "error.provider.antigravityRequestRejected":
    "Gemini đã từ chối yêu cầu này. Hãy chọn mô hình khác, rồi gửi lại tin nhắn. Nếu vẫn thất bại, hãy bắt đầu cuộc trò chuyện mới.\n{detail}",
  "error.provider.antigravitySessionRejected":
    "Gemini đã từ chối yêu cầu này mà không nêu nguyên nhân. Một mục trong lịch sử trò chuyện có thể gây ra lỗi này, chẳng hạn hình ảnh mà agent đã mở. OpenBot đã bắt đầu một phiên Gemini mới với lịch sử trò chuyện. Hãy thử lại. Nếu lỗi vẫn tiếp diễn, hãy chọn mô hình khác.",
  "error.provider.antigravityHistoryUnreadable":
    "Gemini không thể đọc lịch sử đã lưu của cuộc trò chuyện này. OpenBot đã bắt đầu một phiên Gemini mới với lịch sử trò chuyện. Hãy gửi lại tin nhắn.",
  "error.provider.antigravityLocationUnsupported":
    "Google không cho phép Gemini hoạt động từ vị trí mạng của máy tính đang chạy agent này. Hãy dùng Gemini trên máy tính khác, hoặc chọn nhà cung cấp khác cho agent này.\n{detail}",
  "error.provider.antigravityConnectionLost":
    "Gemini bị mất kết nối với agent của nó và đã dừng. Hãy gửi một tin nhắn để tiếp tục.",
  "error.provider.grokServiceFailure":
    "Dịch vụ Grok đang bận hoặc gặp lỗi. Hãy thử lại sau vài phút, hoặc chọn mô hình khác.",
  "error.provider.grokConnectionFailed":
    "Grok không thể kết nối tới dịch vụ của nó. Hãy kiểm tra kết nối internet, rồi gửi lại tin nhắn.",
  "error.provider.antigravityRemoteWindowsSignIn":
    "Trên host Windows, Gemini mở trang Google ngay trên host. Hãy kết nối Gemini trên máy tính host.",
  "error.provider.cursorArchivePath": "Tệp nén Cursor chứa tệp không mong đợi.",
  "error.provider.cursorChecksum": "Checksum của runtime Cursor không khớp.",
  "error.provider.cursorReleaseShape": "Bản phát hành Cursor có cấu trúc không như mong đợi.",
  "error.provider.cursorMissing": "Chưa tải Cursor xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.cursorNotStarted": "Đã tìm thấy agent Cursor, nhưng không thể đọc phiên bản của nó.",
  "error.provider.cursorVersionUnreadable": "Không thể đọc phiên bản agent Cursor.",
  "error.provider.cursorSignIn": "Hãy đăng nhập bằng Cursor hoặc đặt CURSOR_API_KEY để dùng Cursor.",
  "error.provider.clineArchivePath": "Tệp nén Cline có đường dẫn không mong đợi.",
  "error.provider.clinePackageMismatch": "Gói Cline không khớp với danh mục runtime.",
  "error.provider.clineChecksum": "Checksum của runtime Cline không khớp.",
  "error.provider.clineLicenseChecksum": "Checksum của giấy phép Cline không khớp.",
  "error.provider.clineMissing": "Chưa tải Cline xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.clineOutdated": "Cline CLI {version} đã quá cũ. OpenBot yêu cầu phiên bản 3.0.68 trở lên.",
  "error.provider.clineNotStarted": "Cline không thể khởi động. Hãy chạy `cline --version` trong terminal.",
  "error.provider.clineVersionUnreadable": "Không thể đọc phiên bản Cline CLI.",
  "error.provider.clineSignIn": "Hãy đăng nhập bằng Cline hoặc đặt CLINE_API_KEY để dùng Cline.",
  "error.provider.kimiArchivePath": "Tệp nén Kimi có đường dẫn không mong đợi.",
  "error.provider.kimiChecksum": "Checksum của runtime Kimi không khớp.",
  "error.provider.kimiLicenseChecksum": "Checksum của giấy phép Kimi không khớp.",
  "error.provider.kimiMissing": "Chưa tải Kimi xuống. Hãy tải xuống trong OpenBot để tiếp tục.",
  "error.provider.kimiOutdated": "Kimi CLI {version} đã quá cũ. OpenBot yêu cầu phiên bản 1.52.0 trở lên.",
  "error.provider.kimiNotStarted": "Kimi không thể khởi động. Hãy chạy `kimi --version` trong terminal.",
  "error.provider.kimiVersionUnreadable": "Không thể đọc phiên bản Kimi CLI.",
  "error.provider.kimiSignIn": "Hãy đăng nhập bằng Kimi Code để dùng Kimi.",
  "error.provider.devinSignIn": "Hãy đăng nhập bằng Devin để dùng Devin.",
  "error.provider.copilotSignIn": "Hãy đăng nhập bằng GitHub hoặc đặt COPILOT_GITHUB_TOKEN để dùng GitHub Copilot.",
  "error.provider.mistralSignIn": "Hãy đăng nhập bằng Mistral hoặc đặt MISTRAL_API_KEY để dùng Mistral.",
  "error.provider.hermesMissing": "Chưa cài đặt Hermes Agent. Hãy cài đặt, rồi thử lại.",
  "error.provider.hermesNotStarted": "Hermes Agent không thể khởi động. Hãy chạy `hermes --version` trong terminal.",
  "error.provider.hermesVersionUnreadable": "Không thể đọc phiên bản Hermes Agent.",
  "error.provider.hermesSignIn":
    "Hãy đăng nhập bằng Nous Portal, hoặc chạy `hermes setup` trong terminal, để dùng Hermes.",
  "error.provider.hermesTurnFailed":
    "Hermes không thể hoàn tất lượt này. Nếu câu trả lời của nó nêu lý do, hãy làm theo. Nếu không, một máy chủ MCP của agent này có thể không khả dụng: hãy kiểm tra trong Cửa hàng, Ứng dụng, rồi gửi lại tin nhắn.",
  "error.provider.hermesRefused":
    "Hermes đã từ chối tin nhắn này trước khi bắt đầu. Hãy gửi lại. Nếu Hermes từ chối mọi tin nhắn, hãy khởi động lại OpenBot trên máy tính đang chạy agent này.",
  "error.provider.hermesConnectionLost":
    "Hermes bị mất kết nối trong lúc xử lý tin nhắn này, nên không biết công việc đã xong hay chưa. Hãy kiểm tra những gì agent đã làm trước khi gửi lại tin nhắn.",
  "error.provider.copilotThinkingRejected":
    "GitHub Copilot không thể dùng mô hình này: mô hình không chấp nhận cài đặt suy nghĩ của nó. Hãy chọn mô hình khác cho agent này, rồi gửi lại tin nhắn.",
  "error.provider.usageLimitReached": "Tài khoản đã chạm giới hạn sử dụng.",
  "error.provider.claudeContextFull":
    "Cuộc trò chuyện này đã quá dài đối với Claude. OpenBot đã bắt đầu một phiên Claude Code mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.claudeApiKeyNoCredit":
    "Số dư tín dụng của khóa API Anthropic quá thấp. Gói Claude không chi trả cho các yêu cầu dùng khóa API. Hãy nạp thêm tín dụng trong Anthropic Console, hoặc đăng nhập Claude trong Cài đặt và chọn tài khoản Claude trong menu mô hình của agent.",
  "error.provider.claudeServiceBlocked":
    "Dịch vụ Claude đã chặn yêu cầu này. Đây thường là sự cố ngắn ở phía Claude, không phải vấn đề với tài khoản của bạn. Hãy gửi lại tin nhắn sau vài phút.",
  "error.provider.foreignReasoning":
    "{provider} không chấp nhận phần suy luận trước đó trong cuộc trò chuyện này, vì một tài khoản hoặc khóa API khác đã nhận nó. OpenBot đã bắt đầu một phiên {provider} mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.codexHistoryItemMissing":
    "Codex không thể tiếp tục cuộc trò chuyện này vì thiếu một mục trong lịch sử đã lưu. OpenBot đã bắt đầu một phiên Codex mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.codexRequestRefused":
    "{provider} đã từ chối yêu cầu cho cuộc trò chuyện này mà không nêu nguyên nhân. Điều này có thể xảy ra trong cuộc trò chuyện dài có nhiều hình ảnh. OpenBot đã bắt đầu một phiên {provider} mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.codexAudioRefused":
    "Mô hình không chấp nhận âm thanh trong cuộc trò chuyện này. OpenBot đã bắt đầu một phiên Codex mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.imageTooSmall":
    "Mô hình không chấp nhận một hình ảnh trong cuộc trò chuyện này vì hình ảnh quá nhỏ. OpenBot đã bắt đầu một phiên {provider} mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.imageTooLarge":
    "Mô hình không chấp nhận một hình ảnh trong cuộc trò chuyện này vì hình ảnh quá lớn. OpenBot đã bắt đầu một phiên {provider} mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.imageCountLimit":
    "Mô hình không chấp nhận cuộc trò chuyện này vì có quá nhiều hình ảnh. OpenBot đã bắt đầu một phiên {provider} mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.imageUnreadable":
    "Mô hình không thể đọc một hình ảnh trong cuộc trò chuyện này. OpenBot đã bắt đầu một phiên {provider} mới với lịch sử trò chuyện. Hãy thử lại. Nếu bạn đã gửi một hình ảnh, hãy gửi hình khác.",
  "error.provider.requestTooLarge":
    "Cuộc trò chuyện này đã quá lớn để gửi tới mô hình. Hình ảnh trong cuộc trò chuyện thường là nguyên nhân. OpenBot đã bắt đầu một phiên {provider} mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.opencodeSessionRejected":
    "OpenCode đã từ chối yêu cầu mà không nêu nguyên nhân. Điều này có thể xảy ra trong cuộc trò chuyện dài hoặc sau khi đổi mô hình. OpenBot đã bắt đầu một phiên OpenCode mới với lịch sử trò chuyện. Hãy thử lại. Nếu lỗi vẫn tiếp diễn, hãy chọn mô hình khác hoặc mức suy luận thấp hơn.",
  "error.provider.opencodeCompactionFailed":
    "Mô hình không thể tóm tắt cuộc trò chuyện dài này để giải phóng chỗ trong cửa sổ ngữ cảnh. OpenBot đã bắt đầu một phiên OpenCode mới với lịch sử trò chuyện. Hãy thử lại. Nếu lỗi vẫn tiếp diễn, hãy chọn mô hình mạnh hơn.",
  "error.provider.museMcpStartupFault":
    "Muse không thể khởi động một máy chủ MCP và đã chặn MCP trong phiên này. OpenBot đã bắt đầu một phiên Muse mới với lịch sử trò chuyện. Hãy thử lại. Nếu lỗi vẫn tiếp diễn, hãy tắt Điều khiển máy tính hoặc máy chủ MCP bị lỗi cho agent này.",
  "error.provider.claudeSessionMissing":
    "Claude Code không tìm thấy phiên đã lưu của cuộc trò chuyện này. OpenBot đã bắt đầu một phiên Claude Code mới với lịch sử trò chuyện. Hãy thử lại.",
  "error.provider.grokSignIn": "Hãy chạy `grok login` hoặc đặt XAI_API_KEY để dùng Grok.",
  "error.provider.acpSignInTimedOut": "Đăng nhập đã hết thời gian chờ.",
  "error.provider.acpSignInStopped": "Đăng nhập đã dừng trước khi hoàn tất.",
  "error.provider.geminiBrowserUnavailable":
    "Gemini không thể mở trang đăng nhập. Hãy cài đặt trình duyệt và xdg-utils, rồi kết nối từ một phiên desktop trên host này. Máy chủ không có desktop không thể hoàn tất kiểu đăng nhập này.",
  "error.provider.geminiBrowserOpenFailed":
    "Gemini không thể mở trang đăng nhập trong trình duyệt của bạn. Hãy kiểm tra trình duyệt mặc định, rồi kết nối lại.",
  "error.provider.acpSignInFailed": "Đăng nhập chưa hoàn tất.",
  "error.provider.acpSignInFailedReason": "Đăng nhập chưa hoàn tất: {reason}",
  "error.provider.acpSignInNetwork":
    "Quá trình đăng nhập không thể kết nối tới máy chủ của nhà cung cấp. Hãy kiểm tra kết nối mạng và cài đặt DNS của máy tính chạy OpenBot, rồi thử lại.",
  "error.provider.acpSignOutFailed": "Đăng xuất chưa hoàn tất.",
  "error.provider.acpSignOutFailedReason": "Đăng xuất chưa hoàn tất: {reason}",
  "error.provider.acpSignInMethodMissing":
    "Nhà cung cấp này không hỗ trợ cách đăng nhập này trên máy tính này. Hãy cập nhật nhà cung cấp, rồi thử lại.",
  "error.provider.httpsSignInLinkOnly": "Chỉ liên kết đăng nhập HTTPS mới có thể mở trong trình duyệt.",
  "error.provider.geminiKeyRefused":
    "Gemini đã từ chối khóa API đã lưu. Hãy thay thế hoặc xóa khóa trong Cài đặt, rồi kết nối lại.",
  "error.provider.geminiKeyRateLimited":
    "Gemini đã từ chối yêu cầu vì khóa API Gemini đã lưu của bạn đã chạm giới hạn tốc độ hoặc hạn mức. Khóa này được dùng thay cho gói Google của bạn. Hãy chờ vài phút hoặc chọn mô hình khác, rồi thử lại. Để dùng gói Google của bạn, hãy xóa khóa trong Cài đặt.\n{detail}",
  "error.provider.geminiKeyQuotaZero":
    "Khóa API Gemini đã lưu của bạn không có hạn mức cho mô hình này. Khóa này được dùng thay cho gói Google của bạn. Hãy chọn mô hình khác, hoặc xóa khóa trong Cài đặt để dùng gói Google của bạn.\n{detail}",
  "error.provider.geminiAccountSettingsUnreadable":
    "Gemini không thể mở tệp cài đặt của tài khoản này, nên không thể đăng nhập. Hãy xóa tài khoản này và thêm lại.",
  "error.provider.geminiSettingsUnreadable":
    "Gemini không thể mở tệp cài đặt của nó trên máy tính này, nên không thể đăng nhập. Hãy thoát các ứng dụng khác đang dùng Gemini, rồi thoát và mở lại OpenBot.",
  "error.provider.geminiVerificationRequired":
    "Google cần xác minh tài khoản của bạn trước khi Gemini có thể trả lời. Hãy xác minh tài khoản Google trong trình duyệt, rồi gửi lại tin nhắn.",
  "error.provider.keyProviderRefused":
    "{provider} đã từ chối khóa API đã lưu. Hãy thay thế hoặc xóa khóa trong Cài đặt, rồi thử lại.",
  "error.provider.keyProviderNoBalance":
    "Tài khoản {provider} của khóa API đã lưu không còn số dư. Hãy nạp thêm tín dụng vào tài khoản, rồi thử lại.",
  "error.provider.keyProviderLowCredit":
    "Tài khoản {provider} của khóa API đã lưu không đủ tín dụng cho một câu trả lời từ mô hình này. Hãy nạp thêm tín dụng vào tài khoản, hoặc chọn mô hình khác, rồi thử lại.",
  "error.provider.modelServiceRefused":
    "Dịch vụ mô hình đã từ chối yêu cầu. Hãy chọn mô hình khác, hoặc kiểm tra quyền truy cập của bạn vào mô hình này tại dịch vụ.",
  "error.provider.modelServiceRefusedReason":
    "Dịch vụ mô hình đã từ chối yêu cầu: {reason}. Hãy chọn mô hình khác, hoặc kiểm tra quyền truy cập của bạn vào mô hình này tại dịch vụ.",
  "error.provider.messageTooLarge": "OpenBot đã dừng {provider} vì nó gửi một tin nhắn lớn hơn {limit} MB.",
  "error.provider.customAgentIdInvalid":
    "ID agent chỉ được gồm chữ cái thường, chữ số hoặc `-`, và không được trùng ID của nhà cung cấp tích hợp sẵn.",
  "error.provider.customAgentEnvInvalid":
    "Tên biến chỉ được gồm chữ cái, chữ số hoặc `_`, và không bắt đầu bằng chữ số. Mỗi tên chỉ dùng một lần, tối đa 16 tên.",
  "error.provider.customAgentUsagePromptInvalid": "Lệnh xem mức sử dụng phải nằm trên một dòng, tối đa 256 ký tự.",
  "error.provider.customAgentCommandInvalid":
    "Lệnh phải là đường dẫn đầy đủ, đường dẫn bắt đầu bằng ~/, hoặc tên lệnh không có dấu cách.",
  "error.provider.customAgentArgsInvalid": "Đối số không được chứa dấu xuống dòng. Dùng tối đa 32 đối số.",
  "error.provider.customAgentWindowsScript":
    "Lệnh .cmd hoặc .bat chỉ nhận chữ cái, chữ số và - _ . , : = @ + / \\ trong các đối số.",
  "error.provider.customAgentNotFound": "OpenBot không tìm thấy {command}. Hãy nhập đường dẫn đầy đủ của lệnh.",
  "error.provider.customAgentCheckTimedOut": "Agent không phản hồi trong 20 giây.",
  "error.provider.customAgentCheckStopped": "Agent đã dừng trước khi phản hồi.",
  "error.provider.customAgentProtocolVersion": "Agent dùng ACP phiên bản {version}. OpenBot dùng phiên bản 1.",
  "error.provider.customAgentCheckFailed": "Agent không phản hồi như một agent ACP.",
  "error.provider.customAgentRemoveBusy":
    "Hãy chờ lượt đang chạy và hàng đợi hoàn tất trước khi xóa agent tùy chỉnh này.",
  "error.provider.customAgentNone": "Chưa lưu agent tùy chỉnh nào.",
  "error.provider.customAgentsUnavailable":
    "Máy chủ này không thể thay đổi agent tùy chỉnh. Hãy cập nhật OpenBot trên máy chủ.",
  "error.provider.customAgentMissing": "Agent tùy chỉnh này hiện không còn được lưu. Hãy chọn mô hình khác.",
  "error.provider.customAgentSignIn": "Hãy đăng nhập bằng lệnh riêng của agent, rồi thử lại.",
  "error.provider.customAgentsReadOnly":
    "Các agent tùy chỉnh đã lưu được ghi bởi phiên bản OpenBot mới hơn, hoặc không thể đọc tệp. Hãy cập nhật OpenBot để thay đổi chúng.",
  "error.provider.customAgentNoSecureStorage":
    "Máy tính này không có kho lưu trữ an toàn, nên không thể lưu giá trị biến môi trường. Hãy xóa chúng và thử lại.",
  "error.provider.customAgentNotSaved": "Agent tùy chỉnh này chưa được lưu. Hãy làm mới danh sách và thử lại.",
  "error.provider.customAgentWorkspaceOnly":
    "{reason}. Chế độ Chỉ không gian làm việc chặn thao tác này. Hãy thử Toàn quyền.",
  "error.provider.customAgentTooMany": "Bạn có thể lưu tối đa {count} agent tùy chỉnh.",
  "error.provider.customAgentEnvValueMissing": "Hãy nhập giá trị cho {name}.",
  "error.provider.off": "{provider} đang tắt trong OpenBot. Hãy bật trong cài đặt nhà cung cấp trước.",
  "error.provider.inUse":
    "Một agent đang dùng {provider}. Hãy đổi mô hình của agent đó trước khi tắt nhà cung cấp này.",
  "error.provider.useBusy": "Hãy chờ quá trình kiểm tra nhà cung cấp hoặc đăng nhập hoàn tất, rồi thử lại.",
  "error.provider.useSettingsReadOnly":
    "Không thể đọc cài đặt nhà cung cấp đã lưu. Hãy cập nhật OpenBot trước khi thay đổi chúng.",
  "error.provider.useChangeFailed": "OpenBot không thể thay đổi cài đặt nhà cung cấp.",
  "error.provider.accountsUnsupported": "{provider} chỉ có thể giữ một tài khoản.",
  "error.provider.accountNeedsConnection": "Hãy kết nối {provider} trước khi thêm tài khoản khác.",
  "error.provider.usageResetUnsupported": "{provider} không thể đặt lại giới hạn sử dụng.",
  "error.provider.signOutUnsupported": "OpenBot không thể ngắt kết nối đăng nhập {provider}.",
  "error.provider.usageResetNotConnected": "Hãy đăng nhập lại tài khoản {provider} này trước khi đặt lại mức sử dụng.",
  "error.provider.accountLimit": "{provider} có thể giữ tối đa {limit} tài khoản.",
  "error.provider.accountNotFound": "Tài khoản {provider} này không có trên máy tính này. Hãy làm mới và thử lại.",
  "error.provider.accountAlreadyAdded": "Tài khoản {provider} này đã được kết nối.",
  "error.provider.accountDefault": "Không thể xóa tài khoản {provider} đầu tiên.",
  "error.provider.accountUsesKey":
    "Tài khoản {provider} này dùng khóa API đã lưu và không có đăng nhập. Hãy thay đổi khóa trong Cài đặt máy chủ → Nhà cung cấp.",
  "error.provider.accountNeedsKey":
    "Các tài khoản {provider} sau tài khoản đầu tiên dùng khóa API. Hãy cập nhật OpenBot trên thiết bị này, rồi thử lại.",
  "error.provider.accountKeyRefused": "{provider} không chấp nhận khóa API này. Hãy kiểm tra khóa, rồi thử lại.",
  "error.provider.accountKeyUnreachable":
    "OpenBot không thể kết nối tới {provider} để kiểm tra khóa API. Hãy kiểm tra kết nối internet, rồi thử lại.",
  "error.provider.accountKeySignedOut":
    "{provider} không còn chấp nhận khóa API của tài khoản này. Hãy cấp khóa mới cho tài khoản.",
  "error.provider.accountInUse": "Một agent trên tài khoản này đang làm việc. Hãy thử lại khi agent dừng.",
  "error.provider.accountsReadOnly":
    "Không thể đọc các tài khoản nhà cung cấp đã lưu. Hãy cập nhật OpenBot trước khi thay đổi chúng.",
  "error.provider.accountSignedOut": "Tài khoản {provider} này đã đăng xuất. Hãy đăng nhập lại.",
  "error.provider.sessionSettingUnavailable": "Cài đặt này không khả dụng trong phiên nhà cung cấp hiện tại.",
  "error.provider.sessionSettingInvalid": "Giá trị này không khả dụng cho cài đặt.",
  "error.provider.sessionSettingsBusy": "Hãy chờ lượt hiện tại kết thúc trước khi thay đổi cài đặt phiên.",
  "error.provider.piOutdated": "Pi {version} đã quá cũ. Hãy cài Pi 1.1.0 trở lên để có hỗ trợ RPC gốc và MCP.",
  "error.provider.nativeMissing": "Chưa cài đặt {provider} CLI. Hãy tải xuống trong Cài đặt.",
  "error.provider.nativeNotStarted": "{provider} CLI không thể khởi động.",
  "error.provider.nativeVersionUnreadable": "Không thể đọc phiên bản {provider} CLI.",
  "error.provider.piSessionBusy": "Hãy chờ lượt Pi hiện tại kết thúc.",
  "error.provider.acpSessionBusy": "{provider} vẫn đang hoàn tất một lượt đã dừng. Hãy thử lại sau giây lát.",
  "error.provider.acpModelNotOffered":
    "{provider} hiện không cung cấp {model}. Hãy chọn mô hình khác cho agent này, rồi thử lại.",
  "error.provider.piStopped": "Pi không chạy. Hãy kết nối Pi và thử lại.",
  "error.provider.piSessionMissing": "Tệp phiên Pi không có trên máy tính này.",
  "error.provider.piResumeCancelled": "Pi đã hủy việc tiếp tục phiên. Hãy thử lại.",
  "error.provider.piSessionIdentity": "Pi trả về một phiên khác. Phiên đã lưu không bị thay thế.",
  "error.provider.piExtensionFailed":
    "Pi đã dừng vì không thể tải một tiện ích mở rộng. Hãy xóa hoặc cập nhật tiện ích mở rộng này, rồi thử lại. {detail}",
  "error.provider.piThreadStopped": "Pi đã dừng bất ngờ trước khi hoàn tất lượt này. Hãy gửi một tin nhắn để tiếp tục.",
  "error.provider.piModelInvalid": "Hãy chọn một mô hình Pi có kèm nhà cung cấp của nó.",
  "error.provider.piToolInvalid": "Công cụ trả về kết quả không hợp lệ.",
  "error.provider.piSignIn": "Hãy dùng /login trong Pi trên máy tính host. Đóng Pi khi đăng nhập xong.",
  "error.provider.museBusy": "Phiên Muse đang bận.",
  "error.provider.museStopped": "Ứng dụng khách Muse không chạy.",
  "error.provider.museUnexpectedProvider": "Muse trả về nhà cung cấp mô hình không như mong đợi.",
  "error.provider.museNoActiveTurn": "Muse không có lượt nào đang chạy để định hướng.",
  "error.provider.museInvalidProtocol": "Muse trả về phản hồi giao thức không hợp lệ.",
  "error.provider.museNotStarted": "Muse không khởi động.",
  "error.provider.museNativeWindows": "Muse cần một tệp thực thi gốc trên Windows.",
  "error.provider.museStartTimeout": "Khởi tạo Muse đã hết thời gian chờ.",
  "error.provider.museStartStopped": "Muse đã dừng trong lúc khởi tạo.",
  "error.provider.museProtocolVersion": "Phiên bản giao thức Muse không được hỗ trợ.",
  "error.provider.museHistoryRequired": "Muse phải giữ lịch sử phiên.",
  "error.provider.museRequestUnsupported": "Yêu cầu máy chủ Muse không được hỗ trợ.",
  "error.provider.museConnectionFailed":
    "Kết nối Muse thất bại. Hãy tiếp tục cuộc trò chuyện để khôi phục lịch sử đã lưu.",
  "error.provider.museUnknownSession": "Phiên Muse không xác định.",
  "error.provider.museInvalidToolResult": "Kết quả công cụ OpenBot không hợp lệ.",
  "error.provider.museMcpRequired": "Muse phải hỗ trợ máy chủ MCP theo phiên.",
  "error.provider.museSessionMismatch": "Muse trả về một phiên khác.",
  "error.provider.museCompactRejected": "Muse không chấp nhận việc thu gọn ngữ cảnh.",
  "error.provider.museTurnMismatch": "Muse trả về một lượt khác.",
  "error.provider.museHistoryMismatch": "Lịch sử Muse bị lẫn giữa các phiên.",
  "error.provider.museRecoveryFailed": "Muse không thể khôi phục các sự kiện bị thiếu.",
  "error.provider.museHistoryStalled": "Con trỏ lịch sử Muse không tiến lên.",
  "error.provider.museApprovalUnavailable": "Muse không cung cấp phản hồi phê duyệt này.",
  "error.provider.museHistoryOwner": "Lịch sử Muse thuộc về một phiên khác.",
  "error.provider.museHistoryMissing": "Muse không trả về lịch sử phiên.",
  "error.provider.museEmptyInput": "Muse cần văn bản hoặc hình ảnh.",
  "error.provider.museMethodUnsupported": "Muse không hỗ trợ {method}.",
  "error.provider.museTurnFailed": "Lượt Muse thất bại.",
  "error.provider.museModelUnavailable":
    "Muse không thể dùng mô hình này. Muse có thể không khả dụng tại quốc gia nơi agent này chạy, hoặc tài khoản này không có quyền truy cập mô hình. Hãy chọn mô hình khác, rồi thử lại.\n{detail}",
  "error.provider.museProfileUnsupported":
    "Muse không thể tạo hồ sơ khi không có quyền truy cập công cụ bên ngoài. Hãy dùng nhà cung cấp khác để tạo hồ sơ, rồi chọn Muse cho agent.",
  "error.provider.museAuthUnverified":
    "Xác thực Muse chưa được xác minh. Hãy kết nối trên máy tính host, hoặc đặt khóa API Meta.",
  "error.provider.museSignIn": "Hãy đăng nhập Muse trên máy tính host để tiếp tục.",
  "error.provider.inceptionSignIn": "Hãy thêm khóa API Inception để tiếp tục.",
  "error.provider.deepseekSignIn": "Hãy thêm khóa API DeepSeek để tiếp tục.",
  "error.provider.openrouterSignIn": "Hãy thêm khóa API OpenRouter để tiếp tục.",
  "error.provider.terminalLoginFailed":
    "Không thể mở terminal đăng nhập. Hãy mở CLI của nhà cung cấp trên host này và đăng nhập tại đó, rồi làm mới danh sách nhà cung cấp.",
  "error.provider.nativeArchiveInvalid": "Bản tải xuống của nhà cung cấp không chứa bản cài đặt hợp lệ.",
  "error.provider.nativeChecksum": "Bản cài đặt của nhà cung cấp không vượt qua bước kiểm tra tính toàn vẹn.",
  "error.provider.registryUnavailable": "Registry ACP không khả dụng. Hãy thử lại.",
  "error.provider.registryInvalid": "Registry ACP trả về dữ liệu không hợp lệ.",
  "error.provider.registryMissing": "Agent này không có trong registry ACP.",
  "error.provider.registryBusy": "Agent này đang được cài đặt.",
  "error.provider.registryCancelled": "Đã hủy cài đặt agent.",
  "error.provider.registryPrerequisite": "Hãy cài đặt {tool} trên host trước khi cài đặt agent này.",
  "error.provider.registryBindingChanged": "Agent tùy chỉnh đã thay đổi trong lúc cài đặt. Hãy thử lại.",
  "error.provider.registryInstallFailed": "Cài đặt agent thất bại. Bản cài đặt trước đó không thay đổi.",
  "error.provider.hermesInstallFailed": "Không cài đặt được Hermes Agent. Hãy thử lại, hoặc dùng hướng dẫn cài đặt.",
  "error.provider.hermesNeedsGitCurl": "Hermes Agent cần git và curl. Hãy cài đặt chúng, rồi thử lại.",
  "error.provider.registryRemoveBusy":
    "Hãy chờ quá trình cài đặt agent và các tác vụ ACP đang chạy hoàn tất trước khi xóa agent.",
} as const satisfies PartialTranslation<typeof source>;
