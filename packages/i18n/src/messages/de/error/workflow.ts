import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Dieser Workflow existiert nicht mehr.",
  "error.workflow.versionMissing": "Diese Version des Workflows existiert nicht mehr.",
  "error.workflow.annotation": "Texte, Notizen und Formen können keine Verbindungen haben.",
  "error.workflow.port": "Ein Schritt kann diese Art von Eingabe nicht annehmen.",
  "error.workflow.branch": "Nur eine Bedingung kann Ja- und Nein-Verbindungen haben.",
  "error.workflow.conditionBranch": "Jede Verbindung einer Bedingung muss Ja oder Nein sein.",
  "error.workflow.duplicateEdge": "Diese zwei Schritte haben diese Verbindung bereits.",
  "error.workflow.serverTooOld":
    "Dieser Server unterstützt keine Workflows. Aktualisiere OpenBot auf dem Computer, auf dem er läuft.",
  "error.workflow.nodeUnsupported":
    "Diese Version von OpenBot kann Bild-, Datei- und Nachrichtenschritte noch nicht ausführen.",
  "error.workflow.interrupted": "OpenBot wurde beendet, während dieser Schritt lief. Führe ihn erneut aus.",
  "error.workflow.agentMissing": "Wähle einen Agenten für diesen Schritt.",
  "error.workflow.handoffFailed": "OpenBot konnte diesen Schritt nicht an seinen Agenten senden.",
  "error.workflow.agentStepEnded": "Die Nachricht an den Agenten wurde entfernt, bevor er antwortete.",
  "error.workflow.conditionUnclear": "Das Modell hat nicht mit Ja oder Nein geantwortet.",
  "error.workflow.modelFailed": "Das Modell konnte nicht antworten. Führe den Schritt erneut aus.",
  "error.workflow.modelBusy": "Eine andere Modellanfrage läuft. Führe den Schritt bald erneut aus.",
  "error.workflow.stepMissing": "Dieser Schritt existiert nicht mehr.",
  "error.workflow.nodeMissing": "Dieser Schritt ist nicht im Workflow.",
  "error.workflow.runMissing": "Dieser Lauf existiert nicht mehr.",
  "error.workflow.notRetryable": "Nur ein fehlgeschlagener oder gestoppter Schritt kann erneut laufen.",
  "error.workflow.noDecision": "Dieser Schritt wartet nicht auf eine Entscheidung.",
  "error.workflow.outputPlaceMissing": "Wähle einen Messaging-Ort für diese Ausgabe.",
  "error.workflow.outputConnectionOff":
    "Die Messaging-Verbindung dieser Ausgabe ist aus oder entfernt. Wähle erneut einen Ort.",
  "error.workflow.outputNotRunning": "Die Messaging-Verbindung läuft gerade nicht. Versuche es erneut, wenn sie läuft.",
  "error.workflow.outputRefused": "Der Ort hat den Beitrag abgelehnt. Stelle sicher, dass OpenBot dort posten kann.",
  "error.workflow.outputUncertain":
    "Der Beitrag wurde unterwegs unterbrochen. Ein Teil kann schon am Ort sein. Sieh dort nach, bevor du es erneut versuchst.",
  "error.workflow.tooLarge":
    "Dieser Workflow ist zu groß zum Speichern. Entferne einige Zeichnungen oder lange Texte und versuche es erneut.",
  "error.workflow.tooLargeToSend":
    "Dieser Workflow ist zu groß, um ihn an einen anderen Computer zu senden. Öffne ihn auf dem Computer, auf dem der Server läuft.",
  "error.workflow.webhookMissing":
    "Dieser Schritt ist kein Webhook-Auslöser. Speichere den Workflow und versuche es erneut.",
} as const satisfies PartialTranslation<typeof source>;
