import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot başlatılamadı",
  "startup.failedBody":
    "{message}\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı. Kurtarma adımları için sorun giderme kılavuzuna bakın.",
  "startup.archiveChangedTitle": "OpenBot dosyaları değiştirildi",
  "startup.archiveChangedBody":
    "Başka bir program OpenBot’un app.asar dosyasını değiştirdi. OpenBot şu an çalışıyor, ancak kapattıktan sonra açılmayacak.\n\nOnarmak için OpenBot’u yeniden yükleyin. Yerel verileriniz korunur.",
  "startup.archiveChangedDownload": "OpenBot’u indir",
} as const satisfies PartialTranslation<typeof source>;
