import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "Esta versão do OpenBot não tem um GitHub App.",
  "error.connector.githubDenied": "O login no GitHub foi recusado.",
  "error.connector.githubCodeExpired": "O código do GitHub expirou. Conecte o GitHub novamente.",
  "error.connector.githubDeviceFlowDisabled": "O GitHub App não permite login por dispositivo.",
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
  "error.connector.bitwardenHostInput":
    "Informe um endereço de servidor HTTPS, o client_id e o client_secret da chave de API e a senha mestra.",
  "error.connector.bitwardenHostFailed":
    "Não foi possível abrir o Bitwarden neste servidor. Verifique o endereço do servidor, a chave de API e a senha mestra, e confirme que uma pasta se chama Shared with OpenBot. Depois, conecte de novo.",
  "error.connector.bitwardenCliInstallFailed":
    "Não foi possível instalar a CLI do Bitwarden neste servidor. Verifique a conexão de rede dele e conecte de novo.",
  "error.connector.bitwardenFileUnreadable": "O arquivo de conexão do Bitwarden não pode ser lido.",
  "error.connector.telegramAccountCredentialsMissing":
    "Digite o api_id e o api_hash do seu app do Telegram. Você os obtém em my.telegram.org.",
  "error.connector.telegramAccountCredentialsInvalid":
    "O api_id é um número e o api_hash tem 32 caracteres de 0-9 e a-f. Copie-os de novo em my.telegram.org.",
  "error.connector.telegramAccountApiRejected":
    "O Telegram não aceita este api_id e api_hash. Copie-os de novo em my.telegram.org.",
  "error.connector.telegramAccountPhoneFormat":
    "Digite o número de telefone com o código do país, por exemplo +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid":
    "O Telegram não reconhece este número. Inclua o código do país, por exemplo +48.",
  "error.connector.telegramAccountCodeInvalid": "Este código não está correto. Confira e tente de novo.",
  "error.connector.telegramAccountCodeEmpty": "Digite o código que o Telegram enviou para você.",
  "error.connector.telegramAccountCodeExpired": "O código expirou. Comece de novo para receber um novo código.",
  "error.connector.telegramAccountPasswordInvalid": "Esta senha não está correta. Tente de novo.",
  "error.connector.telegramAccountPasswordEmpty": "Digite sua senha de verificação em duas etapas.",
  "error.connector.telegramAccountPasswordNeeded": "O Telegram precisa da sua senha de verificação em duas etapas.",
  "error.connector.telegramAccountNoAccount":
    "Este número não tem conta no Telegram. Entre com um número que já usa o Telegram.",
  "error.connector.telegramAccountPhoneBanned": "O Telegram baniu este número.",
  "error.connector.telegramAccountQrExpired": "O código QR expirou antes de você escaneá-lo. Comece de novo.",
  "error.connector.telegramAccountFloodWait": "O Telegram pede que você aguarde. Tente de novo em {count} min.",
  "error.connector.telegramAccountCancelled": "O login no Telegram foi cancelado.",
  "error.connector.telegramAccountTimedOut": "O login parou após 10 minutos sem atividade. Comece de novo.",
  "error.connector.telegramAccountMovedOn": "O login passou para outra etapa. Comece de novo.",
  "error.connector.telegramAccountRefused": "O Telegram recusou o login: {detail}",
  "error.connector.telegramAccountSaveFailed": "O OpenBot não conseguiu salvar a conexão com o Telegram: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "O Telegram encerrou esta sessão, por exemplo em Configurações > Dispositivos. Conecte sua conta do Telegram de novo.",
  "error.connector.telegramAccountFileUnreadable": "O arquivo de conexão da conta do Telegram não pode ser lido.",
  "error.connector.telegramAccountFileTooLarge": "O arquivo de conexão da conta do Telegram é muito grande.",
} as const satisfies PartialTranslation<typeof source>;
