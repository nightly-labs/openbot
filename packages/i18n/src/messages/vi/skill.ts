import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/skill";

export const messages = {
  "skill.title": "Kỹ năng",
  "skill.close": "Đóng kỹ năng",
  "skill.detailsDescription": "Chi tiết {name}",
  "skill.assignedDescription": "Kỹ năng được gán cho {name}",
  "skill.addFromMarketplace": "Thêm từ Cửa hàng",
  "skill.limitReached": "Agent này đã đạt giới hạn {limit} kỹ năng. Hãy gỡ một kỹ năng trước khi thêm kỹ năng khác.",
  "skill.managedOnHost": "Kỹ năng của agent này được quản lý trên host.",
  "skill.loading": "Đang tải kỹ năng…",
  "skill.loadingDetails": "Đang tải chi tiết…",
  "skill.emptyEnabled": "Agent này chưa bật kỹ năng nào.",
  "skill.emptyAssigned": "Agent này chưa được gán kỹ năng nào.",
  "skill.folderSkill": "OpenBot không cài kỹ năng này. Hãy chỉnh sửa hoặc gỡ nó tại {location}.",
  "skill.moreFor": "Thêm tùy chọn cho {name}",
  "skill.update": "Cập nhật",
  "skill.updateName": "Cập nhật {name}",
  "skill.enableName": "Bật {name}",
  "skill.repair": "Sửa chữa",
  "skill.uninstall": "Gỡ cài đặt",
  "skill.version": "v{version}",
  "skill.versionUpdate": "v{installed} · đã có v{available}",

  "skill.loadFailed": "Không thể tải kỹ năng.",
  "skill.loadDetailsFailed": "Không thể tải chi tiết kỹ năng.",
  "skill.enableFailed": "Không thể bật kỹ năng.",
  "skill.disableFailed": "Không thể tắt kỹ năng.",
  "skill.removeFailed": "Không thể gỡ kỹ năng.",
  "skill.updateFailed": "Không thể cập nhật kỹ năng.",

  "skill.confirm.replaceTitle": "Thay thế thay đổi cục bộ?",
  "skill.confirm.removeTitle": "Gỡ kỹ năng này?",
  "skill.confirm.replaceBody":
    "Cập nhật kỹ năng này sẽ thay các tệp cục bộ bằng gói kỹ năng mới nhất. Những chỉnh sửa của bạn trong thư mục kỹ năng này sẽ bị mất.",
  "skill.confirm.removeModifiedBody":
    "Kỹ năng này có thay đổi cục bộ trong không gian làm việc của agent. Gỡ sẽ xóa các tệp đó. Tin nhắn trò chuyện gốc vẫn được giữ.",
  "skill.confirm.removeBody": "OpenBot sẽ gỡ kỹ năng này khỏi agent. Lịch sử trò chuyện vẫn được giữ.",
  "skill.confirm.replace": "Thay thế kỹ năng",
  "skill.confirm.remove": "Gỡ kỹ năng",

  "skill.unavailable.readOnly": "Kỹ năng từ xa chỉ có thể đọc.",
  "skill.unavailable.add": "Hãy thêm kỹ năng này để dùng thử.",
  "skill.unavailable.repair": "Hãy sửa chữa kỹ năng này để dùng thử.",
  "skill.unavailable.updateVersion": "Hãy cập nhật kỹ năng này để dùng thử phiên bản này.",
  "skill.unavailable.updateRevision": "Hãy cập nhật kỹ năng này để dùng thử bản sửa đổi này.",
  "skill.unavailable.saving": "Hãy chờ kỹ năng này lưu xong, rồi dùng thử.",
  "skill.unavailable.composer": "Khung soạn tin của agent không khả dụng.",

  "skill.toolbar.source": "Nguồn kỹ năng",
  "skill.toolbar.all": "Tất cả",
  "skill.toolbar.local": "Cục bộ",
  "skill.toolbar.enabled": "Đã bật",
  "skill.toolbar.create": "Tạo kỹ năng",

  "skill.local.loadFailed": "Không thể tải kỹ năng cục bộ.",
  "skill.local.toggleFailed": "Không thể thay đổi trạng thái kỹ năng.",
  "skill.local.addFailed": "Không thể thêm kỹ năng cục bộ.",
  "skill.local.back": "Quay lại kỹ năng cục bộ",
  "skill.local.added": "Đã thêm",
  "skill.local.add": "Thêm kỹ năng",
  "skill.local.loading": "Đang tải kỹ năng cục bộ…",
  "skill.local.empty": "Chưa có kỹ năng cục bộ nào.",

  "skill.preview.label": "Xem trước {name}",
  "skill.preview.creator": "Của {name}",
  "skill.preview.examplePrompt": "Hãy giúp tôi dùng kỹ năng này.",
  "skill.preview.try": "Dùng thử kỹ năng",
  "skill.preview.linkFailed": "Không thể mở liên kết.",

  "skill.marketplace.changed": {
    one: "Đã thay đổi {name} trên {count} agent.",
    other: "Đã thay đổi {name} trên {count} agent.",
  },
  "skill.marketplace.updated": {
    one: "Đã cập nhật {name} trên {count} agent.",
    other: "Đã cập nhật {name} trên {count} agent.",
  },
  "skill.marketplace.undone": "Đã hoàn tác thay đổi đối với {name}.",
  "skill.marketplace.confirmAgents": "Agent: {agents}.",
  "skill.marketplace.limitReason": "Mỗi agent có thể có tối đa {limit} kỹ năng.",
  "skill.marketplace.cannotRemove": "OpenBot không thể gỡ kỹ năng tích hợp sẵn hoặc kỹ năng không do OpenBot cài.",
} as const satisfies PartialTranslation<typeof source>;
