import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Nicht verbunden",
  "mobile.workspace.status.online": "Online",
  "mobile.workspace.status.offline": "Offline",
  "mobile.workspace.status.error": "Verbindungsfehler",
  "mobile.workspace.status.reconnecting": "Verbindung wird wiederhergestellt",
  "mobile.workspace.status.attempt": "Versuch {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Versuch ",
  "mobile.workspace.status.retryIn": "Neuer Versuch in {seconds} Sekunden",
  "mobile.workspace.section.agents": "Agenten",
  "mobile.workspace.error.directoryUnavailable": "Das Serververzeichnis ist nicht verfügbar.",
  "mobile.workspace.error.sectionsLoadFailed": "Abschnitte konnten nicht geladen werden. Versuche es erneut.",
  "mobile.workspace.error.transportNotReady": "Die mobile Übertragung ist nicht bereit.",
  "mobile.workspace.error.sectionsUnsupported": "Dieser Host unterstützt keine Änderungen an Abschnitten.",
  "mobile.workspace.error.leaveOwnServer": "Nur beigetretene Remote-Server können verlassen werden.",
  "mobile.workspace.error.removeOwnedServerOnly": "Nur der Eigentümer kann diesen Server entfernen.",
  "mobile.workspace.error.agentNotOnHost": "Der Agent ist nicht auf diesem Host.",
  "mobile.workspace.error.filesUnsupported":
    "Dieser Host unterstützt keine Dateiverwaltung. Aktualisiere OpenBot auf dem Host.",
  "mobile.workspace.error.agentUnavailableOnHost": "Der Agent ist auf diesem Host nicht verfügbar.",
  "mobile.workspace.error.agentUnavailable": "Der Agent ist nicht verfügbar.",
  "mobile.workspace.error.formUnavailable": "Dieses Formular ist nicht mehr verfügbar.",
  "mobile.workspace.error.approvalInactive":
    "Diese Anfrage wartet nicht mehr. Ein anderes Gerät hat sie beantwortet, oder die Aufgabe wurde beendet.",
  "mobile.workspace.error.approvalOffline": "Verbinde dich mit dem Server, um diese Anfrage zu beantworten.",
  "mobile.workspace.alert.preferencesTitle": "Chat-Einstellungen konnten nicht gespeichert werden",
  "mobile.workspace.alert.preferencesBody": "Deine vorherigen Einstellungen wurden beibehalten. Versuche es erneut.",
  "mobile.workspace.alert.updateRequiredTitle": "Update erforderlich",
  "mobile.workspace.alert.updateRequiredUnread":
    "Aktualisiere diesen Desktop-Server, um Unterhaltungen als ungelesen zu markieren.",
  "mobile.workspace.alert.markUnreadTitle": "Konnte nicht als ungelesen markiert werden",
  "mobile.workspace.alert.markUnreadBody": "Verbinde dich erneut mit dem Server und versuche es noch einmal.",
  "mobile.workspace.alert.markAllReadTitle": "Nicht alle konnten als gelesen markiert werden",
  "mobile.workspace.alert.markAllReadBody":
    "Einige Chats sind noch ungelesen. Verbinde dich erneut mit dem Server und versuche es noch einmal.",
  "mobile.workspace.alert.serverOrderTitle": "Serverreihenfolge konnte nicht gespeichert werden",
  "mobile.workspace.alert.serverOrderBody": "Deine vorherige Reihenfolge wurde beibehalten. Versuche es erneut.",
  "mobile.workspace.error.connectFailed": "Die Serververbindung ist fehlgeschlagen.",
  "mobile.workspace.error.disconnectFailed": "Der Server wurde nicht sauber getrennt.",
  "mobile.workspace.error.queueEditRejected": "Der Host hat diese Änderung nicht angenommen.",
} as const satisfies PartialTranslation<typeof source>;
