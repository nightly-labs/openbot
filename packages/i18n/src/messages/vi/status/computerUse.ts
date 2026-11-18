import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  // Computer Use driver status.
  "status.computerUse.driverNotStarted": "Driver Điều khiển máy tính không khởi động. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Driver Điều khiển máy tính đã dừng trước khi trả lời.",
  "status.computerUse.driverNoAnswer": "Driver Điều khiển máy tính không trả lời. {reason}",
  "status.computerUse.driverStopped": "Driver Điều khiển máy tính đã dừng.",
  "status.computerUse.unsupported": "Điều khiển máy tính có trên macOS, Windows và Linux.",
  "status.computerUse.driverMissing": "Bản dựng OpenBot này không có driver Điều khiển máy tính.",
  // Computer Use progress on the agent's activity line.
  "status.computerUse.progressActing": "Đang dùng một ứng dụng trên máy tính này…",
  "status.computerUse.progressDeciding": "Đang quyết định bước tiếp theo trong ứng dụng…",
} as const satisfies PartialTranslation<typeof source>;
