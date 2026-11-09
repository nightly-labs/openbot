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
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude respondió a la velocidad estándar. Con una suscripción de Claude, el modo rápido usa créditos de uso. Actívalos en tu cuenta de Claude.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude respondió a la velocidad estándar. Tu plan de Claude no incluye el modo rápido.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude respondió a la velocidad estándar. El modo rápido solo funciona con una clave de API de Anthropic o una suscripción de Claude, no con Bedrock, Vertex, Foundry ni una pasarela.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude respondió a la velocidad estándar. Este modelo no puede usar el modo rápido en tu cuenta.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude respondió a la velocidad estándar. El modo rápido está desactivado en los ajustes de Claude Code o por tu organización.",
  "status.provider.claudeFastModeUnavailable":
    "Claude respondió a la velocidad estándar. Claude Code no pudo usar el modo rápido en este turno.",
} as const satisfies PartialTranslation<typeof source>;
