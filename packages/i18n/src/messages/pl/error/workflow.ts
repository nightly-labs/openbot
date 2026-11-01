import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Ten przepływ pracy już nie istnieje.",
  "error.workflow.versionMissing": "Ta wersja przepływu pracy już nie istnieje.",
  "error.workflow.annotation": "Teksty, notatki i kształty nie mogą mieć połączeń.",
  "error.workflow.port": "Krok nie może przyjąć tego typu danych.",
  "error.workflow.branch": "Tylko warunek może mieć połączenia tak i nie.",
  "error.workflow.conditionBranch": "Każde połączenie z warunku musi być tak albo nie.",
  "error.workflow.duplicateEdge": "Te dwa kroki mają już to połączenie.",
  "error.workflow.serverTooOld":
    "Ten serwer nie obsługuje przepływów pracy. Zaktualizuj OpenBot na komputerze, na którym działa.",
  "error.workflow.nodeUnsupported": "Ta wersja OpenBot nie może jeszcze uruchamiać kroków obrazu, pliku i wiadomości.",
  "error.workflow.interrupted": "OpenBot zatrzymał się podczas tego kroku. Uruchom go ponownie.",
  "error.workflow.agentMissing": "Wybierz agenta dla tego kroku.",
  "error.workflow.handoffFailed": "OpenBot nie mógł wysłać tego kroku do jego agenta.",
  "error.workflow.agentStepEnded": "Wiadomość do agenta została usunięta, zanim odpowiedział.",
  "error.workflow.conditionUnclear": "Model nie odpowiedział tak ani nie.",
  "error.workflow.modelFailed": "Model nie mógł odpowiedzieć. Uruchom krok ponownie.",
  "error.workflow.modelBusy": "Trwa inne zapytanie do modelu. Uruchom krok ponownie za chwilę.",
  "error.workflow.stepMissing": "Ten krok już nie istnieje.",
  "error.workflow.nodeMissing": "Tego kroku nie ma w przepływie pracy.",
  "error.workflow.runMissing": "To uruchomienie już nie istnieje.",
  "error.workflow.notRetryable": "Ponownie można uruchomić tylko krok, który się nie powiódł lub został zatrzymany.",
  "error.workflow.noDecision": "Ten krok nie czeka na decyzję.",
  "error.workflow.outputPlaceMissing": "Wybierz miejsce w komunikatorze dla tego wyjścia.",
  "error.workflow.outputConnectionOff":
    "Połączenie komunikatora tego wyjścia jest wyłączone lub usunięte. Wybierz miejsce ponownie.",
  "error.workflow.outputNotRunning": "Połączenie komunikatora teraz nie działa. Spróbuj ponownie, gdy zacznie działać.",
  "error.workflow.outputRefused": "Miejsce odrzuciło wpis. Upewnij się, że OpenBot może tam publikować.",
  "error.workflow.outputUncertain":
    "Wpis zatrzymał się w drodze. Jego część może już być w tym miejscu. Sprawdź to, zanim spróbujesz ponownie.",
  "error.workflow.tooLarge":
    "Ten workflow jest za duży, aby go zapisać. Usuń część rysunków lub długich tekstów i spróbuj ponownie.",
  "error.workflow.tooLargeToSend":
    "Ten workflow jest za duży, aby wysłać go na inny komputer. Otwórz go na komputerze, na którym działa serwer.",
  "error.workflow.webhookMissing": "Ten krok nie jest wyzwalaczem webhook. Zapisz przepływ pracy i spróbuj ponownie.",
  "error.workflow.githubActionMissing": "Wybierz, co to wyjście robi w GitHub.",
  "error.workflow.githubRepositoryMissing": "Wybierz repozytorium dla tego wyjścia.",
  "error.workflow.githubItemMissing":
    "To wyjście nie ma zgłoszenia ani pull requestu. Uruchom przepływ ze zdarzenia GitHub albo wpisz numer na jego wejściu.",
  "error.workflow.githubPullRequestOnly": "Ta akcja działa tylko dla pull requestów.",
  "error.workflow.githubTextMissing": "To wyjście nie ma tekstu do wysłania. Połącz krok, który go pisze.",
  "error.workflow.githubEventText":
    "To wyjście nie może wysłać surowego zdarzenia wyzwalacza. Umieść agenta między wyzwalaczem a tym wyjściem.",
  "error.workflow.githubChoiceMissing": "Wybierz etykiety lub osobę dla tego wyjścia.",
  "error.workflow.githubChoseNothing": "Model nie wybrał żadnej etykiety ani osoby z tego repozytorium.",
  "error.workflow.githubNotConnected": "Połącz GitHub na komputerze, na którym działa ten przepływ pracy.",
  "error.workflow.githubNoAccess":
    "OpenBot GitHub App nie widzi tego repozytorium ani elementu. Otwórz GitHub i daj jej dostęp.",
  "error.workflow.githubNoWrite":
    "OpenBot GitHub App nie może zmieniać tego repozytorium. Otwórz GitHub i daj jej dostęp.",
  "error.workflow.githubLocked": "Ta rozmowa jest zablokowana w GitHub.",
  "error.workflow.githubRefused": "GitHub odrzucił zmianę: {detail}",
  "error.workflow.githubUnreachable": "OpenBot nie mógł połączyć się z GitHub. Uruchom krok ponownie.",
  "error.workflow.githubUncertain":
    "Zmiana zatrzymała się w drodze. Może już być w GitHub. Sprawdź tam, zanim ponownie uruchomisz krok.",
  "error.workflow.githubNoEvent": "W GitHub nie ma zgłoszenia ani pull requestu, dla którego startuje ten wyzwalacz.",
} as const satisfies PartialTranslation<typeof source>;
