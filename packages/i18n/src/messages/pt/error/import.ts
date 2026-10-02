import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest} não é um JSON válido.",
  "error.import.notAgentExport": "{manifest} não é uma exportação de agente do OpenBot.",
  "error.import.newerExportSkill":
    "Esta exportação foi feita por uma habilidade de exportação mais recente. Atualize o OpenBot e tente novamente.",
  "error.import.noAgents": "A exportação não contém agentes.",
  "error.import.tooManyAgents": "A exportação contém mais de {limit} agentes.",
  "error.import.tooManyChannels": "A exportação contém mais de {limit} canais.",
  "error.import.channelSkipped": "{name}: o canal é ignorado porque nenhum de seus agentes está na exportação.",
  "error.import.membersLeftOut": "{name}: os membros que não são agentes nesta exportação são deixados de fora.",
  "error.import.leadNotMember": "{name}: o líder não é um membro, por isso o canal fica sem líder.",
  "error.import.routineLimit": "{name}: somente as primeiras {limit} rotinas são importadas.",
  "error.import.routineInvalid":
    '{name}: a rotina "{routine}" é ignorada porque seu nome, texto ou agendamento é inválido.',
  "error.import.memoriesSkipped":
    "{name}: {skipped} memórias são ignoradas porque estão vazias ou têm mais de {limit} caracteres.",
  "error.import.memoryLimit": "{name}: somente as primeiras {limit} memórias são importadas.",
  "error.import.manifestMissing": "A exportação deve conter {manifest}.",
  "error.import.skillFolderMissing": "{name}: a pasta da habilidade {skill} não tem SKILL.md.",
  "error.import.avatarSkipped":
    "{name}: o avatar é ignorado porque não é uma imagem PNG, JPEG ou WebP com menos de 512 KB.",
  "error.import.exportClosed": "A exportação não está mais aberta. Escolha-a novamente.",
  "error.import.agentNotInExport": "A seleção indica um agente que não está na exportação.",
  "error.import.channelNotInExport": "A seleção indica um canal que não está na exportação.",
  "error.import.serverAgentLimit": "Um servidor pode ter no máximo {limit} agentes.",
  "error.import.exportChanged": "A exportação mudou depois de ser verificada. Escolha-a novamente.",
  "error.import.noMembersImported": "Nenhum de seus agentes foi importado.",
  "error.import.leadNotImported": "{name}: seu líder não foi importado, por isso fica sem líder.",
  "error.import.routineSkipped": '{name}: a rotina "{routine}" é ignorada. {reason}',
  "error.import.fileRenamed": "{name}: {file} já existe, por isso esta cópia é salva como {saved}.",
  "error.import.fileSkipped": "{name}: o arquivo {file} é ignorado. {reason}",
  "error.import.chooseZip": "Escolha um arquivo .zip.",
  "error.import.zipTooLarge": "A exportação deve ser um .zip com menos de 500 MB.",
  "error.import.unsafeFile": "A exportação contém um arquivo inseguro: {name}",
  "error.import.expandedTooLarge": "A exportação descompactada deve ter menos de 500 MB e menos de {limit} arquivos.",
  "error.import.zipInvalid":
    "O arquivo selecionado não é um .zip válido. Se o Grok Bot ainda estiver salvando o arquivo, aguarde e escolha-o novamente.",
  "error.import.empty": "A exportação está vazia.",
  "error.import.remoteZipTooLarge":
    "Para importar em um servidor ao qual você se conectou, a exportação deve ser um .zip com menos de 100 MB.",
  "error.import.hostBusy": "O servidor está lendo outras exportações. Tente novamente em alguns minutos.",
  "error.import.skillKept":
    '{name}: o servidor já tem a habilidade "{skill}", por isso o agente usa essa habilidade. Peça a um administrador para atualizá-la.',
} as const satisfies PartialTranslation<typeof source>;
