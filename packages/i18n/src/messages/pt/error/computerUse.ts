import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "Esta versão do OpenBot não tem um aplicativo para arrastar.",
  "error.computerUse.helpWindowChanged": "A janela de ajuda de permissões mudou antes de começar a arrastar.",
  "error.computerUse.noAppToShow": "Esta versão do OpenBot não tem um aplicativo para mostrar.",
  "error.computerUse.noDriver": "Este computador não tem um driver de Uso do computador.",
  "error.computerUse.socketPathTooLong":
    "O caminho do socket de Uso do computador tem {length} caracteres, e este sistema permite {limit}.",
  "error.computerUse.socketDirectoryNotDirectory":
    "O diretório do socket de Uso do computador {path} não é um diretório.",
  "error.computerUse.socketDirectoryOtherOwner":
    "O diretório do socket de Uso do computador {path} pertence a outro usuário.",
  "error.computerUse.socketDirectoryShared":
    "O diretório do socket de Uso do computador {path} está acessível a outros usuários.",
  "error.computerUse.socketNotReady": "Não aceitou uma conexão em {seconds} segundos. {reason}",
} as const satisfies PartialTranslation<typeof source>;
