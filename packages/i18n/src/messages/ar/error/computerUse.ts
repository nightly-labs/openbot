import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "لا يحتوي هذا الإصدار من OpenBot على تطبيق للسحب.",
  "error.computerUse.helpWindowChanged": "تغيّرت نافذة مساعدة الأذونات قبل بدء السحب.",
  "error.computerUse.noAppToShow": "لا يحتوي هذا الإصدار من OpenBot على تطبيق للعرض.",
  "error.computerUse.noDriver": "لا يوجد على هذا الحاسوب برنامج تشغيل للتحكم في الحاسوب.",
  "error.computerUse.socketPathTooLong": "طول مسار مقبس التحكم في الحاسوب {length} حرفًا، ويسمح هذا النظام بـ {limit}.",
  "error.computerUse.socketDirectoryNotDirectory": "مجلد مقبس التحكم في الحاسوب {path} ليس مجلدًا.",
  "error.computerUse.socketDirectoryOtherOwner": "مجلد مقبس التحكم في الحاسوب {path} يخص مستخدمًا آخر.",
  "error.computerUse.socketDirectoryShared": "مجلد مقبس التحكم في الحاسوب {path} مفتوح لمستخدمين آخرين.",
  "error.computerUse.socketNotReady": "لم يقبل اتصالًا خلال {seconds} ثانية. {reason}",
} as const satisfies PartialTranslation<typeof source>;
