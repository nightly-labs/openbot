import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "Entre na sua conta para compartilhar",
  "mobile.share.signInDescription":
    "Leia o código QR no OpenBot do seu computador. Depois, você poderá escolher o agente que recebe o que você compartilhou.",
  "mobile.share.reading": "Lendo o que você compartilhou…",
  "mobile.share.readFailed": "O OpenBot não conseguiu ler o que você compartilhou. Compartilhe novamente.",
  "mobile.share.content": "Para compartilhar",
  "mobile.share.footer": "O chat abre com isto no campo de mensagem. Nada é enviado até você enviar.",
  "mobile.share.lastUsed": "Usado por último",
  "mobile.share.noAgents": "Nenhum agente",
  "mobile.share.chooseAgent": "Escolha um agente",
  "mobile.share.action": "Compartilhar com {name}",
  "mobile.share.extension.send": "Enviar",
  "mobile.share.extension.footer": "O OpenBot envia isto ao agente agora. O app não abre.",
  "mobile.share.extension.sending": "Enviando para {name}…",
  "mobile.share.extension.sent": "Enviado para {name}",
  "mobile.share.extension.failed": "O OpenBot não conseguiu enviar isto. Abra o app para enviar de lá.",
  "mobile.share.extension.unconfirmed": "O servidor não confirmou a mensagem. Veja o chat antes de enviar de novo.",
  "mobile.share.extension.openApp": "Abrir o OpenBot",
} as const satisfies PartialTranslation<typeof source>;
