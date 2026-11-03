import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "Nie udało się uruchomić OpenBot",
  "startup.failedBody":
    "{message}\n\nTwoje lokalne dane nie zostały zresetowane ani nadpisane. Kroki przywracania znajdziesz w przewodniku rozwiązywania problemów.",
  "startup.archiveChangedTitle": "Pliki OpenBot zostały zmienione",
  "startup.archiveChangedBody":
    "Inny program zmienił plik app.asar OpenBot. OpenBot działa teraz, ale nie uruchomi się po zamknięciu.\n\nAby naprawić OpenBot, zainstaluj go ponownie. Twoje lokalne dane zostaną zachowane.",
  "startup.archiveChangedDownload": "Pobierz OpenBot",
} as const satisfies PartialTranslation<typeof source>;
