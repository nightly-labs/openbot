import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld": "Máy chủ này không hỗ trợ CRM. Hãy cập nhật OpenBot trên máy tính chạy máy chủ.",
  "error.crm.tooLargeToSend": "Trang CRM này quá lớn để gửi tới ứng dụng này.",
  "error.crm.customerMissing": "Khách hàng này không còn tồn tại.",
  "error.crm.planMissing": "Gói này không còn tồn tại.",
  "error.crm.paymentMissing": "Khoản thanh toán này không còn tồn tại.",
  "error.crm.tagMissing": "Thẻ này không còn tồn tại.",
  "error.crm.statusMissing": "Trạng thái này không còn tồn tại.",
  "error.crm.proposalMissing": "Đề xuất này không còn tồn tại hoặc đã được quyết định.",
  "error.crm.tagExists": "Đã có một thẻ trùng tên này.",
  "error.crm.statusExists": "Đã có một trạng thái trùng tên này.",
  "error.crm.builtinStatus": "Bạn không thể đổi tên hoặc xóa trạng thái có sẵn.",
  "error.crm.tooManyStatuses": "CRM đã có số trạng thái tối đa. Hãy xóa một trạng thái trước.",
  "error.crm.tooManyTags": "CRM đã có số thẻ tối đa. Hãy xóa một thẻ trước.",
  "error.crm.tooManyPlans": "Khách hàng này đã có số gói tối đa. Hãy xóa một gói trước.",
  "error.crm.paymentPaid": "Khoản thanh toán này đã được trả. Hãy đánh dấu là chưa trả trước.",
  "error.crm.splitTotal": "Tổng các phần phải bằng số tiền của khoản thanh toán.",
  "error.crm.planEndsBeforeStart": "Gói không thể kết thúc trước khi bắt đầu.",
  "error.crm.currencyInUse": "Bạn không thể đổi đơn vị tiền tệ của khách hàng đã có gói hoặc khoản thanh toán.",
  "error.crm.badCursor": "Trang này không còn hợp lệ. Hãy tải lại danh sách.",
  "error.crm.invalidChange": "Thay đổi này không hợp lệ.",
  "error.crm.agentNotAllowed":
    "Agent này không thể dùng CRM. Chủ sở hữu hoặc quản trị viên có thể cho phép: mở trang CRM, nhấp Đề xuất, nhấp nút có số lượng agent, rồi bật agent này.",
  "error.crm.tooManyProposals": "Có quá nhiều đề xuất đang chờ quyết định. Hãy chờ đến khi có người quyết định.",
  "error.crm.amountInvalid": "Hãy nhập số tiền dưới dạng số, ví dụ 129.00.",
  "error.crm.amountDecimals": "Số tiền có quá nhiều chữ số thập phân cho {currency}.",
  "error.crm.fieldPrivate": "Trường này là riêng tư. Agent không thể đọc hoặc lọc theo trường này.",
  "error.crm.sourceOwned":
    "Hàng này do Stripe quản lý. Hãy thay đổi trong Stripe; CRM sẽ nhận thay đổi ở lần đồng bộ tiếp theo.",
  "error.crm.sourceConnected": "Stripe đã được kết nối với CRM này.",
  "error.crm.sourceMissing": "Kết nối Stripe này không còn tồn tại.",
  "error.crm.sourceSecretKey":
    "Đây là khóa bí mật, có thể thay đổi tài khoản Stripe của bạn. Hãy tạo một khóa hạn chế chỉ có quyền đọc.",
  "error.crm.sourceInvalidKey": "Stripe không chấp nhận khóa này. Hãy sao chép lại khóa hạn chế.",
  "error.crm.sourcePermission":
    "Khóa này không thể đọc khách hàng, hóa đơn, gói đăng ký, sự kiện và sản phẩm. Hãy cấp cho khóa quyền đọc các mục này.",
  "error.crm.sourceRateLimited": "Stripe nhận quá nhiều yêu cầu. Hãy thử lại sau một phút.",
  "error.crm.sourceNetwork": "OpenBot không thể kết nối tới Stripe. Hãy kiểm tra kết nối internet.",
  "error.crm.sourceFailed": "Stripe gửi một phản hồi mà OpenBot không đọc được. Hãy thử lại sau.",
  "error.crm.sourceKeySaveFailed": "OpenBot không thể lưu khóa Stripe trên máy tính này.",
  "error.crm.off": "CRM đang tắt. Chủ sở hữu hoặc quản trị viên có thể bật CRM trong Cài đặt máy chủ > Thử nghiệm.",
  "error.crm.settingsSaveFailed": "OpenBot không thể lưu cài đặt CRM trên máy chủ này.",
} as const satisfies PartialTranslation<typeof source>;
