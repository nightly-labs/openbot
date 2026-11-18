import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot không thể kết nối. Hãy thử lại.",
  "mobile.link.invite.signInTitle": "Đăng nhập để tham gia máy chủ này",
  "mobile.link.invite.signInDescription":
    "Quét mã QR trong OpenBot trên máy tính của bạn. Sau đó bạn có thể xem lại lời mời.",
  "mobile.link.invite.cancel": "Hủy lời mời",
  "mobile.link.pairing.title": "Kết nối điện thoại này",
  "mobile.link.pairing.alreadySignedIn":
    "Bạn đã đăng nhập. Hãy đăng xuất trong Cài đặt trước khi kết nối tài khoản khác.",
  "mobile.link.pairing.description": "Chỉ tiếp tục nếu bạn đã yêu cầu liên kết Mobile Connect này từ máy tính.",
  "mobile.link.pairing.accountService":
    "Liên kết này kết nối tới dịch vụ tài khoản tại {origin}, không phải dịch vụ tài khoản OpenBot.",
  "mobile.link.pairing.connect": "Kết nối",
  "mobile.link.plugin.title": "Mở trang tiện ích",
  "mobile.link.plugin.description": "Xem tiện ích này trên trang web OpenBot.",
  "mobile.link.plugin.openFailed": "Không thể mở trang tiện ích.",
  "mobile.link.plugin.view": "Xem tiện ích",
  "mobile.link.unavailable.title": "Liên kết không khả dụng",
  "mobile.link.unavailable.description":
    "Liên kết này không hợp lệ, không còn khả dụng, hoặc không hỗ trợ trên điện thoại.",
  "mobile.link.template.signInTitle": "Đăng nhập để thêm trợ lý này",
  "mobile.link.template.signInDescription":
    "Quét mã QR trong OpenBot trên máy tính của bạn. Sau đó bạn có thể xem lại trợ lý trước khi thêm.",
  "mobile.link.template.loading": "Đang tải trợ lý…",
  "mobile.link.template.creator": "Bởi {name}",
  "mobile.link.template.section.instructions": "Chỉ dẫn",
  "mobile.link.template.section.skills": "Kỹ năng",
  "mobile.link.template.section.noSkills": "Không có kỹ năng.",
  "mobile.link.template.section.routines": "Nhiệm vụ định kỳ",
  "mobile.link.template.section.noRoutines": "Không có nhiệm vụ định kỳ.",
  "mobile.link.template.skill.local": "Kỹ năng cục bộ (chỉ SKILL.md)",
  "mobile.link.template.skill.marketplace": "Kỹ năng từ Cửa hàng, phiên bản {version}",
  "mobile.link.template.server.title": "Thêm vào máy chủ",
  "mobile.link.template.server.footer": "Chỉ hiện những máy chủ mà bạn là chủ sở hữu hoặc quản trị viên.",
  "mobile.link.template.server.updateRequired": "Cập nhật OpenBot trên máy chủ này để thêm trợ lý dùng chung.",
  "mobile.link.template.server.none": "Bạn phải là chủ sở hữu hoặc quản trị viên máy chủ để thêm trợ lý dùng chung.",
  "mobile.link.template.install.action": "Thêm trợ lý",
  "mobile.link.template.install.pending": "Đang thêm…",
  "mobile.link.template.install.failed": "Không thể thêm trợ lý.",
  "mobile.link.template.notFound.title": "Không tìm thấy trợ lý",
  "mobile.link.template.notFound.description": "Trợ lý dùng chung này không tồn tại, hoặc người tạo đã gỡ bỏ nó.",
  "mobile.link.template.error.title": "Không thể tải trợ lý",
  "mobile.link.template.error.loadFailed": "Không thể đọc trợ lý dùng chung. Hãy thử lại.",
  "mobile.link.template.error.unsupported":
    "Máy chủ này không thể thêm trợ lý dùng chung. Hãy cập nhật OpenBot trên máy tính đang chạy máy chủ.",
} as const satisfies PartialTranslation<typeof source>;
