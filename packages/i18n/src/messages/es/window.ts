import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "Host local de OpenBot",
  "window.localClientTitle": "Cliente local de OpenBot",
  "window.computerUsePermissionTitle": "Activar el uso del equipo",
  "window.controls.label": "Ventana",
  "window.controls.minimize": "Minimizar",
  "window.controls.maximize": "Maximizar",
  "window.controls.restore": "Restaurar",
  "window.controls.close": "Cerrar",
} as const satisfies PartialTranslation<typeof source>;
