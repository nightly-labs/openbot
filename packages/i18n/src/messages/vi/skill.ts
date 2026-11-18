import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/skill";

export const messages = {
  "skill.title": "Kỹ năng",
  "skill.close": "Đóng kỹ năng",
  "skill.detailsDescription": "Chi tiết {name}",
  "skill.assignedDescription": "Kỹ năng được gán cho {name}",
  "skill.addFromMarketplace": "Thêm từ Cửa hàng",
  "skill.limitReached":
    "Trợ lý này đã đạt giới hạn {limit} kỹ năng. Hãy gỡ bỏ một kỹ năng trước khi thêm kỹ năng khác.",
  "skill.managedOnHost": "Kỹ năng của trợ lý này được quản lý trên máy tính.",
  "skill.loading": "Đang tải kỹ năng…",
  "skill.loadingDetails": "Đang tải chi tiết…",
  "skill.emptyEnabled": "Trợ lý này không có kỹ năng nào được bật.",
  "skill.emptyAssigned": "Trợ lý này chưa có kỹ năng nào được gán.",
  "skill.folderSkill": "OpenBot không cài kỹ năng này. Hãy sửa hoặc gỡ bỏ nó trong {location}.",
  "skill.moreFor": "Thêm cho {name}",
  "skill.update": "Cập nhật",
  "skill.updateName": "Cập nhật {name}",
  "skill.enableName": "Bật {name}",
  "skill.repair": "Sửa chữa",
  "skill.uninstall": "Gỡ cài đặt",
  "skill.version": "v{version}",
  "skill.versionUpdate": "v{installed} · có v{available}",

  "skill.loadFailed": "Không thể tải kỹ năng.",
  "skill.loadDetailsFailed": "Không thể tải chi tiết kỹ năng.",
  "skill.enableFailed": "Không thể bật kỹ năng.",
  "skill.disableFailed": "Không thể tắt kỹ năng.",
  "skill.removeFailed": "Không thể gỡ bỏ kỹ năng.",
  "skill.updateFailed": "Không thể cập nhật kỹ năng.",

  "skill.confirm.replaceTitle": "Thay thế các thay đổi cục bộ?",
  "skill.confirm.removeTitle": "Gỡ bỏ kỹ năng này?",
  "skill.confirm.replaceBody":
    "Cập nhật kỹ năng này sẽ thay các tệp cục bộ bằng gói kỹ năng mới nhất. Những chỉnh sửa của bạn trong thư mục kỹ năng này sẽ mất.",
  "skill.confirm.removeModifiedBody":
    "Kỹ năng này có thay đổi cục bộ trong không gian làm việc của trợ lý. Gỡ bỏ sẽ xóa các tệp đó. Tin nhắn trò chuyện gốc vẫn còn.",
  "skill.confirm.removeBody": "OpenBot sẽ gỡ bỏ kỹ năng này khỏi trợ lý. Lịch sử trò chuyện vẫn còn.",
  "skill.confirm.replace": "Thay thế kỹ năng",
  "skill.confirm.remove": "Gỡ bỏ kỹ năng",

  "skill.unavailable.readOnly": "Kỹ năng từ xa chỉ đọc.",
  "skill.unavailable.add": "Thêm kỹ năng này để thử.",
  "skill.unavailable.repair": "Sửa chữa kỹ năng này để thử.",
  "skill.unavailable.updateVersion": "Cập nhật kỹ năng này để thử phiên bản này.",
  "skill.unavailable.updateRevision": "Cập nhật kỹ năng này để thử bản sửa đổi này.",
  "skill.unavailable.saving": "Chờ kỹ năng này lưu xong rồi hãy thử.",
  "skill.unavailable.composer": "Trình soạn của trợ lý không khả dụng.",

  "skill.toolbar.source": "Nguồn kỹ năng",
  "skill.toolbar.all": "Tất cả",
  "skill.toolbar.local": "Cục bộ",
  "skill.toolbar.enabled": "Đã bật",
  "skill.toolbar.create": "Tạo kỹ năng",

  "skill.local.loadFailed": "Không thể tải kỹ năng cục bộ.",
  "skill.local.toggleFailed": "Không thể đổi trạng thái của kỹ năng.",
  "skill.local.addFailed": "Không thể thêm kỹ năng cục bộ.",
  "skill.local.back": "Quay lại kỹ năng cục bộ",
  "skill.local.added": "Đã thêm",
  "skill.local.add": "Thêm kỹ năng",
  "skill.local.loading": "Đang tải kỹ năng cục bộ…",
  "skill.local.empty": "Chưa có kỹ năng cục bộ nào.",

  "skill.preview.label": "Xem trước {name}",
  "skill.preview.creator": "Bởi {name}",
  "skill.preview.examplePrompt": "Giúp tôi dùng kỹ năng này.",
  "skill.preview.try": "Thử kỹ năng",
  "skill.preview.linkFailed": "Không thể mở liên kết.",

  // The Skills tab of the Marketplace. {agents} is a list of agent names.
  "skill.marketplace.changed": { other: "{name} đã thay đổi ở {count} trợ lý." },
  "skill.marketplace.updated": { other: "{name} đã được cập nhật ở {count} trợ lý." },
  "skill.marketplace.undone": "Thay đổi với {name} đã được hoàn tác.",
  "skill.marketplace.confirmAgents": "Trợ lý: {agents}.",
  "skill.marketplace.limitReason": "Một trợ lý có thể có tối đa {limit} kỹ năng.",
  "skill.marketplace.cannotRemove": "OpenBot không thể gỡ bỏ kỹ năng tích hợp sẵn hoặc kỹ năng mà nó không cài đặt.",
} as const satisfies PartialTranslation<typeof source>;
