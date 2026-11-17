import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Computer Use ドライバーが起動しませんでした。{reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Computer Use ドライバーは応答する前に停止しました。",
  "status.computerUse.driverNoAnswer": "Computer Use ドライバーが応答しませんでした。{reason}",
  "status.computerUse.driverStopped": "Computer Use ドライバーが停止しました。",
  "status.computerUse.unsupported": "Computer Use は macOS、Windows、Linux で使用できます。",
  "status.computerUse.driverMissing": "この OpenBot ビルドには Computer Use ドライバーが含まれていません。",
  "status.computerUse.restartRequired":
    "両方の権限がオンでも、macOS が OpenBot のクリックと入力をブロックしています。OpenBot を再起動してください。再び表示される場合は、「アクセシビリティ」の横の「管理」をクリックし、リストから OpenBot を削除して追加し直してから、OpenBot を再起動してください。",
  "status.computerUse.progressActing": "このコンピューターのアプリを操作しています…",
  "status.computerUse.progressDeciding": "アプリでの次の操作を決めています…",
} as const satisfies PartialTranslation<typeof source>;
