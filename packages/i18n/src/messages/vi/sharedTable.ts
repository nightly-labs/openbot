import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Bảng",
  "sharedTable.description": "Những gì các trợ lý giữ lại giữa các công việc, cùng trợ lý đã bắt đầu mỗi bộ bản ghi",
  "sharedTable.close": "Đóng bảng",
  "sharedTable.loading": "Đang tải bảng…",
  "sharedTable.empty":
    "Chưa có bảng nào. Khi một công việc cần bản ghi giữa các lượt, trợ lý sẽ tự tạo bảng, và mọi trợ lý đều dùng được.",
  "sharedTable.loadFailed": "Không thể tải các bảng.",
  "sharedTable.deleteFailed": "Không thể xóa mục này.",
  "sharedTable.madeOutside": "Tạo ngoài OpenBot · mọi trợ lý đều có thể xóa",
  "sharedTable.keptBy": "Được giữ bởi {name}",
  "sharedTable.keptByDeleted": "Được giữ bởi một trợ lý không còn tồn tại",
  "sharedTable.deleteName": "Xóa {name}",
  "sharedTable.confirmDelete": "Xóa mục này cho mọi trợ lý? Các bản ghi không thể khôi phục.",
  "sharedTable.notCounted": "không được tính",
  "sharedTable.records": { other: "{count} bản ghi" },
} as const satisfies PartialTranslation<typeof source>;
