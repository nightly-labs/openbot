import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.clear": "Cancella ricerca",
  "mobile.search.emptyTitle": "Nessun risultato",
  "mobile.search.emptyBody": "Prova con un'altra ricerca.",
  "mobile.search.searching": "Ricerca nei messaggi…",
  "mobile.search.errorTitle": "Impossibile cercare nei messaggi",
  "mobile.search.errorBody": "Controlla la connessione a questo computer, poi riprova.",
  "mobile.search.retry": "Riprova",
  "mobile.search.showMore": "Mostra altri messaggi",
  "mobile.search.fromYou": "Tu a {name} · {time}",
  "mobile.search.toYou": "{name} a te · {time}",
} as const satisfies PartialTranslation<typeof source>;
