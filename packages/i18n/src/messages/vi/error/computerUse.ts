import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "Bản dựng OpenBot này không có ứng dụng nào để kéo.",
  "error.computerUse.helpWindowChanged": "Cửa sổ trợ giúp cấp quyền đã thay đổi trước khi bắt đầu kéo.",
  "error.computerUse.noAppToShow": "Bản dựng OpenBot này không có ứng dụng nào để hiển thị.",
  "error.computerUse.noDriver": "Máy tính này không có trình điều khiển cho Điều khiển máy tính.",
  "error.computerUse.socketPathTooLong":
    "Đường dẫn socket của Điều khiển máy tính dài {length} ký tự, nhưng hệ thống này chỉ cho phép {limit}.",
  "error.computerUse.socketDirectoryNotDirectory":
    "Thư mục socket của Điều khiển máy tính {path} không phải là thư mục.",
  "error.computerUse.socketDirectoryOtherOwner":
    "Thư mục socket của Điều khiển máy tính {path} thuộc về người dùng khác.",
  "error.computerUse.socketDirectoryShared":
    "Thư mục socket của Điều khiển máy tính {path} đang mở cho người dùng khác.",
  "error.computerUse.socketNotReady": "Không nhận kết nối nào trong {seconds} giây. {reason}",
} as const satisfies PartialTranslation<typeof source>;
