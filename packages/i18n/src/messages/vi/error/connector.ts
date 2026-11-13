import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  // The built-in GitHub connection: the device flow, the token refresh and the stored file.
  "error.connector.githubUnavailable": "Bản dựng này của OpenBot không có GitHub App.",
  "error.connector.githubDenied": "Đăng nhập GitHub bị từ chối.",
  "error.connector.githubCodeExpired": "Mã GitHub đã hết hạn. Hãy kết nối GitHub lại.",
  "error.connector.githubDeviceFlowDisabled": "GitHub App không cho phép đăng nhập bằng thiết bị.",
  "error.connector.githubClientUnknown": "GitHub không biết Client ID của GitHub App này.",
  "error.connector.githubUnexpected": "GitHub đã gửi một câu trả lời không mong đợi: {detail}",
  "error.connector.githubUnreachable": "OpenBot không thể kết nối tới GitHub: {detail}",
  "error.connector.githubExpired": "Kết nối GitHub đã hết hạn. Hãy kết nối GitHub lại.",
  "error.connector.githubFileUnreadable": "Không thể đọc tệp kết nối GitHub.",
  "error.connector.githubFileTooLarge": "Tệp kết nối GitHub quá lớn.",
  "error.connector.linkDenied": "Đăng nhập Link bị từ chối.",
  "error.connector.linkCodeExpired": "Đăng nhập Link đã hết hạn. Hãy kết nối Link lại.",
  "error.connector.linkUnexpected": "Link đã gửi một câu trả lời không mong đợi: {detail}",
  "error.connector.linkUnreachable": "OpenBot không thể kết nối tới Link: {detail}",
  "error.connector.linkExpired": "Kết nối Link đã hết hạn. Hãy kết nối Link lại.",
  "error.connector.linkNotConnected": "Link chưa được kết nối. Hãy kết nối trong Cài đặt máy chủ > Kho > Thẻ.",
  "error.connector.linkNoCard": "Tài khoản Link chưa có thẻ nào. Hãy thêm một thẻ trong Link.",
  "error.connector.linkFileUnreadable": "Không thể đọc tệp kết nối Link.",
  "error.connector.linkFileTooLarge": "Tệp kết nối Link quá lớn.",
  // The 1Password connection: the CLI that creates the service account, the token and the stored file.
  "error.connector.onePasswordCliMissing":
    "OpenBot không thể tìm thấy 1Password CLI. Hãy cài đặt nó và bật tích hợp trong ứng dụng 1Password, hoặc dùng token tài khoản dịch vụ.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot không thể cài đặt 1Password CLI. Hãy kiểm tra kết nối internet, rồi thử lại.",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI chưa đăng nhập. Hãy bật tích hợp trong ứng dụng 1Password, rồi kết nối lại.",
  "error.connector.onePasswordCliFailed": "1Password CLI đã thất bại: {detail}",
  "error.connector.onePasswordUnexpected": "1Password đã gửi một câu trả lời không mong đợi: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password không chấp nhận token tài khoản dịch vụ.",
  "error.connector.onePasswordNoVault":
    "Tài khoản dịch vụ không thể đọc một kho. Hãy cấp cho nó quyền truy cập một kho, rồi thử lại.",
  "error.connector.onePasswordFileUnreadable": "Không thể đọc tệp kết nối 1Password.",
  "error.connector.onePasswordFileTooLarge": "Tệp kết nối 1Password quá lớn.",
  "error.connector.bitwardenFailed":
    "Không thể đọc Bitwarden. Hãy cài đặt bw CLI, đăng nhập, mở khóa, và tạo một thư mục tên Shared dành cho OpenBot. Kết nối bằng một khóa phiên mới.",
  "error.connector.bitwardenHostInput":
    "Nhập địa chỉ máy chủ HTTPS, client_id và client_secret của khóa API, và mật khẩu chính.",
  "error.connector.bitwardenHostFailed":
    "Không thể mở Bitwarden trên máy chủ này. Hãy kiểm tra địa chỉ máy chủ, khóa API và mật khẩu chính, và đảm bảo có một thư mục tên Shared dành cho OpenBot. Rồi kết nối lại.",
  "error.connector.bitwardenCliInstallFailed":
    "Không thể cài đặt Bitwarden CLI trên máy chủ này. Hãy kiểm tra kết nối mạng của nó, rồi kết nối lại.",
  "error.connector.bitwardenFileUnreadable": "Không thể đọc tệp kết nối Bitwarden.",
  "error.connector.passwordManagerUnknown": "OpenBot không biết trình quản lý mật khẩu này.",
  "error.connector.passwordManagerMethod": "Trình quản lý mật khẩu này không thể kết nối theo cách này.",
  "error.connector.passwordManagerNoSignIn": "Không có trang đăng nhập nào đang mở. Hãy kết nối lại.",
  "error.connector.protonPassFailed": "Không thể kết nối Proton Pass. Hãy kết nối lại.",
  "error.connector.protonPassCliInstallFailed":
    "Không thể cài đặt Proton Pass CLI. Hãy kiểm tra kết nối mạng, rồi kết nối lại.",
  "error.connector.protonPassPlan":
    "Gói Proton của bạn không cho phép dùng Proton Pass CLI. Hãy đổi gói, rồi kết nối lại.",
  "error.connector.protonPassExpired": "Quyền truy cập Proton Pass đã kết thúc. Hãy kết nối lại.",
  "error.connector.protonPassKeyInvalid": "Nhập khóa truy cập Proton Pass bắt đầu bằng pst_.",
  "error.connector.protonPassExtraPassword": "Mật khẩu bổ sung không đúng. Hãy nhập lại.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass không yêu cầu mật khẩu bổ sung.",
  "error.connector.protonPassFileUnreadable": "Không thể đọc tệp kết nối Proton Pass.",
  "error.connector.protonPassSignInTimeout": "Đăng nhập Proton mất quá lâu. Hãy kết nối lại.",
  "error.connector.protonPassSetupFailed":
    "Không thể tạo kho Shared dành cho OpenBot hoặc khóa truy cập của nó trong Proton Pass. Hãy kết nối lại.",
} as const satisfies PartialTranslation<typeof source>;
