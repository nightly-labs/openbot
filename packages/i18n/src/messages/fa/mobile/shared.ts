import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "انتخاب",
  "mobile.shared.crop.label": "برش عکس",
  "mobile.shared.crop.hint": "برای جابه‌جایی عکس بکشید. برای تغییر اندازه، دو انگشت را باز یا بسته کنید.",
  "mobile.shared.splash.loading": "در حال بارگذاری حساب",
  "mobile.shared.photo.openFailed": "بازکردن این عکس ممکن نشد. دوباره تلاش کنید.",
  "mobile.shared.photo.tooLarge": "OpenBot نتوانست این عکس را به‌اندازهٔ کافی کوچک کند. عکس ساده‌تری انتخاب کنید.",
  "mobile.shared.save.changes": "ذخیرهٔ تغییرات",
} as const satisfies PartialTranslation<typeof source>;
