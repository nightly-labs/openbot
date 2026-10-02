import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "O anexo não foi encontrado.",
  "error.attachment.fileTooLarge": "Um arquivo excede o limite de 100 MB.",
  "error.attachment.totalTooLarge": "Os anexos excedem o limite total de 250 MB.",
  "error.attachment.unavailable": "Este arquivo não está mais disponível.",
  "error.attachment.tooMany": "Escolha no máximo {limit} arquivos.",
  "error.attachment.mediaUnsupported":
    "Este servidor não oferece suporte a anexos MP3 ou MOV. Atualize o OpenBot no computador anfitrião e tente novamente.",
  "error.attachment.emlUnsupported":
    "Este servidor não oferece suporte a anexos EML. Atualize o OpenBot no computador anfitrião e tente novamente.",
  "error.attachment.previewTooLarge": "O arquivo excede o limite de 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
