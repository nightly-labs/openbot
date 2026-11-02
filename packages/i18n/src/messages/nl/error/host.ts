import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal heeft geen ICE-servers gegeven.",
  "error.host.keyRotationUnavailable": "Deze server kan de sleutel niet wijzigen zonder de accountservice.",
  "error.host.keyRotationRefused":
    "De accountservice heeft de nieuwe serversleutel niet geaccepteerd. De huidige sleutel blijft in gebruik.",
  "error.host.webRtcNotConfigured": "De WebRTC-hostservice is niet geconfigureerd.",
  "error.host.runtimeNotInstalled": "De runtime voor extern bureaublad is niet geïnstalleerd.",
  "error.host.setupUnavailable": "Instellen van toestemmingen is niet beschikbaar.",
  "error.host.accountChangedDuringUpdate": "Het ingelogde account is gewijzigd terwijl deze server werd bijgewerkt.",
  "error.host.nameBeforePublish": "Geef deze OpenBot een naam voordat je hem publiceert.",
  "error.host.memberNotFound": "Het externe lid bestaat niet.",
  "error.host.publishBeforeInvite": "Maak deze OpenBot openbaar voordat je een uitnodiging maakt.",
  "error.host.teamAccessUnavailable": "Je teamtoegang is niet beschikbaar.",
  "error.host.ownerIdentityUnavailable": "De identiteit van de eigenaar van de host is niet beschikbaar.",
  "error.host.reserveAddressFailed": "Kan het openbare adres niet reserveren.",
  "error.host.publishFailed": "Deze OpenBot kon niet worden gepubliceerd.",
  "error.host.mobileConnectPublishFailed": "Deze OpenBot kon niet worden gepubliceerd voor Mobile Connect.",
  "error.host.mobileConnectHostChanged": "De host voor Mobile Connect is gewijzigd. Probeer het opnieuw.",
  "error.host.noServer": "Deze computer heeft geen server om te wijzigen.",
  "error.host.identityLocalOnly":
    "De naam en het logo van de server kun je alleen wijzigen op de computer waarop de server draait.",
  "error.host.timezoneInvalid": "Deze tijdzone is onbekend.",
  "error.host.maintenanceInterrupted":
    "Onderhoud van de host is onderbroken. Controleer de app en zet de status van de host terug voordat je het opnieuw probeert.",
  "error.host.updateFailed":
    "Update van de host is mislukt tijdens {phase}. Controleer het eigendom van de bundel, de ondertekening, de status van tenants en de vrije schijfruimte voordat je de status terugzet.",
  "error.host.tenantsNotIdle": "Tenants zijn binnen twee uur niet vijf minuten inactief gebleven.",
  "error.host.tenantShutdownTimeout": "Het afsluiten van tenants duurde te lang. Er is geen app vervangen.",
  "error.host.tenantHealthMissing":
    "Statusrapporten van tenants ontbreken of zijn niet in orde na de herstart. Controleer de sessies van tenants voor een volgende update.",
} as const satisfies PartialTranslation<typeof source>;
