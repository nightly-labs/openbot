import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Zapis {path} poza obszarem roboczym agenta, folderem współdzielonym i folderami tymczasowymi.",
  "status.agent.contextCleared": "Kontekst wyczyszczony. Tutaj zaczyna się nowy czat.",
  "status.agent.modelSwitchedForLimit": "Osiągnięto limit użycia. Przełączono na {model}.",
  "status.agent.modelReturnedAfterLimit": "Limit użycia już nie obowiązuje. Przełączono z powrotem na {model}.",
  "status.agent.modelSwitchedForError": "Błąd dostawcy. Przełączono na {model}.",
  "status.agent.modelReturnedAfterError": "Po błędzie dostawcy przełączono z powrotem na {model}.",
  "status.agent.marketplaceSuggested": "Zaproponowano aplikację z Marketplace: {app}.",
  "status.agent.channelMemberAdded": "Agent {agent} dodał {member} do kanału. Prośba od: {person}.",
  "status.agent.channelMemberRemoved": "Agent {agent} usunął {member} z kanału. Prośba od: {person}.",
  "status.agent.channelInstructionsChanged": "Agent {agent} zmienił instrukcje kanału. Prośba od: {person}.",
  "status.agent.channelRoutineCreated": "Agent {agent} utworzył rutynę {routine}. Prośba od: {person}.",
  "status.agent.channelRoutineUpdated": "Agent {agent} zmienił rutynę {routine}. Prośba od: {person}.",
  "status.agent.channelRoutineDeleted": "Agent {agent} usunął rutynę {routine}. Prośba od: {person}.",
  "status.agent.screenCaptureScreen": "Przechwyć główny ekran i wyślij obraz do modelu agenta.",
  "status.agent.screenCaptureChannel":
    "Obraz pojawi się na kanale {channel} i każdy członek tego serwera, który czyta kanał, może go zobaczyć.",
  "status.agent.screenCaptureDisplay": "Przechwyć wyświetlacz {name} i wyślij obraz do modelu agenta.",
  "status.agent.screenCaptureWindow": "Przechwyć okno {name} i wyślij obraz do modelu agenta.",
  "status.agent.screenCaptureRegion":
    "Przechwyć obszar ekranu w punkcie {x}, {y} o rozmiarze {width} × {height} punktów i wyślij obraz do modelu agenta.",
  "status.agent.screenCaptureProgress": "Prośba o przechwycenie ekranu…",
  "status.agent.screenCaptureReviewing": "Sprawdzanie przechwyconego ekranu…",
  "status.agent.browserOpening": "Otwieranie strony internetowej…",
  "status.agent.browserReading": "Czytanie strony internetowej…",
  "status.agent.browserClicking": "Klikanie na stronie internetowej…",
  "status.agent.browserTyping": "Wpisywanie na stronie internetowej…",
  "status.agent.browserActing": "Korzystanie ze strony internetowej…",
  "status.agent.browserReviewing": "Sprawdzanie strony internetowej…",
  "status.agent.memoriesSearching": "Przeszukiwanie wspomnień…",
  "status.agent.memoriesSearched": {
    one: "Przeszukano wspomnienia, znalezione: {count}",
    few: "Przeszukano wspomnienia, znalezione: {count}",
    many: "Przeszukano wspomnienia, znalezione: {count}",
    other: "Przeszukano wspomnienia, znalezione: {count}",
  },
  "status.agent.memoriesUpdating": "Aktualizowanie wspomnień…",
  "status.agent.skillUsing": "Używanie umiejętności {name}…",
  "status.agent.skillReading": "Czytanie umiejętności…",
  "status.agent.memoryChanges": "Wspomnienia: zapisane {saved}, zaktualizowane {updated}, zapomniane {forgotten}.",
  "status.agent.memoryChangesWithConflicts":
    "Wspomnienia: zapisane {saved}, zaktualizowane {updated}, zapomniane {forgotten}, niezmienione {notChanged}, bo inny wątek zmienił je wcześniej.",
  "status.agent.planContinues": "Plan ma otwarte kroki. Agent kontynuuje ({current} z {limit}).",
  "status.agent.branchTitle": "Odgałęziony czat",
} as const satisfies PartialTranslation<typeof source>;
