import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "De bijlage is niet gevonden.",
  "error.attachment.fileTooLarge": "Een bestand is groter dan de limiet van 100 MB.",
  "error.attachment.totalTooLarge": "De bijlagen zijn samen groter dan de limiet van 250 MB.",
  "error.attachment.unavailable": "Dit bestand is niet meer beschikbaar.",
  "error.attachment.tooMany": "Kies maximaal {limit} bestanden.",
  "error.attachment.mediaUnsupported":
    "Deze server ondersteunt geen MP3- of MOV-bijlagen. Werk OpenBot bij op de host en probeer het opnieuw.",
  "error.attachment.emlUnsupported":
    "Deze server ondersteunt geen EML-bijlagen. Werk OpenBot bij op de host en probeer het opnieuw.",
  "error.attachment.zipUnsupported":
    "Deze server ondersteunt geen ZIP-bijlagen. Werk OpenBot bij op de host en probeer het opnieuw.",
  "error.attachment.mp4Unsupported":
    "Deze server ondersteunt geen MP4-bijlagen. Werk OpenBot bij op de host en probeer het opnieuw.",
  "error.attachment.previewTooLarge": "Het bestand is groter dan de limiet van 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
