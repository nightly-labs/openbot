import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "В этой сборке OpenBot нет приложения для перетаскивания.",
  "error.computerUse.helpWindowChanged": "Окно подсказки по разрешениям изменилось до начала перетаскивания.",
  "error.computerUse.noAppToShow": "В этой сборке OpenBot нет приложения для показа.",
  "error.computerUse.noDriver": "На этом компьютере нет драйвера управления компьютером.",
  "error.computerUse.socketPathTooLong":
    "Путь к сокету управления компьютером — {length} символов, а система допускает {limit}.",
  "error.computerUse.socketDirectoryNotDirectory":
    "Каталог сокета управления компьютером {path} не является каталогом.",
  "error.computerUse.socketDirectoryOtherOwner":
    "Каталог сокета управления компьютером {path} принадлежит другому пользователю.",
  "error.computerUse.socketDirectoryShared":
    "Каталог сокета управления компьютером {path} открыт для других пользователей.",
  "error.computerUse.socketNotReady": "Он не принял подключение за {seconds} с. {reason}",
} as const satisfies PartialTranslation<typeof source>;
