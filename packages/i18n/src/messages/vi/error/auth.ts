import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  // Errors from the OpenBot account service.
  "error.auth.serviceUnavailable":
    "OpenBot không thể kết nối tới dịch vụ tài khoản. Hãy kiểm tra xem API có đang chạy không, rồi thử lại.",
  "error.auth.networkBlocked":
    "Một tường lửa hoặc proxy trong mạng này đã chặn OpenBot kết nối tới {host}. Hãy nhờ quản trị viên mạng cho phép {host}, rồi thử lại.",
  "error.auth.signInFirst": "Hãy đăng nhập vào OpenBot trước.",
  "error.auth.signInRequired": "Cần đăng nhập.",
  "error.auth.chatColorUnavailable": "Dịch vụ tài khoản chưa hỗ trợ màu trò chuyện. Hãy thử lại sau.",
  "error.auth.accountChangedDuringRegister": "Tài khoản đã đăng nhập bị thay đổi trong lúc máy chủ này được đăng ký.",
  "error.auth.hostCredentialUnavailable":
    "Thông tin xác thực của máy chủ từ xa không khả dụng. Hãy đăng ký máy chủ này lại.",
  "error.auth.codeNotVerified": "Không thể xác minh mã đăng nhập.",
  "error.auth.serviceError": "Dịch vụ tài khoản trả về một lỗi.",
  "error.auth.serviceUnreachable":
    "OpenBot không thể kết nối tới dịch vụ tài khoản. Hãy kiểm tra kết nối của bạn, rồi thử lại.",
  "error.auth.serviceTimeout": "Dịch vụ tài khoản không phản hồi kịp thời gian. Hãy thử lại.",
  "error.auth.serviceStatus": "Dịch vụ tài khoản trả về một lỗi ({status}). Hãy thử lại sau.",
  "error.auth.invalidHostedServer": "Dịch vụ tài khoản trả về một máy chủ lưu trữ không hợp lệ.",
  "error.auth.invalidServerClaim": "Dịch vụ tài khoản trả về một yêu cầu máy chủ không hợp lệ.",
  "error.auth.codeNotSent": "OpenBot không thể gửi mã đăng nhập.",
  "error.auth.deliveryTimeout":
    "OpenBot không thể xác nhận việc gửi kịp thời gian. Mã có thể vẫn tới; hãy kiểm tra hộp thư trước khi gửi lại.",
  "error.auth.deliveryInterrupted":
    "Kết nối kết thúc trước khi OpenBot xác nhận việc gửi. Hãy kiểm tra hộp thư để tránh gửi một mã khác.",
  "error.auth.deliveryUnknown":
    "OpenBot không thể xác nhận mã đăng nhập đã được gửi hay chưa. Hãy kiểm tra hộp thư trước khi gửi lại.",
  // Company sign-in, which the company's provider does in the browser.
  "error.auth.companySignInFailed": "Đăng nhập bằng tài khoản công ty không hoàn tất. Hãy thử lại.",
  "error.auth.companySignInCancelled": "Đăng nhập bằng tài khoản công ty đã bị hủy.",
  "error.auth.companySignInTimeout":
    "Đăng nhập bằng tài khoản công ty mất quá nhiều thời gian. Hãy mở lại trang đăng nhập.",
  "error.auth.companySignInRefused": "Đăng nhập ở công ty của bạn đã bị hủy hoặc từ chối.",
  "error.auth.companySignInDomainMismatch":
    "Tài khoản công ty có địa chỉ email thuộc một tên miền không nằm trong thiết lập.",
  "error.auth.companySignInAccountDisabled": "Công ty của bạn đã tắt tài khoản này. Hãy hỏi quản trị viên của bạn.",
  "error.auth.companySignInOff": "Đăng nhập bằng tài khoản công ty đang tắt cho email này.",
  "error.auth.companySignInEmailMissing": "Tài khoản công ty của bạn không cung cấp địa chỉ email đã xác minh.",
  "error.auth.companySignInUnavailable": "OpenBot này không thể mở trình duyệt để đăng nhập bằng tài khoản công ty.",
  "error.auth.companySignInProviderRejected": "Nhà cung cấp không chấp nhận client ID hoặc secret.",
  "error.auth.companySignInTokenInvalid": "Nhà cung cấp trả về một lượt đăng nhập mà OpenBot không thể kiểm tra.",
  "error.auth.companySignInProviderUnreachable": "Nhà cung cấp đăng nhập công ty không phản hồi.",
  "error.auth.companySignInDomainTaken": "Một trong các tên miền này đã đăng nhập qua một máy chủ khác.",
  "error.auth.companySignInNoServer": "Hãy khởi động máy chủ này trước khi thiết lập đăng nhập bằng tài khoản công ty.",
} as const satisfies PartialTranslation<typeof source>;
