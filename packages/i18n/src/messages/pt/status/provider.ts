import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download interrompido. Tente novamente.",
  "status.provider.downloadFailed": "Falha no download. Tente novamente.",
} as const satisfies PartialTranslation<typeof source>;
