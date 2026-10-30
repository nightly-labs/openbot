import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Bestandsvoorvertoning",
  "preview.panel.resize": "Grootte van bestandsvoorvertoning wijzigen",
  "preview.panel.copy": "Bestandstekst kopiëren",
  "preview.panel.openExternally": "Bestand extern openen",
  "preview.panel.download": "Bestand downloaden",
  "preview.panel.reveal": "Toon bestand in Finder",
  "preview.panel.close": "Bestandsvoorvertoning sluiten",
  "preview.panel.back": "Terug",
  "preview.panel.rawMarkdown": "Markdown-bron tonen",
  "preview.panel.rawHtml": "HTML-bron tonen",
  "preview.panel.wrapLines": "Lange regels afbreken",
  "preview.folder.empty": "Deze map is leeg.",
  "preview.folder.truncated": "Alleen de eerste {limit} items worden getoond.",
  "preview.truncated": "Voorvertoning ingekort na {limit} tekens.",
  "preview.unavailable": "Voorvertoning niet beschikbaar.",
  "preview.unsupported.title": "Voorvertoning niet beschikbaar",
  "preview.unsupported.description": "Dit bestandstype kan worden geopend in de standaardapp.",
  "preview.unsupported.openExternally": "Extern openen",
  "preview.spreadsheet.readFailed": "Kan deze spreadsheet niet lezen.",
  "preview.spreadsheet.truncated": "Voorvertoning beperkt tot de eerste {rows} rijen en {columns} kolommen.",
} as const satisfies PartialTranslation<typeof source>;
