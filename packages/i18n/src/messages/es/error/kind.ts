import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.",
  "error.kind.timeout":
    "La solicitud tardó demasiado. Comprueba si la acción se completó antes de intentarlo de nuevo.",
  "error.kind.storage":
    "No hay suficiente espacio de almacenamiento. Libera espacio en el equipo que ejecuta OpenBot e inténtalo de nuevo.",
  "error.kind.filePermission":
    "OpenBot no tiene permiso para completar esta acción. Comprueba los permisos del archivo o la carpeta e inténtalo de nuevo.",
  "error.kind.notFound":
    "No se encontró un archivo o una carpeta necesarios. Restáuralos o elige otros e inténtalo de nuevo.",
  "error.kind.readOnly":
    "Esta carpeta es de solo lectura. Elige una carpeta en la que puedas escribir e inténtalo de nuevo.",
  "error.kind.conflict": "Ya existe un elemento con este nombre. Elige otro nombre e inténtalo de nuevo.",
  "error.kind.auth": "La autenticación falló. Comprueba tu cuenta o la conexión al servidor e inténtalo de nuevo.",
  "error.kind.permission": "No tienes permiso para completar esta acción. Pide acceso al propietario.",
  "error.kind.rateLimit": "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
  "error.kind.service": "El servicio no está disponible. Espera un momento e inténtalo de nuevo.",
} as const satisfies PartialTranslation<typeof source>;
