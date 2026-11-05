import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "الجداول",
  "sharedTable.description": "ما يحتفظ به الوكلاء بين المهام، مع الوكيل الذي بدأ كل مجموعة من السجلات",
  "sharedTable.close": "إغلاق الجداول",
  "sharedTable.loading": "جارٍ تحميل الجداول…",
  "sharedTable.empty":
    "لا توجد جداول بعد. ينشئ الوكيل جدولًا بنفسه عندما تحتاج مهمة إلى سجلات بين الأدوار، ويمكن لكل وكيل استخدامه.",
  "sharedTable.loadFailed": "تعذّر تحميل الجداول.",
  "sharedTable.deleteFailed": "تعذّر حذف هذا.",
  "sharedTable.madeOutside": "أُنشئ خارج OpenBot · يمكن لأي وكيل حذفه",
  "sharedTable.keptBy": "يحتفظ به {name}",
  "sharedTable.keptByDeleted": "يحتفظ به وكيل لم يعد موجودًا",
  "sharedTable.deleteName": "حذف {name}",
  "sharedTable.confirmDelete": "هل تريد حذف هذا لكل الوكلاء؟ لا يمكن استعادة السجلات.",
  "sharedTable.notCounted": "غير محسوب",
  "sharedTable.records": {
    zero: "لا سجلات",
    one: "سجل واحد",
    two: "سجلان",
    few: "{count} سجلات",
    many: "{count} سجلًا",
    other: "{count} سجل",
  },
} as const satisfies PartialTranslation<typeof source>;
