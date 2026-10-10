import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/auth";

export const messages = {
  "mobile.auth.logo.animate": "Animar el logotipo de OpenBot",
  "mobile.auth.logo.animateHint": "Hace que el logotipo guiñe un ojo",
  "mobile.auth.scanQrCode": "Escanear código QR",
  "mobile.auth.closeScanner": "Cerrar escáner",
  "mobile.auth.scanner.connectFailed": "No se pudo conectar",
  "mobile.auth.scanner.codeFailed": "No se pudo usar este código",
  "mobile.auth.scanner.scanAgain": "Escanear de nuevo",
  "mobile.auth.scanner.connecting": "Conectando tu teléfono…",
  "mobile.auth.scanner.readingInvitation": "Leyendo la invitación…",
  "mobile.auth.scanner.scanDesktop": "Escanea el código del escritorio",
  "mobile.auth.scanner.scanInvitation": "Escanea el código de invitación",
  "mobile.auth.scanner.verifying": "Verificando el código de un solo uso.",
  "mobile.auth.scanner.checkingServer": "Comprobando la identidad del servidor.",
  "mobile.auth.scanner.keepCentered": "Mantén el código QR centrado dentro del marco.",
  "mobile.auth.scanner.connectFallback": "OpenBot no pudo conectar este teléfono.",
  "mobile.auth.scanner.cameraFailed": "No se pudo iniciar la cámara. Inténtalo de nuevo.",
  "mobile.auth.camera.title": "Se necesita acceso a la cámara",
  "mobile.auth.camera.pairingReason":
    "OpenBot usa la cámara solo para escanear el código QR de un solo uso que muestra la aplicación de escritorio.",
  "mobile.auth.camera.invitationReason": "OpenBot usa la cámara solo para escanear el código QR de la invitación.",
  "mobile.auth.camera.blocked":
    "El acceso a la cámara está bloqueado. Actívalo para OpenBot en los ajustes del dispositivo y vuelve aquí para escanear el código.",
  "mobile.auth.camera.allow": "Permitir acceso a la cámara",
  "mobile.auth.camera.openSettings": "Abrir ajustes",
  "mobile.auth.signIn.title": "Tus agentes, en cualquier lugar.",
  "mobile.auth.signIn.subtitle": "Conéctate a OpenBot en tu equipo.",
  "mobile.auth.signIn.helpTitle": "¿Dónde está el código QR?",
  "mobile.auth.signIn.helpStep1": "1. Abre OpenBot en tu equipo.",
  "mobile.auth.signIn.helpStep2": "2. Ve a Ajustes → Conexión móvil.",
  "mobile.auth.signIn.helpStep3": "3. Elige Generar código QR y escanéalo aquí.",
  "mobile.auth.error.sessionEnded": "Tu sesión terminó. Escanea un código nuevo desde OpenBot en tu escritorio.",
  "mobile.auth.error.connectionInProgress": "Hay otra conexión en curso. Espera a que termine.",
  "mobile.auth.error.invalidCode": "Este no es un código válido de Mobile Connect de OpenBot.",
  "mobile.auth.error.codeOutdated":
    "Genera un código nuevo de Mobile Connect en una aplicación de escritorio actualizada.",
  "mobile.auth.error.alreadySignedIn": "Ya iniciaste sesión. Cierra la sesión antes de conectar otra cuenta.",
  "mobile.auth.error.desktopUnreachable":
    "OpenBot no pudo acceder a tu escritorio. Mantén ambos dispositivos en la misma red Wi-Fi y permite el acceso a la red local.",
  "mobile.auth.error.accountServiceUnreachable":
    "OpenBot no pudo acceder al servicio de cuentas. Comprueba tu conexión e inténtalo de nuevo.",
  "mobile.auth.error.codeExpired": "Este código de Mobile Connect no es válido o caducó.",
  "mobile.auth.error.revokePreviousFailed":
    "No se pudo revocar la sesión móvil anterior. Comprueba tu conexión y vuelve a escanear.",
  "mobile.auth.error.verifyFailed": "OpenBot no pudo verificar esta sesión móvil.",
  "mobile.auth.error.sessionsLoadFailed": "No se pudieron cargar las sesiones de la cuenta. Inténtalo de nuevo.",
  "mobile.auth.error.useSignOut": "Usa Cerrar sesión para desconectar este dispositivo.",
  "mobile.auth.error.desktopSession": "Las sesiones de escritorio no se pueden desconectar desde el móvil.",
  "mobile.auth.error.disconnectFailed": "No se pudo desconectar esta sesión. Actualiza e inténtalo de nuevo.",
  "mobile.auth.error.nameLength": "Escribe un nombre visible de entre 3 y 20 caracteres.",
  "mobile.auth.error.photoTooLarge": "Elige una foto de menos de 512 KB.",
  "mobile.auth.error.photoInvalid": "La foto seleccionada no es válida. Elige otra imagen.",
  "mobile.auth.error.tooManyChanges": "Demasiados cambios. Espera un momento e inténtalo de nuevo.",
  "mobile.auth.error.photoConflict": "Tu foto cambió en otro dispositivo. Inténtalo de nuevo.",
  "mobile.auth.error.profileSaveFailed": "No se pudo guardar tu perfil. Comprueba tu conexión e inténtalo de nuevo.",
  "mobile.auth.error.signOutUnconfirmed":
    "No se pudo confirmar el cierre de sesión. Comprueba tu conexión e inténtalo de nuevo.",
} as const satisfies PartialTranslation<typeof source>;
