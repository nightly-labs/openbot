import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Tabellen",
  "sharedTable.description": "Wat de agents tussen taken bewaren, met de agent die elke set records is begonnen",
  "sharedTable.close": "Tabellen sluiten",
  "sharedTable.loading": "Tabellen laden…",
  "sharedTable.empty":
    "Nog geen tabellen. Een agent maakt er zelf een wanneer een taak records tussen beurten nodig heeft, en elke agent kan hem gebruiken.",
  "sharedTable.loadFailed": "Kan de tabellen niet laden.",
  "sharedTable.deleteFailed": "Kan dit niet verwijderen.",
  "sharedTable.madeOutside": "Buiten OpenBot gemaakt · elke agent kan hem verwijderen",
  "sharedTable.keptBy": "Bewaard door {name}",
  "sharedTable.keptByDeleted": "Bewaard door een agent die niet meer bestaat",
  "sharedTable.deleteName": "{name} verwijderen",
  "sharedTable.confirmDelete": "Dit voor elke agent verwijderen? De records kunnen niet worden hersteld.",
  "sharedTable.notCounted": "niet geteld",
  "sharedTable.records": { one: "{count} record", other: "{count} records" },
} as const satisfies PartialTranslation<typeof source>;
