import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/search";

export const messages = {
  "mobile.search.clear": "Borrar búsqueda",
  "mobile.search.emptyTitle": "Sin resultados coincidentes",
  "mobile.search.emptyBody": "Prueba con otra búsqueda.",
  "mobile.search.searching": "Buscando mensajes…",
  "mobile.search.errorTitle": "No se pudieron buscar mensajes",
  "mobile.search.errorBody": "Comprueba la conexión con este equipo y vuelve a intentarlo.",
  "mobile.search.retry": "Volver a intentar",
  "mobile.search.showMore": "Mostrar más mensajes",
  "mobile.search.fromYou": "Tú a {name} · {time}",
  "mobile.search.toYou": "{name} a ti · {time}",
} as const satisfies PartialTranslation<typeof source>;
