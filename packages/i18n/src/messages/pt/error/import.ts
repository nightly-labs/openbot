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
  "error.import.unsafeFile": "A exportação contém um arquivo inseguro: {name}",
  "error.import.tooManyFiles": "A exportação deve ter no máximo {limit} arquivos.",
  "error.import.diskSpace":
    "{name}: os arquivos precisam de {size} GB de espaço livre em disco, e há {free} GB livres. Libere espaço e importe o agente novamente.",
  "error.import.remoteExpandedTooLarge":
    "A exportação descompactada deve ter menos de 500 MB e menos de {limit} arquivos.",
  "error.import.zipInvalid":
    "O arquivo selecionado não é um .zip válido. Se o Grok Bot ainda estiver salvando o arquivo, aguarde e escolha-o novamente.",
  "error.import.entryDamaged": "O arquivo está danificado na exportação.",
  "error.import.foldersSkipped":
    "{number} arquivos nas pastas .git e node_modules ficam de fora. Uma ferramenta pode criá-los de novo.",
  "error.import.empty": "A exportação está vazia.",
  "error.import.remoteZipTooLarge":
    "Para importar em um servidor ao qual você se conectou, a exportação deve ser um .zip com menos de 100 MB.",
  "error.import.hostBusy": "O servidor está lendo outras exportações. Tente novamente em alguns minutos.",
  "error.import.uploadDiskSpace":
    "A exportação precisa de {size} GB de espaço livre no servidor, e há {free} GB livres. Libere espaço no servidor e escolha a exportação novamente.",
  "error.import.remoteZipTooLargeOldHost":
    "Este servidor aceita uma exportação de até 100 MB. Atualize o OpenBot no servidor para importar uma exportação maior.",
  "error.import.skillKept":
    '{name}: o servidor já tem a habilidade "{skill}", por isso o agente usa essa habilidade. Peça a um administrador para atualizá-la.',
  "error.import.skillRenamed":
    '{name}: o nome da habilidade "{skill}" é parecido demais com o de outra habilidade, por isso ela é salva como "{renamed}".',
  "error.import.transferRemoteTooLarge":
    "Um arquivo de transferência para um servidor ao qual você se conectou deve ter menos de 100 MB. Desative os arquivos do espaço de trabalho ou exporte menos agentes.",
  "error.import.transferNotFile": "Este arquivo não é um arquivo de transferência do OpenBot.",
  "error.import.transferNewer":
    "Uma versão mais nova do OpenBot criou este arquivo. Atualize o OpenBot e tente de novo.",
  "error.import.transferEmpty": "O arquivo não contém agentes nem configurações.",
  "error.import.transferTooLarge":
    "Um arquivo de transferência deve ter menos de 2 GB e de 50.000 arquivos. Desative os arquivos do espaço de trabalho ou exporte menos agentes.",
  "error.import.transferAgentInvalid": "O agente {number} no arquivo é inválido e por isso foi ignorado.",
  "error.import.transferSettingsInvalid":
    "As configurações do app no arquivo são inválidas e por isso não foram importadas.",
  "error.import.transferModelMissing":
    "{name}: o modelo “{model}” ainda não está disponível aqui, então o agente usa o modelo padrão. Escolha o modelo de novo quando o provedor dele estiver pronto.",
  "error.import.transferSettingSkipped": "{name} não foi importado. {reason}",
  "error.import.transferRoutineFlowSkipped": "A importação deixou de fora um fluxo de rotina. {reason}",
  "error.import.transferCustomAgentCommand":
    "{name}: agentes personalizados não são importados, porque executam um comando. Verifique o comando “{command}” e adicione o agente de novo em Configurações.",
  "error.import.transferSkillLimit":
    "{name}: só as primeiras {limit} de suas {total} habilidades estão no arquivo, porque um agente pode ter {limit} habilidades.",
  "error.import.transferFilesGone":
    "{number} arquivos foram excluídos durante a exportação, então não estão no arquivo.",
  "error.import.transferProviderKey": "{name}: digite a chave de API de novo em Configurações.",
  "error.import.transferAgentEnv": "{name}: digite os valores de {names} de novo em Configurações.",
  "error.import.transferMcpValues":
    "{name}: o servidor MCP foi adicionado desativado. Verifique o comando, digite os valores e o endereço completo de novo e ative-o nas configurações de MCP.",
  "error.import.transferValuesCleared":
    "{name}: valores que podem conter um segredo foram removidos dos argumentos ou do endereço. Digite-os de novo em Configurações.",
  "error.import.transferSharedKept": "{number} arquivos da pasta Shared já estão aqui, então são mantidos como estão.",
} as const satisfies PartialTranslation<typeof source>;
