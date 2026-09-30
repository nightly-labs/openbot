import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "İptal",
  "common.save": "Kaydet",
  "common.close": "Kapat",
  "common.delete": "Sil",
  "common.remove": "Kaldır",
  "common.edit": "Düzenle",
  "common.rename": "Yeniden adlandır",
  "common.retry": "Tekrar dene",
  "common.copy": "Kopyala",
  "common.copied": "Kopyalandı",
  "common.done": "Bitti",
  "common.back": "Geri",
  "common.continue": "Devam et",
  "common.add": "Ekle",
  "common.create": "Oluştur",
  "common.open": "Aç",
  "common.search": "Ara",
  "common.loading": "Yükleniyor…",
  "common.saving": "Kaydediliyor…",
  "common.tryAgain": "Tekrar dene",
  "common.connecting": "Bağlanıyor…",
  "common.download": "İndir",
  "common.removing": "Kaldırılıyor…",
  "common.sending": "Gönderiliyor…",
} as const satisfies PartialTranslation<typeof source>;
