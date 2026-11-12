import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "Lokale OpenBot-host",
  "window.localClientTitle": "Lokale OpenBot-client",
  "window.computerUsePermissionTitle": "Zet Computerbesturing aan",
  "window.controls.label": "Venster",
  "window.controls.minimize": "Minimaliseren",
  "window.controls.maximize": "Maximaliseren",
  "window.controls.restore": "Vorig formaat",
  "window.controls.close": "Sluiten",
} as const satisfies PartialTranslation<typeof source>;
