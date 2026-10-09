import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Não conectado",
  "mobile.workspace.status.online": "Online",
  "mobile.workspace.status.offline": "Offline",
  "mobile.workspace.status.error": "Erro de conexão",
  "mobile.workspace.status.reconnecting": "Reconectando",
  "mobile.workspace.status.attempt": "Tentativa {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Tentativa ",
  "mobile.workspace.status.retryIn": "Nova tentativa em {seconds} segundos",
  "mobile.workspace.section.agents": "Agentes",
  "mobile.workspace.error.directoryUnavailable": "O diretório de servidores está indisponível.",
  "mobile.workspace.error.sectionsLoadFailed": "Não foi possível carregar as seções. Tente novamente.",
  "mobile.workspace.error.transportNotReady": "O transporte de dados do aplicativo para celular não está pronto.",
  "mobile.workspace.error.sectionsUnsupported": "Este computador anfitrião não permite alterar seções.",
  "mobile.workspace.error.leaveOwnServer": "Só é possível sair de servidores remotos dos quais você participa.",
  "mobile.workspace.error.agentNotOnHost": "O agente não está neste computador anfitrião.",
  "mobile.workspace.error.filesUnsupported":
    "Este computador anfitrião não permite gerenciar arquivos. Atualize o OpenBot nele.",
  "mobile.workspace.error.agentUnavailableOnHost": "O agente está indisponível neste computador anfitrião.",
  "mobile.workspace.error.agentUnavailable": "O agente está indisponível.",
  "mobile.workspace.error.formUnavailable": "Este formulário não está mais disponível.",
  "mobile.workspace.error.approvalInactive":
    "Esta solicitação não está mais aguardando. Outro dispositivo a respondeu ou a tarefa parou.",
  "mobile.workspace.error.approvalOffline": "Conecte-se ao servidor para responder a esta solicitação.",
  "mobile.workspace.alert.preferencesTitle": "Não foi possível salvar as preferências do chat",
  "mobile.workspace.alert.preferencesBody": "Suas preferências anteriores foram mantidas. Tente novamente.",
  "mobile.workspace.alert.updateRequiredTitle": "Atualização necessária",
  "mobile.workspace.alert.updateRequiredUnread":
    "Atualize o servidor no computador para marcar conversas como não lidas.",
  "mobile.workspace.alert.markUnreadTitle": "Não foi possível marcar como não lida",
  "mobile.workspace.alert.markUnreadBody": "Conecte-se novamente ao servidor e tente de novo.",
  "mobile.workspace.alert.serverOrderTitle": "Não foi possível salvar a ordem dos servidores",
  "mobile.workspace.alert.serverOrderBody": "A ordem anterior foi mantida. Tente novamente.",
  "mobile.workspace.error.connectFailed": "A conexão com o servidor falhou.",
  "mobile.workspace.error.disconnectFailed": "O servidor não desconectou corretamente.",
  "mobile.workspace.error.queueEditRejected": "O computador anfitrião não aceitou esta edição.",
} as const satisfies PartialTranslation<typeof source>;
