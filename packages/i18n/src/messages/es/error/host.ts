import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal no ha proporcionado servidores ICE.",
  "error.host.keyRotationUnavailable": "Este servidor no puede cambiar su clave sin el servicio de cuentas.",
  "error.host.keyRotationRefused":
    "El servicio de cuentas no aceptó la nueva clave del servidor. La clave actual sigue en uso.",
  "error.host.webRtcNotConfigured": "El servicio de host WebRTC no está configurado.",
  "error.host.runtimeNotInstalled": "El entorno de ejecución del escritorio remoto no está instalado.",
  "error.host.setupUnavailable": "La configuración de permisos no está disponible.",
  "error.host.accountChangedDuringUpdate":
    "La cuenta con sesión iniciada cambió mientras se actualizaba este servidor.",
  "error.host.nameBeforePublish": "Pon un nombre a este OpenBot antes de publicarlo.",
  "error.host.memberNotFound": "El miembro remoto no existe.",
  "error.host.publishBeforeInvite": "Haz público este OpenBot antes de crear una invitación.",
  "error.host.teamAccessUnavailable": "Tu acceso al equipo no está disponible.",
  "error.host.ownerIdentityUnavailable": "La identidad del propietario del host no está disponible.",
  "error.host.reserveAddressFailed": "No se pudo reservar la dirección pública.",
  "error.host.publishFailed": "No se pudo publicar este OpenBot.",
  "error.host.mobileConnectPublishFailed": "No se pudo publicar este OpenBot para la conexión móvil.",
  "error.host.mobileConnectHostChanged": "El host de la conexión móvil cambió. Inténtalo de nuevo.",
  "error.host.noServer": "Este equipo no tiene ningún servidor que se pueda cambiar.",
  "error.host.identityLocalOnly":
    "El nombre y el logotipo del servidor solo se pueden cambiar en el equipo que lo ejecuta.",
  "error.host.timezoneInvalid": "Esta zona horaria no es conocida.",
  "error.host.maintenanceInterrupted":
    "Se interrumpió el mantenimiento del host. Verifica la aplicación y restablece el estado del host antes de intentarlo de nuevo.",
  "error.host.updateFailed":
    "La actualización del host falló durante {phase}. Verifica la propiedad del paquete, la firma, el estado de los inquilinos y el espacio libre en disco antes de restablecer el estado.",
  "error.host.tenantsNotIdle":
    "Los inquilinos no permanecieron inactivos durante cinco minutos en un plazo de dos horas.",
  "error.host.tenantShutdownTimeout":
    "Se agotó el tiempo de apagado de los inquilinos. No se inició el reemplazo de la aplicación.",
  "error.host.tenantHealthMissing":
    "Faltan informes de estado de los inquilinos o indican problemas tras el reinicio. Inspecciona las sesiones de los inquilinos antes de otra actualización.",
} as const satisfies PartialTranslation<typeof source>;
