import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "La configuración de permisos está disponible en macOS.",
  "status.remote.setupInstallHost": "Instala el componente de host del escritorio remoto y vuelve a comprobarlo.",
  "status.remote.setupUpdateRuntime":
    "Actualiza el entorno de ejecución del escritorio remoto para comprobar los permisos de macOS.",
  "status.remote.setupCheckFailed":
    "Sunshine no pudo completar la comprobación de permisos. Comprueba la sesión del host e inténtalo de nuevo.",
  "status.remote.setupServiceFailed":
    "El servicio de escritorio remoto no pudo iniciarse. Comprueba que este usuario de macOS tenga una sesión gráfica activa.",
  "status.remote.connectingSunshine": "Conectando a través de Sunshine…",
  "status.remote.switchingMonitor": "Cambiando el monitor compartido…",
  "status.remote.controlConnected": "Control remoto conectado.",
  "status.remote.controlFailed": "El control remoto falló.",
  "status.remote.stagePreferences": "Cargando las preferencias de chat locales: {reason}",
  "status.remote.stageConnection": "Conectando con el escritorio: {reason}",
  "status.remote.stageCompatibility": "Comprobando la compatibilidad del escritorio: {reason}",
  "status.remote.stageAgents": "Cargando agentes: {reason}",
  "status.remote.stageReads": "Cargando el estado de lectura: {reason}",
  "status.remote.stageConversations": "Cargando conversaciones: {reason}",
  "status.remote.suspendedDetail":
    "Actualiza OpenBot Mobile o la aplicación de escritorio antes de conectarte.\n{detail}",
  "status.remote.cooldownDetail":
    "La conexión falló tras {limit} intentos. Nuevo intento en {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "La conexión falló tras {limit} intentos. Nuevo intento en {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Conexión perdida. Nuevo intento en {count} s.\n{detail}",
    other: "Conexión perdida. Nuevo intento en {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Conexión perdida. Nuevo intento en {count} s.",
    other: "Conexión perdida. Nuevo intento en {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "El intento de conexión falló. Nuevo intento en {count} s.\n{detail}",
    other: "El intento de conexión falló. Nuevo intento en {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "El intento de conexión falló. Nuevo intento en {count} s.",
    other: "El intento de conexión falló. Nuevo intento en {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Reconectando {attempt}/{count}\n{detail}",
    other: "Reconectando {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Reconectando {attempt}/{count}",
    other: "Reconectando {attempt}/{count}",
  },
} as const satisfies PartialTranslation<typeof source>;
