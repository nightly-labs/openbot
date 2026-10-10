import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot no pudo conectarse. Inténtalo de nuevo.",
  "mobile.link.invite.signInTitle": "Inicia sesión para unirte a este servidor",
  "mobile.link.invite.signInDescription":
    "Escanea el código QR en OpenBot en tu equipo. Después podrás revisar la invitación.",
  "mobile.link.invite.cancel": "Cancelar invitación",
  "mobile.link.pairing.title": "Conectar este teléfono",
  "mobile.link.pairing.alreadySignedIn":
    "Ya iniciaste sesión. Cierra la sesión en Ajustes antes de conectar otra cuenta.",
  "mobile.link.pairing.description": "Continúa solo si solicitaste este enlace de Mobile Connect desde tu escritorio.",
  "mobile.link.pairing.connect": "Conectar",
  "mobile.link.plugin.title": "Abrir página del plugin",
  "mobile.link.plugin.description": "Ver este plugin en el sitio web de OpenBot.",
  "mobile.link.plugin.openFailed": "No se pudo abrir la página del plugin.",
  "mobile.link.plugin.view": "Ver plugin",
  "mobile.link.unavailable.title": "Enlace no disponible",
  "mobile.link.unavailable.description":
    "Este enlace no es válido, ya no está disponible o no es compatible con el móvil.",
  "mobile.link.template.signInTitle": "Inicia sesión para añadir este agente",
  "mobile.link.template.signInDescription":
    "Escanea el código QR en OpenBot en tu equipo. Después podrás revisar el agente antes de añadirlo.",
  "mobile.link.template.loading": "Cargando agente…",
  "mobile.link.template.creator": "Por {name}",
  "mobile.link.template.section.instructions": "Instrucciones",
  "mobile.link.template.section.skills": "Habilidades",
  "mobile.link.template.section.noSkills": "Sin habilidades.",
  "mobile.link.template.section.routines": "Rutinas",
  "mobile.link.template.section.noRoutines": "Sin rutinas.",
  "mobile.link.template.skill.local": "Habilidad local (solo SKILL.md)",
  "mobile.link.template.skill.marketplace": "Habilidad de Marketplace, versión {version}",
  "mobile.link.template.server.title": "Añadir al servidor",
  "mobile.link.template.server.footer": "Solo se muestran los servidores en los que eres propietario o administrador.",
  "mobile.link.template.server.updateRequired": "Actualiza OpenBot en este servidor para añadir agentes compartidos.",
  "mobile.link.template.server.none":
    "Debes ser propietario o administrador de un servidor para añadir un agente compartido.",
  "mobile.link.template.install.action": "Añadir agente",
  "mobile.link.template.install.pending": "Añadiendo…",
  "mobile.link.template.install.failed": "No se pudo añadir el agente.",
  "mobile.link.template.notFound.title": "No se encontró el agente",
  "mobile.link.template.notFound.description": "Este agente compartido no existe o su creador dejó de publicarlo.",
  "mobile.link.template.error.title": "No se pudo cargar el agente",
  "mobile.link.template.error.loadFailed": "No se pudo leer el agente compartido. Inténtalo de nuevo.",
  "mobile.link.template.error.unsupported":
    "Este servidor no puede añadir agentes compartidos. Actualiza OpenBot en el equipo que ejecuta el servidor.",
} as const satisfies PartialTranslation<typeof source>;
