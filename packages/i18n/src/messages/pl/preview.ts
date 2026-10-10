import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Podgląd pliku",
  "preview.panel.resize": "Zmień rozmiar podglądu pliku",
  "preview.panel.copy": "Kopiuj tekst pliku",
  "preview.panel.openExternally": "Otwórz plik zewnętrznie",
  "preview.panel.download": "Pobierz plik",
  "preview.panel.reveal": "Pokaż plik w Finderze",
  "preview.panel.close": "Zamknij podgląd pliku",
  "preview.panel.back": "Wstecz",
  "preview.panel.rawMarkdown": "Pokaż źródło Markdown",
  "preview.panel.rawHtml": "Pokaż źródło HTML",
  "preview.panel.wrapLines": "Zawijaj długie wiersze",
  "preview.folder.empty": "Ten folder jest pusty.",
  "preview.folder.truncated": "Wyświetlono tylko początkowe elementy, maksymalnie {limit}.",
  "preview.truncated": "Podgląd ucięty po {limit} znakach.",
  "preview.unavailable": "Podgląd niedostępny.",
  "preview.unsupported.title": "Podgląd niedostępny",
  "preview.unsupported.description": "Ten typ pliku można otworzyć w domyślnej aplikacji.",
  "preview.unsupported.openExternally": "Otwórz zewnętrznie",
  "preview.spreadsheet.readFailed": "Nie udało się odczytać tego arkusza kalkulacyjnego.",
  "preview.spreadsheet.truncated": "Podgląd ograniczony do pierwszych wierszy ({rows}) i kolumn ({columns}).",
} as const satisfies PartialTranslation<typeof source>;
