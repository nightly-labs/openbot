import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot Yerel Ana Makine",
  "window.localClientTitle": "OpenBot Yerel İstemci",
  "window.computerUsePermissionTitle": "Bilgisayar Kullanımını Aç",
} as const satisfies PartialTranslation<typeof source>;
