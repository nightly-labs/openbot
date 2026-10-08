import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Abrir archivo",
  "attachment.preview": "Vista previa de {name}",
  "attachment.notFound": "Archivo no encontrado",
  "attachment.download": "Descargar {name}",
  "attachment.open": "Abrir {name}",
  "attachment.loadMedia": "Reproducir {name}",
  "attachment.previewUnavailable": "La vista previa no está disponible.",
  "attachment.error.preview": "No se pudo mostrar la vista previa de {name}. Vuelve a intentarlo.",
  "attachment.error.download": "No se pudieron descargar los archivos adjuntos. Vuelve a intentarlo.",
  "attachment.error.open": "No se pudo abrir o guardar este archivo adjunto. Vuelve a intentarlo.",
  "attachment.error.openFile": "No se pudo abrir este archivo. Vuelve a intentarlo.",
  "attachment.error.fileFallback": "Archivo",
  "attachment.error.fileNotFound": "No se encontró «{name}» en esta ruta. Puede que se haya movido o eliminado.",
  "attachment.error.previewFile": "No se pudo mostrar la vista previa de «{name}». Vuelve a intentarlo.",
} as const satisfies PartialTranslation<typeof source>;
