import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Nel browser esterno si possono aprire solo link HTTP(S).",
  "error.app.notificationsUnsupported": "Questo sistema non supporta le notifiche del desktop.",
  "error.app.notificationSettingsMissing": "Questo sistema non ha una pagina delle impostazioni delle notifiche.",
  "error.app.notReady": "OpenBot non è pronto.",
  "error.app.macSecureStorageUnavailable": "L'archivio sicuro di macOS non è disponibile.",
  "error.app.secretStorageUnavailable": "L'archivio dei segreti del sistema non è disponibile.",
  "error.app.remoteIdentityUnavailable": "L'identità dell'host remoto non è disponibile.",
  "error.app.iceServersMissing": "Remote Signal non ha ancora fornito i server ICE.",
  "error.app.finishLocalTest": "Termina il test locale prima di cambiare schermo.",
} as const satisfies PartialTranslation<typeof source>;
