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
} as const satisfies PartialTranslation<typeof source>;
