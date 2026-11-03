import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Descarga detenida. Inténtalo de nuevo.",
  "status.provider.downloadFailed": "La descarga falló. Inténtalo de nuevo.",
  "status.provider.updateWaiting": "La actualización empieza cuando termine el turno actual.",
  "status.provider.confirmContinue": "Continuar",
  "status.provider.confirmCancel": "Cancelar",
  "status.provider.retryUnreachable":
    "{provider} no puede conectarse a su servidor. Reintento {attempt} de {maxAttempts}.",
  "status.provider.retryServerError":
    "El servidor de {provider} está ocupado o tiene un error. Reintento {attempt} de {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} vuelve a recibir respuestas de su servidor.",
} as const satisfies PartialTranslation<typeof source>;
