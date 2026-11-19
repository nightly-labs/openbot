import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot không kết nối được với dịch vụ tài khoản. Hãy kiểm tra API có đang chạy không, rồi thử lại.",
  "error.auth.networkBlocked":
    "Tường lửa hoặc proxy trên mạng này đã chặn OpenBot kết nối tới {host}. Hãy nhờ quản trị viên mạng cho phép {host}, rồi thử lại.",
  "error.auth.signInFirst": "Hãy đăng nhập OpenBot trước.",
  "error.auth.signInRequired": "Bạn cần đăng nhập.",
  "error.auth.chatColorUnavailable": "Dịch vụ tài khoản chưa hỗ trợ màu cuộc trò chuyện. Hãy thử lại sau.",
  "error.auth.accountChangedDuringRegister": "Tài khoản đăng nhập đã thay đổi trong lúc đăng ký máy chủ này.",
  "error.auth.hostCredentialUnavailable": "Không có thông tin xác thực của host từ xa. Hãy đăng ký lại host.",
  "error.auth.codeNotVerified": "Không xác minh được mã đăng nhập.",
  "error.auth.serviceError": "Dịch vụ tài khoản trả về lỗi.",
  "error.auth.serviceUnreachable":
    "OpenBot không kết nối được với dịch vụ tài khoản. Hãy kiểm tra kết nối, rồi thử lại.",
  "error.auth.serviceTimeout": "Dịch vụ tài khoản không phản hồi kịp. Hãy thử lại.",
  "error.auth.serviceStatus": "Dịch vụ tài khoản trả về lỗi ({status}). Hãy thử lại sau.",
  "error.auth.invalidHostedServer": "Dịch vụ tài khoản trả về máy chủ được lưu trữ không hợp lệ.",
  "error.auth.invalidServerClaim": "Dịch vụ tài khoản trả về yêu cầu nhận máy chủ không hợp lệ.",
  "error.auth.codeNotSent": "OpenBot không gửi được mã đăng nhập.",
  "error.auth.deliveryTimeout":
    "OpenBot không xác nhận kịp việc gửi mã. Mã có thể vẫn đến; hãy kiểm tra trước khi gửi lại.",
  "error.auth.deliveryInterrupted":
    "Kết nối đã ngắt trước khi OpenBot xác nhận việc gửi mã. Hãy kiểm tra để tránh gửi thêm một mã khác.",
  "error.auth.deliveryUnknown":
    "OpenBot không xác nhận được mã đăng nhập đã được gửi hay chưa. Hãy kiểm tra trước khi gửi lại.",
  "error.auth.companySignInFailed": "Đăng nhập bằng tài khoản công ty chưa hoàn tất. Hãy thử lại.",
  "error.auth.companySignInCancelled": "Đăng nhập bằng tài khoản công ty đã bị hủy.",
  "error.auth.companySignInTimeout":
    "Đăng nhập bằng tài khoản công ty mất quá nhiều thời gian. Hãy mở lại trang đăng nhập.",
  "error.auth.companySignInRefused": "Việc đăng nhập tại công ty của bạn đã bị hủy hoặc bị từ chối.",
  "error.auth.companySignInDomainMismatch": "Tài khoản công ty có email thuộc tên miền không có trong thiết lập.",
  "error.auth.companySignInAccountDisabled": "Công ty của bạn đã tắt tài khoản này. Hãy hỏi quản trị viên.",
  "error.auth.companySignInOff": "Đăng nhập bằng tài khoản công ty đang tắt cho email này.",
  "error.auth.companySignInEmailMissing": "Tài khoản công ty của bạn không cung cấp địa chỉ email đã xác minh.",
  "error.auth.companySignInUnavailable": "OpenBot này không mở được trình duyệt để đăng nhập bằng tài khoản công ty.",
  "error.auth.companySignInProviderRejected": "Nhà cung cấp không chấp nhận client ID hoặc secret.",
  "error.auth.companySignInTokenInvalid": "Nhà cung cấp trả về thông tin đăng nhập mà OpenBot không kiểm tra được.",
  "error.auth.companySignInProviderUnreachable": "Nhà cung cấp đăng nhập của công ty không phản hồi.",
  "error.auth.companySignInDomainTaken": "Một trong các tên miền này đã đăng nhập qua một máy chủ khác.",
  "error.auth.companySignInNoServer": "Hãy khởi động máy chủ này trước khi thiết lập đăng nhập bằng tài khoản công ty.",
} as const satisfies PartialTranslation<typeof source>;
