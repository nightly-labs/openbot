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
  "error.connector.onePasswordCliMissing":
    "O OpenBot não encontrou a CLI do 1Password. Instale-a e ative a integração no app do 1Password, ou use um token de conta de serviço.",
  "error.connector.onePasswordCliInstallFailed":
    "O OpenBot não conseguiu instalar a CLI do 1Password. Verifique a conexão com a internet e tente novamente.",
  "error.connector.onePasswordCliSignedOut":
    "A CLI do 1Password não está conectada. Ative a integração no app do 1Password e conecte novamente.",
  "error.connector.onePasswordCliFailed": "A CLI do 1Password falhou: {detail}",
  "error.connector.onePasswordUnexpected": "O 1Password enviou uma resposta inesperada: {detail}",
  "error.connector.onePasswordTokenRejected": "O 1Password não aceitou o token da conta de serviço.",
  "error.connector.onePasswordNoVault":
    "A conta de serviço não consegue ler nenhum cofre. Dê acesso a um cofre e tente novamente.",
  "error.connector.onePasswordFileUnreadable": "O arquivo de conexão com o 1Password não pode ser lido.",
  "error.connector.onePasswordFileTooLarge": "O arquivo de conexão com o 1Password é muito grande.",
  "error.connector.bitwardenFailed":
    "Não foi possível ler o Bitwarden. Instale a CLI bw, entre, desbloqueie e crie uma pasta chamada Shared with OpenBot. Conecte com uma nova chave de sessão.",
} as const satisfies PartialTranslation<typeof source>;
