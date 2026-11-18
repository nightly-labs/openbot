import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  // Computer Use driver and permission window errors.
  "error.computerUse.noAppToDrag": "Bản dựng OpenBot này không có ứng dụng để kéo.",
  "error.computerUse.helpWindowChanged": "Cửa sổ trợ giúp quyền đã thay đổi trước khi bắt đầu kéo.",
  "error.computerUse.noAppToShow": "Bản dựng OpenBot này không có ứng dụng để hiển thị.",
  "error.computerUse.noDriver": "Máy tính này không có driver Điều khiển máy tính.",
  "error.computerUse.socketPathTooLong":
    "Đường dẫn socket Điều khiển máy tính dài {length} ký tự, và hệ thống này cho phép {limit}.",
  "error.computerUse.socketDirectoryNotDirectory": "Thư mục socket Điều khiển máy tính {path} không phải thư mục.",
  "error.computerUse.socketDirectoryOtherOwner": "Thư mục socket Điều khiển máy tính {path} thuộc về người dùng khác.",
  "error.computerUse.socketDirectoryShared": "Thư mục socket Điều khiển máy tính {path} mở cho người dùng khác.",
  "error.computerUse.socketNotReady": "Nó không chấp nhận kết nối trong {seconds} giây. {reason}",
} as const satisfies PartialTranslation<typeof source>;
