import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "Nie znaleziono załącznika.",
  "error.attachment.fileTooLarge": "Plik przekracza limit 100 MB.",
  "error.attachment.totalTooLarge": "Załączniki przekraczają łączny limit 250 MB.",
  "error.attachment.unavailable": "Ten plik nie jest już dostępny.",
  "error.attachment.tooMany": "Maksymalna liczba plików: {limit}.",
  "error.attachment.mediaUnsupported":
    "Ten serwer nie obsługuje załączników MP3 ani MOV. Zaktualizuj OpenBot na hoście i spróbuj ponownie.",
  "error.attachment.emlUnsupported":
    "Ten serwer nie obsługuje załączników EML. Zaktualizuj OpenBot na hoście i spróbuj ponownie.",
  "error.attachment.previewTooLarge": "Plik przekracza limit 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
