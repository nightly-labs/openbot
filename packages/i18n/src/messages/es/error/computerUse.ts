import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "Esta versión de OpenBot no tiene ninguna aplicación que se pueda arrastrar.",
  "error.computerUse.helpWindowChanged": "La ventana de ayuda de permisos cambió antes de iniciar el arrastre.",
  "error.computerUse.noAppToShow": "Esta versión de OpenBot no tiene ninguna aplicación que se pueda mostrar.",
  "error.computerUse.noDriver": "Este equipo no tiene un controlador de uso del equipo.",
  "error.computerUse.socketPathTooLong":
    "La ruta del socket de uso del equipo tiene {length} caracteres y este sistema permite {limit}.",
  "error.computerUse.socketDirectoryNotDirectory":
    "El directorio del socket de uso del equipo {path} no es un directorio.",
  "error.computerUse.socketDirectoryOtherOwner":
    "El directorio del socket de uso del equipo {path} pertenece a otro usuario.",
  "error.computerUse.socketDirectoryShared":
    "El directorio del socket de uso del equipo {path} está abierto a otros usuarios.",
  "error.computerUse.socketNotReady": "No aceptó una conexión en {seconds} segundos. {reason}",
} as const satisfies PartialTranslation<typeof source>;
