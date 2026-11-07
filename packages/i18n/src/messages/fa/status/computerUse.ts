import { defineMessages } from "../../../message";

export const messages = defineMessages("status.computerUse", {
  // Computer Use driver status.
  "status.computerUse.driverNotStarted": "درایور Computer Use شروع نشد. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "درایور Computer Use پیش از پاسخ‌دادن متوقف شد.",
  "status.computerUse.driverNoAnswer": "درایور Computer Use پاسخی نداد. {reason}",
  "status.computerUse.driverStopped": "درایور Computer Use متوقف شد.",
  "status.computerUse.unsupported": "Computer Use در macOS، Windows و Linux در دسترس است.",
  "status.computerUse.driverMissing": "این نسخهٔ OpenBot درایور Computer Use را ندارد.",
  // Computer Use progress on the agent's activity line.
  "status.computerUse.progressActing": "در حال استفاده از برنامه‌ای در این رایانه…",
  "status.computerUse.progressDeciding": "در حال تصمیم‌گیری دربارهٔ گام بعدی در برنامه…",
});
