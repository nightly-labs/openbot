import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Questo OpenBot è stato registrato per l'accesso WebRTC.",
  "status.host.identityUpdated": "Identità del server aggiornata.",
  "status.host.starting": "Avvio dell'host WebRTC…",
  "status.host.ready": "Questo OpenBot è pronto per le connessioni WebRTC.",
  "status.host.stopping": "Questo OpenBot sta diventando privato…",
  "status.host.private": "Questo OpenBot è privato.",
} as const satisfies PartialTranslation<typeof source>;
