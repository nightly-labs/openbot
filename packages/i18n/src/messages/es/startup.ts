import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot no pudo iniciarse",
  "startup.failedBody":
    "{message}\n\nTus datos locales no se han restablecido ni sobrescrito. Consulta la guía de solución de problemas para recuperarlos.",
  "startup.archiveChangedTitle": "Se cambiaron archivos de OpenBot",
  "startup.archiveChangedBody":
    "Otro programa cambió el archivo app.asar de OpenBot. OpenBot funciona ahora, pero no se abrirá después de cerrarlo.\n\nPara repararlo, vuelve a instalar OpenBot. Tus datos locales se conservan.",
  "startup.archiveChangedDownload": "Descargar OpenBot",
} as const satisfies PartialTranslation<typeof source>;
