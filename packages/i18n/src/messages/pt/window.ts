import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "Computador anfitrião local do OpenBot",
  "window.localClientTitle": "Cliente local do OpenBot",
  "window.computerUsePermissionTitle": "Ativar Uso do computador",
  "window.controls.label": "Janela",
  "window.controls.minimize": "Minimizar",
  "window.controls.maximize": "Maximizar",
  "window.controls.restore": "Restaurar",
  "window.controls.close": "Fechar",
} as const satisfies PartialTranslation<typeof source>;
