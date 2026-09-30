import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/memory";

export const messages = {
  "memory.title": "Bellekler",
  "memory.description": "{name} için kaydedilen bellekler",
  "memory.add": "Bellek ekle",
  "memory.close": "Bellekleri kapat",
  "memory.new": "Yeni bellek",
  "memory.newPlaceholder": "Kalıcı bir bilgi veya tercih ekleyin",
  "memory.save": "Belleği kaydet",
  "memory.limitAgent":
    "Bu ajan {limit} bellek sınırına ulaştı. Yenisini eklemeden önce bir belleği düzenleyin, birleştirin veya silin.",
  "memory.limitChannel":
    "Bu kanal {limit} bellek sınırına ulaştı. Yenisini eklemeden önce bir belleği düzenleyin, birleştirin veya silin.",
  "memory.loading": "Bellekler yükleniyor…",
  "memory.emptyAgent": "Bu ajanın henüz kaydedilmiş belleği yok.",
  "memory.emptyChannel": "Bu kanalın henüz kaydedilmiş belleği yok.",
  "memory.editText": "Belleği düzenle: {text}",
  "memory.edit": "Belleği düzenle",
  "memory.delete": "Belleği sil",
  "memory.learned": "Otomatik öğrenildi",
  "memory.manual": "Manuel eklendi",
  "memory.unknownDate": "Bilinmeyen tarih",
  "memory.clearAll": "Tüm bellekleri temizle",
  "memory.clearTitle": "Tüm bellekler temizlensin mi?",
  "memory.clearDescription":
    "OpenBot, {name} için kaydedilen tüm {total} belleği kalıcı olarak kaldıracaktır. Orijinal mesajlar konuşma geçmişinde kalacaktır.",
  "memory.loadFailed": "Bellekler yüklenemedi.",
  "memory.saveFailed": "Bellek kaydedilemedi.",
  "memory.updateFailed": "Bellek güncellenemedi.",
  "memory.deleteFailed": "Bellek silinemedi.",
  "memory.clearFailed": "Bellekler temizlenemedi.",
} as const satisfies PartialTranslation<typeof source>;
