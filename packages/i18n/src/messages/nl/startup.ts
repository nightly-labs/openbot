import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot kan niet starten",
  "startup.failedBody":
    "{message}\n\nJe lokale gegevens zijn niet gereset of overschreven. Bekijk de handleiding voor probleemoplossing voor herstelstappen.",
  "startup.archiveChangedTitle": "OpenBot-bestanden zijn gewijzigd",
  "startup.archiveChangedBody":
    "Een ander programma heeft het OpenBot-bestand app.asar gewijzigd. OpenBot werkt nu, maar opent niet meer nadat je het afsluit.\n\nInstalleer OpenBot opnieuw om het te herstellen. Je lokale gegevens blijven bewaard.",
  "startup.archiveChangedDownload": "OpenBot downloaden",
} as const satisfies PartialTranslation<typeof source>;
