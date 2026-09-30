import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "Mesaj kuyruğu",
  "queue.moved": "Kuyruktaki mesaj {total} içinden {position}. konuma taşındı.",
  "queue.attachment": "Ek",
  "queue.hold.named": "Bekliyor - {name} {channel} kanalında çalışıyor",
  "queue.hold.unnamed": "Bekliyor - bu ajan {channel} kanalında çalışıyor",
  "queue.item.label": "Kuyruktaki mesaj {position}: {preview}",
  "queue.item.labelEditing": "Kuyruktaki mesaj {position}, düzenleniyor: {preview}",
  "queue.item.editing": "Düzenleniyor",
  "queue.item.steerLabel": "Kuyruktaki mesajı yönlendir {position}",
  "queue.item.steerTooltip": "Mesajı yönlendir",
  "queue.item.steering": "Yönlendiriliyor",
  "queue.item.steer": "Yönlendir",
  "queue.item.deleteLabel": "Kuyruktaki mesajı sil {position}",
  "queue.item.deleteTooltip": "Mesajı sil",
  "queue.item.editLabel": "Kuyruktaki mesajı düzenle {position}",
  "queue.item.editTooltip": "Mesajı düzenle",
  "queue.deleteHeld.title": "Kuyruktaki mesaj silinsin mi?",
  "queue.deleteHeld.body": "Başka bir cihaz bu mesajı düzenliyor. Ajan bu mesajı almayacak.",
  "queue.deleteHeld.keep": "Koru",
} as const satisfies PartialTranslation<typeof source>;
