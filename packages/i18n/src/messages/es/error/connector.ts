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
  "error.connector.bitwardenCliMissing":
    "OpenBot no encuentra la CLI de Bitwarden. Instala bw, comprueba que funciona en una terminal nueva y vuelve a conectar.",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden debe tener exactamente una carpeta llamada Shared with OpenBot. Créala o elimina la carpeta adicional y vuelve a conectar.",
  "error.connector.bitwardenHostInput":
    "Introduce una dirección de servidor HTTPS, el client_id y el client_secret de la clave de API y la contraseña maestra.",
  "error.connector.bitwardenHostFailed":
    "No se pudo abrir Bitwarden en este servidor. Comprueba la dirección del servidor, la clave de API y la contraseña maestra, y asegúrate de que una carpeta se llama Shared with OpenBot. Después, conecta de nuevo.",
  "error.connector.bitwardenCliInstallFailed":
    "No se pudo instalar la CLI de Bitwarden en este servidor. Comprueba su conexión de red y conecta de nuevo.",
  "error.connector.bitwardenFileUnreadable": "El archivo de conexión de Bitwarden no se puede leer.",
  "error.connector.passwordManagerUnknown": "OpenBot no conoce este gestor de contraseñas.",
  "error.connector.passwordManagerMethod": "Este gestor de contraseñas no se puede conectar de esta forma.",
  "error.connector.passwordManagerNoSignIn": "No hay ninguna página de inicio de sesión abierta. Vuelve a conectar.",
  "error.connector.protonPassFailed": "No se pudo conectar Proton Pass. Vuelve a conectar.",
  "error.connector.protonPassCliInstallFailed":
    "No se pudo instalar la CLI de Proton Pass. Comprueba la conexión de red y vuelve a conectar.",
  "error.connector.protonPassPlan":
    "Tu plan de Proton no permite la CLI de Proton Pass. Cambia el plan y vuelve a conectar.",
  "error.connector.protonPassExpired": "El acceso a Proton Pass ha terminado. Vuelve a conectar.",
  "error.connector.protonPassKeyInvalid": "Introduce una clave de acceso de Proton Pass que empiece por pst_.",
  "error.connector.protonPassExtraPassword": "La contraseña adicional no es correcta. Introdúcela de nuevo.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass no ha pedido una contraseña adicional.",
  "error.connector.protonPassFileUnreadable": "El archivo de conexión de Proton Pass no se puede leer.",
  "error.connector.protonPassSignInTimeout": "El inicio de sesión de Proton tardó demasiado. Vuelve a conectar.",
  "error.connector.protonPassSetupFailed":
    "No se pudo crear la bóveda Shared with OpenBot ni su clave de acceso en Proton Pass. Vuelve a conectar.",
} as const satisfies PartialTranslation<typeof source>;
