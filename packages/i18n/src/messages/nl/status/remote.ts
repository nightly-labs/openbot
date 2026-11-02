import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "Instellen van toestemmingen is beschikbaar op macOS.",
  "status.remote.setupInstallHost": "Installeer het hostonderdeel voor extern bureaublad en controleer opnieuw.",
  "status.remote.setupUpdateRuntime":
    "Werk de runtime voor extern bureaublad bij om de macOS-toestemmingen te controleren.",
  "status.remote.setupCheckFailed":
    "Sunshine kon de controle van toestemmingen niet voltooien. Controleer de hostsessie en probeer het opnieuw.",
  "status.remote.setupServiceFailed":
    "De service voor extern bureaublad kon niet starten. Controleer of deze macOS-gebruiker een actieve GUI-sessie heeft.",
  "status.remote.connectingSunshine": "Verbinden via Sunshine…",
  "status.remote.switchingMonitor": "Gedeelde monitor wisselen…",
  "status.remote.controlConnected": "Bediening op afstand verbonden.",
  "status.remote.controlFailed": "Bediening op afstand mislukt.",
  "status.remote.stagePreferences": "Lokale chatvoorkeuren laden: {reason}",
  "status.remote.stageConnection": "Verbinden met de desktop: {reason}",
  "status.remote.stageCompatibility": "Compatibiliteit van de desktop controleren: {reason}",
  "status.remote.stageAgents": "Agents laden: {reason}",
  "status.remote.stageReads": "Leesstatus laden: {reason}",
  "status.remote.suspendedDetail": "Werk OpenBot Mobile of de desktop-app bij voordat je verbinding maakt.\n{detail}",
  "status.remote.cooldownDetail":
    "Verbinding mislukt na {limit} pogingen. Opnieuw proberen over {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Verbinding mislukt na {limit} pogingen. Opnieuw proberen over {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Verbinding verbroken. Opnieuw proberen over {count} s.\n{detail}",
    other: "Verbinding verbroken. Opnieuw proberen over {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Verbinding verbroken. Opnieuw proberen over {count} s.",
    other: "Verbinding verbroken. Opnieuw proberen over {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Verbindingspoging mislukt. Opnieuw proberen over {count} s.\n{detail}",
    other: "Verbindingspoging mislukt. Opnieuw proberen over {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Verbindingspoging mislukt. Opnieuw proberen over {count} s.",
    other: "Verbindingspoging mislukt. Opnieuw proberen over {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Opnieuw verbinden {attempt}/{count}\n{detail}",
    other: "Opnieuw verbinden {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Opnieuw verbinden {attempt}/{count}",
    other: "Opnieuw verbinden {attempt}/{count}",
  },
} as const satisfies PartialTranslation<typeof source>;
