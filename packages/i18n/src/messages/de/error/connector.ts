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
  "error.connector.bitwardenHostInput":
    "Gib eine HTTPS-Serveradresse, client_id und client_secret des API-Schlüssels und das Master-Passwort ein.",
  "error.connector.bitwardenHostFailed":
    "Bitwarden konnte auf diesem Server nicht geöffnet werden. Prüfe die Serveradresse, den API-Schlüssel und das Master-Passwort und stelle sicher, dass ein Ordner Shared with OpenBot heißt. Verbinde dann erneut.",
  "error.connector.bitwardenCliInstallFailed":
    "Die Bitwarden CLI konnte auf diesem Server nicht installiert werden. Prüfe seine Netzwerkverbindung und verbinde dann erneut.",
  "error.connector.bitwardenFileUnreadable": "Die Bitwarden-Verbindungsdatei ist nicht lesbar.",
  "error.connector.telegramAccountCredentialsMissing":
    "Gib die api_id und den api_hash deiner Telegram-App ein. Du erhältst sie auf my.telegram.org.",
  "error.connector.telegramAccountCredentialsInvalid":
    "Die api_id ist eine Zahl, und der api_hash hat 32 Zeichen aus 0-9 und a-f. Kopiere beide erneut von my.telegram.org.",
  "error.connector.telegramAccountApiRejected":
    "Telegram akzeptiert diese api_id und diesen api_hash nicht. Kopiere beide erneut von my.telegram.org.",
  "error.connector.telegramAccountPhoneFormat":
    "Gib die Telefonnummer mit Ländervorwahl ein, zum Beispiel +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid":
    "Telegram kennt diese Nummer nicht. Gib die Ländervorwahl mit an, zum Beispiel +48.",
  "error.connector.telegramAccountCodeInvalid": "Dieser Code ist nicht richtig. Prüfe ihn und versuche es erneut.",
  "error.connector.telegramAccountCodeEmpty": "Gib den Code ein, den Telegram dir gesendet hat.",
  "error.connector.telegramAccountCodeExpired":
    "Der Code ist abgelaufen. Starte erneut, um einen neuen Code zu erhalten.",
  "error.connector.telegramAccountPasswordInvalid": "Dieses Passwort ist nicht richtig. Versuche es erneut.",
  "error.connector.telegramAccountPasswordEmpty": "Gib dein Passwort für die zweistufige Bestätigung ein.",
  "error.connector.telegramAccountPasswordNeeded": "Telegram braucht dein Passwort für die zweistufige Bestätigung.",
  "error.connector.telegramAccountNoAccount":
    "Zu dieser Nummer gibt es kein Telegram-Konto. Melde dich mit einer Nummer an, die Telegram bereits nutzt.",
  "error.connector.telegramAccountPhoneBanned": "Telegram hat diese Nummer gesperrt.",
  "error.connector.telegramAccountQrExpired": "Der QR-Code ist abgelaufen, bevor du ihn gescannt hast. Starte erneut.",
  "error.connector.telegramAccountFloodWait": "Telegram bittet dich zu warten. Versuche es in {count} Min. erneut.",
  "error.connector.telegramAccountCancelled": "Die Telegram-Anmeldung wurde abgebrochen.",
  "error.connector.telegramAccountTimedOut":
    "Die Anmeldung wurde nach 10 Minuten ohne Aktivität beendet. Starte erneut.",
  "error.connector.telegramAccountMovedOn": "Die Anmeldung ist bei einem anderen Schritt. Starte erneut.",
  "error.connector.telegramAccountRefused": "Telegram hat die Anmeldung abgelehnt: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot konnte die Telegram-Verbindung nicht speichern: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram hat diese Sitzung beendet, zum Beispiel unter Einstellungen > Geräte. Verbinde dein Telegram-Konto erneut.",
  "error.connector.telegramAccountFileUnreadable": "Die Verbindungsdatei des Telegram-Kontos ist nicht lesbar.",
  "error.connector.telegramAccountFileTooLarge": "Die Verbindungsdatei des Telegram-Kontos ist zu groß.",
  "error.connector.whatsappAccountPhoneFormat":
    "Gib die Telefonnummer mit Ländervorwahl ein, zum Beispiel +48 600 100 200.",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp hat keinen Code ausgegeben: {detail}",
  "error.connector.whatsappAccountQrExpired": "Der Code ist abgelaufen, bevor du ihn verwendet hast. Starte erneut.",
  "error.connector.whatsappAccountTimedOut":
    "Die Verknüpfung wurde nach 10 Minuten ohne Aktivität beendet. Starte erneut.",
  "error.connector.whatsappAccountMovedOn": "Die Verknüpfung ist bei einem anderen Schritt. Starte erneut.",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp hat dieses Gerät nicht verknüpft: {detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot konnte die WhatsApp-Verbindung nicht speichern: {detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp hat dieses Gerät entfernt, zum Beispiel unter Einstellungen > Verknüpfte Geräte. Verknüpfe dein WhatsApp-Konto erneut.",
  "error.connector.whatsappAccountReplaced":
    "Ein anderes Programm hat dieses verknüpfte Gerät geöffnet, deshalb hat WhatsApp die Verbindung hier geschlossen. Trenne es, dann verknüpfe es erneut.",
  "error.connector.whatsappAccountForbidden":
    "WhatsApp hat dieses Gerät abgelehnt. Deine Nummer kann eingeschränkt sein. Prüfe WhatsApp auf deinem Telefon.",
  "error.connector.whatsappAccountOutdated":
    "WhatsApp akzeptiert diese Version der Verbindung nicht mehr. Aktualisiere OpenBot, dann verknüpfe erneut.",
  "error.connector.whatsappAccountOffline":
    "WhatsApp ist gerade nicht erreichbar. OpenBot versucht es erneut. Agenten können die Chats auf diesem Computer weiterhin lesen.",
  "error.connector.whatsappAccountFileUnreadable": "Die Verbindungsdatei des WhatsApp-Kontos ist nicht lesbar.",
} as const satisfies PartialTranslation<typeof source>;
