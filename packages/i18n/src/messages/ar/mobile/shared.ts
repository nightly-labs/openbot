import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "اختيار",
  "mobile.shared.crop.label": "قص الصورة",
  "mobile.shared.crop.hint": "اسحب لتحريك الصورة. اقرص لتغيير حجمها.",
  "mobile.shared.splash.loading": "جارٍ تحميل الحساب",
  "mobile.shared.photo.openFailed": "تعذّر فتح هذه الصورة. حاول مرة أخرى.",
  "mobile.shared.photo.tooLarge": "لم يتمكن OpenBot من تصغير هذه الصورة بما يكفي. اختر صورة أبسط.",
  "mobile.shared.save.changes": "حفظ التغييرات",
} as const satisfies PartialTranslation<typeof source>;
