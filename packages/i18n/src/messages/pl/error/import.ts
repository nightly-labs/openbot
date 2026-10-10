import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} nie jest prawidłowym plikiem JSON.",
  "error.import.notAgentExport": "{manifest} nie jest eksportem agenta OpenBot.",
  "error.import.newerExportSkill":
    "Ten eksport utworzyła nowsza umiejętność eksportu. Zaktualizuj OpenBot i spróbuj ponownie.",
  "error.import.noAgents": "Eksport nie zawiera agentów.",
  "error.import.tooManyAgents": "Eksport zawiera więcej niż {limit} agentów.",
  "error.import.tooManyChannels": "Eksport zawiera więcej niż {limit} kanałów.",
  "error.import.channelSkipped": "{name}: pominięto kanał, ponieważ żadnego z jego agentów nie ma w eksporcie.",
  "error.import.membersLeftOut": "{name}: pominięto członków, którzy nie są agentami w tym eksporcie.",
  "error.import.leadNotMember": "{name}: lider nie jest członkiem, więc kanał nie ma lidera.",
  "error.import.routineLimit": "{name}: zaimportowano tylko pierwsze rutyny (limit: {limit}).",
  "error.import.routineInvalid":
    "{name}: pominięto rutynę „{routine}”, ponieważ jej nazwa, tekst lub harmonogram są nieprawidłowe.",
  "error.import.memoriesSkipped":
    "{name}: pominięto wspomnienia ({skipped}), ponieważ są puste lub dłuższe niż {limit} znaków.",
  "error.import.memoryLimit": "{name}: zaimportowano tylko pierwsze wspomnienia (limit: {limit}).",
  "error.import.manifestMissing": "Eksport musi zawierać {manifest}.",
  "error.import.skillFolderMissing": "{name}: folder umiejętności {skill} nie zawiera SKILL.md.",
  "error.import.avatarSkipped":
    "{name}: pominięto awatar, ponieważ nie jest plikiem PNG, JPEG ani WebP poniżej 512 KB.",
  "error.import.exportClosed": "Eksport nie jest już otwarty. Wybierz go ponownie.",
  "error.import.agentNotInExport": "Wybór wskazuje agenta, którego nie ma w eksporcie.",
  "error.import.channelNotInExport": "Wybór wskazuje kanał, którego nie ma w eksporcie.",
  "error.import.serverAgentLimit": "Serwer może mieć najwyżej {limit} agentów.",
  "error.import.exportChanged": "Eksport zmienił się po sprawdzeniu. Wybierz go ponownie.",
  "error.import.noMembersImported": "Nie zaimportowano żadnego z jego agentów.",
  "error.import.leadNotImported": "{name}: nie zaimportowano lidera, więc kanał nie ma lidera.",
  "error.import.routineSkipped": "{name}: pominięto rutynę „{routine}”. {reason}",
  "error.import.fileRenamed": "{name}: {file} już istnieje, więc tę kopię zapisano jako {saved}.",
  "error.import.fileSkipped": "{name}: pominięto plik {file}. {reason}",
  "error.import.chooseZip": "Wybierz plik .zip.",
  "error.import.zipTooLarge": "Eksport musi być plikiem .zip poniżej 500 MB.",
  "error.import.unsafeFile": "Eksport zawiera niebezpieczny plik: {name}",
  "error.import.expandedTooLarge": "Po rozpakowaniu eksport musi mieć poniżej 500 MB i {limit} plików.",
  "error.import.zipInvalid":
    "Wybrany plik nie jest prawidłowym plikiem .zip. Jeśli Grok Bot nadal go zapisuje, zaczekaj i wybierz go ponownie.",
  "error.import.empty": "Eksport jest pusty.",
  "error.import.remoteZipTooLarge":
    "Aby zaimportować na dołączony serwer, eksport musi być plikiem .zip poniżej 100 MB.",
  "error.import.hostBusy": "Serwer odczytuje inne eksporty. Spróbuj ponownie za kilka minut.",
  "error.import.skillKept":
    "{name}: serwer ma już umiejętność „{skill}”, więc agent używa tej umiejętności. Poproś administratora o jej aktualizację.",
} as const satisfies PartialTranslation<typeof source>;
