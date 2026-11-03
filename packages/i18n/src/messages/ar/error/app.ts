import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "يمكن فتح روابط HTTP(S) فقط في المتصفح الخارجي.",
  "error.app.notificationsUnsupported": "لا يدعم هذا النظام إشعارات سطح المكتب.",
  "error.app.notificationSettingsMissing": "لا توجد في هذا النظام صفحة لإعدادات الإشعارات.",
  "error.app.notReady": "OpenBot غير جاهز.",
  "error.app.macSecureStorageUnavailable": "التخزين الآمن في macOS غير متاح.",
  "error.app.secretStorageUnavailable": "تخزين الأسرار في النظام غير متاح.",
  "error.app.remoteIdentityUnavailable": "هوية المضيف البعيد غير متاحة.",
  "error.app.iceServersMissing": "لم يقدّم Remote Signal خوادم ICE بعد.",
  "error.app.finishLocalTest": "أكمل الاختبار المحلي قبل تبديل الشاشات.",
} as const satisfies PartialTranslation<typeof source>;
