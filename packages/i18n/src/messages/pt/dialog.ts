import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Escolha um diretório de site estático",
  "dialog.chooseSkill": "Escolha uma pasta de habilidade ou um ZIP",
  "dialog.filter.skillPackages": "Pacotes de habilidades",
  "dialog.filter.images": "Imagens",
  "dialog.filter.supportedFiles": "Arquivos compatíveis",
  "dialog.filter.attachment": "Anexo",
  "dialog.filter.zipArchive": "Arquivo ZIP",
  "dialog.filter.jsonDocument": "Documento JSON",
  "dialog.chooseAgentExport": "Escolha uma exportação de agente",
  "dialog.filter.agentExports": "Exportações de agentes",
  "dialog.saveExportSkill": "Salvar a habilidade de exportação",
} as const satisfies PartialTranslation<typeof source>;
