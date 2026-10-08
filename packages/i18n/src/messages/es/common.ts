import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "Cancelar",
  "common.save": "Guardar",
  "common.close": "Cerrar",
  "common.delete": "Eliminar",
  "common.remove": "Quitar",
  "common.edit": "Editar",
  "common.rename": "Cambiar nombre",
  "common.retry": "Reintentar",
  "common.copy": "Copiar",
  "common.copied": "Copiado",
  "common.done": "Listo",
  "common.back": "Atrás",
  "common.continue": "Continuar",
  "common.add": "Añadir",
  "common.create": "Crear",
  "common.open": "Abrir",
  "common.search": "Buscar",
  "common.loading": "Cargando…",
  "common.saving": "Guardando…",
  "common.tryAgain": "Volver a intentar",
  "common.connecting": "Conectando…",
  "common.download": "Descargar",
  "common.removing": "Quitando…",
  "common.sending": "Enviando…",
} as const satisfies PartialTranslation<typeof source>;
