import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Bestand openen",
  "attachment.preview": "Voorvertoning van {name}",
  "attachment.notFound": "Bestand niet gevonden",
  "attachment.download": "{name} downloaden",
  "attachment.open": "{name} openen",
  "attachment.loadMedia": "{name} afspelen",
  "attachment.previewUnavailable": "Voorvertoning is niet beschikbaar.",
  "attachment.error.preview": "Kan geen voorvertoning van {name} tonen. Probeer het opnieuw.",
  "attachment.error.download": "Kan bijlagen niet downloaden. Probeer het opnieuw.",
  "attachment.error.open": "Kan deze bijlage niet openen of opslaan. Probeer het opnieuw.",
  "attachment.error.openFile": "Kan dit bestand niet openen. Probeer het opnieuw.",
  "attachment.error.fileFallback": "Bestand",
  "attachment.error.fileNotFound": "“{name}” is niet gevonden op dit pad. Het is misschien verplaatst of verwijderd.",
  "attachment.error.previewFile": "Kan geen voorvertoning van “{name}” tonen. Probeer het opnieuw.",
} as const satisfies PartialTranslation<typeof source>;
