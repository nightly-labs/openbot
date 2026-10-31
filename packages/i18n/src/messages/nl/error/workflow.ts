import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Deze workflow bestaat niet meer.",
  "error.workflow.versionMissing": "Deze versie van de workflow bestaat niet meer.",
  "error.workflow.annotation": "Tekst, notities en vormen kunnen geen verbindingen hebben.",
  "error.workflow.port": "Een stap kan dit type invoer niet aannemen.",
  "error.workflow.branch": "Alleen een voorwaarde kan ja- en nee-verbindingen hebben.",
  "error.workflow.conditionBranch": "Elke verbinding vanuit een voorwaarde moet ja of nee zijn.",
  "error.workflow.duplicateEdge": "Deze twee stappen hebben deze verbinding al.",
  "error.workflow.serverTooOld":
    "Deze server ondersteunt geen workflows. Werk OpenBot bij op de computer waarop de server draait.",
  "error.workflow.nodeUnsupported":
    "Deze versie van OpenBot kan nog geen stappen voor afbeeldingen, bestanden en berichten uitvoeren.",
  "error.workflow.interrupted": "OpenBot is gestopt terwijl deze stap liep. Voer hem opnieuw uit.",
  "error.workflow.agentMissing": "Kies een agent voor deze stap.",
  "error.workflow.handoffFailed": "OpenBot kon deze stap niet naar de agent sturen.",
  "error.workflow.agentStepEnded": "Het bericht van de agent voor deze stap is verwijderd voordat de agent antwoordde.",
  "error.workflow.conditionUnclear": "Het model antwoordde niet met ja of nee.",
  "error.workflow.modelFailed": "Het model kon niet antwoorden. Voer de stap opnieuw uit.",
  "error.workflow.modelBusy": "Er loopt een ander verzoek aan het model. Voer de stap zo opnieuw uit.",
  "error.workflow.stepMissing": "Deze stap bestaat niet meer.",
  "error.workflow.nodeMissing": "Deze stap staat niet in de workflow.",
  "error.workflow.runMissing": "Deze run bestaat niet meer.",
  "error.workflow.notRetryable": "Alleen een stap die is mislukt of gestopt, kan opnieuw worden uitgevoerd.",
  "error.workflow.noDecision": "Deze stap wacht niet op een beslissing.",
  "error.workflow.outputPlaceMissing": "Kies een berichtenplek voor deze uitvoer.",
  "error.workflow.outputConnectionOff":
    "De berichtenverbinding van deze uitvoer staat uit of is verwijderd. Kies opnieuw een plek.",
  "error.workflow.outputNotRunning": "De berichtenverbinding draait nu niet. Probeer het opnieuw als hij draait.",
  "error.workflow.outputRefused": "De plek heeft het bericht geweigerd. Zorg dat OpenBot daar mag posten.",
  "error.workflow.outputUncertain":
    "Het bericht is onderweg gestopt. Een deel ervan kan op de plek staan. Kijk daar voordat je het opnieuw probeert.",
  "error.workflow.tooLarge":
    "Deze workflow is te groot om op te slaan. Verwijder een paar tekeningen of lange teksten en probeer het opnieuw.",
  "error.workflow.tooLargeToSend":
    "Deze workflow is te groot om naar een andere computer te sturen. Open hem op de computer waarop de server draait.",
  "error.workflow.webhookMissing": "Deze stap is geen webhooktrigger. Sla de workflow op en probeer het opnieuw.",
  "error.workflow.githubActionMissing": "Kies wat deze uitvoer op GitHub doet.",
  "error.workflow.githubRepositoryMissing": "Kies een repository voor deze uitvoer.",
  "error.workflow.githubItemMissing":
    "Deze uitvoer heeft geen issue of pull request. Start de run vanuit een GitHub-event of zet het nummer in de invoer.",
  "error.workflow.githubPullRequestOnly": "Deze actie werkt alleen bij pull requests.",
  "error.workflow.githubTextMissing":
    "Deze uitvoer heeft geen tekst om te sturen. Verbind een stap die de tekst schrijft.",
  "error.workflow.githubChoiceMissing": "Kies de labels of de persoon voor deze uitvoer.",
  "error.workflow.githubChoseNothing": "Het model koos geen label of persoon van deze repository.",
  "error.workflow.githubNotConnected": "Verbind GitHub op de computer waarop deze workflow draait.",
  "error.workflow.githubNoAccess":
    "De OpenBot GitHub App kan deze repository of dit item niet zien. Open GitHub en geef de app toegang.",
  "error.workflow.githubNoWrite":
    "De OpenBot GitHub App kan deze repository niet wijzigen. Open GitHub en geef de app toegang.",
  "error.workflow.githubLocked": "Dit gesprek is vergrendeld op GitHub.",
  "error.workflow.githubRefused": "GitHub heeft de wijziging geweigerd: {detail}",
  "error.workflow.githubUnreachable": "OpenBot kon GitHub niet bereiken. Voer de stap opnieuw uit.",
  "error.workflow.githubUncertain":
    "De wijziging is onderweg gestopt. Hij kan al op GitHub staan. Kijk daar voordat je de stap opnieuw uitvoert.",
  "error.workflow.githubNoEvent": "GitHub heeft geen issue of pull request waarop deze trigger start.",
} as const satisfies PartialTranslation<typeof source>;
