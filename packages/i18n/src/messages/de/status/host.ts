import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Dieser OpenBot wurde für den WebRTC-Zugriff registriert.",
  "status.host.identityUpdated": "Serveridentität aktualisiert.",
  "status.host.starting": "WebRTC-Host wird gestartet…",
  "status.host.ready": "Dieser OpenBot ist für WebRTC-Verbindungen bereit.",
  "status.host.stopping": "Dieser OpenBot wird auf privat gesetzt…",
  "status.host.private": "Dieser OpenBot ist privat.",
} as const satisfies PartialTranslation<typeof source>;
