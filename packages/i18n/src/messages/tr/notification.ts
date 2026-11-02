import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Girdinize ihtiyaç duyuyor.",
  "notification.needsApproval": "Onayınıza ihtiyaç duyuyor.",
  "notification.needsBrowserStep": "Tarayıcıda bir adımı tamamlamanız gerekiyor.",
  "notification.needsApprovalFor": "Onayınıza ihtiyaç duyuyor: {action}",
  "notification.finished": "Çalışmayı tamamladı.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "Bir adım onayınızı bekliyor.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "Bir iş akışının yeni bir sonucu var.",
  "notification.failed": "Bir hatayla durdu.",
  "notification.channelTitle": "{channel} kanalında {agent}",
  "notification.channelMessage": "Bir mesaj gönderdi.",
  "notification.usageLimit.title": "{provider} hesabı sınırına ulaştı",
  "notification.usageLimit.body": {
    one: "{count} ajan bekliyor. OpenBot daha sonra tekrar deneyecek.",
    other: "{count} ajan bekliyor. OpenBot daha sonra tekrar deneyecek.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} ajan bekliyor. Sıfırlanma: {reset}.",
    other: "{count} ajan bekliyor. Sıfırlanma: {reset}.",
  },
  "notification.machineAlert.disk": "{server}: disk {percent} dolu",
  "notification.machineAlert.memory": "{server}: bellek {percent} kullanımda",
  "notification.machineAlert.cpu": "{server}: CPU {percent} meşgul",
  "notification.machineAlert.body": "{level} uyarı seviyesi aşıldı. Sunucu ayarları > Depolama bölümüne bakın.",
  "notification.test": "Bildirimler çalışıyor.",
  "notification.welcome": "Bir ajanın size ihtiyacı olduğunda OpenBot burada bildirecektir.",
  "notification.toast.region": "Bildirimler",
  "notification.toast.close": "Bildirimi kapat",
} as const satisfies PartialTranslation<typeof source>;
