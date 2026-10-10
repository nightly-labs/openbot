import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Dateivorschau",
  "preview.panel.resize": "Größe der Dateivorschau ändern",
  "preview.panel.copy": "Dateitext kopieren",
  "preview.panel.openExternally": "Datei extern öffnen",
  "preview.panel.download": "Datei herunterladen",
  "preview.panel.reveal": "Datei im Finder anzeigen",
  "preview.panel.close": "Dateivorschau schließen",
  "preview.panel.back": "Zurück",
  "preview.panel.rawMarkdown": "Markdown-Quelltext anzeigen",
  "preview.panel.rawHtml": "HTML-Quelltext anzeigen",
  "preview.folder.empty": "Dieser Ordner ist leer.",
  "preview.folder.truncated": "Es werden nur die ersten {limit} Elemente angezeigt.",
  "preview.truncated": "Vorschau nach {limit} Zeichen gekürzt.",
  "preview.unavailable": "Vorschau nicht verfügbar.",
  "preview.unsupported.title": "Vorschau nicht verfügbar",
  "preview.unsupported.description": "Dieser Dateityp kann in seiner Standardanwendung geöffnet werden.",
  "preview.unsupported.openExternally": "Extern öffnen",
  "preview.spreadsheet.readFailed": "Diese Tabelle konnte nicht gelesen werden.",
  "preview.spreadsheet.truncated": "Vorschau auf die ersten {rows} Zeilen und {columns} Spalten begrenzt.",
} as const satisfies PartialTranslation<typeof source>;
