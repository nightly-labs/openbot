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
    "Bitwarden konnte nicht gelesen werden. Installiere die bw CLI, melde dich an, entsperre sie und erstelle einen Ordner mit dem Namen „Shared with OpenBot“. Verbinde dich mit einem neuen Sitzungsschlüssel.",
  "error.connector.bitwardenCliMissing":
    "OpenBot findet die Bitwarden CLI nicht. Installiere bw, prüfe, dass es in einem neuen Terminal funktioniert, und verbinde dich dann erneut.",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden muss genau einen Ordner mit dem Namen „Shared with OpenBot“ haben. Erstelle ihn oder entferne den zusätzlichen Ordner und verbinde dich dann erneut.",
  "error.connector.bitwardenHostInput":
    "Gib eine HTTPS-Serveradresse, client_id und client_secret des API-Schlüssels und das Master-Passwort ein.",
  "error.connector.bitwardenHostFailed":
    "Bitwarden konnte auf diesem Server nicht geöffnet werden. Prüfe die Serveradresse, den API-Schlüssel und das Master-Passwort und stelle sicher, dass ein Ordner Shared with OpenBot heißt. Verbinde dann erneut.",
  "error.connector.bitwardenCliInstallFailed":
    "Die Bitwarden CLI konnte auf diesem Server nicht installiert werden. Prüfe seine Netzwerkverbindung und verbinde dann erneut.",
  "error.connector.bitwardenFileUnreadable": "Die Bitwarden-Verbindungsdatei ist nicht lesbar.",
  "error.connector.passwordManagerUnknown": "OpenBot kennt diesen Passwortmanager nicht.",
  "error.connector.passwordManagerMethod": "Dieser Passwortmanager kann sich so nicht verbinden.",
  "error.connector.passwordManagerNoSignIn": "Keine Anmeldeseite ist offen. Verbinde erneut.",
  "error.connector.protonPassFailed": "Proton Pass konnte nicht verbunden werden. Verbinde erneut.",
  "error.connector.protonPassCliInstallFailed":
    "Die Proton Pass CLI konnte nicht installiert werden. Prüfe die Netzwerkverbindung und verbinde dann erneut.",
  "error.connector.protonPassPlan":
    "Dein Proton-Tarif erlaubt die Proton Pass CLI nicht. Ändere den Tarif und verbinde dann erneut.",
  "error.connector.protonPassExpired": "Der Zugriff auf Proton Pass ist abgelaufen. Verbinde erneut.",
  "error.connector.protonPassKeyInvalid": "Gib einen Proton Pass-Zugriffsschlüssel ein, der mit pst_ beginnt.",
  "error.connector.protonPassExtraPassword": "Das zusätzliche Passwort ist nicht korrekt. Gib es erneut ein.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass hat nicht nach einem zusätzlichen Passwort gefragt.",
  "error.connector.protonPassFileUnreadable": "Die Proton Pass-Verbindungsdatei ist nicht lesbar.",
  "error.connector.protonPassSignInTimeout": "Die Proton-Anmeldung hat zu lange gedauert. Verbinde erneut.",
  "error.connector.protonPassSetupFailed":
    "Der Tresor Shared with OpenBot oder sein Zugriffsschlüssel konnte in Proton Pass nicht erstellt werden. Verbinde erneut.",
} as const satisfies PartialTranslation<typeof source>;
