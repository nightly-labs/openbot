import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "Deze build van OpenBot heeft geen GitHub-app.",
  "error.connector.githubDenied": "Het inloggen bij GitHub is geweigerd.",
  "error.connector.githubCodeExpired": "De GitHub-code is verlopen. Verbind GitHub opnieuw.",
  "error.connector.githubDeviceFlowDisabled": "De GitHub-app staat inloggen via een apparaat niet toe.",
  "error.connector.githubClientUnknown": "GitHub kent de Client ID van deze GitHub-app niet.",
  "error.connector.githubUnexpected": "GitHub gaf een onverwacht antwoord: {detail}",
  "error.connector.githubUnreachable": "OpenBot kan GitHub niet bereiken: {detail}",
  "error.connector.githubExpired": "De verbinding met GitHub is verlopen. Verbind GitHub opnieuw.",
  "error.connector.githubFileUnreadable": "Het verbindingsbestand van GitHub is onleesbaar.",
  "error.connector.githubFileTooLarge": "Het verbindingsbestand van GitHub is te groot.",
  "error.connector.onePasswordCliMissing":
    "OpenBot kan de 1Password-CLI niet vinden. Installeer deze en zet de integratie aan in de 1Password-app, of gebruik een token van een serviceaccount.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot kon de 1Password-CLI niet installeren. Controleer de internetverbinding en probeer het opnieuw.",
  "error.connector.onePasswordCliSignedOut":
    "De 1Password-CLI is niet ingelogd. Zet de integratie aan in de 1Password-app en verbind opnieuw.",
  "error.connector.onePasswordCliFailed": "De 1Password-CLI is mislukt: {detail}",
  "error.connector.onePasswordUnexpected": "1Password gaf een onverwacht antwoord: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password heeft het token van het serviceaccount niet geaccepteerd.",
  "error.connector.onePasswordNoVault":
    "Het serviceaccount kan geen kluis lezen. Geef het toegang tot een kluis en probeer het opnieuw.",
  "error.connector.onePasswordFileUnreadable": "Het verbindingsbestand van 1Password is onleesbaar.",
  "error.connector.onePasswordFileTooLarge": "Het verbindingsbestand van 1Password is te groot.",
  "error.connector.bitwardenFailed":
    "Kan Bitwarden niet lezen. Installeer de bw-CLI, log in, ontgrendel deze en maak één map met de naam Shared with OpenBot. Verbind met een nieuwe sessiesleutel.",
  "error.connector.bitwardenHostInput":
    "Voer een HTTPS-serveradres, de client_id en client_secret van de API-sleutel en het hoofdwachtwoord in.",
  "error.connector.bitwardenHostFailed":
    "Kan Bitwarden niet openen op deze server. Controleer het serveradres, de API-sleutel en het hoofdwachtwoord, en zorg dat één map de naam Shared with OpenBot heeft. Verbind daarna opnieuw.",
  "error.connector.bitwardenCliInstallFailed":
    "Kan de Bitwarden-CLI niet installeren op deze server. Controleer de netwerkverbinding en verbind opnieuw.",
  "error.connector.bitwardenFileUnreadable": "Het verbindingsbestand van Bitwarden is onleesbaar.",
  "error.connector.telegramAccountCredentialsMissing":
    "Voer de api_id en api_hash van je Telegram-app in. Je vindt ze op my.telegram.org.",
  "error.connector.telegramAccountCredentialsInvalid":
    "De api_id is een getal en de api_hash heeft 32 tekens uit 0-9 en a-f. Kopieer ze opnieuw van my.telegram.org.",
  "error.connector.telegramAccountApiRejected":
    "Telegram accepteert deze api_id en api_hash niet. Kopieer ze opnieuw van my.telegram.org.",
  "error.connector.telegramAccountPhoneFormat":
    "Voer het telefoonnummer in met de landcode, bijvoorbeeld +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid":
    "Telegram kent dit nummer niet. Voeg de landcode toe, bijvoorbeeld +48.",
  "error.connector.telegramAccountCodeInvalid": "Deze code klopt niet. Controleer hem en probeer het opnieuw.",
  "error.connector.telegramAccountCodeEmpty": "Voer de code in die Telegram je heeft gestuurd.",
  "error.connector.telegramAccountCodeExpired": "De code is verlopen. Begin opnieuw om een nieuwe code te krijgen.",
  "error.connector.telegramAccountPasswordInvalid": "Dit wachtwoord klopt niet. Probeer het opnieuw.",
  "error.connector.telegramAccountPasswordEmpty": "Voer je wachtwoord voor verificatie in twee stappen in.",
  "error.connector.telegramAccountPasswordNeeded":
    "Telegram heeft je wachtwoord voor verificatie in twee stappen nodig.",
  "error.connector.telegramAccountNoAccount":
    "Dit nummer heeft geen Telegram-account. Log in met een nummer dat Telegram al gebruikt.",
  "error.connector.telegramAccountPhoneBanned": "Telegram heeft dit nummer geblokkeerd.",
  "error.connector.telegramAccountQrExpired": "De QR-code is verlopen voordat je hem scande. Begin opnieuw.",
  "error.connector.telegramAccountFloodWait": "Telegram vraagt je te wachten. Probeer het over {count} min. opnieuw.",
  "error.connector.telegramAccountCancelled": "Het inloggen bij Telegram is geannuleerd.",
  "error.connector.telegramAccountTimedOut": "Het inloggen is gestopt na 10 minuten zonder activiteit. Begin opnieuw.",
  "error.connector.telegramAccountMovedOn": "Het inloggen is naar een andere stap gegaan. Begin opnieuw.",
  "error.connector.telegramAccountRefused": "Telegram heeft het inloggen geweigerd: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot kan de Telegram-verbinding niet opslaan: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram heeft deze sessie beëindigd, bijvoorbeeld in Instellingen > Apparaten. Verbind je Telegram-account opnieuw.",
  "error.connector.telegramAccountFileUnreadable": "Het verbindingsbestand van het Telegram-account is onleesbaar.",
  "error.connector.telegramAccountFileTooLarge": "Het verbindingsbestand van het Telegram-account is te groot.",
  "error.connector.whatsappAccountPhoneFormat":
    "Voer het telefoonnummer in met de landcode, bijvoorbeeld +48 600 100 200.",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp gaf geen code: {detail}",
  "error.connector.whatsappAccountQrExpired": "De code is verlopen voordat je hem gebruikte. Begin opnieuw.",
  "error.connector.whatsappAccountTimedOut": "Het koppelen is gestopt na 10 minuten zonder activiteit. Begin opnieuw.",
  "error.connector.whatsappAccountMovedOn": "Het koppelen is naar een andere stap gegaan. Begin opnieuw.",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp heeft dit apparaat niet gekoppeld: {detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot kan de WhatsApp-verbinding niet opslaan: {detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp heeft dit apparaat verwijderd, bijvoorbeeld in Instellingen > Gekoppelde apparaten. Koppel je WhatsApp-account opnieuw.",
  "error.connector.whatsappAccountReplaced":
    "Een ander programma heeft dit gekoppelde apparaat geopend, dus WhatsApp heeft de verbinding hier gesloten. Ontkoppel en koppel daarna opnieuw.",
  "error.connector.whatsappAccountForbidden":
    "WhatsApp heeft dit apparaat geweigerd. Je nummer kan beperkt zijn. Controleer WhatsApp op je telefoon.",
  "error.connector.whatsappAccountOutdated":
    "WhatsApp accepteert deze versie van de verbinding niet meer. Werk OpenBot bij en koppel daarna opnieuw.",
  "error.connector.whatsappAccountOffline":
    "WhatsApp is nu niet bereikbaar. OpenBot probeert het opnieuw. Agents kunnen de chats op deze computer nog steeds lezen.",
  "error.connector.whatsappAccountFileUnreadable": "Het verbindingsbestand van het WhatsApp-account is onleesbaar.",
} as const satisfies PartialTranslation<typeof source>;
