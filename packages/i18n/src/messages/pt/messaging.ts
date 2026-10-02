import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "O Slack não aceita mais o OpenBot neste espaço de trabalho. Ele pode ter sido desinstalado. Conecte o espaço de trabalho novamente.",
  "messaging.help.secret_storage_unavailable":
    "O OpenBot não consegue ler os tokens salvos neste computador. Desconecte o espaço de trabalho e conecte-o novamente.",
  "messaging.help.relay_unavailable":
    "O OpenBot não consegue receber eventos do Slack neste computador. Entre na sua conta, dê um nome a este computador nas configurações do servidor e mantenha o OpenBot aberto.",
} as const satisfies PartialTranslation<typeof source>;
