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
  "startup.filesDamagedBody":
    "Bazı OpenBot dosyaları hasarlı veya eksik.\n\nOnarmak için OpenBot’u yeniden yükleyin. Yerel verileriniz korunur.",
  "startup.newerDataUpdatingTitle": "OpenBot güncelleniyor",
  "startup.newerDataUpdatingBody":
    "OpenBot’un daha yeni bir sürümü verilerinizi kaydetti. OpenBot en son sürümü yüklüyor ve ardından yeniden açılacak.\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  "startup.newerDataTitle": "En son OpenBot’u yükleyin",
  "startup.newerDataBody":
    "OpenBot’un daha yeni bir sürümü verilerinizi kaydetti ve bu sürüm ({version}) onları açamıyor. Verilerinizi açmak için en son sürümü yükleyin.\n\nYerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  "startup.newerDataDownload": "OpenBot’u indir",
  "startup.newerDataGuide": "Kılavuzu aç",
  "startup.newerDataQuit": "Çık",
  "startup.recoveryWindowTitle": "OpenBot kurtarma",
  "startup.recoveryTitle": "OpenBot açılmadı",
  "startup.recoveryBody": {
    one: "OpenBot {version}, açılmadan önce art arda {count} kez durdu. Yerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
    other:
      "OpenBot {version}, açılmadan önce art arda {count} kez durdu. Yerel verileriniz sıfırlanmadı veya üzerine yazılmadı.",
  },
  "startup.recoveryHint":
    "Yeniden deneyin veya açılan son sürümü yükleyin. Yardım almak için tanılamayı dışa aktarın ve dosyayı raporunuzla gönderin.",
  "startup.recoveryRetry": "Yeniden dene",
  "startup.recoveryPreviousVersion": "Önceki sürümü indir",
  "startup.recoveryExportDiagnostics": "Tanılamayı dışa aktar",
  "startup.recoveryOpenDataFolder": "Veri klasörünü aç",
  "startup.recoveryQuit": "Çık",
  "startup.recoveryDiagnosticsSaved": "Tanılama dosyası kaydedildi.",
  "startup.recoveryActionFailed": "OpenBot bu işlemi yapamadı.",
} as const satisfies PartialTranslation<typeof source>;
