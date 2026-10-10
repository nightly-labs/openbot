import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "W zewnętrznej przeglądarce można otwierać tylko linki HTTP(S).",
  "error.app.notificationsUnsupported": "Ten system nie obsługuje powiadomień na pulpicie.",
  "error.app.notificationSettingsMissing": "Ten system nie ma strony ustawień powiadomień.",
  "error.app.notReady": "OpenBot nie jest gotowy.",
  "error.app.macSecureStorageUnavailable": "Bezpieczny magazyn macOS jest niedostępny.",
  "error.app.secretStorageUnavailable": "Systemowy magazyn sekretów jest niedostępny.",
  "error.app.remoteIdentityUnavailable": "Tożsamość zdalnego hosta jest niedostępna.",
  "error.app.iceServersMissing": "Remote Signal nie dostarczył jeszcze serwerów ICE.",
  "error.app.finishLocalTest": "Zakończ test lokalny przed przełączeniem ekranów.",
} as const satisfies PartialTranslation<typeof source>;
