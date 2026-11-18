import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "Bản dựng OpenBot này không có GitHub App.",
  "error.connector.githubDenied": "Yêu cầu đăng nhập GitHub đã bị từ chối.",
  "error.connector.githubCodeExpired": "Mã GitHub đã hết hạn. Hãy kết nối lại GitHub.",
  "error.connector.githubDeviceFlowDisabled": "GitHub App không cho phép đăng nhập bằng thiết bị.",
  "error.connector.githubClientUnknown": "GitHub không nhận ra Client ID của GitHub App này.",
  "error.connector.githubUnexpected": "GitHub gửi phản hồi không mong đợi: {detail}",
  "error.connector.githubUnreachable": "OpenBot không thể kết nối tới GitHub: {detail}",
  "error.connector.githubExpired": "Kết nối GitHub đã hết hạn. Hãy kết nối lại GitHub.",
  "error.connector.githubFileUnreadable": "Không đọc được tệp kết nối GitHub.",
  "error.connector.githubFileTooLarge": "Tệp kết nối GitHub quá lớn.",
  "error.connector.linkDenied": "Yêu cầu đăng nhập Link đã bị từ chối.",
  "error.connector.linkCodeExpired": "Phiên đăng nhập Link đã hết hạn. Hãy kết nối lại Link.",
  "error.connector.linkUnexpected": "Link gửi phản hồi không mong đợi: {detail}",
  "error.connector.linkUnreachable": "OpenBot không thể kết nối tới Link: {detail}",
  "error.connector.linkExpired": "Kết nối Link đã hết hạn. Hãy kết nối lại Link.",
  "error.connector.linkNotConnected": "Link chưa được kết nối. Hãy kết nối trong Cài đặt máy chủ > Kho bảo mật > Thẻ.",
  "error.connector.linkNoCard": "Tài khoản Link chưa có thẻ nào. Hãy thêm thẻ trong Link.",
  "error.connector.linkFileUnreadable": "Không đọc được tệp kết nối Link.",
  "error.connector.linkFileTooLarge": "Tệp kết nối Link quá lớn.",
  "error.connector.onePasswordCliMissing":
    "OpenBot không tìm thấy 1Password CLI. Hãy cài đặt và bật tích hợp của nó trong ứng dụng 1Password, hoặc dùng token tài khoản dịch vụ.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot không thể cài đặt 1Password CLI. Hãy kiểm tra kết nối internet rồi thử lại.",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI chưa đăng nhập. Hãy bật tích hợp của nó trong ứng dụng 1Password rồi kết nối lại.",
  "error.connector.onePasswordAppUnreachable":
    "OpenBot không thể kết nối tới ứng dụng 1Password. Hãy mở và mở khóa 1Password. Trong Settings > Developer, đảm bảo “Integrate with 1Password CLI” đang bật. Sau đó thử lại.",
  "error.connector.onePasswordCliFailed": "1Password CLI gặp lỗi: {detail}",
  "error.connector.onePasswordCliForbidden":
    "Tài khoản 1Password của bạn không cho phép tạo kho dùng chung hoặc tài khoản dịch vụ. Hãy xin quyền này từ chủ sở hữu hoặc quản trị viên tài khoản, hoặc xin họ một token tài khoản dịch vụ rồi nhấp “Dùng token”.",
  "error.connector.onePasswordUnexpected": "1Password gửi phản hồi không mong đợi: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password không chấp nhận token tài khoản dịch vụ.",
  "error.connector.onePasswordUnreachable":
    "OpenBot không thể kết nối tới 1Password. Hãy kiểm tra kết nối internet rồi thử lại.",
  "error.connector.onePasswordRateLimited": "1Password nhận quá nhiều yêu cầu. Hãy đợi vài phút rồi thử lại.",
  "error.connector.onePasswordNoVault":
    "Tài khoản dịch vụ không đọc được kho nào. Hãy cấp cho nó quyền truy cập một kho rồi thử lại.",
  "error.connector.onePasswordFileUnreadable": "Không đọc được tệp kết nối 1Password.",
  "error.connector.onePasswordFileTooLarge": "Tệp kết nối 1Password quá lớn.",
  "error.connector.bitwardenFailed":
    "Không thể đọc Bitwarden. Hãy cài đặt bw CLI, đăng nhập, mở khóa và tạo một thư mục tên Shared with OpenBot. Kết nối bằng một khóa phiên mới.",
  "error.connector.bitwardenCliMissing":
    "OpenBot không tìm thấy Bitwarden CLI. Hãy cài đặt bw, đảm bảo nó chạy được trong một terminal mới rồi kết nối lại.",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden phải có đúng một thư mục tên Shared with OpenBot. Hãy tạo thư mục đó hoặc xóa thư mục thừa rồi kết nối lại.",
  "error.connector.bitwardenHostInput":
    "Nhập địa chỉ máy chủ HTTPS, client_id và client_secret của khóa API, cùng mật khẩu chính.",
  "error.connector.bitwardenHostFailed":
    "Không thể mở Bitwarden trên máy chủ này. Hãy kiểm tra địa chỉ máy chủ, khóa API và mật khẩu chính, đồng thời đảm bảo có một thư mục tên Shared with OpenBot. Sau đó kết nối lại.",
  "error.connector.bitwardenCliInstallFailed":
    "Không thể cài đặt Bitwarden CLI trên máy chủ này. Hãy kiểm tra kết nối mạng của máy chủ rồi kết nối lại.",
  "error.connector.bitwardenFileUnreadable": "Không đọc được tệp kết nối Bitwarden.",
  "error.connector.passwordManagerUnknown": "OpenBot không nhận ra trình quản lý mật khẩu này.",
  "error.connector.passwordManagerMethod": "Trình quản lý mật khẩu này không thể kết nối theo cách này.",
  "error.connector.passwordManagerNoSignIn": "Không có trang đăng nhập nào đang mở. Hãy kết nối lại.",
  "error.connector.protonPassFailed": "Không thể kết nối Proton Pass. Hãy kết nối lại.",
  "error.connector.protonPassCliInstallFailed":
    "Không thể cài đặt Proton Pass CLI. Hãy kiểm tra kết nối mạng rồi kết nối lại.",
  "error.connector.protonPassPlan": "Gói Proton của bạn không hỗ trợ Proton Pass CLI. Hãy đổi gói rồi kết nối lại.",
  "error.connector.protonPassExpired": "Quyền truy cập Proton Pass đã hết hạn. Hãy kết nối lại.",
  "error.connector.protonPassKeyInvalid": "Nhập khóa truy cập Proton Pass bắt đầu bằng pst_.",
  "error.connector.protonPassExtraPassword": "Mật khẩu bổ sung không đúng. Hãy nhập lại.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass không yêu cầu mật khẩu bổ sung.",
  "error.connector.protonPassFileUnreadable": "Không đọc được tệp kết nối Proton Pass.",
  "error.connector.protonPassSignInTimeout": "Đăng nhập Proton mất quá nhiều thời gian. Hãy kết nối lại.",
  "error.connector.protonPassSetupFailed":
    "Không thể tạo kho Shared with OpenBot hoặc khóa truy cập của kho trong Proton Pass. Hãy kết nối lại.",
} as const satisfies PartialTranslation<typeof source>;
