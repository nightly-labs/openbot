import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.filter.all": "Tout",
  "mobile.search.filter.messages": "Messages",
  "mobile.search.filter.agents": "Agents",
  "mobile.search.filter.files": "Fichiers",
  "mobile.search.filter.routines": "Routines",
  "mobile.search.filterResults": "Filtrer les résultats, {filter}",
  "mobile.search.clear": "Effacer la recherche",
  "mobile.search.emptyTitle": "Aucun résultat correspondant",
  "mobile.search.emptyBody": "Essayez une autre recherche ou choisissez un autre filtre.",
} as const satisfies PartialTranslation<typeof source>;
