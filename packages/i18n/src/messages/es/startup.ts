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
  "startup.filesDamagedBody":
    "Algunos archivos de OpenBot están dañados o faltan.\n\nPara repararlo, vuelve a instalar OpenBot. Tus datos locales se conservan.",
  "startup.newerDataUpdatingTitle": "Actualizando OpenBot",
  "startup.newerDataUpdatingBody":
    "Una versión más reciente de OpenBot guardó tus datos. OpenBot instala la última versión y luego se abre de nuevo.\n\nTus datos locales no se restablecieron ni se sobrescribieron.",
  "startup.newerDataTitle": "Instala la última versión de OpenBot",
  "startup.newerDataBody":
    "Una versión más reciente de OpenBot guardó tus datos y esta versión ({version}) no puede abrirlos. Instala la última versión para abrir tus datos.\n\nTus datos locales no se restablecieron ni se sobrescribieron.",
  "startup.newerDataDownload": "Descargar OpenBot",
  "startup.newerDataGuide": "Abrir guía",
  "startup.newerDataQuit": "Salir",
  "startup.recoveryWindowTitle": "Recuperación de OpenBot",
  "startup.recoveryTitle": "OpenBot no se abrió",
  "startup.recoveryBody": {
    one: "OpenBot {version} se detuvo antes de abrirse, {count} vez seguida. Tus datos locales no se restablecieron ni se sobrescribieron.",
    other:
      "OpenBot {version} se detuvo antes de abrirse, {count} veces seguidas. Tus datos locales no se restablecieron ni se sobrescribieron.",
  },
  "startup.recoveryHint":
    "Vuelve a intentarlo o instala la última versión que se abrió. Para obtener ayuda, exporta el diagnóstico y envía el archivo con tu informe.",
  "startup.recoveryRetry": "Reintentar",
  "startup.recoveryPreviousVersion": "Descargar versión anterior",
  "startup.recoveryExportDiagnostics": "Exportar diagnóstico",
  "startup.recoveryOpenDataFolder": "Abrir carpeta de datos",
  "startup.recoveryQuit": "Salir",
  "startup.recoveryDiagnosticsSaved": "El archivo de diagnóstico se guardó.",
  "startup.recoveryActionFailed": "OpenBot no pudo realizar esta acción.",
} as const satisfies PartialTranslation<typeof source>;
