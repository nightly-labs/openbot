import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "Esta versão do OpenBot não tem um GitHub App.",
  "error.connector.githubDenied": "A entrada no GitHub foi recusada.",
  "error.connector.githubCodeExpired": "O código do GitHub expirou. Conecte o GitHub novamente.",
  "error.connector.githubDeviceFlowDisabled": "O GitHub App não permite entrar pelo dispositivo.",
  "error.connector.githubClientUnknown": "O GitHub não reconhece o Client ID deste GitHub App.",
  "error.connector.githubUnexpected": "O GitHub enviou uma resposta inesperada: {detail}",
  "error.connector.githubUnreachable": "O OpenBot não consegue acessar o GitHub: {detail}",
  "error.connector.githubExpired": "A conexão com o GitHub expirou. Conecte o GitHub novamente.",
  "error.connector.githubFileUnreadable": "O arquivo de conexão com o GitHub não pode ser lido.",
  "error.connector.githubFileTooLarge": "O arquivo de conexão com o GitHub é muito grande.",
} as const satisfies PartialTranslation<typeof source>;
