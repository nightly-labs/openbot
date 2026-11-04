import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Dosyayı aç",
  "attachment.preview": "{name} dosyasını önizle",
  "attachment.notFound": "Dosya bulunamadı",
  "attachment.download": "{name} dosyasını indir",
  "attachment.downloadProgress": "{received} / {total}",
  "attachment.stopDownload": "{name} indirmesini durdur, %{percent}",
  "attachment.downloadFailed": "İndirme başarısız",
  "attachment.retryDownload": "{name} indirmesini yeniden dene",
  "attachment.open": "{name} dosyasını aç",
  "attachment.loadMedia": "{name} dosyasını oynat",
  "attachment.previewUnavailable": "Önizleme kullanılamıyor.",
  "attachment.error.preview": "{name} önizlenemedi. Tekrar deneyin.",
  "attachment.error.download": "Ekler indirilemedi. Tekrar deneyin.",
  "attachment.error.open": "Bu ek açılamadı veya kaydedilemedi. Tekrar deneyin.",
  "attachment.error.openFile": "Bu dosya açılamadı. Tekrar deneyin.",
  "attachment.error.fileFallback": "Dosya",
  "attachment.error.fileNotFound": "“{name}” bu konumda bulunamadı. Taşınmış veya silinmiş olabilir.",
  "attachment.error.previewFile": "“{name}” önizlenemedi. Tekrar deneyin.",
} as const satisfies PartialTranslation<typeof source>;
