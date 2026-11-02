import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download interrompido. Tente novamente.",
  "status.provider.downloadFailed": "Falha no download. Tente novamente.",
  "status.provider.updateWaiting": "A atualização começa quando o turno atual terminar.",
  "status.provider.confirmContinue": "Continuar",
  "status.provider.confirmCancel": "Cancelar",
} as const satisfies PartialTranslation<typeof source>;
