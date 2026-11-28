import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot Yerel Ana Makine",
  "window.localClientTitle": "OpenBot Yerel İstemci",
  "window.computerUsePermissionTitle": "Bilgisayar Kullanımını aç",
  "window.rendererStoppedTitle": "OpenBot çalışmayı durdurdu",
  "window.rendererStoppedBody":
    "Pencere birkaç kez durdu. Sohbetleriniz kaydedildi ve ajanlarınız çalışmaya devam ediyor.",
  "window.rendererStoppedReload": "Yeniden yükle",
  "window.minimize": "Simge durumuna küçült",
  "window.maximize": "Ekranı kapla",
  "window.restore": "Önceki boyut",
} as const satisfies PartialTranslation<typeof source>;
