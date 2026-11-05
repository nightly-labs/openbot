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
  "startup.newerDataUpdatingTitle": "OpenBot güncelleniyor",
  "startup.newerDataUpdatingBody":
    "OpenBot’un daha yeni bir sürümü verilerinizi kaydetti. OpenBot en son sürümü yüklüyor ve ardından yeniden açılacak.\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  "startup.newerDataTitle": "En son OpenBot’u yükleyin",
  "startup.newerDataBody":
    "OpenBot’un daha yeni bir sürümü verilerinizi kaydetti ve bu sürüm ({version}) onları açamıyor. Verilerinizi açmak için en son sürümü yükleyin.\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  "startup.newerDataDownload": "OpenBot’u indir",
  "startup.newerDataGuide": "Kılavuzu aç",
  "startup.newerDataQuit": "Çık",
} as const satisfies PartialTranslation<typeof source>;
