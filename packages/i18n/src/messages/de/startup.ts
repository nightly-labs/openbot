import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot konnte nicht starten",
  "startup.failedBody":
    "{message}\n\nDeine lokalen Daten wurden weder zurückgesetzt noch überschrieben. Schritte zur Wiederherstellung findest du in der Anleitung zur Fehlerbehebung.",
  "startup.archiveChangedTitle": "OpenBot-Dateien wurden geändert",
  "startup.archiveChangedBody":
    "Ein anderes Programm hat die OpenBot-Datei app.asar geändert. OpenBot läuft jetzt, startet aber nicht mehr, wenn du es beendest.\n\nInstalliere OpenBot erneut, um es zu reparieren. Deine lokalen Daten bleiben erhalten.",
  "startup.archiveChangedDownload": "OpenBot laden",
} as const satisfies PartialTranslation<typeof source>;
