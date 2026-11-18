import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Trình điều khiển Điều khiển máy tính chưa khởi động. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer":
    "Trình điều khiển Điều khiển máy tính đã dừng trước khi kịp phản hồi.",
  "status.computerUse.driverNoAnswer": "Trình điều khiển Điều khiển máy tính không phản hồi. {reason}",
  "status.computerUse.driverStopped": "Trình điều khiển Điều khiển máy tính đã dừng.",
  "status.computerUse.unsupported": "Điều khiển máy tính khả dụng trên macOS, Windows và Linux.",
  "status.computerUse.driverMissing": "Bản dựng OpenBot này không có trình điều khiển Điều khiển máy tính.",
  "status.computerUse.progressActing": "Đang dùng một ứng dụng trên máy tính này…",
  "status.computerUse.progressDeciding": "Đang quyết định bước tiếp theo trong ứng dụng…",
} as const satisfies PartialTranslation<typeof source>;
