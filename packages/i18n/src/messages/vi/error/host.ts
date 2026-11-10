import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  // Errors from host setup, publishing, and host maintenance.
  "error.host.iceServersMissing": "Remote Signal chưa cung cấp máy chủ ICE.",
  "error.host.keyRotationUnavailable": "Máy chủ này không thể đổi khóa nếu không có dịch vụ tài khoản.",
  "error.host.keyRotationRefused": "Dịch vụ tài khoản không chấp nhận khóa máy chủ mới. Khóa hiện tại vẫn được dùng.",
  "error.host.webRtcNotConfigured": "Dịch vụ máy tính WebRTC chưa được cấu hình.",
  "error.host.runtimeNotInstalled": "Chưa cài đặt môi trường chạy máy tính từ xa.",
  "error.host.setupUnavailable": "Thiết lập quyền không khả dụng.",
  "error.host.accountChangedDuringUpdate":
    "Tài khoản đã đăng nhập đã thay đổi trong khi máy chủ này đang được cập nhật.",
  "error.host.nameBeforePublish": "Hãy đặt tên cho OpenBot này trước khi xuất bản.",
  "error.host.memberNotFound": "Thành viên từ xa không tồn tại.",
  "error.host.publishBeforeInvite": "Hãy đưa OpenBot này ra công khai trước khi tạo lời mời.",
  "error.host.teamAccessUnavailable": "Quyền truy cập nhóm của bạn không khả dụng.",
  "error.host.ownerIdentityUnavailable": "Danh tính chủ sở hữu máy tính không khả dụng.",
  "error.host.reserveAddressFailed": "Không thể dành địa chỉ công khai.",
  "error.host.publishFailed": "Không thể xuất bản OpenBot này.",
  "error.host.mobileConnectPublishFailed": "Không thể xuất bản OpenBot này cho Mobile Connect.",
  "error.host.mobileConnectHostChanged": "Máy tính Mobile Connect đã thay đổi. Hãy thử lại.",
  "error.host.noServer": "Máy tính này không có máy chủ để thay đổi.",
  "error.host.identityLocalOnly": "Tên và logo máy chủ chỉ có thể thay đổi trên máy tính chạy nó.",
  "error.host.timezoneInvalid": "Múi giờ này không được nhận biết.",
  "error.host.maintenanceInterrupted":
    "Quá trình bảo trì máy tính đã bị gián đoạn. Kiểm tra ứng dụng và đặt lại trạng thái máy tính trước khi thử lại.",
  "error.host.updateFailed":
    "Cập nhật máy tính thất bại trong {phase}. Kiểm tra quyền sở hữu gói, chữ ký, trạng thái tenant và dung lượng đĩa trống trước khi đặt lại trạng thái.",
  "error.host.tenantsNotIdle": "Các tenant không nghỉ liên tục năm phút trong vòng hai giờ.",
  "error.host.tenantShutdownTimeout": "Đã hết thời gian tắt tenant. Không bắt đầu thay thế ứng dụng nào.",
  "error.host.tenantHealthMissing":
    "Báo cáo sức khỏe tenant bị thiếu hoặc không khỏe mạnh sau khi khởi động lại. Kiểm tra phiên tenant trước khi cập nhật lần nữa.",
  "error.host.personalityInvalid": "Kiểu phản hồi này không được nhận biết.",
} as const satisfies PartialTranslation<typeof source>;
