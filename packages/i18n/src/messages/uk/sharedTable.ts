import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Tabele",
  "sharedTable.description":
    "Co agenci przechowują między zadaniami, wraz z agentem, który utworzył każdy zestaw rekordów",
  "sharedTable.close": "Zamknij tabele",
  "sharedTable.loading": "Wczytywanie tabel…",
  "sharedTable.empty":
    "Nie ma jeszcze tabel. Agent sam tworzy tabelę, gdy zadanie potrzebuje rekordów między turami, a każdy agent może z niej korzystać.",
  "sharedTable.loadFailed": "Nie udało się wczytać tabel.",
  "sharedTable.deleteFailed": "Nie udało się tego usunąć.",
  "sharedTable.madeOutside": "Utworzona poza OpenBot · każdy agent może ją usunąć",
  "sharedTable.keptBy": "Prowadzi: {name}",
  "sharedTable.keptByDeleted": "Prowadzi agent, który już nie istnieje",
  "sharedTable.deleteName": "Usuń {name}",
  "sharedTable.confirmDelete": "Usunąć to dla wszystkich agentów? Rekordów nie można odzyskać.",
  "sharedTable.notCounted": "nie policzono",
  "sharedTable.records": {
    one: "{count} rekord",
    few: "{count} rekordy",
    many: "{count} rekordów",
    other: "{count} rekordu",
  },
} as const satisfies PartialTranslation<typeof source>;
