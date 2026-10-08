import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Tablas",
  "sharedTable.description":
    "Lo que los agentes conservan entre tareas, con el agente que inició cada conjunto de registros",
  "sharedTable.close": "Cerrar tablas",
  "sharedTable.loading": "Cargando tablas…",
  "sharedTable.empty":
    "Aún no hay tablas. Un agente crea una cuando una tarea necesita registros entre turnos, y todos los agentes pueden usarla.",
  "sharedTable.loadFailed": "No se pudieron cargar las tablas.",
  "sharedTable.deleteFailed": "No se pudo eliminar este elemento.",
  "sharedTable.madeOutside": "Creada fuera de OpenBot · cualquier agente puede eliminarla",
  "sharedTable.keptBy": "Mantenida por {name}",
  "sharedTable.keptByDeleted": "Mantenida por un agente que ya no existe",
  "sharedTable.deleteName": "Eliminar {name}",
  "sharedTable.confirmDelete": "¿Eliminar esto para todos los agentes? Los registros no se pueden recuperar.",
  "sharedTable.notCounted": "sin contar",
  "sharedTable.records": {
    one: "{count} registro",
    other: "{count} registros",
  },
} as const satisfies PartialTranslation<typeof source>;
