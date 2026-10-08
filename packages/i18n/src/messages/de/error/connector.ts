import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "Diese Version von OpenBot hat keine GitHub App.",
  "error.connector.githubDenied": "Die GitHub-Anmeldung wurde abgelehnt.",
  "error.connector.githubCodeExpired": "Der GitHub-Code ist abgelaufen. Verbinde GitHub erneut.",
  "error.connector.githubDeviceFlowDisabled": "Die GitHub App erlaubt keine Geräteanmeldung.",
  "error.connector.githubClientUnknown": "GitHub kennt die Client ID dieser GitHub App nicht.",
  "error.connector.githubUnexpected": "GitHub hat eine unerwartete Antwort gesendet: {detail}",
  "error.connector.githubUnreachable": "OpenBot kann GitHub nicht erreichen: {detail}",
  "error.connector.githubExpired": "Die GitHub-Verbindung ist abgelaufen. Verbinde GitHub erneut.",
  "error.connector.githubFileUnreadable": "Die GitHub-Verbindungsdatei ist nicht lesbar.",
  "error.connector.githubFileTooLarge": "Die GitHub-Verbindungsdatei ist zu groß.",
  "error.connector.onePasswordCliMissing":
    "OpenBot kann die 1Password CLI nicht finden. Installiere sie und aktiviere ihre Integration in der 1Password-App oder verwende ein Dienstkonto-Token.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot konnte die 1Password CLI nicht installieren. Prüfe die Internetverbindung und versuche es erneut.",
  "error.connector.onePasswordCliSignedOut":
    "Die 1Password CLI ist nicht angemeldet. Aktiviere ihre Integration in der 1Password-App und verbinde sie erneut.",
  "error.connector.onePasswordCliFailed": "Die 1Password CLI ist fehlgeschlagen: {detail}",
  "error.connector.onePasswordUnexpected": "1Password hat eine unerwartete Antwort gesendet: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password hat das Dienstkonto-Token nicht akzeptiert.",
  "error.connector.onePasswordNoVault":
    "Das Dienstkonto kann keinen Tresor lesen. Gib ihm Zugriff auf einen Tresor und versuche es erneut.",
  "error.connector.onePasswordFileUnreadable": "Die 1Password-Verbindungsdatei ist nicht lesbar.",
  "error.connector.onePasswordFileTooLarge": "Die 1Password-Verbindungsdatei ist zu groß.",
  "error.connector.bitwardenFailed":
    "Bitwarden konnte nicht gelesen werden. Installiere die bw CLI, melde dich an, entsperre sie und erstelle einen Ordner mit dem Namen Shared with OpenBot. Verbinde dich mit einem neuen Sitzungsschlüssel.",
} as const satisfies PartialTranslation<typeof source>;
