import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Deze workflow bestaat niet meer.",
  "error.workflow.versionMissing": "Deze versie van de workflow bestaat niet meer.",
  "error.workflow.annotation": "Tekst, notities en vormen kunnen geen verbindingen hebben.",
  "error.workflow.port": "Een stap kan dit type invoer niet aannemen.",
  "error.workflow.unknownValue":
    "Deze OpenBot kent een instelling van een stap niet. Werk OpenBot bij en probeer het opnieuw.",
  "error.workflow.branch": "Alleen een voorwaarde kan ja- en nee-verbindingen hebben.",
  "error.workflow.conditionBranch": "Elke verbinding vanuit een voorwaarde moet ja of nee zijn.",
  "error.workflow.duplicateEdge": "Deze twee stappen hebben deze verbinding al.",
  "error.workflow.serverTooOld":
    "Deze server ondersteunt geen workflows. Werk OpenBot bij op de computer waarop de server draait.",
  "error.workflow.newerSteps":
    "Deze workflow heeft stappen uit een nieuwere OpenBot. Werk OpenBot bij om hem te wijzigen.",
  "error.workflow.nodeUnsupported":
    "Deze versie van OpenBot kan nog geen stappen voor afbeeldingen, bestanden en berichten uitvoeren.",
  "error.workflow.interrupted": "OpenBot is gestopt terwijl deze stap liep. Voer hem opnieuw uit.",
  "error.workflow.agentMissing": "Kies een agent voor deze stap.",
  "error.workflow.handoffFailed": "OpenBot kon deze stap niet naar de agent sturen.",
  "error.workflow.agentStepEnded": "Het bericht van de agent voor deze stap is verwijderd voordat de agent antwoordde.",
  "error.workflow.agentStepStopped":
    "De agent is gestopt voordat hij deze stap beantwoordde. Voer de stap opnieuw uit.",
  "error.workflow.conditionUnclear": "Het model antwoordde niet met ja of nee.",
  "error.workflow.answerInvalid":
    "Het antwoord had niet de velden die deze stap vraagt: {fields}. Voer de stap opnieuw uit.",
  "error.workflow.answerSetup":
    "De antwoordvelden van deze workflow hebben hier een probleem: {fields}. Corrigeer de workflow en voer de stap daarna opnieuw uit.",
  "error.workflow.answerSourceEnded":
    "Deze velden hebben geen waarde, omdat de stap die ze levert niet is voltooid: {fields}. Voer eerst die stap opnieuw uit.",
  "error.workflow.runInputInvalid":
    "De invoer van de run past niet bij de antwoordvelden van de trigger: {fields}. Stuur één JSON-object met deze velden.",
  "error.workflow.sourceNotDone":
    "Een eerdere stap is de laatste keer mislukt of gestopt. Voer eerst die stap opnieuw uit.",
  "error.workflow.checkInvalid": "De controle van deze stap is ongeldig. Corrigeer hem en voer de stap opnieuw uit.",
  "error.workflow.modelFailed": "Het model kon niet antwoorden. Voer de stap opnieuw uit.",
  "error.workflow.modelTimedOut":
    "Het model antwoordde niet op tijd. Kies een lager denkniveau of een sneller model voor deze stap en voer hem opnieuw uit.",
  "error.workflow.modelToolUse":
    "Het model probeerde een tool te gebruiken, maar deze stap kan alleen met tekst antwoorden. Voer de stap opnieuw uit of kies er een ander model voor.",
  "error.workflow.modelImageUnsupported":
    "Het model van deze stap kan geen afbeeldingen lezen. Kies een model dat dat wel kan, of verwijder de afbeeldingsverbinding.",
  "error.workflow.modelImageType":
    "Een modelstap kan alleen PNG-, JPEG-, GIF- en WebP-afbeeldingen lezen. Verbind een afbeelding van een van deze typen.",
  "error.workflow.modelUnavailable":
    "Het model van deze stap is niet beschikbaar. Kies een ander model voor deze stap.",
  "error.workflow.providerBusy": "De provider is bezet. Wacht een paar minuten en voer de stap dan opnieuw uit.",
  "error.workflow.providerOffline":
    "OpenBot kon de provider niet bereiken. Controleer de internetverbinding en voer de stap dan opnieuw uit.",
  "error.workflow.providerBilling":
    "Het account heeft geen tegoed, of het abonnement bevat dit model niet. Controleer het abonnement, of kies een ander model.",
  "error.workflow.modelRefused": "De provider staat dit model niet toe voor dit account. Kies een ander model.",
  "error.workflow.modelRefusedReason":
    'Kies een ander model. De provider staat dit model niet toe voor dit account: "{reason}"',
  "error.workflow.contentBlocked":
    "De provider heeft de invoer geblokkeerd. Wijzig de invoer of de prompt en voer de stap dan opnieuw uit.",
  "error.workflow.inputTooLong": "De invoer is te lang voor dit model. Maak hem korter, of kies een ander model.",
  "error.workflow.requestRefused": "De provider heeft deze stap niet geaccepteerd. Kies een ander model.",
  "error.workflow.requestRefusedReason":
    'Kies een ander model. De provider heeft deze stap niet geaccepteerd: "{reason}"',
  "error.workflow.providerRefused": 'Kies een ander model, of voer de stap opnieuw uit. De provider zei: "{reason}"',
  "error.workflow.modelBusy": "Er loopt een ander verzoek aan het model. Voer de stap zo opnieuw uit.",
  "error.workflow.mediaFailed": "Het model kon de afbeelding of video niet maken. Voer de stap opnieuw uit.",
  "error.workflow.mediaNotMade": "Het model heeft de afbeelding of video niet gemaakt. Het antwoordde: {answer}",
  "error.workflow.pictureMissing": "De afbeelding staat niet meer op de server. Stuur hem opnieuw.",
  "error.workflow.pictureType": "Gebruik een PNG-, JPEG- of WebP-afbeelding.",
  "error.workflow.mediaInputMissing":
    "Een afbeelding van een eerdere stap is niet beschikbaar. Voer die stap opnieuw uit.",
  "error.workflow.mediaEmptyRequest":
    "Schrijf een beschrijving, of voer de stappen ervoor uit zodat er een tekst of afbeelding binnenkomt.",
  "error.workflow.mediaInputNotImage":
    "Deze stap neemt alleen afbeeldingen aan, geen video’s. Verwijder de verbinding vanaf de video.",
  "error.workflow.mediaInputNotClip":
    "Deze invoer neemt alleen video’s en audiobestanden aan. Verwijder de verbinding vanaf het bestand.",
  "error.workflow.stepMissing": "Deze stap bestaat niet meer.",
  "error.workflow.nodeMissing": "Deze stap staat niet in de workflow.",
  "error.workflow.runMissing": "Deze run bestaat niet meer.",
  "error.workflow.notRetryable": "Alleen een stap die is mislukt of gestopt, kan opnieuw worden uitgevoerd.",
  "error.workflow.noDecision": "Deze stap wacht niet op een beslissing.",
  "error.workflow.outputPlaceMissing": "Kies een berichtenplek voor deze uitvoer.",
  "error.workflow.outputChannelMissing": "Kies een kanaal voor deze uitvoer.",
  "error.workflow.outputChannelFailed":
    "OpenBot kon het resultaat niet in het kanaal plaatsen. Voer de stap opnieuw uit.",
  "error.workflow.discordNoMessage":
    "Deze uitvoer werkt op het Discord-bericht dat de run startte. Start de run vanuit een vermelding in Discord, of kies Posten in kanaal.",
  "error.workflow.slackNoMessage":
    "Deze uitvoer werkt op het Slack-bericht dat de run startte. Start de run vanuit een vermelding in Slack, of kies Posten in kanaal.",
  "error.workflow.telegramNoMessage":
    "Deze uitvoer werkt op het Telegram-bericht dat de run startte. Start de run vanuit een vermelding in Telegram, of kies Posten in chat.",
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
  "error.workflow.githubEventText":
    "Deze uitvoer kan de onbewerkte gebeurtenis van de trigger niet sturen. Zet een agent tussen de trigger en deze uitvoer.",
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
  "error.workflow.sunraSignIn": "Meld je aan bij Sunra in Apps om Sunra-modellen te gebruiken.",
  "error.workflow.sunraNoCredits":
    "Je Sunra-account heeft niet genoeg credits. Voeg credits toe op sunra.ai/pricing en voer de stap daarna opnieuw uit.",
  "error.workflow.sunraNeedsPlan":
    "Dit Sunra-model heeft een Sunra-abonnement nodig. Kies een abonnement op sunra.ai/pricing of selecteer een ander model.",
  "error.workflow.sunraTeamInputs":
    "Sunra gebruikt invoerafbeeldingen alleen met een persoonlijk account. Selecteer je persoonlijke account in Sunra of verwijder de afbeeldingsverbindingen.",
  "error.workflow.sunraFailed": "Sunra kon het bestand niet maken: {reason}",
  "error.workflow.sunraTimeout":
    "Sunra heeft het bestand niet op tijd gemaakt. Kijk in het project OpenBot op sunra.ai voordat je de stap opnieuw uitvoert.",
  "error.workflow.higgsfieldSignIn": "Meld je aan bij Higgsfield in Apps om Higgsfield-modellen te gebruiken.",
  "error.workflow.higgsfieldNoCredits":
    "Je Higgsfield-account heeft niet genoeg tegoed. Voeg tegoed toe op higgsfield.ai/pricing en voer de stap daarna opnieuw uit.",
  "error.workflow.higgsfieldNeedsPlan":
    "Dit Higgsfield-model heeft een Higgsfield-abonnement nodig. Kies een abonnement op higgsfield.ai/pricing of selecteer een ander model.",
  "error.workflow.higgsfieldBlocked":
    "Higgsfield heeft het bestand niet gemaakt, omdat de inhoudscontrole het heeft gestopt. Wijzig de prompt of de invoerafbeeldingen en voer de stap daarna opnieuw uit.",
  "error.workflow.higgsfieldFailed": "Higgsfield kon het bestand niet maken: {reason}",
  "error.workflow.higgsfieldTimeout":
    "Higgsfield heeft het bestand niet op tijd afgemaakt. Kijk in je geschiedenis op higgsfield.ai voordat je de stap opnieuw uitvoert.",
} as const satisfies PartialTranslation<typeof source>;
