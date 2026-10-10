import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "Historia jest niedostępna dla tego żądania. Odczytaj ponownie najnowszą historię lub użyj channel_history do pracy z kanałem.",
  "error.agent.toolRequestInvalid":
    "Nieprawidłowe argumenty wyszukiwania narzędzi. Użyj zadeklarowanego schematu i oryginalnej kwalifikowanej nazwy narzędzia.",
  "error.agent.approvalWhileDeleting": "Nie można udzielić zatwierdzenia podczas usuwania agenta.",
  "error.agent.accessLocalOnly": "Dostęp agenta można zmienić tylko na komputerze, na którym działa agent.",
  "error.agent.duplicateCleanupFailed": "Duplikowanie agenta nie powiodło się i nie udało się usunąć niepełnej kopii.",
  "error.agent.commitEffectsFailed": "Transakcja została zatwierdzona, ale jej zapisane efekty nie powiodły się.",
  "error.agent.settingsLocalOnly": "Ustawienia agenta można zmienić tylko na komputerze, na którym działa agent.",
  "error.agent.skillsLocalOnly": "Umiejętności można zmienić tylko na komputerze, na którym działa agent.",
  "error.agent.addLocalOnly": "Agentów można dodawać tylko na komputerze, na którym działają.",
  "error.agent.joinedServerUpdate": "Agenta na dołączonym serwerze nie można stąd zaktualizować.",
  "error.agent.searchQueryRequired": "Wymagane jest zapytanie wyszukiwania.",
  "error.agent.messageTooLong": "Wiadomość jest za długa.",
  "error.agent.messageOrAttachmentRequired": "Wymagana jest wiadomość lub załącznik.",
  "error.agent.promptAnswersTooLong": "Odpowiedzi na pytania są za długie.",
  "error.agent.gone": "Ten agent już nie istnieje.",
  "error.agent.profileGenerationBusy": "Generowanie profilu jest zajęte. Spróbuj ponownie za chwilę.",
  "error.agent.initialMessageRequired": "Wymagana jest wiadomość początkowa.",
  "error.agent.initialMessageTooLong": "Wiadomość początkowa jest za długa.",
  "error.agent.setupCleanupFailed": "Konfiguracja agenta nie powiodła się i nie udało się usunąć niepełnego agenta.",
  "error.agent.modelUnavailable": "Wybrany model agenta jest niedostępny.",
  "error.agent.modelProviderNotConnected":
    "Wybrany model agenta „{model}” jest niedostępny: {provider} nie jest połączony.",
  "error.agent.modelListEmpty":
    "Wybrany model agenta „{model}” jest niedostępny: {provider} nie zwrócił żadnych modeli. Ostatni błąd: {detail}",
  "error.agent.modelListEmptyNoError":
    "Wybrany model agenta „{model}” jest niedostępny: {provider} nie zwrócił żadnych modeli.",
  "error.agent.modelNotInProviderList":
    "Wybrany model agenta „{model}” jest niedostępny: {provider} nie ma go na liście.",
  "error.agent.modelProviderMismatch": "Wybrany model nie należy do tego dostawcy.",
  "error.agent.modelNotListed": "Model „{model}” jest niedostępny. Dostępne modele: {models}.",
  "error.agent.providerNotListed":
    "Żaden model {provider} nie jest teraz dostępny. Wywołaj list_models, aby zobaczyć dostępne modele.",
  "error.agent.reasoningEffortUnsupported":
    "Model „{model}” nie obsługuje poziomu rozumowania „{effort}”. Obsługiwane poziomy: {efforts}.",
  "error.agent.noStartingModelInSettings":
    "{provider} nie ma dostępnego modelu i nie ma go też żaden inny zalogowany dostawca. Zaloguj się do dostawcy lub zmień domyślnego dostawcę w sekcji Ustawienia serwera → Dostawcy.",
  "error.agent.noStartingModel":
    "{provider} nie ma dostępnego modelu i nie ma go też żaden inny zalogowany dostawca. Zaloguj się do dostawcy lub zmień domyślnego dostawcę w sekcji „Dostawcy i uprawnienia”.",
  "error.agent.waitBeforeProviderChange": "Poczekaj, aż bieżąca tura i kolejka się zakończą, zanim zmienisz dostawcę.",
  "error.agent.waitBeforeClearContext":
    "Poczekaj, aż bieżąca tura i kolejka się zakończą, zanim rozpoczniesz nowy czat.",
  "error.agent.unknown": "Nieznany agent: {id}",
  "error.agent.onlyUserWidensSettings":
    "Tylko użytkownik może dać agentowi pełny dostęp lub włączyć Sterowanie komputerem. Poproś użytkownika o zmianę w ustawieniach agenta.",
  "error.agent.queuedMessageCreateFailed": "Nie udało się utworzyć wiadomości w kolejce.",
  "error.agent.messageUnavailable": "Wiadomość nie jest już dostępna.",
  "error.agent.hostLimit": "Host może mieć maksymalnie {limit} agentów.",
  "error.agent.changedWhileDuplicating": "Agent zmienił się podczas duplikowania. Spróbuj ponownie.",
  "error.agent.duplicatedAgentGone": "Zduplikowany agent już nie istnieje.",
  "error.agent.stateCorrupt": "Stan agenta jest uszkodzony lub pochodzi z nowszej wersji OpenBot; odmowa nadpisania.",
  "error.agent.oldRoleField":
    "Zapisane profile agentów używają starego pola roli; zaktualizuj dane przed uruchomieniem OpenBot.",
  "error.agent.duplicateIds": "Stan agentów zawiera zduplikowane identyfikatory agentów; odmowa nadpisania.",
  "error.agent.copyNameFailed": "OpenBot nie mógł utworzyć unikalnej nazwy kopii agenta.",
  "error.agent.endpointRemoved": "Endpoint używany przez tego agenta został usunięty. Wybierz dla niego inny model.",
  "error.agent.selectedGone": "Wybrany agent już nie istnieje.",
  "error.agent.profileEndpointsChanged": "Własne endpointy zmieniły się w trakcie generowania. Spróbuj ponownie.",
  "error.agent.profileInvalid": "Dostawca zwrócił nieprawidłowy profil. Spróbuj zmienić prompt.",
  "error.agent.profileSectionUnavailable":
    "Wygenerowana sekcja jest niedostępna. Spróbuj ponownie lub wybierz sekcję ręcznie.",
  "error.agent.profileTimedOut": "Przekroczono czas generowania profilu. Spróbuj ponownie.",
  "error.agent.profileDisconnected": "Dostawca rozłączył się podczas generowania profilu.",
  "error.agent.profileToolUse": "Dostawca próbował użyć narzędzia. Spróbuj zmienić prompt.",
  "error.agent.profileFailed": "Dostawca nie mógł wygenerować profilu. Spróbuj ponownie.",
  "error.agent.profileTooLarge": "Wygenerowany profil jest za duży. Spróbuj krótszego promptu.",
  "error.agent.profileNotStarted": "Dostawca nie mógł rozpocząć generowania profilu.",
  "error.agent.deletionBusy": "Usuwanie agenta już trwa.",
  "error.agent.stopBeforeDelete": "Zatrzymaj agenta i anuluj wiadomości w kolejce, zanim go usuniesz.",
  "error.agent.deleteIncomplete": "Nie udało się całkowicie usunąć danych agenta. Spróbuj ponownie usunąć agenta.",
  "error.agent.duplicationBusy": "Ten agent jest już duplikowany.",
  "error.agent.waitBeforeDuplicate": "Poczekaj, aż agent skończy i opróżni kolejkę, zanim go zduplikujesz.",
  "error.agent.saveOtherAgent": "Ten zapis należy do innego agenta.",
  "error.agent.savedGone": "Zapisany agent już nie istnieje.",
  "error.agent.storedProfileUnreadable":
    "Zapisany profil agenta ma nieczytelną wartość „{field}”; zaktualizuj dane przed uruchomieniem OpenBot.",
  "error.agent.storedProfileUnreadableId":
    "Zapisany profil agenta {id} ma nieczytelną wartość „{field}”; zaktualizuj dane przed uruchomieniem OpenBot.",
  "error.agent.queueEditRejected": "Odrzucono edycję kolejki: {reason}",
  "error.agent.computerUseLocalOnly":
    "Sterowanie komputerem można zmienić tylko na komputerze, na którym działa agent.",
  "error.agent.automationLocalOnly": "Na lokalne skrypty można zezwolić tylko na komputerze, na którym działa agent.",
  "error.agent.busyMessageModeLocalOnly":
    "Zachowanie wiadomości podczas pracy agenta można ustawić tylko na komputerze, na którym działa agent.",
  "error.agent.localScriptsOff": "Ten agent nie zezwala na lokalne skrypty.",
  "error.agent.localScriptsRateLimited":
    "Lokalne skrypty wysłały do tego agenta {limit} żądań wiadomości lub rutyn w ciągu ostatniej godziny. Spróbuj ponownie później.",
  "error.agent.automationOff": "Ten agent nie zezwala lokalnym skryptom na uruchamianie jego rutyn.",
  "error.agent.automationPayloadTooLong": "Dane są dłuższe niż {limit} znaków.",
  "error.agent.automationRateLimited":
    "Lokalne skrypty uruchomiły rutyny tego agenta {limit} razy w ciągu ostatniej godziny. Spróbuj ponownie później.",
  "error.agent.workspaceOnlyMacOnly":
    "Tryb „Tylko obszar roboczy” jest dla tego dostawcy dostępny wyłącznie w macOS. Wybierz pełny dostęp w ustawieniach agenta.",
  "error.agent.lowMemory":
    "Na tym serwerze brakuje pamięci. Twoja wiadomość czeka w kolejce i ruszy, gdy pamięć się zwolni. Większy plan daje serwerowi więcej pamięci.",
  "error.agent.workspaceOnlyToolMissing":
    "Tryb „Tylko obszar roboczy” wymaga narzędzia {tool}, którego OpenBot nie znalazł. Zainstaluj je lub wybierz pełny dostęp w ustawieniach agenta.",
} as const satisfies PartialTranslation<typeof source>;
