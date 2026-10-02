import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "A configuração de permissões está disponível no macOS.",
  "status.remote.setupInstallHost":
    "Instale o componente de área de trabalho remota do computador anfitrião e verifique novamente.",
  "status.remote.setupUpdateRuntime":
    "Atualize o ambiente de execução da área de trabalho remota para verificar as permissões do macOS.",
  "status.remote.setupCheckFailed":
    "O Sunshine não conseguiu concluir a verificação de permissões. Verifique a sessão no computador anfitrião e tente novamente.",
  "status.remote.setupServiceFailed":
    "O serviço de área de trabalho remota não conseguiu iniciar. Verifique se este usuário do macOS tem uma sessão gráfica ativa.",
  "status.remote.connectingSunshine": "Conectando pelo Sunshine…",
  "status.remote.switchingMonitor": "Trocando o monitor compartilhado…",
  "status.remote.controlConnected": "Controle remoto conectado.",
  "status.remote.controlFailed": "Falha no controle remoto.",
  "status.remote.stagePreferences": "Carregando preferências locais do chat: {reason}",
  "status.remote.stageConnection": "Conectando ao computador: {reason}",
  "status.remote.stageCompatibility": "Verificando a compatibilidade do computador: {reason}",
  "status.remote.stageAgents": "Carregando agentes: {reason}",
  "status.remote.stageReads": "Carregando o status de leitura: {reason}",
  "status.remote.stageConversations": "Carregando conversas: {reason}",
  "status.remote.suspendedDetail":
    "Atualize o OpenBot Mobile ou o aplicativo para computador antes de conectar.\n{detail}",
  "status.remote.cooldownDetail":
    "A conexão falhou após {limit} tentativas. Nova tentativa em {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "A conexão falhou após {limit} tentativas. Nova tentativa em {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Conexão perdida. Nova tentativa em {count}s.\n{detail}",
    other: "Conexão perdida. Nova tentativa em {count}s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Conexão perdida. Nova tentativa em {count}s.",
    other: "Conexão perdida. Nova tentativa em {count}s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "A tentativa de conexão falhou. Nova tentativa em {count}s.\n{detail}",
    other: "A tentativa de conexão falhou. Nova tentativa em {count}s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "A tentativa de conexão falhou. Nova tentativa em {count}s.",
    other: "A tentativa de conexão falhou. Nova tentativa em {count}s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Reconectando {attempt}/{count}\n{detail}",
    other: "Reconectando {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "Reconectando {attempt}/{count}", other: "Reconectando {attempt}/{count}" },
} as const satisfies PartialTranslation<typeof source>;
