import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "Esta versión de OpenBot no tiene una GitHub App.",
  "error.connector.githubDenied": "Se rechazó el inicio de sesión de GitHub.",
  "error.connector.githubCodeExpired": "El código de GitHub caducó. Conecta GitHub de nuevo.",
  "error.connector.githubDeviceFlowDisabled": "La GitHub App no permite iniciar sesión desde un dispositivo.",
  "error.connector.githubClientUnknown": "GitHub no reconoce el Client ID de esta GitHub App.",
  "error.connector.githubUnexpected": "GitHub envió una respuesta inesperada: {detail}",
  "error.connector.githubUnreachable": "OpenBot no puede acceder a GitHub: {detail}",
  "error.connector.githubExpired": "La conexión con GitHub caducó. Conecta GitHub de nuevo.",
  "error.connector.githubFileUnreadable": "El archivo de conexión de GitHub no se puede leer.",
  "error.connector.githubFileTooLarge": "El archivo de conexión de GitHub es demasiado grande.",
  "error.connector.onePasswordCliMissing":
    "OpenBot no encuentra la CLI de 1Password. Instálala y activa su integración en la aplicación 1Password, o usa un token de cuenta de servicio.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot no pudo instalar la CLI de 1Password. Comprueba la conexión a Internet e inténtalo de nuevo.",
  "error.connector.onePasswordCliSignedOut":
    "La CLI de 1Password no tiene una sesión iniciada. Activa su integración en la aplicación 1Password y vuelve a conectar.",
  "error.connector.onePasswordCliFailed": "La CLI de 1Password falló: {detail}",
  "error.connector.onePasswordUnexpected": "1Password envió una respuesta inesperada: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password no aceptó el token de cuenta de servicio.",
  "error.connector.onePasswordNoVault":
    "La cuenta de servicio no puede leer ninguna bóveda. Dale acceso a una bóveda e inténtalo de nuevo.",
  "error.connector.onePasswordFileUnreadable": "El archivo de conexión de 1Password no se puede leer.",
  "error.connector.onePasswordFileTooLarge": "El archivo de conexión de 1Password es demasiado grande.",
  "error.connector.bitwardenFailed":
    "No se pudo leer Bitwarden. Instala la CLI bw, inicia sesión, desbloquéala y crea una carpeta llamada Shared with OpenBot. Conecta con una nueva clave de sesión.",
} as const satisfies PartialTranslation<typeof source>;
