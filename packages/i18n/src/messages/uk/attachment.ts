import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Otwórz plik",
  "attachment.preview": "Podgląd: {name}",
  "attachment.notFound": "Nie znaleziono pliku",
  "attachment.download": "Pobierz {name}",
  "attachment.downloadProgress": "{received} z {total}",
  "attachment.stopDownload": "Zatrzymaj pobieranie {name}, {percent}%",
  "attachment.downloadFailed": "Pobieranie nie powiodło się",
  "attachment.retryDownload": "Ponów pobieranie {name}",
  "attachment.open": "Otwórz {name}",
  "attachment.loadMedia": "Odtwórz: {name}",
  "attachment.previewUnavailable": "Podgląd jest niedostępny.",
  "attachment.error.preview": "Nie udało się wyświetlić podglądu: {name}. Spróbuj ponownie.",
  "attachment.error.download": "Nie udało się pobrać załączników. Spróbuj ponownie.",
  "attachment.error.open": "Nie udało się otworzyć ani zapisać tego załącznika. Spróbuj ponownie.",
  "attachment.error.openFile": "Nie udało się otworzyć tego pliku. Spróbuj ponownie.",
  "attachment.error.fileFallback": "Plik",
  "attachment.error.fileNotFound":
    "Nie znaleziono „{name}” pod tą ścieżką. Plik mógł zostać przeniesiony lub usunięty.",
  "attachment.error.previewFile": "Nie udało się wyświetlić podglądu „{name}”. Spróbuj ponownie.",
} as const satisfies PartialTranslation<typeof source>;
