import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.clear": "Suche leeren",
  "mobile.search.emptyTitle": "Keine passenden Ergebnisse",
  "mobile.search.emptyBody": "Versuche eine andere Suche.",
  "mobile.search.searching": "Nachrichten werden durchsucht…",
  "mobile.search.errorTitle": "Nachrichten konnten nicht durchsucht werden",
  "mobile.search.errorBody": "Prüfe die Verbindung zu diesem Computer und versuche es erneut.",
  "mobile.search.retry": "Erneut versuchen",
  "mobile.search.showMore": "Weitere Nachrichten anzeigen",
  "mobile.search.fromYou": "Du an {name} · {time}",
  "mobile.search.toYou": "{name} an dich · {time}",
} as const satisfies PartialTranslation<typeof source>;
