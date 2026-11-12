import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download interrompido. Tente novamente.",
  "status.provider.downloadFailed": "Falha no download. Tente novamente.",
  "status.provider.updateWaiting": "A atualização começa quando o turno atual terminar.",
  "status.provider.confirmContinue": "Continuar",
  "status.provider.confirmCancel": "Cancelar",
  "status.provider.retryUnreachable":
    "{provider} não consegue se conectar ao servidor. Nova tentativa {attempt} de {maxAttempts}.",
  "status.provider.retryServerError":
    "O servidor do {provider} está ocupado ou com erro. Nova tentativa {attempt} de {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} voltou a receber respostas do servidor.",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "O Claude respondeu na velocidade padrão. Com uma assinatura do Claude, o modo rápido usa créditos de uso. Ative-os na sua conta do Claude.",
  "status.provider.claudeFastModeNotOnPlan":
    "O Claude respondeu na velocidade padrão. O seu plano do Claude não inclui o modo rápido.",
  "status.provider.claudeFastModeNotFirstParty":
    "O Claude respondeu na velocidade padrão. O modo rápido só funciona com uma chave de API da Anthropic ou uma assinatura do Claude, não com Bedrock, Vertex, Foundry ou um gateway.",
  "status.provider.claudeFastModeModelNotAllowed":
    "O Claude respondeu na velocidade padrão. Este modelo não pode usar o modo rápido na sua conta.",
  "status.provider.claudeFastModeTurnedOff":
    "O Claude respondeu na velocidade padrão. O modo rápido está desativado nas configurações do Claude Code ou pela sua organização.",
  "status.provider.claudeFastModeUnavailable":
    "O Claude respondeu na velocidade padrão. O Claude Code não pôde usar o modo rápido neste turno.",
} as const satisfies PartialTranslation<typeof source>;
