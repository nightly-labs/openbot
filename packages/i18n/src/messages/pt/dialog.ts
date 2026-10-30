import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  "dialog.chooseSiteDirectory": "Escolha um diretório de site estático",
  "dialog.chooseAgentFolder": "Escolha uma pasta para {agent}",
  "dialog.chooseAgentExclusion": "Escolha uma pasta que {agent} não deve alterar",
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
  "dialog.saveTransfer": "Salvar o arquivo de transferência",
  "dialog.chooseTransfer": "Escolher um arquivo de transferência",
  "dialog.filter.transfer": "Arquivos de transferência do OpenBot",
  "dialog.chooseExternalLinkApp": "Escolha um navegador",
  "dialog.filter.applications": "Aplicativos",
} as const satisfies PartialTranslation<typeof source>;
