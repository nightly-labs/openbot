import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "تعذّر تغيير خطة الخادم. حدّث صفحة الفوترة وأعد المحاولة.",
  "error.billing.confirmMismatch": "اكتب اسم الخادم لحذفه.",
  "error.billing.restartBusy": "لا يمكن إعادة تشغيل الخادم الآن. أعد المحاولة بعد دقيقة.",
  "error.billing.planRequired": "انتهت خطة هذا الخادم. جدّدها لتشغيل الخادم.",
  "error.billing.planSoldOut": "نفدت هذه الخطة. اختر خطة أخرى.",
  "error.billing.licenseExists": "لهذا الحساب ترخيص بالفعل. غيّر مستخدميه بدلًا من ذلك.",
  "error.billing.licenseCurrency": "يجب أن يستخدم الترخيص عملة خططك الأخرى.",
  "error.billing.planCurrency": "يجب أن تستخدم الخطة الجديدة عملة خططك الأخرى.",
  "error.billing.licenseUsersInUse": "لا يمكن أن يكون عدد مستخدمي الترخيص أقل من عدد من يستخدمونه الآن.",
  "error.billing.licensePaymentFailed": "أخفق الدفع مقابل المستخدمين المضافين. حدّث طريقة الدفع وأعد المحاولة.",
  "error.billing.licenseUnavailable": "التراخيص غير متاحة الآن.",
  "error.billing.licenseOneUser": "هذا الترخيص لمستخدم واحد. غيّره إلى Team لإضافة مستخدمين.",
  "error.billing.licensePlanChange": "لا يمكن تغيير هذا الترخيص إلى تلك الخطة. ألغِه واشترِ الخطة الجديدة.",
  "error.billing.noLicense": "لا ترخيص لهذا الحساب.",
  "error.billing.invalidRequest": "طلب الفوترة غير صالح.",
  "error.billing.invalidResponse": "استجابة الفوترة غير صالحة.",
  "error.billing.notStripePage": "صفحة الفوترة ليست صفحة Stripe.",
} as const satisfies PartialTranslation<typeof source>;
