import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "توقف همهٔ عامل‌ها",
  "menu.checkForUpdates": "بررسی به‌روزرسانی‌ها…",
  "menu.preferences": "تنظیمات…",
  "menu.actualSize": "اندازهٔ واقعی",
  "menu.zoomIn": "بزرگ‌نمایی",
  "menu.zoomOut": "کوچک‌نمایی",
  "menu.copyLink": "کپی پیوند",
  "menu.quit": "خروج از OpenBot",
  "menu.quitConfirmTitle": "از OpenBot خارج می‌شوید؟",
  "menu.quitConfirmBody": "تا وقتی دوباره OpenBot را باز نکنید، عامل‌ها و روتین‌ها متوقف می‌مانند.",
  "menu.quitConfirm": "خروج",
  "menu.quitHint": "برای خروج، ⌘Q را نگه دارید یا دوبار فشار دهید",
  "menu.trayOpen": "باز کردن OpenBot",
  "menu.trayQuit": "خروج از OpenBot",
  "menu.trayTooltip": "OpenBot",
  "menu.undo": "واگرد",
  "menu.redo": "ازنو",
  "menu.cut": "برش",
  "menu.copy": "کپی",
  "menu.paste": "جای‌گذاری",
  "menu.pasteAndMatchStyle": "جای‌گذاری و هماهنگ‌کردن سبک",
  "menu.delete": "حذف",
  "menu.selectAll": "انتخاب همه",
} as const satisfies PartialTranslation<typeof source>;
