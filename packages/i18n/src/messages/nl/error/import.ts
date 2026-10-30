import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} is geen geldige JSON.",
  "error.import.notAgentExport": "{manifest} is geen agentexport van OpenBot.",
  "error.import.newerExportSkill":
    "Deze export is gemaakt door een nieuwere exportvaardigheid. Werk OpenBot bij en probeer het opnieuw.",
  "error.import.noAgents": "De export bevat geen agents.",
  "error.import.tooManyAgents": "De export bevat meer dan {limit} agents.",
  "error.import.tooManyChannels": "De export bevat meer dan {limit} kanalen.",
  "error.import.channelSkipped": "{name}: het kanaal is overgeslagen, omdat geen van de agents in de export zit.",
  "error.import.membersLeftOut": "{name}: leden die geen agent in deze export zijn, zijn weggelaten.",
  "error.import.leadNotMember": "{name}: de leider is geen lid, dus het kanaal heeft geen leider.",
  "error.import.routineLimit": "{name}: alleen de eerste {limit} routines zijn geïmporteerd.",
  "error.import.routineInvalid":
    "{name}: routine “{routine}” is overgeslagen, omdat de naam, tekst of planning ongeldig is.",
  "error.import.memoriesSkipped":
    "{name}: {skipped} herinneringen zijn overgeslagen, omdat ze leeg zijn of langer dan {limit} tekens.",
  "error.import.memoryLimit": "{name}: alleen de eerste {limit} herinneringen zijn geïmporteerd.",
  "error.import.manifestMissing": "De export moet {manifest} bevatten.",
  "error.import.skillFolderMissing": "{name}: de vaardigheidsmap {skill} heeft geen SKILL.md.",
  "error.import.avatarSkipped":
    "{name}: de avatar is overgeslagen, omdat het geen PNG, JPEG of WebP van minder dan 512 KB is.",
  "error.import.exportClosed": "De export is niet meer open. Kies hem opnieuw.",
  "error.import.agentNotInExport": "De selectie noemt een agent die niet in de export zit.",
  "error.import.channelNotInExport": "De selectie noemt een kanaal dat niet in de export zit.",
  "error.import.serverAgentLimit": "Een server kan maximaal {limit} agents hebben.",
  "error.import.exportChanged": "De export is gewijzigd nadat hij is gecontroleerd. Kies hem opnieuw.",
  "error.import.noMembersImported": "Geen van de agents is geïmporteerd.",
  "error.import.leadNotImported": "{name}: de leider is niet geïmporteerd, dus er is geen leider.",
  "error.import.routineSkipped": "{name}: routine “{routine}” is overgeslagen. {reason}",
  "error.import.fileRenamed": "{name}: {file} bestaat al, dus deze kopie is opgeslagen als {saved}.",
  "error.import.fileSkipped": "{name}: het bestand {file} is overgeslagen. {reason}",
  "error.import.chooseZip": "Kies een .zip-bestand.",
  "error.import.zipTooLarge": "De export moet een .zip van minder dan 500 MB zijn.",
  "error.import.unsafeFile": "De export bevat een onveilig bestand: {name}",
  "error.import.expandedTooLarge": "Uitgepakt moet de export kleiner zijn dan 500 MB en {limit} bestanden.",
  "error.import.zipInvalid":
    "Het gekozen bestand is geen geldige .zip. Als Grok Bot het nog opslaat, wacht dan en kies het opnieuw.",
  "error.import.empty": "De export is leeg.",
  "error.import.remoteZipTooLarge":
    "Om te importeren in een server waaraan je deelneemt, moet de export een .zip van minder dan 100 MB zijn.",
  "error.import.hostBusy": "De server leest andere exports. Probeer het over een paar minuten opnieuw.",
  "error.import.skillKept":
    "{name}: de server heeft de vaardigheid “{skill}” al, dus de agent gebruikt die vaardigheid. Vraag een beheerder om deze bij te werken.",
  "error.import.hermesNoProfiles":
    "Deze map heeft geen Hermes-profielen. Kies de Hermes-map, met config.yaml of SOUL.md.",
  "error.import.hermesClosed": "De Hermes-profielen zijn niet meer open. Lees ze opnieuw.",
  "error.import.hermesProfileMissing": "De selectie noemt een Hermes-profiel dat niet is gelezen.",
  "error.import.hermesSoulLong":
    "{name}: SOUL.md is langer dan {limit} tekens, dus de instructies bevatten alleen het begin. Het volledige bestand staat in imported/hermes/SOUL.md.",
  "error.import.hermesSkillSkipped": "{name}: de vaardigheid “{skill}” is overgeslagen. {reason}",
  "error.import.hermesSkillCodeAdded":
    "Er staat code in die er niet was toen de profielen werden gelezen. Lees ze opnieuw om dit toe te staan.",
  "error.import.hermesLinkNotSaved":
    "{name}: OpenBot kon niet opslaan welke agent uit dit profiel kwam, dus bij de volgende import wordt het een nieuwe agent.",
  "error.import.transferRemoteTooLarge":
    "Een overdrachtsbestand voor een server waaraan je deelneemt, moet kleiner zijn dan 100 MB. Zet werkruimtebestanden uit, of exporteer minder agents.",
  "error.import.transferNotFile": "Dit bestand is geen overdrachtsbestand van OpenBot.",
  "error.import.transferNewer":
    "Een nieuwere versie van OpenBot heeft dit bestand gemaakt. Werk OpenBot bij en probeer het opnieuw.",
  "error.import.transferEmpty": "Het bestand bevat geen agents en geen instellingen.",
  "error.import.transferTooLarge":
    "Een overdrachtsbestand moet kleiner zijn dan 2 GB en 50.000 bestanden. Zet werkruimtebestanden uit, of exporteer minder agents.",
  "error.import.transferAgentInvalid": "Agent {number} in het bestand is ongeldig, dus deze is overgeslagen.",
  "error.import.transferSettingsInvalid":
    "De app-instellingen in het bestand zijn ongeldig, dus ze zijn niet geïmporteerd.",
  "error.import.transferModelMissing":
    "{name}: het model “{model}” is hier nog niet beschikbaar, dus de agent gebruikt het standaardmodel. Kies het model opnieuw als de aanbieder klaar is.",
  "error.import.transferSettingSkipped": "{name} is niet geïmporteerd. {reason}",
  "error.import.transferRoutineFlowSkipped": "De import heeft een routineflow weggelaten. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: aangepaste agents worden niet geïmporteerd, omdat ze een opdracht uitvoeren. Controleer de opdracht “{command}” en voeg de agent opnieuw toe in Instellingen.",
  "error.import.transferSkillLimit":
    "{name}: alleen de eerste {limit} van de {total} vaardigheden staan in het bestand, omdat een agent {limit} vaardigheden kan hebben.",
  "error.import.transferFilesGone":
    "{number} bestanden zijn verwijderd terwijl de export liep, dus ze staan niet in het bestand.",
  "error.import.transferProviderKey": "{name}: voer de API-sleutel opnieuw in bij Instellingen.",
  "error.import.transferAgentEnv": "{name}: voer de waarden van {names} opnieuw in bij Instellingen.",
  "error.import.transferMcpValues":
    "{name}: de MCP-server is uitgeschakeld toegevoegd. Controleer de opdracht, voer de waarden en het volledige adres opnieuw in, en zet hem aan in de MCP-instellingen.",
  "error.import.transferValuesCleared":
    "{name}: waarden die een geheim kunnen bevatten, zijn verwijderd uit de argumenten of het adres. Voer ze opnieuw in bij Instellingen.",
  "error.import.transferSharedKept": "{number} bestanden in de map Shared staan hier al, dus ze blijven zoals ze zijn.",
} as const satisfies PartialTranslation<typeof source>;
