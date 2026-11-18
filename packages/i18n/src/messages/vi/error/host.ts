import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal chưa cung cấp máy chủ ICE.",
  "error.host.keyRotationUnavailable": "Máy chủ này không thể đổi khóa khi không có dịch vụ tài khoản.",
  "error.host.keyRotationRefused":
    "Dịch vụ tài khoản không chấp nhận khóa máy chủ mới. Khóa hiện tại vẫn được sử dụng.",
  "error.host.webRtcNotConfigured": "Dịch vụ host WebRTC chưa được cấu hình.",
  "error.host.runtimeNotInstalled": "Chưa cài đặt môi trường chạy máy tính từ xa.",
  "error.host.setupUnavailable": "Không thể thiết lập quyền.",
  "error.host.accountChangedDuringUpdate": "Tài khoản đăng nhập đã thay đổi trong khi máy chủ này đang được cập nhật.",
  "error.host.nameBeforePublish": "Hãy đặt tên cho OpenBot này trước khi công khai.",
  "error.host.memberNotFound": "Thành viên từ xa không tồn tại.",
  "error.host.publishBeforeInvite": "Hãy công khai OpenBot này trước khi tạo lời mời.",
  "error.host.teamAccessUnavailable": "Quyền truy cập nhóm của bạn hiện không khả dụng.",
  "error.host.ownerIdentityUnavailable": "Không có thông tin danh tính chủ sở hữu host.",
  "error.host.reserveAddressFailed": "Không thể giữ chỗ địa chỉ công khai.",
  "error.host.publishFailed": "Không thể công khai OpenBot này.",
  "error.host.mobileConnectPublishFailed": "Không thể công khai OpenBot này cho Mobile Connect.",
  "error.host.mobileConnectHostChanged": "Host Mobile Connect đã thay đổi. Hãy thử lại.",
  "error.host.mobileConnectHostMismatch": "Tài khoản của bạn có khóa khác cho máy chủ này. Hãy thử lại.",
  "error.host.noServer": "Máy tính này không có máy chủ nào để thay đổi.",
  "error.host.identityLocalOnly": "Chỉ có thể đổi tên và logo máy chủ trên máy tính đang chạy máy chủ đó.",
  "error.host.timezoneInvalid": "Không nhận ra múi giờ này.",
  "error.host.turnLimitInvalid": "Giới hạn luồng này không hợp lệ.",
  "error.host.maintenanceInterrupted":
    "Quá trình bảo trì host bị gián đoạn. Hãy kiểm tra ứng dụng và đặt lại trạng thái host trước khi thử lại.",
  "error.host.updateFailed":
    "Cập nhật host thất bại ở bước {phase}. Hãy kiểm tra quyền sở hữu gói, chữ ký, trạng thái tenant và dung lượng đĩa trống trước khi đặt lại trạng thái.",
  "error.host.tenantsNotIdle": "Các tenant không ở trạng thái rảnh liên tục năm phút trong vòng hai giờ.",
  "error.host.tenantShutdownTimeout": "Tắt tenant bị quá thời gian. Chưa bắt đầu thay thế ứng dụng.",
  "error.host.tenantHealthMissing":
    "Sau khi khởi động lại, báo cáo tình trạng tenant bị thiếu hoặc không ổn định. Hãy kiểm tra các phiên tenant trước khi cập nhật lần nữa.",
  "error.host.personalityInvalid": "Không nhận ra phong cách phản hồi này.",
} as const satisfies PartialTranslation<typeof source>;
