import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.clear": "Wyczyść wyszukiwanie",
  "mobile.search.emptyTitle": "Brak pasujących wyników",
  "mobile.search.emptyBody": "Spróbuj wyszukać coś innego.",
  "mobile.search.searching": "Wyszukiwanie wiadomości…",
  "mobile.search.errorTitle": "Nie udało się przeszukać wiadomości",
  "mobile.search.errorBody": "Sprawdź połączenie z tym komputerem i spróbuj ponownie.",
  "mobile.search.retry": "Spróbuj ponownie",
  "mobile.search.showMore": "Pokaż więcej wiadomości",
  "mobile.search.fromYou": "Ty do: {name} · {time}",
  "mobile.search.toYou": "{name} do ciebie · {time}",
} as const satisfies PartialTranslation<typeof source>;
