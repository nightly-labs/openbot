import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "Die Einrichtung der Berechtigungen ist unter macOS verfügbar.",
  "status.remote.setupInstallHost": "Installiere die Host-Komponente des Remote-Desktops und prüfe erneut.",
  "status.remote.setupUpdateRuntime":
    "Aktualisiere die Remote-Desktop-Laufzeit, um die macOS-Berechtigungen zu prüfen.",
  "status.remote.setupCheckFailed":
    "Sunshine konnte die Berechtigungsprüfung nicht abschließen. Prüfe die Host-Sitzung und versuche es erneut.",
  "status.remote.setupServiceFailed":
    "Der Remote-Desktop-Dienst konnte nicht starten. Prüfe, ob dieser macOS-Benutzer eine aktive grafische Sitzung hat.",
  "status.remote.connectingSunshine": "Verbindung über Sunshine wird hergestellt…",
  "status.remote.switchingMonitor": "Geteilter Monitor wird gewechselt…",
  "status.remote.controlConnected": "Fernsteuerung verbunden.",
  "status.remote.controlFailed": "Fernsteuerung fehlgeschlagen.",
  "status.remote.stagePreferences": "Lokale Chateinstellungen werden geladen: {reason}",
  "status.remote.stageConnection": "Verbindung zum Desktop wird hergestellt: {reason}",
  "status.remote.stageCompatibility": "Desktop-Kompatibilität wird geprüft: {reason}",
  "status.remote.stageAgents": "Agenten werden geladen: {reason}",
  "status.remote.stageReads": "Lesestatus wird geladen: {reason}",
  "status.remote.stageConversations": "Unterhaltungen werden geladen: {reason}",
  "status.remote.suspendedDetail":
    "Aktualisiere OpenBot Mobile oder die Desktop-App, bevor du dich verbindest.\n{detail}",
  "status.remote.cooldownDetail":
    "Verbindung nach {limit} Versuchen fehlgeschlagen. Neuer Versuch in {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Verbindung nach {limit} Versuchen fehlgeschlagen. Neuer Versuch in {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Verbindung verloren. Neuer Versuch in {count} s.\n{detail}",
    other: "Verbindung verloren. Neuer Versuch in {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Verbindung verloren. Neuer Versuch in {count} s.",
    other: "Verbindung verloren. Neuer Versuch in {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Verbindungsversuch fehlgeschlagen. Neuer Versuch in {count} s.\n{detail}",
    other: "Verbindungsversuch fehlgeschlagen. Neuer Versuch in {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Verbindungsversuch fehlgeschlagen. Neuer Versuch in {count} s.",
    other: "Verbindungsversuch fehlgeschlagen. Neuer Versuch in {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Verbindung wird wiederhergestellt {attempt}/{count}\n{detail}",
    other: "Verbindung wird wiederhergestellt {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Verbindung wird wiederhergestellt {attempt}/{count}",
    other: "Verbindung wird wiederhergestellt {attempt}/{count}",
  },
} as const satisfies PartialTranslation<typeof source>;
