import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/memory";

export const messages = {
  "memory.title": "Recuerdos",
  "memory.description": "Recuerdos guardados de {name}",
  "memory.add": "Añadir recuerdo",
  "memory.close": "Cerrar recuerdos",
  "memory.new": "Nuevo recuerdo",
  "memory.newPlaceholder": "Añade un dato o una preferencia que quieras conservar",
  "memory.save": "Guardar recuerdo",
  "memory.limitAgent":
    "Este agente ha alcanzado el límite de {limit} recuerdos. Edita, combina o elimina un recuerdo antes de añadir otro.",
  "memory.limitChannel":
    "Este canal ha alcanzado el límite de {limit} recuerdos. Edita, combina o elimina un recuerdo antes de añadir otro.",
  "memory.loading": "Cargando recuerdos…",
  "memory.emptyAgent": "Este agente aún no tiene recuerdos guardados.",
  "memory.emptyChannel": "Este canal aún no tiene recuerdos guardados.",
  "memory.editText": "Editar recuerdo: {text}",
  "memory.edit": "Editar recuerdo",
  "memory.delete": "Eliminar recuerdo",
  "memory.learned": "Aprendido automáticamente",
  "memory.manual": "Añadido manualmente",
  "memory.unknownDate": "Fecha desconocida",
  "memory.clearAll": "Borrar todos los recuerdos",
  "memory.clearTitle": "¿Borrar todos los recuerdos?",
  "memory.clearDescription":
    "OpenBot eliminará permanentemente los {total} recuerdos guardados de {name}. Los mensajes originales permanecerán en el historial de la conversación.",
  "memory.loadFailed": "No se pudieron cargar los recuerdos.",
  "memory.saveFailed": "No se pudo guardar el recuerdo.",
  "memory.updateFailed": "No se pudo actualizar el recuerdo.",
  "memory.deleteFailed": "No se pudo eliminar el recuerdo.",
  "memory.clearFailed": "No se pudieron borrar los recuerdos.",
} as const satisfies PartialTranslation<typeof source>;
