import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "Sitio web",
  "plugin.link.privacyPolicy": "Política de privacidad",
  "plugin.link.terms": "Condiciones del servicio",
  "plugin.copyLink": "Copiar enlace",
  "plugin.askPrompt": "Pregunta a {name}: {prompt}",
  "plugin.section.apps": "Aplicaciones",
  "plugin.section.skills": "Habilidades",
  "plugin.section.information": "Información",
  "plugin.info.developer": "Desarrollador",
  "plugin.info.category": "Categoría",
  "plugin.info.version": "Versión",
  "plugin.uninstallDialog.title": "¿Desconectar {name}?",
  "plugin.uninstallDialog.description":
    "Esto elimina lo que {name} instaló en este equipo. No cambia nada más en este host ni en este agente.",
  "plugin.uninstallDialog.confirm": "Desconectar",
  "plugin.uninstallDialog.appsLabel": "Aplicaciones que se eliminarán: {number}",
  "plugin.uninstallDialog.appsTitle": "Aplicaciones eliminadas de este host",
  "plugin.uninstallDialog.appsNote":
    "Sus herramientas dejan de estar disponibles y se olvidan los datos de inicio de sesión que OpenBot guardaba para ellas.",
  "plugin.uninstallDialog.skillsLabel": "Habilidades que se eliminarán: {number}",
  "plugin.uninstallDialog.skillsTitle": "Habilidades eliminadas de {agentName}",
} as const satisfies PartialTranslation<typeof source>;
