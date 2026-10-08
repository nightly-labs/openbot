import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Abrir arquivo",
  "attachment.preview": "Visualizar {name}",
  "attachment.notFound": "Arquivo não encontrado",
  "attachment.download": "Baixar {name}",
  "attachment.open": "Abrir {name}",
  "attachment.loadMedia": "Reproduzir {name}",
  "attachment.previewUnavailable": "A prévia está indisponível.",
  "attachment.error.preview": "Não foi possível visualizar {name}. Tente novamente.",
  "attachment.error.download": "Não foi possível baixar os anexos. Tente novamente.",
  "attachment.error.open": "Não foi possível abrir ou salvar este anexo. Tente novamente.",
  "attachment.error.openFile": "Não foi possível abrir este arquivo. Tente novamente.",
  "attachment.error.fileFallback": "Arquivo",
  "attachment.error.fileNotFound": "“{name}” não foi encontrado neste caminho. Ele pode ter sido movido ou excluído.",
  "attachment.error.previewFile": "Não foi possível visualizar “{name}”. Tente novamente.",
} as const satisfies PartialTranslation<typeof source>;
