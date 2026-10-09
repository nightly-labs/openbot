import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Datei öffnen",
  "attachment.preview": "Vorschau von {name}",
  "attachment.notFound": "Datei nicht gefunden",
  "attachment.download": "{name} herunterladen",
  "attachment.open": "{name} öffnen",
  "attachment.loadMedia": "{name} abspielen",
  "attachment.previewUnavailable": "Die Vorschau ist nicht verfügbar.",
  "attachment.error.preview": "Die Vorschau von {name} konnte nicht angezeigt werden. Versuche es erneut.",
  "attachment.error.download": "Die Anhänge konnten nicht heruntergeladen werden. Versuche es erneut.",
  "attachment.error.open": "Dieser Anhang konnte nicht geöffnet oder gespeichert werden. Versuche es erneut.",
  "attachment.error.openFile": "Diese Datei konnte nicht geöffnet werden. Versuche es erneut.",
  "attachment.error.fileFallback": "Datei",
  "attachment.error.fileNotFound":
    "„{name}“ wurde unter diesem Pfad nicht gefunden. Die Datei wurde möglicherweise verschoben oder gelöscht.",
  "attachment.error.previewFile": "Die Vorschau von „{name}“ konnte nicht angezeigt werden. Versuche es erneut.",
} as const satisfies PartialTranslation<typeof source>;
