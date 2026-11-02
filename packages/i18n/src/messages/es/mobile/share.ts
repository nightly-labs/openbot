import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "Inicia sesión para compartir",
  "mobile.share.signInDescription":
    "Escanea el código QR en OpenBot en tu equipo. Después podrás elegir el agente que recibe lo que compartiste.",
  "mobile.share.reading": "Leyendo lo que compartiste…",
  "mobile.share.readFailed": "OpenBot no pudo leer lo que compartiste. Vuelve a compartirlo.",
  "mobile.share.content": "Para compartir",
  "mobile.share.footer": "El chat se abre con esto en el campo de mensaje. No se envía nada hasta que lo envíes.",
  "mobile.share.lastUsed": "Usado por última vez",
  "mobile.share.noAgents": "No hay agentes",
  "mobile.share.chooseAgent": "Elige un agente",
  "mobile.share.action": "Compartir con {name}",
  "mobile.share.extension.send": "Enviar",
  "mobile.share.extension.footer": "OpenBot envía esto al agente ahora. La app no se abre.",
  "mobile.share.extension.sending": "Enviando a {name}…",
  "mobile.share.extension.sent": "Enviado a {name}",
  "mobile.share.extension.failed": "OpenBot no pudo enviar esto. Abre la app para enviarlo desde allí.",
  "mobile.share.extension.unconfirmed":
    "El servidor no confirmó el mensaje. Revisa el chat antes de enviarlo de nuevo.",
  "mobile.share.extension.openApp": "Abrir OpenBot",
} as const satisfies PartialTranslation<typeof source>;
