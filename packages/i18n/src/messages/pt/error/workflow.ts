import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Este fluxo de trabalho não existe mais.",
  "error.workflow.versionMissing": "Esta versão do fluxo de trabalho não existe mais.",
  "error.workflow.annotation": "Textos, notas e formas não podem ter conexões.",
  "error.workflow.port": "Uma etapa não pode receber este tipo de entrada.",
  "error.workflow.branch": "Somente uma condição pode ter conexões de sim e não.",
  "error.workflow.conditionBranch": "Cada conexão de uma condição deve ser sim ou não.",
  "error.workflow.duplicateEdge": "Estas duas etapas já têm esta conexão.",
  "error.workflow.serverTooOld":
    "Este servidor não oferece suporte a fluxos de trabalho. Atualize o OpenBot no computador que o executa.",
  "error.workflow.nodeUnsupported":
    "Esta versão do OpenBot ainda não pode executar etapas de imagem, arquivo e mensagem.",
  "error.workflow.interrupted": "O OpenBot parou enquanto esta etapa era executada. Execute-a novamente.",
  "error.workflow.agentMissing": "Escolha um agente para esta etapa.",
  "error.workflow.handoffFailed": "O OpenBot não conseguiu enviar esta etapa ao agente.",
  "error.workflow.agentStepEnded": "A mensagem ao agente foi removida antes da resposta.",
  "error.workflow.conditionUnclear": "O modelo não respondeu sim ou não.",
  "error.workflow.modelFailed": "O modelo não conseguiu responder. Execute a etapa novamente.",
  "error.workflow.modelBusy": "Outra solicitação ao modelo está em andamento. Execute a etapa novamente em breve.",
  "error.workflow.stepMissing": "Esta etapa não existe mais.",
  "error.workflow.nodeMissing": "Esta etapa não está no fluxo de trabalho.",
  "error.workflow.runMissing": "Esta execução não existe mais.",
  "error.workflow.notRetryable": "Somente uma etapa que falhou ou parou pode ser executada novamente.",
  "error.workflow.noDecision": "Esta etapa não aguarda uma decisão.",
  "error.workflow.outputPlaceMissing": "Escolha um local de mensagens para esta saída.",
  "error.workflow.outputConnectionOff":
    "A conexão de mensagens desta saída está desativada ou foi removida. Escolha um local novamente.",
  "error.workflow.outputNotRunning": "A conexão de mensagens não está em execução agora. Tente de novo quando estiver.",
  "error.workflow.outputRefused": "O local recusou a publicação. Verifique se o OpenBot pode publicar lá.",
  "error.workflow.outputUncertain":
    "A publicação parou no caminho. Uma parte pode já estar no local. Verifique antes de tentar de novo.",
  "error.workflow.tooLarge":
    "Este fluxo de trabalho é grande demais para ser salvo. Remova alguns desenhos ou textos longos e tente novamente.",
  "error.workflow.tooLargeToSend":
    "Este fluxo de trabalho é grande demais para ser enviado a outro computador. Abra-o no computador que executa o servidor.",
  "error.workflow.webhookMissing":
    "Esta etapa não é um gatilho de webhook. Salve o fluxo de trabalho e tente novamente.",
  "error.workflow.githubActionMissing": "Escolha o que esta saída faz no GitHub.",
  "error.workflow.githubRepositoryMissing": "Escolha um repositório para esta saída.",
  "error.workflow.githubItemMissing":
    "Esta saída não tem issue nem pull request. Inicie a execução a partir de um evento do GitHub ou coloque o número na entrada dela.",
  "error.workflow.githubPullRequestOnly": "Esta ação funciona apenas em pull requests.",
  "error.workflow.githubTextMissing": "Esta saída não tem texto para enviar. Conecte uma etapa que o escreva.",
  "error.workflow.githubEventText":
    "Esta saída não pode enviar o evento bruto do gatilho. Coloque um agente entre o gatilho e esta saída.",
  "error.workflow.githubChoiceMissing": "Escolha os rótulos ou a pessoa para esta saída.",
  "error.workflow.githubChoseNothing": "O modelo não escolheu nenhum rótulo ou pessoa deste repositório.",
  "error.workflow.githubNotConnected": "Conecte o GitHub no computador que executa este fluxo de trabalho.",
  "error.workflow.githubNoAccess":
    "O GitHub App do OpenBot não consegue ver este repositório ou item. Abra o GitHub e dê acesso ao app.",
  "error.workflow.githubNoWrite":
    "O GitHub App do OpenBot não pode alterar este repositório. Abra o GitHub e dê acesso ao app.",
  "error.workflow.githubLocked": "Esta conversa está bloqueada no GitHub.",
  "error.workflow.githubRefused": "O GitHub recusou a alteração: {detail}",
  "error.workflow.githubUnreachable": "O OpenBot não conseguiu acessar o GitHub. Execute a etapa novamente.",
  "error.workflow.githubUncertain":
    "A alteração parou no caminho. Ela pode já estar no GitHub. Verifique lá antes de executar a etapa novamente.",
  "error.workflow.githubNoEvent": "O GitHub não tem issue nem pull request para este gatilho iniciar.",
} as const satisfies PartialTranslation<typeof source>;
