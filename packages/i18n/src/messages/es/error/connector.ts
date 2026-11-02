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
  "error.connector.bitwardenHostInput":
    "Introduce una dirección de servidor HTTPS, el client_id y el client_secret de la clave de API y la contraseña maestra.",
  "error.connector.bitwardenHostFailed":
    "No se pudo abrir Bitwarden en este servidor. Comprueba la dirección del servidor, la clave de API y la contraseña maestra, y asegúrate de que una carpeta se llama Shared with OpenBot. Después, conecta de nuevo.",
  "error.connector.bitwardenCliInstallFailed":
    "No se pudo instalar la CLI de Bitwarden en este servidor. Comprueba su conexión de red y conecta de nuevo.",
  "error.connector.bitwardenFileUnreadable": "El archivo de conexión de Bitwarden no se puede leer.",
  "error.connector.telegramAccountCredentialsMissing":
    "Introduce el api_id y el api_hash de tu app de Telegram. Los obtienes en my.telegram.org.",
  "error.connector.telegramAccountCredentialsInvalid":
    "El api_id es un número y el api_hash tiene 32 caracteres de 0-9 y a-f. Cópialos de nuevo desde my.telegram.org.",
  "error.connector.telegramAccountApiRejected":
    "Telegram no acepta este api_id y api_hash. Cópialos de nuevo desde my.telegram.org.",
  "error.connector.telegramAccountPhoneFormat":
    "Introduce el número de teléfono con su código de país, por ejemplo +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid":
    "Telegram no reconoce este número. Incluye el código de país, por ejemplo +48.",
  "error.connector.telegramAccountCodeInvalid": "Este código no es correcto. Revísalo e inténtalo de nuevo.",
  "error.connector.telegramAccountCodeEmpty": "Introduce el código que te envió Telegram.",
  "error.connector.telegramAccountCodeExpired": "El código caducó. Empieza de nuevo para recibir un código nuevo.",
  "error.connector.telegramAccountPasswordInvalid": "Esta contraseña no es correcta. Inténtalo de nuevo.",
  "error.connector.telegramAccountPasswordEmpty": "Introduce tu contraseña de verificación en dos pasos.",
  "error.connector.telegramAccountPasswordNeeded": "Telegram necesita tu contraseña de verificación en dos pasos.",
  "error.connector.telegramAccountNoAccount":
    "Este número no tiene una cuenta de Telegram. Inicia sesión con un número que ya use Telegram.",
  "error.connector.telegramAccountPhoneBanned": "Telegram ha bloqueado este número.",
  "error.connector.telegramAccountQrExpired": "El código QR caducó antes de que lo escanearas. Empieza de nuevo.",
  "error.connector.telegramAccountFloodWait": "Telegram te pide que esperes. Inténtalo de nuevo en {count} min.",
  "error.connector.telegramAccountCancelled": "Se canceló el inicio de sesión en Telegram.",
  "error.connector.telegramAccountTimedOut":
    "El inicio de sesión se detuvo tras 10 minutos sin actividad. Empieza de nuevo.",
  "error.connector.telegramAccountMovedOn": "El inicio de sesión pasó a otro paso. Empieza de nuevo.",
  "error.connector.telegramAccountRefused": "Telegram rechazó el inicio de sesión: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot no pudo guardar la conexión de Telegram: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram cerró esta sesión, por ejemplo en Ajustes > Dispositivos. Conecta tu cuenta de Telegram de nuevo.",
  "error.connector.telegramAccountFileUnreadable": "El archivo de conexión de la cuenta de Telegram no se puede leer.",
  "error.connector.telegramAccountFileTooLarge": "El archivo de conexión de la cuenta de Telegram es demasiado grande.",
  "error.connector.whatsappAccountPhoneFormat":
    "Introduce el número de teléfono con su código de país, por ejemplo +48 600 100 200.",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp no dio un código: {detail}",
  "error.connector.whatsappAccountQrExpired": "El código caducó antes de que lo usaras. Empieza de nuevo.",
  "error.connector.whatsappAccountTimedOut":
    "La vinculación se detuvo tras 10 minutos sin actividad. Empieza de nuevo.",
  "error.connector.whatsappAccountMovedOn": "La vinculación pasó a otro paso. Empieza de nuevo.",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp no vinculó este dispositivo: {detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot no pudo guardar la conexión de WhatsApp: {detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp quitó este dispositivo, por ejemplo en Ajustes > Dispositivos vinculados. Vincula tu cuenta de WhatsApp de nuevo.",
  "error.connector.whatsappAccountReplaced":
    "Otro programa abrió este dispositivo vinculado, así que WhatsApp cerró la conexión aquí. Desvincúlalo y vuelve a vincularlo.",
  "error.connector.whatsappAccountForbidden":
    "WhatsApp rechazó este dispositivo. Puede que tu número esté limitado. Revisa WhatsApp en tu teléfono.",
  "error.connector.whatsappAccountOutdated":
    "WhatsApp ya no acepta esta versión de la conexión. Actualiza OpenBot y vuelve a vincular.",
  "error.connector.whatsappAccountOffline":
    "WhatsApp no está disponible ahora. OpenBot lo vuelve a intentar. Los agentes aún pueden leer los chats de este ordenador.",
  "error.connector.whatsappAccountFileUnreadable": "El archivo de conexión de la cuenta de WhatsApp no se puede leer.",
} as const satisfies PartialTranslation<typeof source>;
