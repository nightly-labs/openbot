import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.clear": "Aramayı temizle",
  "mobile.search.emptyTitle": "Eşleşen sonuç yok",
  "mobile.search.emptyBody": "Farklı bir arama deneyin.",
  "mobile.search.searching": "Mesajlar aranıyor…",
  "mobile.search.errorTitle": "Mesajlar aranamadı",
  "mobile.search.errorBody": "Bu bilgisayarla olan bağlantıyı kontrol edin, ardından tekrar deneyin.",
  "mobile.search.retry": "Tekrar dene",
  "mobile.search.showMore": "Daha fazla mesaj göster",
  "mobile.search.fromYou": "Sizden {name} ajanına · {time}",
  "mobile.search.toYou": "{name} ajanından size · {time}",
} as const satisfies PartialTranslation<typeof source>;
