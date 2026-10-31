import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot: локальний хост",
  "window.localClientTitle": "OpenBot: локальний клієнт",
  "window.computerUsePermissionTitle": "Увімкніть керування комп’ютером",
} as const satisfies PartialTranslation<typeof source>;
