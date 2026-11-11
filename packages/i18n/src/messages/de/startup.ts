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
  "startup.newerDataUpdatingTitle": "OpenBot wird aktualisiert",
  "startup.newerDataUpdatingBody":
    "Eine neuere Version von OpenBot hat deine Daten gespeichert. OpenBot installiert die neueste Version und startet dann neu.\n\nDeine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
  "startup.newerDataTitle": "Neueste OpenBot-Version installieren",
  "startup.newerDataBody":
    "Eine neuere Version von OpenBot hat deine Daten gespeichert, und diese Version ({version}) kann sie nicht öffnen. Installiere die neueste Version, um deine Daten zu öffnen.\n\nDeine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
  "startup.newerDataDownload": "OpenBot laden",
  "startup.newerDataGuide": "Anleitung öffnen",
  "startup.newerDataQuit": "Beenden",
  "startup.recoveryWindowTitle": "OpenBot-Wiederherstellung",
  "startup.recoveryTitle": "OpenBot wurde nicht geöffnet",
  "startup.recoveryBody": {
    one: "OpenBot {version} wurde {count} Mal in Folge vor dem Öffnen beendet. Deine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
    other:
      "OpenBot {version} wurde {count} Mal in Folge vor dem Öffnen beendet. Deine lokalen Daten wurden nicht zurückgesetzt oder überschrieben.",
  },
  "startup.recoveryHint":
    "Versuche es erneut oder installiere die letzte Version, die sich geöffnet hat. Für Hilfe exportiere die Diagnosedaten und sende die Datei mit deinem Bericht.",
  "startup.recoveryRetry": "Wiederholen",
  "startup.recoveryPreviousVersion": "Vorherige Version laden",
  "startup.recoveryExportDiagnostics": "Diagnose exportieren",
  "startup.recoveryOpenDataFolder": "Datenordner öffnen",
  "startup.recoveryQuit": "Beenden",
  "startup.recoveryDiagnosticsSaved": "Die Diagnosedatei ist gespeichert.",
  "startup.recoveryActionFailed": "OpenBot konnte diese Aktion nicht ausführen.",
} as const satisfies PartialTranslation<typeof source>;
