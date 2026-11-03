import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "У цій збірці OpenBot немає застосунку для перетягування.",
  "error.computerUse.helpWindowChanged": "Вікно довідки щодо дозволів змінилося до початку перетягування.",
  "error.computerUse.noAppToShow": "У цій збірці OpenBot немає застосунку для показу.",
  "error.computerUse.noDriver": "На цьому комп’ютері немає драйвера керування комп’ютером.",
  "error.computerUse.socketPathTooLong":
    "Шлях до сокета керування комп’ютером має {length} символів, а ця система дозволяє {limit}.",
  "error.computerUse.socketDirectoryNotDirectory": "Каталог сокета керування комп’ютером {path} не є каталогом.",
  "error.computerUse.socketDirectoryOtherOwner":
    "Каталог сокета керування комп’ютером {path} належить іншому користувачеві.",
  "error.computerUse.socketDirectoryShared":
    "Каталог сокета керування комп’ютером {path} відкритий для інших користувачів.",
  "error.computerUse.socketNotReady": "Він не прийняв з’єднання за {seconds} с. {reason}",
} as const satisfies PartialTranslation<typeof source>;
