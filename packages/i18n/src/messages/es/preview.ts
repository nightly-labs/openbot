import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Vista previa del archivo",
  "preview.panel.resize": "Cambiar tamaño de la vista previa",
  "preview.panel.copy": "Copiar el texto del archivo",
  "preview.panel.openExternally": "Abrir archivo externamente",
  "preview.panel.download": "Descargar archivo",
  "preview.panel.reveal": "Mostrar archivo en Finder",
  "preview.panel.close": "Cerrar vista previa",
  "preview.panel.back": "Atrás",
  "preview.panel.rawMarkdown": "Mostrar código fuente de Markdown",
  "preview.panel.rawHtml": "Mostrar código fuente de HTML",
  "preview.panel.wrapLines": "Ajustar líneas largas",
  "preview.folder.empty": "Esta carpeta está vacía.",
  "preview.folder.truncated": "Solo se muestran los primeros {limit} elementos.",
  "preview.truncated": "Vista previa truncada después de {limit} caracteres.",
  "preview.unavailable": "Vista previa no disponible.",
  "preview.unsupported.title": "Vista previa no disponible",
  "preview.unsupported.description": "Este tipo de archivo se puede abrir en su aplicación predeterminada.",
  "preview.unsupported.openExternally": "Abrir externamente",
  "preview.tooLarge.title": "Archivo demasiado grande para la vista previa",
  "preview.tooLarge.description":
    "La vista previa llega hasta 100 MB. Puedes abrir este archivo en su aplicación predeterminada.",
  "preview.spreadsheet.readFailed": "No se pudo leer esta hoja de cálculo.",
  "preview.spreadsheet.tooLarge":
    "Esta hoja de cálculo es demasiado grande para la vista previa. Abre o descarga el archivo para verla completa.",
  "preview.spreadsheet.truncated": "Vista previa limitada a las primeras {rows} filas y {columns} columnas.",
  "preview.document.readFailed": "No se pudo leer este documento.",
  "preview.document.empty": "Este documento no tiene texto que mostrar.",
  "preview.document.truncated": "Vista previa limitada a la primera parte del documento.",
} as const satisfies PartialTranslation<typeof source>;
