import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "Somente links HTTP(S) podem abrir no navegador externo.",
  "error.app.notificationsUnsupported": "Este sistema não oferece suporte a notificações na área de trabalho.",
  "error.app.notificationSettingsMissing": "Este sistema não tem uma página de configurações de notificações.",
  "error.app.notReady": "O OpenBot não está pronto.",
  "error.app.macSecureStorageUnavailable": "O armazenamento seguro do macOS está indisponível.",
  "error.app.secretStorageUnavailable": "O armazenamento de segredos do sistema está indisponível.",
  "error.app.remoteIdentityUnavailable": "A identidade do computador anfitrião remoto está indisponível.",
  "error.app.iceServersMissing": "O Remote Signal ainda não forneceu servidores ICE.",
  "error.app.finishLocalTest": "Conclua o teste local antes de trocar de tela.",
} as const satisfies PartialTranslation<typeof source>;
