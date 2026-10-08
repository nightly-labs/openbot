import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/remoteDesktop";

export const messages = {
  "remoteDesktop.controlFailed":
    "Die Fernsteuerung ist fehlgeschlagen. Verbinde dich erneut und versuche es noch einmal.",
  "remoteDesktop.startFailed": "Die Fernsteuerung konnte nicht gestartet werden.",
  "remoteDesktop.disconnectFailed": "Die Fernsteuerung konnte nicht getrennt werden.",
  "remoteDesktop.switchDisplayFailed": "Der freigegebene Monitor konnte nicht gewechselt werden.",
  "remoteDesktop.workspaceLabel": "Fernsteuerung",
  "remoteDesktop.displayLabel": "Remote-Bildschirm",
  "remoteDesktop.selectDisplay": "Bildschirm auswählen",
  "remoteDesktop.backToOpenBot": "Zurück zu OpenBot",
  "remoteDesktop.disconnect": "Trennen",
  "remoteDesktop.viewerTitle": "Sunshine-Remotedesktop",
  "remoteDesktop.viewerLoadFailed": "Der Moonlight-Viewer konnte nicht geladen werden.",
  "remoteDesktop.streamNotReady":
    "Der Host hat den Stream nicht gestartet. Sunshine wurde möglicherweise auf dem Host beendet. Versuche es erneut.",
  "remoteDesktop.hostOfflineTitle": "Host ist offline",
  "remoteDesktop.hostOfflineMessage": "Verbinde dich erneut mit dem Host, bevor du seinen Desktop öffnest.",
  "remoteDesktop.openFailed": "Desktop konnte nicht geöffnet werden",
  "remoteDesktop.notSharingTitle": "{name} gibt seinen Bildschirm nicht frei",
  "remoteDesktop.notSharingDescription":
    "Der Host verhindert, dass OpenBot seinen Bildschirm aufnimmt. Öffne auf diesem Computer Systemeinstellungen → Datenschutz & Sicherheit → Bildschirmaufnahme, aktiviere OpenBot und versuche es hier erneut.",
  "remoteDesktop.setup.check.screenRecording": "Bildschirmaufnahme",
  "remoteDesktop.setup.check.accessibility": "Bedienungshilfen",
  "remoteDesktop.setup.check.service": "Sunshine-Dienst",
  "remoteDesktop.setup.check.displays": "Bildschirmverfügbarkeit",
  "remoteDesktop.setup.check.guiSession": "macOS-Benutzersitzung",
  "remoteDesktop.setup.state.notChecked": "Nicht geprüft",
  "remoteDesktop.setup.state.checking": "Wird geprüft…",
  "remoteDesktop.setup.state.allowed": "Erlaubt",
  "remoteDesktop.setup.state.blocked": "Blockiert",
  "remoteDesktop.setup.state.unavailable": "Nicht verfügbar",
  "remoteDesktop.setup.state.failed": "Prüfung fehlgeschlagen",
  "remoteDesktop.setup.state.available": "Verfügbar",
  "remoteDesktop.setup.checkFailed": "Die Remotedesktop-Einrichtung konnte nicht geprüft werden.",
  "remoteDesktop.setup.openFailed": "Die macOS-Einrichtung konnte nicht geöffnet werden.",
  "remoteDesktop.setup.cleanupUnconfirmed": "Die Testverbindung wurde beendet, bevor die Bereinigung bestätigt wurde.",
  "remoteDesktop.setup.endSessionFirst":
    "Beende die Remotedesktop-Sitzung dieses Computers, bevor du einen Test startest.",
  "remoteDesktop.setup.startFailed": "Der Remotedesktop-Test konnte nicht gestartet werden.",
  "remoteDesktop.setup.connectionLost": "Die Testverbindung wurde unterbrochen.",
  "remoteDesktop.setup.hostUpdateRequired":
    "Aktualisiere OpenBot auf dem Host, um Berechtigungen zu prüfen und den Remotedesktop zu testen.",
  "remoteDesktop.setup.permissions": "Berechtigungen",
  "remoteDesktop.setup.checked": "Geprüft",
  "remoteDesktop.setup.checkAgain": "Erneut prüfen",
  "remoteDesktop.setup.grantAccess": "{name} Zugriff gewähren",
  "remoteDesktop.setup.grant": "Erteilen",
  "remoteDesktop.setup.grantHelp":
    "Lass das Sunshine-Konto auf dem Mac angemeldet. Erteile in diesem Konto Zugriff unter Systemeinstellungen → Datenschutz & Sicherheit. „Erteilen“ öffnet ein Hilfsfenster. Ziehe Sunshine.app in die Berechtigungsliste.",
  "remoteDesktop.setup.restartRequired":
    "Sunshine muss neu gestartet werden. Beende aktive Remotedesktop-Sitzungen und prüfe erneut. Aktive Sitzungen werden nicht neu gestartet.",
  "remoteDesktop.setup.showInFinder": "Sunshine im Finder anzeigen",
  "remoteDesktop.setup.liveTest": "Live-Verbindungstest",
  "remoteDesktop.setup.liveTestLocal": "Teste Bild, Maus und Tastatur auf diesem Mac.",
  "remoteDesktop.setup.liveTestRemote":
    "Der Test öffnet ein temporäres Panel auf dem Host. Andere Remote-Sitzungen müssen zuerst beendet werden. Eingaben bleiben innerhalb des Panels.",
  "remoteDesktop.setup.testSummary": "Video: {video} · Bild: {picture} · Maus: {mouse} · Tastatur: {keyboard}",
  "remoteDesktop.setup.received": "empfangen",
  "remoteDesktop.setup.notReceived": "nicht empfangen",
  "remoteDesktop.setup.confirmed": "bestätigt",
  "remoteDesktop.setup.notConfirmed": "nicht bestätigt",
  "remoteDesktop.setup.notTested": "nicht getestet",
  "remoteDesktop.setup.waiting": "wartet",
  "remoteDesktop.setup.testLocal": "Auf diesem Mac testen",
  "remoteDesktop.setup.testRemote": "Remotedesktop testen",
  "remoteDesktop.setup.videoFailed": "Die Test-Videoverbindung ist fehlgeschlagen.",
  "remoteDesktop.setup.inputInstructions":
    "Klicke auf das Ziel auf dem Host und tippe dann {code}. Maus: {mouse}. Tastatur: {keyboard}.",
  "remoteDesktop.setup.videoOnly":
    "Nur Videotest. Maus- und Tastaturtests benötigen die aktualisierte Sunshine-Laufzeitumgebung.",
  "remoteDesktop.setup.pictureConfirmed": "Bild bestätigt",
  "remoteDesktop.setup.seeDesktop": "Ich kann meinen Desktop sehen",
  "remoteDesktop.setup.seeTestPanel": "Ich kann das Testpanel sehen",
  "remoteDesktop.setup.finishTest": "Test beenden",
} as const satisfies PartialTranslation<typeof source>;
