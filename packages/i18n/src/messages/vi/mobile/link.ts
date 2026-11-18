import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot không kết nối được. Hãy thử lại.",
  "mobile.link.invite.signInTitle": "Đăng nhập để tham gia máy chủ này",
  "mobile.link.invite.signInDescription":
    "Hãy quét mã QR trong OpenBot trên máy tính của bạn. Sau đó bạn có thể xem lại lời mời.",
  "mobile.link.invite.cancel": "Hủy lời mời",
  "mobile.link.pairing.title": "Kết nối điện thoại này",
  "mobile.link.pairing.alreadySignedIn":
    "Bạn đã đăng nhập. Hãy đăng xuất trong Cài đặt trước khi kết nối tài khoản khác.",
  "mobile.link.pairing.description": "Chỉ tiếp tục nếu bạn đã yêu cầu liên kết Mobile Connect này từ máy tính.",
  "mobile.link.pairing.accountService":
    "Liên kết này kết nối với dịch vụ tài khoản tại {origin}, không phải dịch vụ tài khoản OpenBot.",
  "mobile.link.pairing.connect": "Kết nối",
  "mobile.link.plugin.title": "Mở trang plugin",
  "mobile.link.plugin.description": "Xem plugin này trên trang web OpenBot.",
  "mobile.link.plugin.openFailed": "Không mở được trang plugin.",
  "mobile.link.plugin.view": "Xem plugin",
  "mobile.link.unavailable.title": "Liên kết không khả dụng",
  "mobile.link.unavailable.description":
    "Liên kết này không hợp lệ, không còn khả dụng hoặc không được hỗ trợ trên thiết bị di động.",
  "mobile.link.template.signInTitle": "Đăng nhập để thêm agent này",
  "mobile.link.template.signInDescription":
    "Hãy quét mã QR trong OpenBot trên máy tính của bạn. Sau đó bạn có thể xem lại agent trước khi thêm.",
  "mobile.link.template.loading": "Đang tải agent…",
  "mobile.link.template.creator": "Bởi {name}",
  "mobile.link.template.section.instructions": "Hướng dẫn",
  "mobile.link.template.section.skills": "Kỹ năng",
  "mobile.link.template.section.noSkills": "Không có kỹ năng.",
  "mobile.link.template.section.routines": "Tác vụ định kỳ",
  "mobile.link.template.section.noRoutines": "Không có tác vụ định kỳ.",
  "mobile.link.template.skill.local": "Kỹ năng cục bộ (chỉ SKILL.md)",
  "mobile.link.template.skill.marketplace": "Kỹ năng từ Cửa hàng, phiên bản {version}",
  "mobile.link.template.server.title": "Thêm vào máy chủ",
  "mobile.link.template.server.footer": "Chỉ hiển thị các máy chủ mà bạn là chủ sở hữu hoặc quản trị viên.",
  "mobile.link.template.server.updateRequired": "Hãy cập nhật OpenBot trên máy chủ này để thêm agent được chia sẻ.",
  "mobile.link.template.server.none":
    "Bạn phải là chủ sở hữu hoặc quản trị viên của một máy chủ để thêm agent được chia sẻ.",
  "mobile.link.template.install.action": "Thêm agent",
  "mobile.link.template.install.pending": "Đang thêm…",
  "mobile.link.template.install.failed": "Không thêm được agent.",
  "mobile.link.template.notFound.title": "Không tìm thấy agent",
  "mobile.link.template.notFound.description": "Agent được chia sẻ này không tồn tại, hoặc người tạo đã hủy xuất bản.",
  "mobile.link.template.error.title": "Không tải được agent",
  "mobile.link.template.error.loadFailed": "Không đọc được agent được chia sẻ. Hãy thử lại.",
  "mobile.link.template.error.unsupported":
    "Máy chủ này không thể thêm agent được chia sẻ. Hãy cập nhật OpenBot trên máy tính chạy máy chủ.",
} as const satisfies PartialTranslation<typeof source>;
