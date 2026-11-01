import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  // Computer Use driver status.
  "status.computerUse.driverNotStarted": "Computer Use 驅動未能啟動。{reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Computer Use 驅動在回應之前就停止了。",
  "status.computerUse.driverNoAnswer": "Computer Use 驅動沒有回應。{reason}",
  "status.computerUse.driverStopped": "Computer Use 驅動已停止。",
  "status.computerUse.unsupported": "Computer Use 可在 macOS、Windows 和 Linux 上使用。",
  "status.computerUse.driverMissing": "該版本的 OpenBot 不包含 Computer Use 驅動。",
  // Computer Use progress on the agent's activity line.
  "status.computerUse.progressActing": "正在操作這臺電腦上的應用…",
  "status.computerUse.progressDeciding": "正在決定應用中的下一步…",
} as const satisfies PartialTranslation<typeof source>;
