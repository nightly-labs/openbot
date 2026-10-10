import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "Nie udało się połączyć. Sprawdź połączenie i spróbuj ponownie.",
  "error.kind.timeout": "Żądanie trwało zbyt długo. Sprawdź, czy działanie się zakończyło, zanim spróbujesz ponownie.",
  "error.kind.storage":
    "Za mało miejsca na dysku. Zwolnij miejsce na komputerze, na którym działa OpenBot, a potem spróbuj ponownie.",
  "error.kind.filePermission":
    "OpenBot nie ma uprawnień do wykonania tego działania. Sprawdź uprawnienia pliku lub folderu, a potem spróbuj ponownie.",
  "error.kind.notFound":
    "Nie znaleziono wymaganego pliku lub folderu. Przywróć go lub wybierz inny, a potem spróbuj ponownie.",
  "error.kind.readOnly": "Ten folder jest tylko do odczytu. Wybierz folder z prawem zapisu, a potem spróbuj ponownie.",
  "error.kind.conflict": "Element o tej nazwie już istnieje. Wybierz inną nazwę, a potem spróbuj ponownie.",
  "error.kind.auth":
    "Uwierzytelnianie nie powiodło się. Sprawdź konto lub połączenie z serwerem, a potem spróbuj ponownie.",
  "error.kind.permission": "Nie masz uprawnień do wykonania tego działania. Poproś właściciela o dostęp.",
  "error.kind.rateLimit": "Za dużo żądań. Poczekaj chwilę, a potem spróbuj ponownie.",
  "error.kind.service": "Usługa jest niedostępna. Poczekaj chwilę, a potem spróbuj ponownie.",
} as const satisfies PartialTranslation<typeof source>;
