import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/memory";

export const messages = {
  "memory.title": "Erinnerungen",
  "memory.description": "Gespeicherte Erinnerungen für {name}",
  "memory.add": "Erinnerung hinzufügen",
  "memory.close": "Erinnerungen schließen",
  "memory.new": "Neue Erinnerung",
  "memory.newPlaceholder": "Füge eine dauerhafte Information oder Präferenz hinzu",
  "memory.save": "Erinnerung speichern",
  "memory.limitAgent":
    "Dieser Agent hat das Limit von {limit} Erinnerungen erreicht. Bearbeite, verbinde oder lösche eine Erinnerung, bevor du eine weitere hinzufügst.",
  "memory.limitChannel":
    "Dieser Kanal hat das Limit von {limit} Erinnerungen erreicht. Bearbeite, verbinde oder lösche eine Erinnerung, bevor du eine weitere hinzufügst.",
  "memory.loading": "Erinnerungen werden geladen…",
  "memory.emptyAgent": "Dieser Agent hat noch keine gespeicherten Erinnerungen.",
  "memory.emptyChannel": "Dieser Kanal hat noch keine gespeicherten Erinnerungen.",
  "memory.editText": "Erinnerung bearbeiten: {text}",
  "memory.edit": "Erinnerung bearbeiten",
  "memory.delete": "Erinnerung löschen",
  "memory.learned": "Automatisch gelernt",
  "memory.manual": "Manuell hinzugefügt",
  "memory.unknownDate": "Unbekanntes Datum",
  "memory.clearAll": "Alle Erinnerungen löschen",
  "memory.clearTitle": "Alle Erinnerungen löschen?",
  "memory.clearDescription":
    "OpenBot entfernt dauerhaft alle {total} gespeicherten Erinnerungen für {name}. Die ursprünglichen Nachrichten bleiben im Unterhaltungsverlauf erhalten.",
  "memory.loadFailed": "Die Erinnerungen konnten nicht geladen werden.",
  "memory.saveFailed": "Die Erinnerung konnte nicht gespeichert werden.",
  "memory.updateFailed": "Die Erinnerung konnte nicht aktualisiert werden.",
  "memory.deleteFailed": "Die Erinnerung konnte nicht gelöscht werden.",
  "memory.clearFailed": "Die Erinnerungen konnten nicht gelöscht werden.",
} as const satisfies PartialTranslation<typeof source>;
