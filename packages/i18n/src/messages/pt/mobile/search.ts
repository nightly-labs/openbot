import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.clear": "Limpar busca",
  "mobile.search.emptyTitle": "Nenhum resultado encontrado",
  "mobile.search.emptyBody": "Tente outra busca.",
  "mobile.search.searching": "Buscando mensagens…",
  "mobile.search.errorTitle": "Não foi possível buscar mensagens",
  "mobile.search.errorBody": "Verifique a conexão com este computador e tente novamente.",
  "mobile.search.retry": "Tentar novamente",
  "mobile.search.showMore": "Mostrar mais mensagens",
  "mobile.search.fromYou": "Você para {name} · {time}",
  "mobile.search.toYou": "{name} para você · {time}",
} as const satisfies PartialTranslation<typeof source>;
