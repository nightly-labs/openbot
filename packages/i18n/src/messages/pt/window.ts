import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "Computador anfitrião local do OpenBot",
  "window.localClientTitle": "Cliente local do OpenBot",
  "window.computerUsePermissionTitle": "Ativar Uso do computador",
  "window.rendererStoppedTitle": "O OpenBot parou de funcionar",
  "window.rendererStoppedBody":
    "A janela parou várias vezes. Suas conversas estão salvas e seus agentes continuam trabalhando.",
  "window.rendererStoppedReload": "Recarregar",
  "window.minimize": "Minimizar",
  "window.maximize": "Maximizar",
  "window.restore": "Restaurar",
} as const satisfies PartialTranslation<typeof source>;
