import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Bảng",
  "sharedTable.description": "Những gì các agent lưu giữ giữa các tác vụ, kèm agent đã tạo từng nhóm bản ghi",
  "sharedTable.close": "Đóng bảng",
  "sharedTable.loading": "Đang tải bảng…",
  "sharedTable.empty":
    "Chưa có bảng nào. Agent tự tạo bảng khi một tác vụ cần lưu bản ghi giữa các lượt, và mọi agent đều có thể dùng bảng đó.",
  "sharedTable.loadFailed": "Không thể tải các bảng.",
  "sharedTable.deleteFailed": "Không thể xóa mục này.",
  "sharedTable.madeOutside": "Tạo bên ngoài OpenBot · agent nào cũng có thể xóa",
  "sharedTable.keptBy": "Do {name} lưu giữ",
  "sharedTable.keptByDeleted": "Do một agent không còn tồn tại lưu giữ",
  "sharedTable.deleteName": "Xóa {name}",
  "sharedTable.confirmDelete": "Xóa mục này cho mọi agent? Không thể khôi phục các bản ghi.",
  "sharedTable.notCounted": "không đếm",
  "sharedTable.records": { one: "{count} bản ghi", other: "{count} bản ghi" },
} as const satisfies PartialTranslation<typeof source>;
