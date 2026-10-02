import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "O OpenBot não conseguiu acessar o serviço de contas. Verifique se a API está em execução e tente novamente.",
  "error.auth.signInFirst": "Entre no OpenBot primeiro.",
  "error.auth.signInRequired": "É necessário entrar.",
  "error.auth.accountChangedDuringRegister": "A conta conectada mudou durante o registro deste servidor.",
  "error.auth.hostCredentialUnavailable":
    "A credencial do computador anfitrião remoto está indisponível. Registre o computador anfitrião novamente.",
  "error.auth.codeNotVerified": "Não foi possível verificar o código de acesso.",
  "error.auth.serviceError": "O serviço de contas retornou um erro.",
  "error.auth.invalidHostedServer": "O serviço de contas retornou um servidor hospedado inválido.",
  "error.auth.codeNotSent": "O OpenBot não conseguiu enviar o código de acesso.",
  "error.auth.deliveryTimeout":
    "O OpenBot não conseguiu confirmar a entrega a tempo. O código ainda pode chegar; verifique a entrega antes de enviar novamente.",
  "error.auth.deliveryInterrupted":
    "A conexão terminou antes de o OpenBot confirmar a entrega. Verifique a entrega para evitar o envio de outro código.",
  "error.auth.deliveryUnknown":
    "O OpenBot não conseguiu confirmar se o código de acesso foi enviado. Verifique a entrega antes de enviar novamente.",
} as const satisfies PartialTranslation<typeof source>;
