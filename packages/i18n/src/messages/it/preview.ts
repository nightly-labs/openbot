import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Anteprima del file",
  "preview.panel.resize": "Ridimensiona l'anteprima del file",
  "preview.panel.copy": "Copia il testo del file",
  "preview.panel.openExternally": "Apri il file con un'altra app",
  "preview.panel.download": "Scarica il file",
  "preview.panel.reveal": "Mostra il file nel Finder",
  "preview.panel.close": "Chiudi l'anteprima del file",
  "preview.panel.back": "Indietro",
  "preview.panel.rawMarkdown": "Mostra il sorgente Markdown",
  "preview.panel.rawHtml": "Mostra il sorgente HTML",
  "preview.panel.wrapLines": "Vai a capo nelle righe lunghe",
  "preview.folder.empty": "Questa cartella è vuota.",
  "preview.folder.truncated": "Vengono mostrati solo i primi {limit} elementi.",
  "preview.truncated": "Anteprima troncata dopo {limit} caratteri.",
  "preview.unavailable": "Anteprima non disponibile.",
  "preview.unsupported.title": "Anteprima non disponibile",
  "preview.unsupported.description": "Questo tipo di file si può aprire con la sua app predefinita.",
  "preview.unsupported.openExternally": "Apri con un'altra app",
  "preview.spreadsheet.readFailed": "Impossibile leggere questo foglio di calcolo.",
  "preview.spreadsheet.truncated": "Anteprima limitata alle prime {rows} righe e {columns} colonne.",
} as const satisfies PartialTranslation<typeof source>;
