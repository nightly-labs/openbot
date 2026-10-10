import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Descarga detenida. Inténtalo de nuevo.",
  "status.provider.downloadFailed": "La descarga falló. Inténtalo de nuevo.",
  "status.provider.confirmContinue": "Continuar",
  "status.provider.confirmCancel": "Cancelar",
} as const satisfies PartialTranslation<typeof source>;
