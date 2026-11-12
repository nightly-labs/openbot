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
  "error.import.unsafeFile": "Eksport zawiera niebezpieczny plik: {name}",
  "error.import.tooManyFiles": "Eksport może mieć najwyżej {limit} plików.",
  "error.import.diskSpace":
    "{name}: jego pliki potrzebują {size} GB wolnego miejsca na dysku, a wolne jest {free} GB. Zwolnij miejsce i zaimportuj agenta ponownie.",
  "error.import.remoteExpandedTooLarge": "Po rozpakowaniu eksport musi mieć poniżej 500 MB i {limit} plików.",
  "error.import.zipInvalid":
    "Wybrany plik nie jest prawidłowym plikiem .zip. Jeśli Grok Bot nadal go zapisuje, zaczekaj i wybierz go ponownie.",
  "error.import.entryDamaged": "Plik w eksporcie jest uszkodzony.",
  "error.import.foldersSkipped":
    "Pominięto {number} plików z folderów .git i node_modules. Narzędzie może je utworzyć ponownie.",
  "error.import.empty": "Eksport jest pusty.",
  "error.import.remoteZipTooLarge":
    "Aby zaimportować na dołączony serwer, eksport musi być plikiem .zip poniżej 100 MB.",
  "error.import.hostBusy": "Serwer odczytuje inne eksporty. Spróbuj ponownie za kilka minut.",
  "error.import.uploadDiskSpace":
    "Eksport potrzebuje {size} GB wolnego miejsca na serwerze, a wolne jest {free} GB. Zwolnij miejsce na serwerze, a potem wybierz eksport ponownie.",
  "error.import.remoteZipTooLargeOldHost":
    "Ten serwer przyjmuje eksport do 100 MB. Zaktualizuj OpenBot na serwerze, aby zaimportować większy eksport.",
  "error.import.skillKept":
    "{name}: serwer ma już umiejętność „{skill}”, więc agent używa tej umiejętności. Poproś administratora o jej aktualizację.",
  "error.import.skillRenamed":
    "{name}: nazwa umiejętności „{skill}” jest zbyt podobna do nazwy innej umiejętności, więc jest zapisana jako „{renamed}”.",
  "error.import.transferRemoteTooLarge":
    "Plik przeniesienia dla dołączonego serwera musi mieć mniej niż 100 MB. Wyłącz pliki obszaru roboczego albo wyeksportuj mniej agentów.",
  "error.import.transferNotFile": "To nie jest plik przeniesienia OpenBot.",
  "error.import.transferNewer": "Ten plik utworzyła nowsza wersja OpenBot. Zaktualizuj OpenBot i spróbuj ponownie.",
  "error.import.transferEmpty": "Plik nie zawiera agentów ani ustawień.",
  "error.import.transferTooLarge":
    "Plik przeniesienia musi mieć mniej niż 2 GB i 50 000 plików. Wyłącz pliki obszaru roboczego albo wyeksportuj mniej agentów.",
  "error.import.transferAgentInvalid": "Agent nr {number} w pliku jest nieprawidłowy, więc zostaje pominięty.",
  "error.import.transferSettingsInvalid":
    "Ustawienia aplikacji w pliku są nieprawidłowe, więc nie zostaną zaimportowane.",
  "error.import.transferModelMissing":
    "{name}: model „{model}” nie jest tu jeszcze dostępny, więc agent używa modelu domyślnego. Wybierz model ponownie, gdy jego dostawca będzie gotowy.",
  "error.import.transferSettingSkipped": "Nie zaimportowano: {name}. {reason}",
  "error.import.transferRoutineFlowSkipped": "Import pominął przepływ rutyny. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: własni agenci nie są importowani, ponieważ uruchamiają polecenie. Sprawdź polecenie „{command}” i dodaj agenta ponownie w Ustawieniach.",
  "error.import.transferSkillLimit":
    "{name}: plik zawiera tylko początkowe umiejętności tego agenta ({limit} z {total}), ponieważ agent może mieć maksymalnie {limit} umiejętności.",
  "error.import.transferFilesGone": "Liczba plików usuniętych podczas eksportu: {number}. Nie ma ich w pliku.",
  "error.import.transferProviderKey": "{name}: wpisz ponownie klucz API w Ustawieniach.",
  "error.import.transferAgentEnv": "{name}: wpisz ponownie wartości {names} w Ustawieniach.",
  "error.import.transferMcpValues":
    "{name}: serwer MCP został dodany jako wyłączony. Sprawdź jego polecenie, wpisz ponownie wartości i pełny adres, a potem włącz go w ustawieniach MCP.",
  "error.import.transferValuesCleared":
    "{name}: z argumentów lub adresu usunięto wartości, które mogą zawierać sekret. Wpisz je ponownie w Ustawieniach.",
  "error.import.transferSharedKept":
    "Liczba plików z folderu współdzielonego, które już tu są: {number}. Zostają bez zmian.",
} as const satisfies PartialTranslation<typeof source>;
