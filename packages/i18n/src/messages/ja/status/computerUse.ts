import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Computer Use ドライバーが起動しませんでした。{reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Computer Use ドライバーは応答する前に停止しました。",
  "status.computerUse.driverNoAnswer": "Computer Use ドライバーが応答しませんでした。{reason}",
  "status.computerUse.driverStopped": "Computer Use ドライバーが停止しました。",
  "status.computerUse.unsupported": "Computer Use は macOS、Windows、Linux で使用できます。",
  "status.computerUse.driverMissing": "この OpenBot ビルドには Computer Use ドライバーが含まれていません。",
} as const satisfies PartialTranslation<typeof source>;
