import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  // Ek ve dosya önizleme hataları.
  "error.attachment.notFound": "Ek bulunamadı.",
  "error.attachment.fileTooLarge": "Bir dosya 100 MB sınırını aşıyor.",
  "error.attachment.totalTooLarge": "Ekler 250 MB toplam sınırını aşıyor.",
  "error.attachment.unavailable": "Bu dosya artık kullanılamıyor.",
  "error.attachment.tooMany": "En fazla {limit} dosya seçin.",
  "error.attachment.mediaUnsupported":
    "Bu sunucu MP3 veya MOV eklerini desteklemiyor. Ana makinedeki OpenBot'u güncelleyin ve tekrar deneyin.",
  "error.attachment.emlUnsupported":
    "Bu sunucu EML eklerini desteklemiyor. Ana makinedeki OpenBot'u güncelleyin ve tekrar deneyin.",
  "error.attachment.previewTooLarge": "Dosya 100 MB sınırını aşıyor.",
} as const satisfies PartialTranslation<typeof source>;
