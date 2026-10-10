import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "Der Verlauf ist für diese Anfrage nicht verfügbar. Lies den aktuellen Verlauf erneut oder verwende channel_history für Arbeit in Kanälen.",
  "error.agent.toolRequestInvalid":
    "Ungültige Argumente für die Werkzeugsuche. Verwende das deklarierte Schema und einen originalen qualifizierten Werkzeugnamen.",
  "error.agent.approvalWhileDeleting": "Während der Agent gelöscht wird, kann keine Freigabe erteilt werden.",
  "error.agent.accessLocalOnly":
    "Der Agentenzugriff kann nur auf dem Computer geändert werden, auf dem der Agent läuft.",
  "error.agent.duplicateCleanupFailed":
    "Der Agent konnte nicht dupliziert und die unvollständige Kopie nicht entfernt werden.",
  "error.agent.commitEffectsFailed":
    "Die Transaktion wurde bestätigt, aber ihre gespeicherten Effekte sind fehlgeschlagen.",
  "error.agent.settingsLocalOnly":
    "Die Agenteneinstellungen können nur auf dem Computer geändert werden, auf dem der Agent läuft.",
  "error.agent.skillsLocalOnly": "Fähigkeiten können nur auf dem Computer geändert werden, auf dem der Agent läuft.",
  "error.agent.addLocalOnly": "Agenten können nur auf dem Computer hinzugefügt werden, auf dem sie laufen.",
  "error.agent.joinedServerUpdate":
    "Ein Agent auf einem Server, dem du beigetreten bist, kann hier nicht aktualisiert werden.",
  "error.agent.searchQueryRequired": "Eine Suchanfrage ist erforderlich.",
  "error.agent.messageTooLong": "Die Nachricht ist zu lang.",
  "error.agent.messageOrAttachmentRequired": "Eine Nachricht oder ein Anhang ist erforderlich.",
  "error.agent.promptAnswersTooLong": "Die Antworten auf die Fragen sind zu lang.",
  "error.agent.gone": "Dieser Agent existiert nicht mehr.",
  "error.agent.profileGenerationBusy": "Die Profilerstellung ist ausgelastet. Versuche es gleich noch einmal.",
  "error.agent.initialMessageRequired": "Eine erste Nachricht ist erforderlich.",
  "error.agent.initialMessageTooLong": "Die erste Nachricht ist zu lang.",
  "error.agent.setupCleanupFailed":
    "Der Agent konnte nicht eingerichtet und der unvollständige Agent nicht entfernt werden.",
  "error.agent.modelUnavailable": "Das gewählte Agentenmodell ist nicht verfügbar.",
  "error.agent.modelProviderNotConnected":
    "Das gewählte Agentenmodell „{model}“ ist nicht verfügbar: {provider} ist nicht verbunden.",
  "error.agent.modelListEmpty":
    "Das gewählte Agentenmodell „{model}“ ist nicht verfügbar: {provider} hat keine Modelle aufgeführt. Letzter Fehler: {detail}",
  "error.agent.modelListEmptyNoError":
    "Das gewählte Agentenmodell „{model}“ ist nicht verfügbar: {provider} hat keine Modelle aufgeführt.",
  "error.agent.modelNotInProviderList":
    "Das gewählte Agentenmodell „{model}“ ist nicht verfügbar: {provider} führt es nicht auf.",
  "error.agent.modelProviderMismatch": "Das gewählte Modell gehört nicht zu diesem Anbieter.",
  "error.agent.modelNotListed": "Das Modell „{model}“ ist nicht verfügbar. Verfügbare Modelle: {models}.",
  "error.agent.providerNotListed":
    "Derzeit ist kein Modell von {provider} verfügbar. Rufe list_models auf, um die verfügbaren Modelle zu sehen.",
  "error.agent.reasoningEffortUnsupported":
    "Das Modell „{model}“ unterstützt den Denkaufwand „{effort}“ nicht. Unterstützte Stufen: {efforts}.",
  "error.agent.noStartingModelInSettings":
    "{provider} hat kein verfügbares Modell, und kein anderer angemeldeter Anbieter hat eines. Melde dich bei einem Anbieter an oder ändere den Standardanbieter unter Servereinstellungen → Anbieter.",
  "error.agent.noStartingModel":
    "{provider} hat kein verfügbares Modell. Auch kein anderer angemeldeter Anbieter hat eines. Melde dich bei einem Anbieter an oder ändere den Standardanbieter unter Anbieter und Berechtigungen.",
  "error.agent.waitBeforeProviderChange":
    "Warte, bis der aktive Durchlauf und die Warteschlange abgeschlossen sind, bevor du den Anbieter wechselst.",
  "error.agent.waitBeforeClearContext":
    "Warte, bis der aktive Durchlauf und die Warteschlange abgeschlossen sind, bevor du einen neuen Chat beginnst.",
  "error.agent.unknown": "Unbekannter Agent: {id}",
  "error.agent.onlyUserWidensSettings":
    "Nur der Benutzer kann einem Agenten Vollzugriff geben oder die Computersteuerung aktivieren. Bitte den Benutzer, dies in den Agenteneinstellungen zu ändern.",
  "error.agent.queuedMessageCreateFailed": "Die Nachricht konnte nicht in die Warteschlange aufgenommen werden.",
  "error.agent.messageUnavailable": "Die Nachricht ist nicht mehr verfügbar.",
  "error.agent.hostLimit": "Ein Host kann bis zu {limit} Agenten haben.",
  "error.agent.changedWhileDuplicating": "Der Agent wurde während des Duplizierens geändert. Versuche es erneut.",
  "error.agent.duplicatedAgentGone": "Der duplizierte Agent existiert nicht mehr.",
  "error.agent.stateCorrupt":
    "Der Agentenzustand ist beschädigt oder stammt aus einer neueren OpenBot-Version. Er wird nicht überschrieben.",
  "error.agent.oldRoleField":
    "Gespeicherte Agentenprofile verwenden das alte Feld role. Aktualisiere die Daten, bevor du OpenBot startest.",
  "error.agent.duplicateIds": "Der Agentenzustand enthält doppelte Agenten-IDs. Er wird nicht überschrieben.",
  "error.agent.copyNameFailed": "OpenBot konnte keinen eindeutigen Namen für die Agentenkopie erstellen.",
  "error.agent.endpointRemoved":
    "Der von diesem Agenten verwendete Endpunkt wurde entfernt. Wähle ein anderes Modell für ihn.",
  "error.agent.selectedGone": "Der gewählte Agent existiert nicht mehr.",
  "error.agent.profileEndpointsChanged":
    "Die benutzerdefinierten Endpunkte wurden während der Erstellung geändert. Versuche es erneut.",
  "error.agent.profileInvalid":
    "Der Anbieter hat ein ungültiges Profil zurückgegeben. Versuche, deine Anweisung zu ändern.",
  "error.agent.profileSectionUnavailable":
    "Der erstellte Abschnitt ist nicht verfügbar. Versuche es erneut oder wähle einen Abschnitt manuell.",
  "error.agent.profileTimedOut": "Die Zeit für die Profilerstellung ist abgelaufen. Versuche es erneut.",
  "error.agent.profileDisconnected": "Der Anbieter hat während der Profilerstellung die Verbindung getrennt.",
  "error.agent.profileToolUse":
    "Der Anbieter hat versucht, ein Werkzeug zu verwenden. Versuche, deine Anweisung zu ändern.",
  "error.agent.profileFailed": "Der Anbieter konnte kein Profil erstellen. Versuche es erneut.",
  "error.agent.profileTooLarge": "Das erstellte Profil ist zu groß. Versuche eine kürzere Anweisung.",
  "error.agent.profileNotStarted": "Der Anbieter konnte die Profilerstellung nicht starten.",
  "error.agent.deletionBusy": "Der Agent wird bereits gelöscht.",
  "error.agent.stopBeforeDelete":
    "Stoppe den Agenten und storniere seine Nachrichten in der Warteschlange, bevor du ihn löschst.",
  "error.agent.deleteIncomplete":
    "Die Agentendaten konnten nicht vollständig entfernt werden. Versuche erneut, den Agenten zu löschen.",
  "error.agent.duplicationBusy": "Dieser Agent wird bereits dupliziert.",
  "error.agent.waitBeforeDuplicate":
    "Warte, bis der Agent fertig ist, und leere seine Warteschlange, bevor du ihn duplizierst.",
  "error.agent.saveOtherAgent": "Dieser Speichervorgang gehört zu einem anderen Agenten.",
  "error.agent.savedGone": "Der gespeicherte Agent existiert nicht mehr.",
  "error.agent.storedProfileUnreadable":
    "Ein gespeichertes Agentenprofil hat einen unlesbaren Wert „{field}“. Aktualisiere die Daten, bevor du OpenBot startest.",
  "error.agent.storedProfileUnreadableId":
    "Das gespeicherte Agentenprofil {id} hat einen unlesbaren Wert „{field}“. Aktualisiere die Daten, bevor du OpenBot startest.",
  "error.agent.queueEditRejected": "Änderung der Warteschlange abgelehnt: {reason}",
  "error.agent.computerUseLocalOnly":
    "Die Computersteuerung kann nur auf dem Computer geändert werden, auf dem der Agent läuft.",
  "error.agent.automationLocalOnly":
    "Lokale Skripte können nur auf dem Computer erlaubt werden, auf dem der Agent läuft.",
  "error.agent.busyMessageModeLocalOnly":
    "Das Verhalten von Nachrichten während der Arbeit des Agenten kann nur auf dem Computer eingestellt werden, auf dem der Agent läuft.",
  "error.agent.localScriptsOff": "Dieser Agent erlaubt keine lokalen Skripte.",
  "error.agent.localScriptsRateLimited":
    "Lokale Skripte haben diesem Agenten in der letzten Stunde {limit} Nachrichten- oder Routinenanfragen gesendet. Versuche es später erneut.",
  "error.agent.automationOff": "Dieser Agent erlaubt lokalen Skripten nicht, seine Routinen auszuführen.",
  "error.agent.automationPayloadTooLong": "Die Nutzdaten sind länger als {limit} Zeichen.",
  "error.agent.automationRateLimited":
    "Lokale Skripte haben die Routinen dieses Agenten in der letzten Stunde {limit}-mal ausgeführt. Versuche es später erneut.",
  "error.agent.workspaceOnlyMacOnly":
    "Nur Arbeitsbereich ist für diesen Anbieter nur unter macOS verfügbar. Wähle Vollzugriff in den Agenteneinstellungen.",
  "error.agent.lowMemory":
    "Dieser Server hat wenig freien Arbeitsspeicher. Deine Nachricht wartet in der Warteschlange und startet, wenn Speicher frei ist. Ein größerer Tarif gibt dem Server mehr Arbeitsspeicher.",
  "error.agent.workspaceOnlyToolMissing":
    "Nur Arbeitsbereich benötigt {tool}, das OpenBot nicht gefunden hat. Installiere es oder wähle Vollzugriff in den Agenteneinstellungen.",
} as const satisfies PartialTranslation<typeof source>;
