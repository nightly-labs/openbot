import { defineMessages } from "../../../message";

export const messages = defineMessages("error.computerUse", {
  // Computer Use driver and permission window errors.
  "error.computerUse.noAppToDrag": "در این نسخهٔ OpenBot برنامه‌ای برای کشیدن وجود ندارد.",
  "error.computerUse.helpWindowChanged": "پنجرهٔ راهنمای مجوز پیش از شروع کشیدن تغییر کرد.",
  "error.computerUse.noAppToShow": "در این نسخهٔ OpenBot برنامه‌ای برای نمایش وجود ندارد.",
  "error.computerUse.noDriver": "این رایانه درایور Computer Use ندارد.",
  "error.computerUse.socketPathTooLong": "مسیر سوکت Computer Use، {length} نویسه دارد و محدودیت این سیستم {limit} نویسه است.",
  "error.computerUse.socketDirectoryNotDirectory": "پوشهٔ سوکت Computer Use به نشانی {path}، پوشه نیست.",
  "error.computerUse.socketDirectoryOtherOwner": "مالک پوشهٔ سوکت Computer Use به نشانی {path} کاربر دیگری است.",
  "error.computerUse.socketDirectoryShared": "پوشهٔ سوکت Computer Use به نشانی {path} برای کاربران دیگر باز است.",
  "error.computerUse.socketNotReady": "در {seconds} ثانیه اتصال را نپذیرفت. {reason}",
});
