import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Girdinize ihtiyaç duyuyor.",
  "notification.needsApproval": "Onayınıza ihtiyaç duyuyor.",
  "notification.finished": "Çalışmayı tamamladı.",
  "notification.failed": "Bir hatayla durdu.",
  "notification.test": "Bildirimler çalışıyor.",
  "notification.welcome": "Bir ajanın size ihtiyacı olduğunda OpenBot burada bildirecektir.",
  "notification.toast.region": "Bildirimler",
  "notification.toast.close": "Bildirimi kapat",
} as const satisfies PartialTranslation<typeof source>;
