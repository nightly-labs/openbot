import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot non è riuscito ad avviarsi",
  "startup.failedBody":
    "{message}\n\nI tuoi dati locali non sono stati reimpostati né sovrascritti. Consulta la guida alla risoluzione dei problemi per i passaggi di ripristino.",
  "startup.archiveChangedTitle": "I file di OpenBot sono stati modificati",
  "startup.archiveChangedBody":
    "Un altro programma ha modificato il file app.asar di OpenBot. OpenBot ora funziona, ma non si aprirà più dopo la chiusura.\n\nPer ripararlo, installa di nuovo OpenBot. I tuoi dati locali restano.",
  "startup.archiveChangedDownload": "Scarica OpenBot",
  "startup.newerDataUpdatingTitle": "Aggiornamento di OpenBot",
  "startup.newerDataUpdatingBody":
    "Una versione più recente di OpenBot ha salvato i tuoi dati. OpenBot installa l’ultima versione e poi si riapre.\n\nI tuoi dati locali non sono stati reimpostati né sovrascritti.",
  "startup.newerDataTitle": "Installa l’ultima versione di OpenBot",
  "startup.newerDataBody":
    "Una versione più recente di OpenBot ha salvato i tuoi dati e questa versione ({version}) non può aprirli. Installa l’ultima versione per aprire i tuoi dati.\n\nI tuoi dati locali non sono stati reimpostati né sovrascritti.",
  "startup.newerDataDownload": "Scarica OpenBot",
  "startup.newerDataGuide": "Apri guida",
  "startup.newerDataQuit": "Esci",
} as const satisfies PartialTranslation<typeof source>;
