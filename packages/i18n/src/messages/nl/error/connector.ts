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
  "error.connector.githubOffline":
    "OpenBot kan GitHub niet bereiken. Controleer de internetverbinding en de DNS-instellingen van de computer of server waarop OpenBot draait en probeer het opnieuw.",
  "error.connector.githubExpired": "De verbinding met GitHub is verlopen. Verbind GitHub opnieuw.",
  "error.connector.githubFileUnreadable": "Het verbindingsbestand van GitHub is onleesbaar.",
  "error.connector.githubFileTooLarge": "Het verbindingsbestand van GitHub is te groot.",
  "error.connector.nearSignIn": "Log in bij OpenBot om de cryptowallet te gebruiken.",
  "error.connector.nearServiceUnavailable": "De cryptowalletdienst is niet beschikbaar. Probeer het later opnieuw.",
  "error.connector.nearWalletNotFound": "Deze wallet hoort niet bij dit OpenBot-account of deze server.",
  "error.connector.nearWalletLimit": "Vandaag zijn er te veel nieuwe wallets gemaakt. Probeer het morgen opnieuw.",
  "error.connector.nearProviderBusy": "NEAR Intents antwoordt nu niet. Probeer het over een paar minuten opnieuw.",
  "error.connector.nearNoWallet":
    "Er is geen cryptowallet ingesteld. Stel hem in via Serverinstellingen > Kluis > Crypto.",
  "error.connector.nearWalletExists": "Er is al een cryptowallet ingesteld.",
  "error.connector.nearFrozen":
    "Betalingen uit de cryptowallet zijn gepauzeerd. Hervat ze in Serverinstellingen > Kluis > Crypto.",
  "error.connector.nearAgentNotAllowed":
    "Deze agent kan niet betalen uit de cryptowallet. Sta het toe in Serverinstellingen > Kluis > Crypto.",
  "error.connector.nearGrantExpired":
    "OpenBot heeft geen betaaltoestemming voor de cryptowallet. Verleng die in Serverinstellingen > Kluis > Crypto.",
  "error.connector.nearUnknownAsset": "De cryptowallet heeft geen asset {asset}.",
  "error.connector.nearAmountInvalid": "{amount} is geen geldig bedrag in {asset}.",
  "error.connector.nearRecipientInvalid": "{recipient} is geen NEAR-account en geen chain:address.",
  "error.connector.nearRefused": "De NEAR Intents Agent API heeft het verzoek geweigerd: {detail}",
  "error.connector.nearUnexpected": "De NEAR Intents Agent API gaf een onverwacht antwoord: {detail}",
  "error.connector.nearUnreachable": "OpenBot kan de NEAR Intents Agent API niet bereiken: {detail}",
  "error.connector.nearFileUnreadable": "Het cryptowalletbestand is onleesbaar.",
  "error.connector.nearFileTooLarge": "Het cryptowalletbestand is te groot.",
  "error.connector.nearSigningCanceled": "De handtekening is geannuleerd.",
  "error.connector.nearSigningExpired": "De handtekening kwam niet op tijd aan. Probeer het opnieuw.",
  "error.connector.nearSigningInvalid": "De handtekening uit de browser is niet geldig.",
  "error.connector.nearSigningBusy":
    "Er wacht al een andere handtekening in de browser. Rond die eerst af of annuleer hem.",
  "error.connector.nearPolicyCooldown": "Je kunt de walletregels vanaf {time} weer wijzigen.",
  "error.connector.nearPolicyPending": "De regelwijziging is niet afgerond. Probeer het over een paar minuten opnieuw.",
  "error.connector.nearDeclined": "De eigenaar heeft de betaling geweigerd.",
  "error.connector.nearUncertain":
    "OpenBot weet niet of de betaling is verzonden. Betaal niet opnieuw. De eigenaar kan de geschiedenis van de wallet controleren.",
  "error.connector.nearPaymentFailed": "De betaling is mislukt: {detail}",
  "error.connector.nearPaymentUnknown": "Deze betaling wacht niet meer op een antwoord.",
  "error.connector.nearRuleFull": "Een betaalregel kan maximaal {limit} ontvangers hebben.",
  "error.connector.nearRulesFull": "De wallet kan maximaal {limit} betaalregels hebben.",
  "error.connector.onePasswordCliMissing":
    "OpenBot kan de 1Password-CLI niet vinden. Installeer deze en zet de integratie aan in de 1Password-app, of gebruik een token van een serviceaccount.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot kon de 1Password-CLI niet installeren. Controleer de internetverbinding en probeer het opnieuw.",
  "error.connector.onePasswordCliSignedOut":
    "De 1Password-CLI is niet ingelogd. Zet de integratie aan in de 1Password-app en verbind opnieuw.",
  "error.connector.onePasswordAppUnreachable":
    "OpenBot kan de 1Password-app niet bereiken. Open 1Password en ontgrendel het. Controleer in Instellingen > Ontwikkelaar dat “Integreren met 1Password CLI” aan staat. Probeer het dan opnieuw.",
  "error.connector.onePasswordCliFailed": "De 1Password-CLI is mislukt: {detail}",
  "error.connector.onePasswordCliForbidden":
    "Je 1Password-account staat niet toe dat je de gedeelde kluis of een serviceaccount maakt. Vraag een eigenaar of beheerder van het account om deze toestemming, of vraag om een token van een serviceaccount en klik op “Gebruik token”.",
  "error.connector.onePasswordUnexpected": "1Password gaf een onverwacht antwoord: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password heeft het token van het serviceaccount niet geaccepteerd.",
  "error.connector.onePasswordUnreachable":
    "OpenBot kon geen verbinding maken met 1Password. Controleer de internetverbinding en probeer het opnieuw.",
  "error.connector.onePasswordRateLimited":
    "1Password heeft te veel verzoeken ontvangen. Wacht een paar minuten en probeer het opnieuw.",
  "error.connector.onePasswordNoVault":
    "Het serviceaccount kan geen kluis lezen. Geef het toegang tot een kluis en probeer het opnieuw.",
  "error.connector.onePasswordReadFailed":
    "OpenBot kan je logins in 1Password niet lezen. Verbreek de verbinding met 1Password en maak daarna opnieuw verbinding.",
  "error.connector.onePasswordFileUnreadable": "Het verbindingsbestand van 1Password is onleesbaar.",
  "error.connector.onePasswordFileTooLarge": "Het verbindingsbestand van 1Password is te groot.",
  "error.connector.bitwardenFailed":
    "Kan Bitwarden niet lezen. Installeer de bw-CLI, log in, ontgrendel deze en maak één map met de naam Shared with OpenBot. Verbind met een nieuwe sessiesleutel.",
  "error.connector.bitwardenCliMissing":
    "OpenBot kan de Bitwarden CLI niet vinden. Installeer bw, controleer dat het in een nieuwe terminal werkt en maak daarna opnieuw verbinding.",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden moet precies één map met de naam Shared with OpenBot hebben. Maak die map of verwijder de extra map en maak daarna opnieuw verbinding.",
  "error.connector.bitwardenHostInput":
    "Voer een HTTPS-serveradres, de client_id en client_secret van de API-sleutel en het hoofdwachtwoord in.",
  "error.connector.bitwardenHostFailed":
    "Kan Bitwarden niet openen op deze server. Controleer het serveradres, de API-sleutel en het hoofdwachtwoord, en zorg dat één map de naam Shared with OpenBot heeft. Verbind daarna opnieuw.",
  "error.connector.bitwardenHostSignInFailed":
    "Kan niet inloggen bij Bitwarden op deze server. Controleer het serveradres en de API-sleutel en verbind opnieuw.",
  "error.connector.bitwardenHostUnlockFailed":
    "Kan Bitwarden niet ontgrendelen op deze server. Controleer het hoofdwachtwoord en verbind opnieuw.",
  "error.connector.bitwardenCliInstallFailed":
    "Kan de Bitwarden-CLI niet installeren op deze server. Controleer de netwerkverbinding en verbind opnieuw.",
  "error.connector.bitwardenFileUnreadable": "Het verbindingsbestand van Bitwarden is onleesbaar.",
  "error.connector.passwordManagerUnknown": "OpenBot kent deze wachtwoordbeheerder niet.",
  "error.connector.passwordManagerMethod": "Deze wachtwoordbeheerder kan niet op deze manier verbinden.",
  "error.connector.passwordManagerNoSignIn": "Er is geen aanmeldpagina open. Verbind opnieuw.",
  "error.connector.protonPassFailed": "Kan Proton Pass niet verbinden. Verbind opnieuw.",
  "error.connector.protonPassCliInstallFailed":
    "Kan de Proton Pass CLI niet installeren. Controleer de netwerkverbinding en verbind daarna opnieuw.",
  "error.connector.protonPassPlan":
    "Je Proton-abonnement staat de Proton Pass CLI niet toe. Wijzig het abonnement en verbind daarna opnieuw.",
  "error.connector.protonPassPlanMissing":
    "Je Proton-abonnement bevat de Proton Pass CLI niet. Daarvoor is een Proton-abonnement nodig waarin Pass Plus zit. Wijzig het abonnement en verbind daarna opnieuw.",
  "error.connector.protonPassExpired": "De toegang tot Proton Pass is beëindigd. Verbind opnieuw.",
  "error.connector.protonPassKeyInvalid": "Voer een Proton Pass-toegangssleutel in die met pst_ begint.",
  "error.connector.protonPassExtraPassword": "Het extra wachtwoord is onjuist. Voer het opnieuw in.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass heeft niet om een extra wachtwoord gevraagd.",
  "error.connector.protonPassFileUnreadable": "Het Proton Pass-verbindingsbestand is onleesbaar.",
  "error.connector.protonPassSignInTimeout": "Het aanmelden bij Proton duurde te lang. Verbind opnieuw.",
  "error.connector.protonPassSetupFailed":
    "Kan de kluis Shared with OpenBot of de toegangssleutel ervan niet maken in Proton Pass. Verbind opnieuw.",
} as const satisfies PartialTranslation<typeof source>;
