import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Dieser Workflow existiert nicht mehr.",
  "error.workflow.versionMissing": "Diese Version des Workflows existiert nicht mehr.",
  "error.workflow.annotation": "Texte, Notizen und Formen können keine Verbindungen haben.",
  "error.workflow.port": "Ein Schritt kann diese Art von Eingabe nicht annehmen.",
  "error.workflow.unknownValue":
    "Dieses OpenBot kennt eine Einstellung eines Schritts nicht. Aktualisiere OpenBot und versuche es dann erneut.",
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
  "error.workflow.agentStepStopped":
    "Der Agent hat angehalten, bevor er auf diesen Schritt antwortete. Führe den Schritt erneut aus.",
  "error.workflow.conditionUnclear": "Das Modell hat nicht mit Ja oder Nein geantwortet.",
  "error.workflow.answerInvalid":
    "Die Antwort hatte nicht die Felder, die dieser Schritt verlangt: {fields}. Führe den Schritt erneut aus.",
  "error.workflow.answerSetup":
    "Die Antwortfelder dieses Workflows passen hier nicht: {fields}. Korrigiere den Workflow und führe den Schritt dann erneut aus.",
  "error.workflow.answerSourceEnded":
    "Diese Felder haben keinen Wert, weil der Schritt, der sie liefert, nicht abgeschlossen wurde: {fields}. Führe zuerst diesen Schritt erneut aus.",
  "error.workflow.runInputInvalid":
    "Die Eingabe des Laufs passt nicht zu den Antwortfeldern des Auslösers: {fields}. Sende ein JSON-Objekt mit diesen Feldern.",
  "error.workflow.sourceNotDone":
    "Ein Schritt davor ist beim letzten Lauf fehlgeschlagen oder wurde gestoppt. Führe zuerst diesen Schritt erneut aus.",
  "error.workflow.checkInvalid":
    "Die Prüfung dieses Schritts ist ungültig. Korrigiere sie und führe den Schritt erneut aus.",
  "error.workflow.modelFailed": "Das Modell konnte nicht antworten. Führe den Schritt erneut aus.",
  "error.workflow.modelTimedOut":
    "Das Modell hat nicht rechtzeitig geantwortet. Wähle für diesen Schritt einen geringeren Aufwand oder ein schnelleres Modell und führe ihn erneut aus.",
  "error.workflow.modelToolUse":
    "Das Modell wollte ein Tool verwenden, aber dieser Schritt kann nur mit Text antworten. Führe den Schritt erneut aus oder wähle ein anderes Modell dafür.",
  "error.workflow.modelImageUnsupported":
    "Das Modell dieses Schritts kann keine Bilder lesen. Wähle ein Modell, das es kann, oder entferne die Bildverbindung.",
  "error.workflow.modelImageType":
    "Ein Modellschritt kann nur PNG-, JPEG-, GIF- und WebP-Bilder lesen. Verbinde ein Bild in einem dieser Formate.",
  "error.workflow.modelUnavailable":
    "Das Modell dieses Schritts ist nicht verfügbar. Wähle ein anderes Modell für diesen Schritt.",
  "error.workflow.providerBusy":
    "Der Anbieter ist ausgelastet. Warte einige Minuten und führe den Schritt dann erneut aus.",
  "error.workflow.providerOffline":
    "OpenBot konnte den Anbieter nicht erreichen. Prüfe die Internetverbindung und führe den Schritt dann erneut aus.",
  "error.workflow.modelBusy": "Eine andere Modellanfrage läuft. Führe den Schritt bald erneut aus.",
  "error.workflow.mediaFailed": "Das Modell konnte das Bild oder Video nicht erstellen. Führe den Schritt erneut aus.",
  "error.workflow.mediaNotMade": "Das Modell hat das Bild oder Video nicht erstellt. Es schrieb: {answer}",
  "error.workflow.pictureMissing": "Das Bild ist nicht mehr auf dem Server. Sende es erneut.",
  "error.workflow.pictureType": "Verwende ein PNG-, JPEG- oder WebP-Bild.",
  "error.workflow.mediaInputMissing":
    "Ein Bild aus einem vorherigen Schritt ist nicht verfügbar. Führe diesen Schritt erneut aus.",
  "error.workflow.mediaEmptyRequest":
    "Schreibe eine Beschreibung oder führe die Schritte davor aus, damit ein Text oder ein Bild ankommt.",
  "error.workflow.mediaInputNotImage":
    "Dieser Schritt nimmt nur Bilder an, keine Videos. Entferne die Verbindung vom Video.",
  "error.workflow.mediaInputNotClip":
    "Dieser Eingang nimmt nur Videos und Audiodateien an. Entferne die Verbindung von der Datei.",
  "error.workflow.stepMissing": "Dieser Schritt existiert nicht mehr.",
  "error.workflow.nodeMissing": "Dieser Schritt ist nicht im Workflow.",
  "error.workflow.runMissing": "Dieser Lauf existiert nicht mehr.",
  "error.workflow.notRetryable": "Nur ein fehlgeschlagener oder gestoppter Schritt kann erneut laufen.",
  "error.workflow.noDecision": "Dieser Schritt wartet nicht auf eine Entscheidung.",
  "error.workflow.outputPlaceMissing": "Wähle einen Messaging-Ort für diese Ausgabe.",
  "error.workflow.outputChannelMissing": "Wähle einen Kanal für diese Ausgabe.",
  "error.workflow.outputChannelFailed":
    "OpenBot konnte das Ergebnis nicht im Kanal posten. Führe den Schritt erneut aus.",
  "error.workflow.discordNoMessage":
    "Diese Ausgabe wirkt auf die Discord-Nachricht, die den Lauf gestartet hat. Starte den Lauf über eine Discord-Erwähnung oder wähle „Im Kanal posten“.",
  "error.workflow.slackNoMessage":
    "Diese Ausgabe wirkt auf die Slack-Nachricht, die den Lauf gestartet hat. Starte den Lauf über eine Slack-Erwähnung oder wähle „Im Kanal posten“.",
  "error.workflow.telegramNoMessage":
    "Diese Ausgabe wirkt auf die Telegram-Nachricht, die den Lauf gestartet hat. Starte den Lauf über eine Telegram-Erwähnung oder wähle „Im Chat posten“.",
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
  "error.workflow.githubActionMissing": "Wähle, was diese Ausgabe auf GitHub tut.",
  "error.workflow.githubRepositoryMissing": "Wähle ein Repository für diese Ausgabe.",
  "error.workflow.githubItemMissing":
    "Diese Ausgabe hat kein Issue und keinen Pull Request. Starte den Lauf über ein GitHub-Ereignis oder gib die Nummer in ihre Eingabe.",
  "error.workflow.githubPullRequestOnly": "Diese Aktion funktioniert nur bei Pull Requests.",
  "error.workflow.githubTextMissing":
    "Diese Ausgabe hat keinen Text zum Senden. Verbinde einen Schritt, der ihn schreibt.",
  "error.workflow.githubEventText":
    "Diese Ausgabe kann das unbearbeitete Ereignis des Auslösers nicht senden. Setze einen Agenten zwischen den Auslöser und diese Ausgabe.",
  "error.workflow.githubChoiceMissing": "Wähle die Labels oder die Person für diese Ausgabe.",
  "error.workflow.githubChoseNothing": "Das Modell hat kein Label und keine Person dieses Repositorys gewählt.",
  "error.workflow.githubNotConnected": "Verbinde GitHub auf dem Computer, auf dem dieser Workflow läuft.",
  "error.workflow.githubNoAccess":
    "Die OpenBot-GitHub-App kann dieses Repository oder Element nicht sehen. Öffne GitHub und gib ihr Zugriff.",
  "error.workflow.githubNoWrite":
    "Die OpenBot-GitHub-App kann dieses Repository nicht ändern. Öffne GitHub und gib ihr Zugriff.",
  "error.workflow.githubLocked": "Diese Unterhaltung ist auf GitHub gesperrt.",
  "error.workflow.githubRefused": "GitHub hat die Änderung abgelehnt: {detail}",
  "error.workflow.githubUnreachable": "OpenBot konnte GitHub nicht erreichen. Führe den Schritt erneut aus.",
  "error.workflow.githubUncertain":
    "Die Änderung wurde unterwegs unterbrochen. Sie kann schon auf GitHub sein. Sieh dort nach, bevor du den Schritt erneut ausführst.",
  "error.workflow.githubNoEvent": "GitHub hat kein Issue und keinen Pull Request, bei dem dieser Auslöser startet.",
  "error.workflow.sunraSignIn": "Melde dich unter Apps bei Sunra an, um Sunra-Modelle zu verwenden.",
  "error.workflow.sunraNoCredits":
    "Dein Sunra-Konto hat nicht genug Credits. Füge Credits unter sunra.ai/pricing hinzu und führe den Schritt dann erneut aus.",
  "error.workflow.sunraNeedsPlan":
    "Dieses Sunra-Modell braucht einen Sunra-Plan. Wähle einen Plan unter sunra.ai/pricing oder ein anderes Modell.",
  "error.workflow.sunraTeamInputs":
    "Sunra verwendet Eingabebilder nur mit einem persönlichen Konto. Wähle dein persönliches Konto in Sunra aus oder entferne die Bildverbindungen.",
  "error.workflow.sunraFailed": "Sunra konnte die Datei nicht erstellen: {reason}",
  "error.workflow.sunraTimeout":
    "Sunra hat die Datei nicht rechtzeitig fertiggestellt. Sieh im Projekt OpenBot auf sunra.ai nach, bevor du den Schritt erneut ausführst.",
  "error.workflow.higgsfieldSignIn": "Melde dich unter Apps bei Higgsfield an, um Higgsfield-Modelle zu verwenden.",
  "error.workflow.higgsfieldNoCredits":
    "Dein Higgsfield-Konto hat nicht genug Credits. Füge Credits unter higgsfield.ai/pricing hinzu und führe den Schritt dann erneut aus.",
  "error.workflow.higgsfieldNeedsPlan":
    "Dieses Higgsfield-Modell braucht einen Higgsfield-Plan. Wähle einen Plan unter higgsfield.ai/pricing oder ein anderes Modell.",
  "error.workflow.higgsfieldBlocked":
    "Higgsfield hat die Datei nicht erstellt, weil die Inhaltsprüfung sie gestoppt hat. Ändere den Prompt oder die Eingabebilder und führe den Schritt dann erneut aus.",
  "error.workflow.higgsfieldFailed": "Higgsfield konnte die Datei nicht erstellen: {reason}",
  "error.workflow.higgsfieldTimeout":
    "Higgsfield hat die Datei nicht rechtzeitig fertiggestellt. Sieh in deinem Verlauf auf higgsfield.ai nach, bevor du den Schritt erneut ausführst.",
} as const satisfies PartialTranslation<typeof source>;
