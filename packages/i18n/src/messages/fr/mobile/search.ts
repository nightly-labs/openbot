import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.clear": "Effacer la recherche",
  "mobile.search.emptyTitle": "Aucun résultat correspondant",
  "mobile.search.emptyBody": "Essayez une autre recherche.",
  "mobile.search.searching": "Recherche des messages…",
  "mobile.search.errorTitle": "Impossible de rechercher les messages",
  "mobile.search.errorBody": "Vérifiez la connexion à cet ordinateur, puis réessayez.",
  "mobile.search.retry": "Réessayer",
  "mobile.search.showMore": "Afficher plus de messages",
  "mobile.search.fromYou": "Vous à {name} · {time}",
  "mobile.search.toYou": "{name} à vous · {time}",
} as const satisfies PartialTranslation<typeof source>;
