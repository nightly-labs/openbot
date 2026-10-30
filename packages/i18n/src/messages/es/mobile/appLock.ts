import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "Bloqueo de la app",
  "mobile.appLock.method.pin": "Código PIN",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Desbloqueo del teléfono",
  "mobile.appLock.methods.title": "Desbloquear con",
  "mobile.appLock.methods.footer":
    "Activa un PIN, {method} o ambos. Así, OpenBot se bloquea cuando sales y te pide uno de ellos cuando vuelves.",
  "mobile.appLock.methods.footerPinOnly":
    "Activa un PIN. Así, OpenBot se bloquea cuando sales y te pide el PIN cuando vuelves.",
  "mobile.appLock.changePin": "Cambiar PIN",
  "mobile.appLock.lockAfter.title": "Bloquear OpenBot",
  "mobile.appLock.lockAfter.immediately": "Inmediatamente",
  "mobile.appLock.lockAfter.minutes": { one: "Después de {count} minuto", other: "Después de {count} minutos" },
  "mobile.appLock.lockAfter.hours": { one: "Después de {count} hora", other: "Después de {count} horas" },
  "mobile.appLock.lockWithPhone": "Cuando se bloquea el teléfono",
  "mobile.appLock.lockAfter.footer":
    "El tiempo empieza cuando sales de OpenBot. OpenBot siempre se bloquea al volver a iniciarse.",
  "mobile.appLock.device.turnOnPrompt": "Activar {method} para OpenBot",
  "mobile.appLock.device.failed": "{method} no se confirmó. Inténtalo de nuevo.",
  "mobile.appLock.device.unavailable": "Primero configura un código en tu teléfono.",
  "mobile.appLock.pinSetup.title": "Código PIN",
  "mobile.appLock.pinSetup.enter": "Introduce un PIN nuevo de 4 dígitos",
  "mobile.appLock.pinSetup.confirm": "Vuelve a introducir el PIN",
  "mobile.appLock.pinSetup.mismatch": "Los PIN no coinciden. Inténtalo de nuevo.",
  "mobile.appLock.pinSetup.saveFailed": "No se pudo guardar el PIN. Inténtalo de nuevo.",
  "mobile.appLock.lock.title": "OpenBot está bloqueado",
  "mobile.appLock.lock.confirmTitle": "Confirma que eres tú",
  "mobile.appLock.lock.enterPin": "Introduce tu PIN",
  "mobile.appLock.lock.unlockPrompt": "Desbloquear OpenBot",
  "mobile.appLock.lock.useDevice": "Usar {method}",
  "mobile.appLock.lock.unlock": "Desbloquear",
  "mobile.appLock.lock.wrongPin": "PIN incorrecto.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "PIN incorrecto. Te queda {count} intento antes de cerrar la sesión.",
    other: "PIN incorrecto. Te quedan {count} intentos antes de cerrar la sesión.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Demasiados intentos. Inténtalo de nuevo en {count} segundo.",
    other: "Demasiados intentos. Inténtalo de nuevo en {count} segundos.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Demasiados intentos. Inténtalo de nuevo en {count} minuto.",
    other: "Demasiados intentos. Inténtalo de nuevo en {count} minutos.",
  },
  "mobile.appLock.lock.checkFailed": "No se pudo comprobar el PIN. Inténtalo de nuevo.",
  "mobile.appLock.lock.pinMissing":
    "Este teléfono no tiene un PIN para OpenBot. Cierra sesión para restablecer el bloqueo de la app.",
  "mobile.appLock.lock.loadFailed": "No se pudieron leer los ajustes del bloqueo de la app.",
  "mobile.appLock.lock.retry": "Reintentar",
  "mobile.appLock.lock.forgotPin": "¿Olvidaste el PIN?",
  "mobile.appLock.lock.signOut": "Cerrar sesión",
  "mobile.appLock.lock.signOutTitle": "¿Cerrar sesión en OpenBot?",
  "mobile.appLock.lock.signOutBody":
    "Esto quita el bloqueo de la app y cierra tu sesión en este teléfono. Vuelve a conectarte escaneando un nuevo código desde OpenBot en tu equipo.",
  "mobile.appLock.lock.signedOut": "Demasiados PIN incorrectos. OpenBot cerró tu sesión en este teléfono.",
  "mobile.appLock.lock.delete": "Borrar dígito",
  "mobile.appLock.lock.progress": {
    one: "{count} de 4 dígitos introducidos",
    other: "{count} de 4 dígitos introducidos",
  },
} as const satisfies PartialTranslation<typeof source>;
