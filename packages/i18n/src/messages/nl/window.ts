import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "Lokale OpenBot-host",
  "window.localClientTitle": "Lokale OpenBot-client",
  "window.computerUsePermissionTitle": "Zet Computerbesturing aan",
  "window.rendererStoppedTitle": "OpenBot werkt niet meer",
  "window.rendererStoppedBody":
    "Het venster is meerdere keren gestopt. Je chats zijn opgeslagen en je agents blijven werken.",
  "window.rendererStoppedReload": "Herladen",
  "window.minimize": "Minimaliseren",
  "window.maximize": "Maximaliseren",
  "window.restore": "Vorige grootte",
} as const satisfies PartialTranslation<typeof source>;
