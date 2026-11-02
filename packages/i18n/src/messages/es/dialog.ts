import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Elige una carpeta de sitio estático",
  "dialog.chooseAgentFolder": "Elige una carpeta para {agent}",
  "dialog.chooseAgentExclusion": "Elige una carpeta que {agent} no debe cambiar",
  "dialog.chooseSkill": "Elige una carpeta de habilidad o un ZIP",
  "dialog.filter.skillPackages": "Paquetes de habilidades",
  "dialog.filter.images": "Imágenes",
  "dialog.filter.supportedFiles": "Archivos compatibles",
  "dialog.filter.attachment": "Archivo adjunto",
  "dialog.filter.zipArchive": "Archivo ZIP",
  "dialog.filter.jsonDocument": "Documento JSON",
  "dialog.chooseAgentExport": "Elige una exportación de agente",
  "dialog.filter.agentExports": "Exportaciones de agentes",
  "dialog.saveExportSkill": "Guardar la habilidad de exportación",
  "dialog.saveTransfer": "Guardar el archivo de transferencia",
  "dialog.chooseTransfer": "Elegir un archivo de transferencia",
  "dialog.filter.transfer": "Archivos de transferencia de OpenBot",
  "dialog.chooseExternalLinkApp": "Elige un navegador",
  "dialog.filter.applications": "Aplicaciones",
} as const satisfies PartialTranslation<typeof source>;
