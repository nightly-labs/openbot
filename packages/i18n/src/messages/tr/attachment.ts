import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.downloadAll.pending": "ZIP indiriliyor…",
  "attachment.downloadAll.label": "Tümünü ZIP olarak indir",
  "attachment.downloadAll.count": { one: "{count} ek", other: "{count} ek" },
  "attachment.downloadAll.zipping": "ZIP yapılıyor",
  "attachment.openFile": "Dosyayı aç",
  "attachment.preview": "{name} önizle",
  "attachment.notFound": "Dosya bulunamadı",
  "attachment.download": "{name} indir",
  "attachment.open": "{name} aç",
  "attachment.previewUnavailable": "Önizleme kullanılamıyor.",
  "attachment.error.preview": "{name} önizlenemedi. Tekrar deneyin.",
  "attachment.error.download": "Ekler indirilemedi. Tekrar deneyin.",
  "attachment.error.open": "Bu ek açılamadı veya kaydedilemedi. Tekrar deneyin.",
  "attachment.error.openFile": "Bu dosya açılamadı. Tekrar deneyin.",
  "attachment.error.fileFallback": "Dosya",
  "attachment.error.fileNotFound": "“{name}” bu konumda bulunamadı. Taşınmış veya silinmiş olabilir.",
  "attachment.error.previewFile": "“{name}” önizlenemedi. Tekrar deneyin.",
} as const satisfies PartialTranslation<typeof source>;
