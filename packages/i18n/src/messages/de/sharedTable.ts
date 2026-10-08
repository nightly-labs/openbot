import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Tabellen",
  "sharedTable.description":
    "Was Agenten zwischen Aufgaben behalten, mit dem Agenten, der den jeweiligen Datensatz angelegt hat",
  "sharedTable.close": "Tabellen schließen",
  "sharedTable.loading": "Tabellen werden geladen…",
  "sharedTable.empty":
    "Noch keine Tabellen. Ein Agent erstellt eine, wenn eine Aufgabe Daten über mehrere Durchgänge benötigt. Jeder Agent kann sie nutzen.",
  "sharedTable.loadFailed": "Die Tabellen konnten nicht geladen werden.",
  "sharedTable.deleteFailed": "Dies konnte nicht gelöscht werden.",
  "sharedTable.madeOutside": "Außerhalb von OpenBot erstellt · jeder Agent kann sie löschen",
  "sharedTable.keptBy": "Verwaltet von {name}",
  "sharedTable.keptByDeleted": "Verwaltet von einem Agenten, der nicht mehr existiert",
  "sharedTable.deleteName": "{name} löschen",
  "sharedTable.confirmDelete": "Für alle Agenten löschen? Die Datensätze können nicht wiederhergestellt werden.",
  "sharedTable.notCounted": "nicht gezählt",
  "sharedTable.records": {
    one: "{count} Datensatz",
    other: "{count} Datensätze",
  },
} as const satisfies PartialTranslation<typeof source>;
