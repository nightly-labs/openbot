import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Bilgisayar Kullanımı sürücüsü başlamadı. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Bilgisayar Kullanımı sürücüsü yanıt veremeden durdu.",
  "status.computerUse.driverNoAnswer": "Bilgisayar Kullanımı sürücüsü yanıt vermedi. {reason}",
  "status.computerUse.driverStopped": "Bilgisayar Kullanımı sürücüsü durdu.",
  "status.computerUse.unsupported": "Bilgisayar Kullanımı macOS, Windows ve Linux üzerinde kullanılabilir.",
  "status.computerUse.driverMissing": "OpenBot'un bu derlemesi bir Bilgisayar Kullanımı sürücüsü içermiyor.",
  "status.computerUse.progressActing": "Bu bilgisayardaki bir uygulama kullanılıyor…",
  "status.computerUse.progressDeciding": "Uygulamadaki sonraki adıma karar veriliyor…",
} as const satisfies PartialTranslation<typeof source>;
