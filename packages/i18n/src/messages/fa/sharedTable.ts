import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "جدول‌ها",
  "sharedTable.description": "جدول‌هایی که عامل‌ها بین کارها نگه می‌دارند، همراه با عاملی که هر دسته از رکوردها را ساخته است",
  "sharedTable.close": "بستن جدول‌ها",
  "sharedTable.loading": "در حال بارگذاری جدول‌ها…",
  "sharedTable.empty":
    "هنوز جدولی نیست. وقتی کاری به رکوردهایی برای نوبت‌های بعد نیاز داشته باشد، عامل خودش جدولی می‌سازد و همهٔ عامل‌ها می‌توانند از آن استفاده کنند.",
  "sharedTable.loadFailed": "بارگذاری جدول‌ها ممکن نشد.",
  "sharedTable.deleteFailed": "حذف این مورد ممکن نشد.",
  "sharedTable.madeOutside": "خارج از OpenBot ساخته شده · هر عاملی می‌تواند آن را حذف کند",
  "sharedTable.keptBy": "نگه‌داری‌شده توسط {name}",
  "sharedTable.keptByDeleted": "نگه‌داری‌شده توسط عاملی که دیگر وجود ندارد",
  "sharedTable.deleteName": "حذف {name}",
  "sharedTable.confirmDelete": "این مورد برای همهٔ عامل‌ها حذف شود؟ رکوردها بازیابی‌شدنی نیستند.",
  "sharedTable.notCounted": "محاسبه نمی‌شود",
  "sharedTable.records": { one: "{count} رکورد", other: "{count} رکورد" },
} as const satisfies PartialTranslation<typeof source>;
