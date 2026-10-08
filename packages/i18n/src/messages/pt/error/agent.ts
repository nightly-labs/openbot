import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.approvalWhileDeleting": "Não é possível conceder aprovação enquanto o agente está sendo excluído.",
  "error.agent.accessLocalOnly": "O acesso do agente só pode ser alterado no computador que executa o agente.",
  "error.agent.duplicateCleanupFailed": "A duplicação do agente falhou e não foi possível remover a cópia incompleta.",
  "error.agent.settingsLocalOnly":
    "As configurações do agente só podem ser alteradas no computador que executa o agente.",
  "error.agent.skillsLocalOnly": "As habilidades só podem ser alteradas no computador que executa o agente.",
  "error.agent.addLocalOnly": "Os agentes só podem ser adicionados no computador que os executa.",
  "error.agent.joinedServerUpdate": "Um agente de um servidor ao qual você se conectou não pode ser atualizado daqui.",
  "error.agent.searchQueryRequired": "É necessário informar um termo de busca.",
  "error.agent.messageTooLong": "A mensagem é muito longa.",
  "error.agent.messageOrAttachmentRequired": "É necessário incluir uma mensagem ou um anexo.",
  "error.agent.promptAnswersTooLong": "As respostas às perguntas são muito longas.",
  "error.agent.gone": "Este agente não existe mais.",
  "error.agent.profileGenerationBusy": "A geração de perfil está ocupada. Tente novamente em instantes.",
  "error.agent.initialMessageRequired": "É necessário informar uma mensagem inicial.",
  "error.agent.initialMessageTooLong": "A mensagem inicial é muito longa.",
  "error.agent.setupCleanupFailed": "A configuração do agente falhou e não foi possível remover o agente incompleto.",
  "error.agent.modelUnavailable": "O modelo selecionado para o agente está indisponível.",
  "error.agent.modelProviderNotConnected":
    'O modelo selecionado para o agente, "{model}", está indisponível: {provider} não está conectado.',
  "error.agent.modelListEmpty":
    'O modelo selecionado para o agente, "{model}", está indisponível: {provider} não listou nenhum modelo. Último erro: {detail}',
  "error.agent.modelListEmptyNoError":
    'O modelo selecionado para o agente, "{model}", está indisponível: {provider} não listou nenhum modelo.',
  "error.agent.modelNotInProviderList":
    'O modelo selecionado para o agente, "{model}", está indisponível: {provider} não o lista.',
  "error.agent.modelProviderMismatch": "O modelo selecionado não pertence a esse provedor.",
  "error.agent.modelNotListed": 'O modelo "{model}" não está disponível. Modelos disponíveis: {models}.',
  "error.agent.providerNotListed":
    "Nenhum modelo de {provider} está disponível agora. Chame list_models para ver os modelos disponíveis.",
  "error.agent.reasoningEffortUnsupported":
    'O modelo "{model}" não oferece suporte ao esforço de raciocínio "{effort}". Esforços disponíveis: {efforts}.',
  "error.agent.noStartingModelInSettings":
    "{provider} não tem nenhum modelo disponível, e nenhum outro provedor conectado tem um. Entre em um provedor ou altere o provedor padrão em Configurações do servidor → Provedores.",
  "error.agent.noStartingModel":
    "{provider} não tem nenhum modelo disponível, e nenhum outro provedor conectado tem um. Entre em um provedor ou altere o provedor padrão em Provedores e permissões.",
  "error.agent.waitBeforeProviderChange": "Aguarde o turno ativo e a fila terminarem antes de trocar de provedor.",
  "error.agent.waitBeforeClearContext": "Aguarde o turno ativo e a fila terminarem antes de iniciar um novo chat.",
  "error.agent.unknown": "Agente desconhecido: {id}",
  "error.agent.onlyUserWidensSettings":
    "Somente o usuário pode conceder Acesso completo a um agente ou ativar Uso do computador. Peça ao usuário para alterar isso nas configurações do agente.",
  "error.agent.queuedMessageCreateFailed": "Não foi possível criar a mensagem na fila.",
  "error.agent.messageUnavailable": "A mensagem não está mais disponível.",
  "error.agent.hostLimit": "Um computador anfitrião pode ter até {limit} agentes.",
  "error.agent.changedWhileDuplicating": "O agente mudou durante a duplicação. Tente novamente.",
  "error.agent.duplicatedAgentGone": "O agente duplicado não existe mais.",
  "error.agent.stateCorrupt":
    "O estado dos agentes está corrompido ou é de uma versão mais recente do OpenBot; ele não será sobrescrito.",
  "error.agent.oldRoleField":
    "Os perfis de agente salvos usam o campo de função antigo; atualize os dados antes de iniciar o OpenBot.",
  "error.agent.duplicateIds": "O estado dos agentes contém IDs de agente duplicados; ele não será sobrescrito.",
  "error.agent.copyNameFailed": "O OpenBot não conseguiu criar um nome exclusivo para a cópia do agente.",
  "error.agent.endpointRemoved": "O endpoint usado por este agente foi removido. Escolha outro modelo para ele.",
  "error.agent.selectedGone": "O agente selecionado não existe mais.",
  "error.agent.profileEndpointsChanged": "Os endpoints personalizados mudaram durante a geração. Tente novamente.",
  "error.agent.profileInvalid": "O provedor retornou um perfil inválido. Tente reformular seu pedido.",
  "error.agent.profileSectionUnavailable":
    "A seção gerada está indisponível. Tente novamente ou escolha uma seção manualmente.",
  "error.agent.profileTimedOut": "O tempo para gerar o perfil esgotou. Tente novamente.",
  "error.agent.profileDisconnected": "O provedor se desconectou durante a geração do perfil.",
  "error.agent.profileToolUse": "O provedor tentou usar uma ferramenta. Tente reformular seu pedido.",
  "error.agent.profileFailed": "O provedor não conseguiu gerar um perfil. Tente novamente.",
  "error.agent.profileTooLarge": "O perfil gerado é muito grande. Tente um pedido mais curto.",
  "error.agent.profileNotStarted": "O provedor não conseguiu iniciar a geração do perfil.",
  "error.agent.deletionBusy": "A exclusão do agente já está em andamento.",
  "error.agent.stopBeforeDelete": "Interrompa o agente e cancele as mensagens na fila antes de excluí-lo.",
  "error.agent.deleteIncomplete":
    "Não foi possível remover todos os dados do agente. Tente excluir o agente novamente.",
  "error.agent.duplicationBusy": "Este agente já está sendo duplicado.",
  "error.agent.waitBeforeDuplicate": "Aguarde o agente terminar e esvazie a fila antes de duplicá-lo.",
  "error.agent.saveOtherAgent": "Este registro salvo pertence a outro agente.",
  "error.agent.savedGone": "O agente salvo não existe mais.",
  "error.agent.storedProfileUnreadable":
    'Um perfil de agente salvo tem um valor "{field}" ilegível; atualize os dados antes de iniciar o OpenBot.',
  "error.agent.storedProfileUnreadableId":
    'O perfil de agente salvo {id} tem um valor "{field}" ilegível; atualize os dados antes de iniciar o OpenBot.',
  "error.agent.queueEditRejected": "Edição da fila rejeitada: {reason}",
  "error.agent.computerUseLocalOnly": "Uso do computador só pode ser alterado no computador que executa o agente.",
  "error.agent.workspaceOnlyMacOnly":
    "Somente o espaço de trabalho está disponível para este provedor apenas no macOS. Escolha Acesso completo nas configurações do agente.",
  "error.agent.lowMemory":
    "Este servidor está com pouca memória. Sua mensagem aguarda na fila e começa quando houver memória livre. Um plano maior oferece mais memória ao servidor.",
  "error.agent.workspaceOnlyToolMissing":
    "Somente o espaço de trabalho exige {tool}, que o OpenBot não encontrou. Instale a ferramenta ou escolha Acesso completo nas configurações do agente.",
} as const satisfies PartialTranslation<typeof source>;
