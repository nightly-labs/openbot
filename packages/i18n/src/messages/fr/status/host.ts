import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "Cet OpenBot est enregistré pour l’accès WebRTC.",
  "status.host.identityUpdated": "Identité du serveur mise à jour.",
  "status.host.starting": "Démarrage de l’hôte WebRTC…",
  "status.host.ready": "Cet OpenBot est prêt pour les connexions WebRTC.",
  "status.host.stopping": "Passage de cet OpenBot en mode privé…",
  "status.host.private": "Cet OpenBot est privé.",
} as const satisfies PartialTranslation<typeof source>;
