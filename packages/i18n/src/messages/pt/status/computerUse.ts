import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "O driver de Uso do computador não iniciou. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "O driver de Uso do computador parou antes de responder.",
  "status.computerUse.driverNoAnswer": "O driver de Uso do computador não respondeu. {reason}",
  "status.computerUse.driverStopped": "O driver de Uso do computador parou.",
  "status.computerUse.unsupported": "O Uso do computador está disponível no macOS, Windows e Linux.",
  "status.computerUse.driverMissing": "Esta versão do OpenBot não inclui um driver de Uso do computador.",
  "status.computerUse.restartRequired":
    "O macOS ainda impede o OpenBot de clicar e digitar, embora as duas permissões estejam ativadas. Reinicie o OpenBot. Se isso voltar, clique em Gerenciar ao lado de Acessibilidade, remova o OpenBot da lista, adicione-o de novo e reinicie o OpenBot.",
  "status.computerUse.progressActing": "Usando um aplicativo neste computador…",
  "status.computerUse.progressDeciding": "Decidindo a próxima etapa no aplicativo…",
} as const satisfies PartialTranslation<typeof source>;
