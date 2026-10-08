import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal hat keine ICE-Server bereitgestellt.",
  "error.host.webRtcNotConfigured": "Der WebRTC-Hostdienst ist nicht eingerichtet.",
  "error.host.runtimeNotInstalled": "Die Remote-Desktop-Laufzeit ist nicht installiert.",
  "error.host.setupUnavailable": "Die Einrichtung der Berechtigungen ist nicht verfügbar.",
  "error.host.accountChangedDuringUpdate":
    "Das angemeldete Konto wurde während der Aktualisierung dieses Servers geändert.",
  "error.host.nameBeforePublish": "Gib diesem OpenBot einen Namen, bevor du ihn veröffentlichst.",
  "error.host.memberNotFound": "Das entfernte Mitglied existiert nicht.",
  "error.host.publishBeforeInvite": "Mache diesen OpenBot öffentlich, bevor du eine Einladung erstellst.",
  "error.host.teamAccessUnavailable": "Dein Teamzugriff ist nicht verfügbar.",
  "error.host.ownerIdentityUnavailable": "Die Identität des Host-Eigentümers ist nicht verfügbar.",
  "error.host.reserveAddressFailed": "Die öffentliche Adresse konnte nicht reserviert werden.",
  "error.host.publishFailed": "Dieser OpenBot konnte nicht veröffentlicht werden.",
  "error.host.mobileConnectPublishFailed": "Dieser OpenBot konnte nicht für Mobile Connect veröffentlicht werden.",
  "error.host.mobileConnectHostChanged": "Der Mobile-Connect-Host wurde geändert. Versuche es erneut.",
  "error.host.noServer": "Dieser Computer hat keinen Server, der geändert werden kann.",
  "error.host.identityLocalOnly":
    "Name und Logo des Servers können nur auf dem Computer geändert werden, auf dem er läuft.",
  "error.host.maintenanceInterrupted":
    "Die Host-Wartung wurde unterbrochen. Prüfe die Anwendung und setze den Host-Zustand zurück, bevor du es erneut versuchst.",
  "error.host.updateFailed":
    "Die Host-Aktualisierung ist während {phase} fehlgeschlagen. Prüfe Paketeigentümer, Signatur, Mandantenstatus und freien Speicherplatz, bevor du den Zustand zurücksetzt.",
  "error.host.tenantsNotIdle":
    "Die Mandanten waren innerhalb von zwei Stunden nicht fünf Minuten lang durchgehend inaktiv.",
  "error.host.tenantShutdownTimeout":
    "Die Zeit für das Herunterfahren der Mandanten ist abgelaufen. Der Austausch der Anwendung wurde nicht gestartet.",
  "error.host.tenantHealthMissing":
    "Nach dem Neustart fehlen Zustandsberichte der Mandanten oder sie melden Probleme. Prüfe die Mandantensitzungen vor einer weiteren Aktualisierung.",
} as const satisfies PartialTranslation<typeof source>;
