import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Girdinize ihtiyaç duyuyor.",
  "notification.needsApproval": "Onayınıza ihtiyaç duyuyor.",
  "notification.finished": "Çalışmayı tamamladı.",
  "notification.failed": "Bir hatayla durdu.",
  "notification.usageLimit.title": "{provider} hesabı sınırına ulaştı",
  "notification.usageLimit.body": {
    one: "{count} ajan bekliyor. OpenBot daha sonra tekrar deneyecek.",
    other: "{count} ajan bekliyor. OpenBot daha sonra tekrar deneyecek.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} ajan bekliyor. Sıfırlanma: {reset}.",
    other: "{count} ajan bekliyor. Sıfırlanma: {reset}.",
  },
  "notification.test": "Bildirimler çalışıyor.",
  "notification.welcome": "Bir ajanın size ihtiyacı olduğunda OpenBot burada bildirecektir.",
  "notification.toast.region": "Bildirimler",
  "notification.toast.close": "Bildirimi kapat",
} as const satisfies PartialTranslation<typeof source>;
