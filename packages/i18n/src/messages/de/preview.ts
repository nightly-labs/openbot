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
  "preview.panel.wrapLines": "Lange Zeilen umbrechen",
  "preview.folder.empty": "Dieser Ordner ist leer.",
  "preview.folder.truncated": "Es werden nur die ersten {limit} Elemente angezeigt.",
  "preview.truncated": "Vorschau nach {limit} Zeichen gekürzt.",
  "preview.unavailable": "Vorschau nicht verfügbar.",
  "preview.unsupported.title": "Vorschau nicht verfügbar",
  "preview.unsupported.description": "Dieser Dateityp kann in seiner Standardanwendung geöffnet werden.",
  "preview.unsupported.openExternally": "Extern öffnen",
  "preview.tooLarge.title": "Datei zu groß für die Vorschau",
  "preview.tooLarge.description":
    "Die Vorschau endet bei 100 MB. Du kannst diese Datei in ihrer Standardanwendung öffnen.",
  "preview.spreadsheet.readFailed": "Diese Tabelle konnte nicht gelesen werden.",
  "preview.spreadsheet.tooLarge":
    "Diese Tabelle ist zu groß für die Vorschau. Öffne die Datei oder lade sie herunter, um alles zu sehen.",
  "preview.spreadsheet.truncated": "Vorschau auf die ersten {rows} Zeilen und {columns} Spalten begrenzt.",
  "preview.document.readFailed": "Dieses Dokument konnte nicht gelesen werden.",
  "preview.document.empty": "Dieses Dokument enthält keinen Text zum Anzeigen.",
  "preview.document.truncated": "Vorschau auf den ersten Teil des Dokuments begrenzt.",
} as const satisfies PartialTranslation<typeof source>;
