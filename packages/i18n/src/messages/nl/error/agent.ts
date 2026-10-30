import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "De geschiedenis is niet beschikbaar voor dit verzoek. Lees de recente geschiedenis opnieuw, of gebruik channel_history voor werk in een kanaal.",
  "error.agent.toolRequestInvalid":
    "Ongeldige argumenten voor het zoeken naar tools. Gebruik het opgegeven schema en een oorspronkelijke, volledige toolnaam.",
  "error.agent.approvalWhileDeleting": "Je kunt geen toestemming geven terwijl de agent wordt verwijderd.",
  "error.agent.accessLocalOnly": "Toegang van de agent kun je alleen wijzigen op de computer waarop de agent draait.",
  "error.agent.duplicateCleanupFailed":
    "Dupliceren van de agent is mislukt en de onvolledige kopie kon niet worden verwijderd.",
  "error.agent.commitEffectsFailed": "De transactie is doorgevoerd, maar de opgeslagen effecten ervan zijn mislukt.",
  "error.agent.settingsLocalOnly":
    "Instellingen van de agent kun je alleen wijzigen op de computer waarop de agent draait.",
  "error.agent.skillsLocalOnly": "Vaardigheden kun je alleen wijzigen op de computer waarop de agent draait.",
  "error.agent.addLocalOnly": "Agents kun je alleen toevoegen op de computer waarop ze draaien.",
  "error.agent.joinedServerUpdate": "Een agent op een server waaraan je deelneemt, kun je hier niet bijwerken.",
  "error.agent.searchQueryRequired": "Een zoekopdracht is verplicht.",
  "error.agent.messageTooLong": "Het bericht is te lang.",
  "error.agent.messageOrAttachmentRequired": "Een bericht of bijlage is verplicht.",
  "error.agent.promptAnswersTooLong": "De antwoorden op de prompt zijn te lang.",
  "error.agent.gone": "Deze agent bestaat niet meer.",
  "error.agent.profileGenerationBusy": "Er wordt al een profiel gemaakt. Probeer het zo opnieuw.",
  "error.agent.initialMessageRequired": "Een eerste bericht is verplicht.",
  "error.agent.initialMessageTooLong": "Het eerste bericht is te lang.",
  "error.agent.setupCleanupFailed":
    "Instellen van de agent is mislukt en de onvolledige agent kon niet worden verwijderd.",
  "error.agent.modelUnavailable": "Het gekozen model van de agent is niet beschikbaar.",
  "error.agent.modelProviderNotConnected":
    "Het gekozen model “{model}” van de agent is niet beschikbaar: {provider} is niet verbonden.",
  "error.agent.modelListEmpty":
    "Het gekozen model “{model}” van de agent is niet beschikbaar: {provider} gaf geen modellen. Laatste fout: {detail}",
  "error.agent.modelListEmptyNoError":
    "Het gekozen model “{model}” van de agent is niet beschikbaar: {provider} gaf geen modellen.",
  "error.agent.modelNotInProviderList":
    "Het gekozen model “{model}” van de agent is niet beschikbaar: {provider} biedt het niet aan.",
  "error.agent.modelProviderMismatch": "Het gekozen model hoort niet bij die aanbieder.",
  "error.agent.modelNotListed": "Model “{model}” is niet beschikbaar. Beschikbare modellen: {models}.",
  "error.agent.providerNotListed":
    "Er is nu geen model van {provider} beschikbaar. Roep list_models aan om de beschikbare modellen te zien.",
  "error.agent.reasoningEffortUnsupported":
    "Model “{model}” ondersteunt redeneerniveau “{effort}” niet. Ondersteunde niveaus: {efforts}.",
  "error.agent.noStartingModelInSettings":
    "{provider} heeft geen model beschikbaar, en geen andere aanbieder waarbij je bent ingelogd heeft er een. Log in bij een aanbieder, of wijzig de standaardaanbieder in Serverinstellingen → Aanbieders.",
  "error.agent.noStartingModel":
    "{provider} heeft geen model beschikbaar, en geen andere aanbieder waarbij je bent ingelogd heeft er een. Log in bij een aanbieder, of wijzig de standaardaanbieder in Aanbieders en machtigingen.",
  "error.agent.waitBeforeProviderChange":
    "Wacht tot de actieve beurt en de wachtrij klaar zijn voordat je de aanbieder wijzigt.",
  "error.agent.waitForTasksBeforeProviderChange":
    "Er draaien taken van deze agent. Wacht tot ze klaar zijn, of stop ze, voordat je de aanbieder wijzigt.",
  "error.agent.waitBeforeClearContext":
    "Wacht tot de actieve beurt en de wachtrij klaar zijn voordat je een nieuwe chat start.",
  "error.agent.waitBeforeCompactContext":
    "Wacht tot de actieve beurt en de wachtrij klaar zijn voordat je de context comprimeert.",
  "error.agent.compactContextUnavailable": "Deze agent kan de context nu niet comprimeren.",
  "error.agent.unknown": "Onbekende agent: {id}",
  "error.agent.onlyUserWidensSettings":
    "Alleen de gebruiker kan een agent Volledige toegang geven of Computerbesturing aanzetten. Vraag de gebruiker om dit te wijzigen in de instellingen van de agent.",
  "error.agent.queuedMessageCreateFailed": "Kan het bericht in de wachtrij niet maken.",
  "error.agent.messageUnavailable": "Het bericht is niet meer beschikbaar.",
  "error.agent.hostLimit": "Een host kan maximaal {limit} agents hebben.",
  "error.agent.changedWhileDuplicating": "De agent is gewijzigd terwijl hij werd gedupliceerd. Probeer het opnieuw.",
  "error.agent.duplicatedAgentGone": "De gedupliceerde agent bestaat niet meer.",
  "error.agent.stateCorrupt":
    "De status van de agent is beschadigd of komt van een nieuwere versie van OpenBot; OpenBot overschrijft deze niet.",
  "error.agent.oldRoleField":
    "Opgeslagen agentprofielen gebruiken het oude rolveld; werk de gegevens bij voordat je OpenBot start.",
  "error.agent.duplicateIds": "De status van de agents bevat dubbele agent-id’s; OpenBot overschrijft deze niet.",
  "error.agent.copyNameFailed": "OpenBot kon geen unieke naam voor de kopie van de agent maken.",
  "error.agent.endpointRemoved":
    "Het endpoint dat deze agent gebruikte, is verwijderd. Kies een ander model voor de agent.",
  "error.agent.turnStalled":
    "{provider} reageerde niet meer, dus OpenBot heeft deze beurt beëindigd. Stuur het bericht opnieuw, of kies een ander model.",
  "error.agent.selectedGone": "De gekozen agent bestaat niet meer.",
  "error.agent.profileEndpointsChanged":
    "De aangepaste endpoints zijn gewijzigd tijdens het maken. Probeer het opnieuw.",
  "error.agent.profileInvalid": "De aanbieder gaf een ongeldig profiel terug. Probeer je prompt aan te passen.",
  "error.agent.profileSectionUnavailable":
    "De gemaakte sectie is niet beschikbaar. Probeer het opnieuw of kies zelf een sectie.",
  "error.agent.profileTimedOut": "Het maken van het profiel duurde te lang. Probeer het opnieuw.",
  "error.agent.profileDisconnected": "De verbinding met de aanbieder werd verbroken tijdens het maken van het profiel.",
  "error.agent.profileToolUse": "De aanbieder probeerde een tool te gebruiken. Probeer je prompt aan te passen.",
  "error.agent.profileFailed": "De aanbieder kon geen profiel maken. Probeer het opnieuw.",
  "error.agent.profileTooLarge": "Het gemaakte profiel is te groot. Probeer een kortere prompt.",
  "error.agent.profileNotStarted": "De aanbieder kon het maken van het profiel niet starten.",
  "error.agent.deletionBusy": "De agent wordt al verwijderd.",
  "error.agent.stopBeforeDelete": "Stop de agent en annuleer de berichten in de wachtrij voordat je hem verwijdert.",
  "error.agent.deleteIncomplete":
    "De gegevens van de agent konden niet volledig worden verwijderd. Probeer de agent opnieuw te verwijderen.",
  "error.agent.duplicationBusy": "Deze agent wordt al gedupliceerd.",
  "error.agent.waitBeforeDuplicate": "Wacht tot de agent klaar is en de wachtrij leeg is voordat je hem dupliceert.",
  "error.agent.saveOtherAgent": "Deze opslag hoort bij een andere agent.",
  "error.agent.savedGone": "De opgeslagen agent bestaat niet meer.",
  "error.agent.storedProfileUnreadable":
    "Een opgeslagen agentprofiel heeft een onleesbare waarde voor “{field}”; werk de gegevens bij voordat je OpenBot start.",
  "error.agent.storedProfileUnreadableId":
    "Opgeslagen agentprofiel {id} heeft een onleesbare waarde voor “{field}”; werk de gegevens bij voordat je OpenBot start.",
  "error.agent.queueEditRejected": "Wijziging van de wachtrij geweigerd: {reason}",
  "error.agent.computerUseLocalOnly": "Computerbesturing kun je alleen wijzigen op de computer waarop de agent draait.",
  "error.agent.automationLocalOnly": "Lokale scripts kun je alleen toestaan op de computer waarop de agent draait.",
  "error.agent.newChatLocalOnly": "Alleen de computer waarop de agent draait, kan de agent nieuwe chats laten starten.",
  "error.agent.quickAcknowledgementLocalOnly":
    "Alleen de computer waarop de agent draait, kan deze instelling wijzigen.",
  "error.agent.sideQuestionBusy": "Er lopen te veel zijvragen. Probeer het zo opnieuw.",
  "error.agent.sideQuestionFailed": "De agent kon de zijvraag niet beantwoorden. Probeer het opnieuw.",
  "error.agent.busyMessageModeLocalOnly":
    "Wat berichten doen terwijl de agent werkt, kun je alleen instellen op de computer waarop de agent draait.",
  "error.agent.backupModelsLocalOnly": "Reservemodellen kun je alleen instellen op de computer waarop de agent draait.",
  "error.agent.taskLimitLocalOnly": "De takenlimiet kun je alleen instellen op de computer waarop de agent draait.",
  "error.agent.localScriptsOff": "Deze agent staat geen lokale scripts toe.",
  "error.agent.localScriptsRateLimited":
    "Lokale scripts hebben deze agent het afgelopen uur {limit} verzoeken voor berichten of routines gestuurd. Probeer het later opnieuw.",
  "error.agent.automationOff": "Deze agent staat niet toe dat lokale scripts de routines uitvoeren.",
  "error.agent.automationPayloadTooLong": "De payload is langer dan {limit} tekens.",
  "error.agent.automationRateLimited":
    "Lokale scripts hebben de routines van deze agent het afgelopen uur {limit} keer uitgevoerd. Probeer het later opnieuw.",
  "error.agent.workspaceOnlyMacOnly":
    "Alleen werkruimte is voor deze aanbieder alleen beschikbaar op macOS. Kies Volledige toegang in de instellingen van de agent.",
  "error.agent.lowMemory":
    "Deze server heeft weinig geheugen. Je bericht wacht in de wachtrij en start zodra er geheugen vrij is. Met een groter abonnement krijgt de server meer geheugen.",
  "error.agent.lowMemoryServer":
    "Deze server heeft weinig geheugen. Je bericht wacht in de wachtrij en start zodra er geheugen vrij is.",
  "error.agent.workspaceOnlyToolMissing":
    "Alleen werkruimte heeft {tool} nodig, maar OpenBot heeft dit niet gevonden. Installeer het, of kies Volledige toegang in de instellingen van de agent.",
  "error.agent.claudeSandboxUnavailable":
    "Alleen werkruimte heeft de Claude-sandbox nodig, maar Claude kan die op deze computer niet starten: {reason}. Kies Volledige toegang of een andere aanbieder in de instellingen van de agent.",
  "error.agent.screenCaptureOff":
    "Schermopname staat uit voor deze agent. De gebruiker kan Computerbesturing aanzetten in de instellingen van de agent.",
  "error.agent.screenCaptureUnavailable": "Schermopname is niet beschikbaar op deze computer.",
  "error.agent.screenCaptureShared":
    "Schermopname werkt niet in een gesprek in Slack, Discord of Telegram, omdat andere mensen de bestanden krijgen.",
  "error.agent.screenCaptureDeclined": "De gebruiker heeft deze schermopname niet toegestaan. Er is niets opgenomen.",
  "error.agent.mcpServerDeclined":
    "De gebruiker heeft deze wijziging van de MCP-server niet toegestaan. Er is niets gewijzigd.",
  "error.agent.mcpServerNotSaved": "De MCP-server reageerde niet, dus is hij niet opgeslagen. {error}",
  "error.agent.mcpServerKeysMove":
    "De MCP-server {name} bewaart sleutels voor de huidige server. Vraag de gebruiker om het adres, de opdracht, de argumenten of het transport te wijzigen in Serverinstellingen, MCP.",
  "error.agent.mcpServerUnknown": "Er is geen MCP-server met de naam {name}. Roep list_mcp_servers aan voor de namen.",
  "error.agent.screenCaptureWindowMissing":
    "Dat venster is nu niet open. Roep list_capture_sources aan voor de huidige venster-id’s.",
  "error.agent.screenCaptureDisplayMissing":
    "Dat beeldscherm is nu niet verbonden. Roep list_capture_sources aan voor de huidige beeldscherm-id’s.",
  "error.agent.screenCaptureRegionOutside":
    "Het gebied valt niet binnen één beeldscherm. Gebruik bureaubladpunten binnen de grenzen van één beeldscherm uit list_capture_sources.",
  "error.agent.screenCapturePermissionMissing":
    "OpenBot heeft geen toestemming voor schermopname. Vraag de gebruiker om Systeeminstellingen > Privacy en beveiliging > Scherm- en systeemaudio-opname te openen, OpenBot aan te zetten en OpenBot daarna te stoppen en opnieuw te openen.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows gaf een leeg beeld. Vraag de gebruiker om de computer te ontgrendelen en beschermde inhoud te sluiten. Ook een beleid van de organisatie kan schermopname blokkeren.",
  "error.agent.screenCaptureFailed": "De schermopname is mislukt. Probeer het opnieuw.",
} as const satisfies PartialTranslation<typeof source>;
