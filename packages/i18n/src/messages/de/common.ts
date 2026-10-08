import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "Abbrechen",
  "common.save": "Speichern",
  "common.close": "Schließen",
  "common.delete": "Löschen",
  "common.remove": "Entfernen",
  "common.edit": "Bearbeiten",
  "common.rename": "Umbenennen",
  "common.retry": "Erneut versuchen",
  "common.copy": "Kopieren",
  "common.copied": "Kopiert",
  "common.done": "Fertig",
  "common.back": "Zurück",
  "common.continue": "Weiter",
  "common.add": "Hinzufügen",
  "common.create": "Erstellen",
  "common.open": "Öffnen",
  "common.search": "Suchen",
  "common.loading": "Wird geladen…",
  "common.saving": "Wird gespeichert…",
  "common.tryAgain": "Erneut versuchen",
  "common.connecting": "Verbindung wird hergestellt…",
  "common.download": "Herunterladen",
  "common.removing": "Wird entfernt…",
  "common.sending": "Wird gesendet…",
} as const satisfies PartialTranslation<typeof source>;
