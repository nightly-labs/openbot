import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot Yerel Ana Makine",
  "window.localClientTitle": "OpenBot Yerel İstemci",
  "window.computerUsePermissionTitle": "Bilgisayar Kullanımını aç",
  "window.controls.label": "Pencere",
  "window.controls.minimize": "Simge durumuna küçült",
  "window.controls.maximize": "Ekranı kapla",
  "window.controls.restore": "Önceki boyut",
  "window.controls.close": "Kapat",
} as const satisfies PartialTranslation<typeof source>;
