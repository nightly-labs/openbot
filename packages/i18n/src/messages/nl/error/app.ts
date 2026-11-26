import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Alleen HTTP(S)-links kunnen in de externe browser worden geopend.",
  "error.app.notificationsUnsupported": "Dit systeem ondersteunt geen bureaubladmeldingen.",
  "error.app.notificationSettingsMissing": "Dit systeem heeft geen pagina met meldingsinstellingen.",
  "error.app.notReady": "OpenBot is niet klaar.",
  "error.app.macSecureStorageUnavailable": "De beveiligde opslag van macOS is niet beschikbaar.",
  "error.app.secretStorageUnavailable": "De opslag voor geheimen van het systeem is niet beschikbaar.",
  "error.app.remoteIdentityUnavailable": "De identiteit van de externe host is niet beschikbaar.",
  "error.app.iceServersMissing": "Remote Signal heeft nog geen ICE-servers gegeven.",
  "error.app.finishLocalTest": "Rond de lokale test af voordat je van beeldscherm wisselt.",
  "error.app.windowBlockedBySecuritySoftware":
    "Beveiligingssoftware op deze computer heeft het OpenBot-venster waarschijnlijk gestopt. Voeg OpenBot.exe in je beveiligingssoftware, bijvoorbeeld Kaspersky, toe als vertrouwde toepassing. Start OpenBot daarna opnieuw.",
} as const satisfies PartialTranslation<typeof source>;
