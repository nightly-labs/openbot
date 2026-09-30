import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Seç",
  "mobile.shared.crop.label": "Fotoğraf kırpma",
  "mobile.shared.crop.hint": "Fotoğrafı taşımak için sürükleyin. Ölçeklendirmek için sıkıştırın.",
  "mobile.shared.splash.loading": "Hesap yükleniyor",
  "mobile.shared.photo.openFailed": "Bu fotoğraf açılamadı. Tekrar deneyin.",
  "mobile.shared.photo.tooLarge": "OpenBot bu fotoğrafı yeterince küçültemedi. Daha basit bir fotoğraf seçin.",
  "mobile.shared.save.changes": "Değişiklikleri kaydet",
} as const satisfies PartialTranslation<typeof source>;
