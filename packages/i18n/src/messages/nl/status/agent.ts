import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "{path} schrijven, buiten de werkruimte van de agent, de gedeelde map en de tijdelijke mappen.",
  "status.agent.contextCleared": "Context gewist. Hier begint een nieuwe chat.",
  "status.agent.modelSwitchedForLimit": "Gebruikslimiet bereikt. Overgeschakeld naar {model}.",
  "status.agent.modelReturnedAfterLimit": "Gebruikslimiet voorbij. Teruggeschakeld naar {model}.",
  "status.agent.modelSwitchedForError": "Fout bij de aanbieder. Overgeschakeld naar {model}.",
  "status.agent.modelReturnedAfterError": "Teruggeschakeld naar {model} na de fout bij de aanbieder.",
  "status.agent.marketplaceSuggested": "Een app uit de marktplaats voorgesteld: {app}.",
  "status.agent.channelMemberAdded": "{agent} heeft {member} aan het kanaal toegevoegd. {person} vroeg erom.",
  "status.agent.channelMemberRemoved": "{agent} heeft {member} uit het kanaal verwijderd. {person} vroeg erom.",
  "status.agent.channelInstructionsChanged": "{agent} heeft de kanaalinstructies gewijzigd. {person} vroeg erom.",
  "status.agent.channelRoutineCreated": "{agent} heeft de routine {routine} gemaakt. {person} vroeg erom.",
  "status.agent.channelRoutineUpdated": "{agent} heeft de routine {routine} gewijzigd. {person} vroeg erom.",
  "status.agent.channelRoutineDeleted": "{agent} heeft de routine {routine} verwijderd. {person} vroeg erom.",
  "status.agent.screenCaptureScreen": "Het hoofdscherm vastleggen en de afbeelding naar het model van de agent sturen.",
  "status.agent.screenCaptureChannel":
    "De afbeelding verschijnt in het kanaal {channel}, en elk lid van deze server dat het kanaal leest, kan haar zien.",
  "status.agent.screenCaptureDisplay":
    "Het beeldscherm {name} vastleggen en de afbeelding naar het model van de agent sturen.",
  "status.agent.screenCaptureWindow":
    "Het venster {name} vastleggen en de afbeelding naar het model van de agent sturen.",
  "status.agent.screenCaptureRegion":
    "Het schermgebied op {x}, {y}, {width} × {height} punten vastleggen en de afbeelding naar het model van de agent sturen.",
  "status.agent.vaultCardFill":
    "De opgeslagen kaart {card} invullen op {site}. Na je goedkeuring kunnen agents deze kaart op deze site invullen zonder goedkeuring. Verwijder de site in Serverinstellingen > Kluis.",
  "status.agent.vaultCardFillFrames": "De kaartvelden staan in frames van {origins}.",
  "status.agent.screenCaptureProgress": "Vraagt om het scherm vast te leggen…",
  "status.agent.screenCaptureReviewing": "Bekijkt de schermopname…",
  "status.agent.browserOpening": "Opent een webpagina…",
  "status.agent.browserReading": "Leest de webpagina…",
  "status.agent.browserClicking": "Klikt op de webpagina…",
  "status.agent.browserTyping": "Typt op de webpagina…",
  "status.agent.browserActing": "Gebruikt de webpagina…",
  "status.agent.browserReviewing": "Bekijkt de webpagina…",
  "status.agent.memoriesSearching": "Doorzoekt de herinneringen…",
  "status.agent.memoriesSearched": {
    one: "Herinneringen doorzocht: {count} gevonden",
    other: "Herinneringen doorzocht: {count} gevonden",
  },
  "status.agent.memoriesUpdating": "Werkt de herinneringen bij…",
  "status.agent.skillUsing": "Gebruikt de vaardigheid {name}…",
  "status.agent.skillReading": "Leest een vaardigheid…",
  "status.agent.memoryChanges": "Geheugen: {saved} opgeslagen, {updated} bijgewerkt, {forgotten} vergeten.",
  "status.agent.memoryChangesWithConflicts":
    "Geheugen: {saved} opgeslagen, {updated} bijgewerkt, {forgotten} vergeten, {notChanged} niet gewijzigd omdat een andere thread ze eerst heeft gewijzigd.",
  "status.agent.mcpServerAdd":
    "De MCP-server {name} toevoegen: {target}. Elke agent op deze server krijgt de tools ervan. OpenBot maakt verbinding om hem te testen.",
  "status.agent.mcpServerChange":
    "De MCP-server {name} wijzigen naar {target}. Elke agent op deze server krijgt de tools ervan. OpenBot maakt verbinding om hem te testen.",
  "status.agent.mcpServerEnable": "De MCP-server {name} aanzetten voor elke agent op deze server.",
  "status.agent.mcpServerDisable": "De MCP-server {name} uitzetten voor elke agent op deze server.",
  "status.agent.mcpServerRemove": "De MCP-server {name} en de inlog ervan verwijderen bij elke agent op deze server.",
  "status.agent.mcpSignInRequested": "De MCP-server {name} vraagt om in te loggen. Log in via Serverinstellingen, MCP.",
  "status.agent.vaultAdded": "Opgeslagen in de Kluis: {name}",
  "status.agent.vaultUpdated": "Gewijzigd in de Kluis: {name}",
  "status.agent.vaultDeleted": "Verwijderd uit de Kluis: {name}",
  "status.agent.planContinues": "Het plan heeft open stappen. De agent gaat verder ({current} van {limit}).",
} as const satisfies PartialTranslation<typeof source>;
