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
  "error.connector.githubOffline":
    "OpenBot kann GitHub nicht erreichen. Prüfe die Internetverbindung und die DNS-Einstellungen des Computers oder Servers, auf dem OpenBot läuft, und versuche es dann erneut.",
  "error.connector.githubExpired": "Die GitHub-Verbindung ist abgelaufen. Verbinde GitHub erneut.",
  "error.connector.githubFileUnreadable": "Die GitHub-Verbindungsdatei ist nicht lesbar.",
  "error.connector.githubFileTooLarge": "Die GitHub-Verbindungsdatei ist zu groß.",
  "error.connector.nearSignIn": "Melde dich bei OpenBot an, um die Krypto-Wallet zu verwenden.",
  "error.connector.nearServiceUnavailable": "Der Krypto-Wallet-Dienst ist nicht verfügbar. Versuche es später erneut.",
  "error.connector.nearWalletNotFound": "Diese Wallet gehört nicht zu diesem OpenBot-Konto oder Server.",
  "error.connector.nearWalletLimit": "Heute wurden zu viele neue Wallets erstellt. Versuche es morgen erneut.",
  "error.connector.nearProviderBusy": "NEAR Intents antwortet gerade nicht. Versuche es in ein paar Minuten erneut.",
  "error.connector.nearNoWallet":
    "Es ist keine Krypto-Wallet eingerichtet. Richte sie unter Servereinstellungen > Vault > Krypto ein.",
  "error.connector.nearWalletExists": "Eine Krypto-Wallet ist bereits eingerichtet.",
  "error.connector.nearFrozen":
    "Zahlungen aus der Krypto-Wallet sind pausiert. Setze sie unter Servereinstellungen > Vault > Krypto fort.",
  "error.connector.nearAgentNotAllowed":
    "Dieser Agent kann nicht aus der Krypto-Wallet zahlen. Erlaube es unter Servereinstellungen > Vault > Krypto.",
  "error.connector.nearGrantExpired":
    "OpenBot hat keine Zahlungsfreigabe für die Krypto-Wallet. Erneuere sie unter Servereinstellungen > Vault > Krypto.",
  "error.connector.nearUnknownAsset": "Die Krypto-Wallet hat kein Asset {asset}.",
  "error.connector.nearAmountInvalid": "{amount} ist kein gültiger Betrag in {asset}.",
  "error.connector.nearRecipientInvalid": "{recipient} ist kein NEAR-Konto und keine chain:address.",
  "error.connector.nearRefused": "Die NEAR Intents Agent API hat die Anfrage abgelehnt: {detail}",
  "error.connector.nearUnexpected": "Die NEAR Intents Agent API hat eine unerwartete Antwort gesendet: {detail}",
  "error.connector.nearUnreachable": "OpenBot kann die NEAR Intents Agent API nicht erreichen: {detail}",
  "error.connector.nearFileUnreadable": "Die Krypto-Wallet-Datei ist nicht lesbar.",
  "error.connector.nearFileTooLarge": "Die Krypto-Wallet-Datei ist zu groß.",
  "error.connector.nearSigningCanceled": "Die Signatur wurde abgebrochen.",
  "error.connector.nearSigningExpired": "Die Signatur kam nicht rechtzeitig an. Versuche es erneut.",
  "error.connector.nearSigningInvalid": "Die Signatur aus dem Browser ist nicht gültig.",
  "error.connector.nearSigningBusy":
    "Im Browser wartet bereits eine andere Signatur. Schließe sie zuerst ab oder brich sie ab.",
  "error.connector.nearPolicyCooldown": "Du kannst die Wallet-Regeln ab {time} wieder ändern.",
  "error.connector.nearPolicyPending":
    "Die Regeländerung wurde nicht abgeschlossen. Versuche es in ein paar Minuten erneut.",
  "error.connector.nearDeclined": "Der Eigentümer hat die Zahlung abgelehnt.",
  "error.connector.nearUncertain":
    "OpenBot weiß nicht, ob die Zahlung gesendet wurde. Zahle nicht noch einmal. Der Eigentümer kann den Verlauf der Wallet prüfen.",
  "error.connector.nearPaymentFailed": "Die Zahlung ist fehlgeschlagen: {detail}",
  "error.connector.nearPaymentUnknown": "Diese Zahlung wartet nicht mehr auf eine Antwort.",
  "error.connector.nearRuleFull": "Eine Zahlungsregel kann höchstens {limit} Empfänger haben.",
  "error.connector.nearRulesFull": "Die Wallet kann höchstens {limit} Zahlungsregeln haben.",
  "error.connector.onePasswordCliMissing":
    "OpenBot kann die 1Password CLI nicht finden. Installiere sie und aktiviere ihre Integration in der 1Password-App oder verwende ein Dienstkonto-Token.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot konnte die 1Password CLI nicht installieren. Prüfe die Internetverbindung und versuche es erneut.",
  "error.connector.onePasswordCliSignedOut":
    "Die 1Password CLI ist nicht angemeldet. Aktiviere ihre Integration in der 1Password-App und verbinde sie erneut.",
  "error.connector.onePasswordAppUnreachable":
    "OpenBot erreicht die 1Password-App nicht. Öffne 1Password und entsperre es. Prüfe unter Einstellungen > Entwickler, dass „In 1Password CLI integrieren“ aktiv ist. Versuche es dann erneut.",
  "error.connector.onePasswordCliFailed": "Die 1Password CLI ist fehlgeschlagen: {detail}",
  "error.connector.onePasswordCliForbidden":
    "Dein 1Password-Konto erlaubt dir nicht, den geteilten Tresor oder ein Dienstkonto zu erstellen. Bitte einen Inhaber oder Administrator des Kontos um diese Berechtigung, oder bitte ihn um ein Dienstkonto-Token und klicke auf „Token verwenden“.",
  "error.connector.onePasswordUnexpected": "1Password hat eine unerwartete Antwort gesendet: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password hat das Dienstkonto-Token nicht akzeptiert.",
  "error.connector.onePasswordUnreachable":
    "OpenBot konnte keine Verbindung zu 1Password herstellen. Prüfe die Internetverbindung und versuche es erneut.",
  "error.connector.onePasswordRateLimited":
    "1Password hat zu viele Anfragen erhalten. Warte ein paar Minuten und versuche es erneut.",
  "error.connector.onePasswordRequestLimit":
    "1Password hat zu viele Anfragen von Dienstkonten erhalten. Versuche es in 1 Stunde erneut. Wenn es weiter fehlschlägt, hat dein 1Password-Konto sein Tageslimit erreicht: Versuche es in 24 Stunden erneut. Alle Dienstkonten deines Kontos zählen zu diesem Limit.",
  "error.connector.onePasswordNoVault":
    "Das Dienstkonto kann keinen Tresor lesen. Gib ihm Zugriff auf einen Tresor und versuche es erneut.",
  "error.connector.onePasswordReadFailed":
    "OpenBot kann deine Logins in 1Password nicht lesen. Trenne 1Password und verbinde es dann erneut.",
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
  "error.connector.bitwardenHostSignInFailed":
    "Die Anmeldung bei Bitwarden auf diesem Server ist fehlgeschlagen. Prüfe die Serveradresse und den API-Schlüssel und verbinde dann erneut.",
  "error.connector.bitwardenHostUnlockFailed":
    "Bitwarden konnte auf diesem Server nicht entsperrt werden. Prüfe das Master-Passwort und verbinde dann erneut.",
  "error.connector.bitwardenCliInstallFailed":
    "Die Bitwarden CLI konnte auf diesem Server nicht installiert werden. Prüfe seine Netzwerkverbindung und verbinde dann erneut.",
  "error.connector.bitwardenCliCannotStart":
    "Die Bitwarden CLI ist auf diesem Server nicht gestartet. Verbinde erneut. Wenn sie dann noch nicht startet, wähle Hilfe > Problem melden.",
  "error.connector.bitwardenFileUnreadable": "Die Bitwarden-Verbindungsdatei ist nicht lesbar.",
  "error.connector.passwordManagerUnknown": "OpenBot kennt diesen Passwortmanager nicht.",
  "error.connector.passwordManagerMethod": "Dieser Passwortmanager kann sich so nicht verbinden.",
  "error.connector.passwordManagerNoSignIn": "Keine Anmeldeseite ist offen. Verbinde erneut.",
  "error.connector.protonPassFailed": "Proton Pass konnte nicht verbunden werden. Verbinde erneut.",
  "error.connector.protonPassCliInstallFailed":
    "Die Proton Pass CLI konnte nicht installiert werden. Prüfe die Netzwerkverbindung und verbinde dann erneut.",
  "error.connector.protonPassPlan":
    "Dein Proton-Tarif erlaubt die Proton Pass CLI nicht. Ändere den Tarif und verbinde dann erneut.",
  "error.connector.protonPassPlanMissing":
    "Dein Proton-Tarif enthält die Proton Pass CLI nicht. Sie braucht einen Proton-Tarif, der Pass Plus enthält. Ändere den Tarif und verbinde dann erneut.",
  "error.connector.protonPassExpired": "Der Zugriff auf Proton Pass ist abgelaufen. Verbinde erneut.",
  "error.connector.protonPassKeyInvalid": "Gib einen Proton Pass-Zugriffsschlüssel ein, der mit pst_ beginnt.",
  "error.connector.protonPassExtraPassword": "Das zusätzliche Passwort ist nicht korrekt. Gib es erneut ein.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass hat nicht nach einem zusätzlichen Passwort gefragt.",
  "error.connector.protonPassFileUnreadable": "Die Proton Pass-Verbindungsdatei ist nicht lesbar.",
  "error.connector.protonPassSignInTimeout": "Die Proton-Anmeldung hat zu lange gedauert. Verbinde erneut.",
  "error.connector.protonPassSetupFailed":
    "Der Tresor Shared with OpenBot oder sein Zugriffsschlüssel konnte in Proton Pass nicht erstellt werden. Verbinde erneut.",
} as const satisfies PartialTranslation<typeof source>;
