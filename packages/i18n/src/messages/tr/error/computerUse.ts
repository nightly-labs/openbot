import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  // Computer Use sürücüsü ve izin penceresi hataları.
  "error.computerUse.noAppToDrag": "OpenBot'un bu derlemesinde sürüklenecek bir uygulama yok.",
  "error.computerUse.helpWindowChanged": "İzin yardım penceresi sürükleme başlamadan önce değişti.",
  "error.computerUse.noAppToShow": "OpenBot'un bu derlemesinde gösterilecek bir uygulama yok.",
  "error.computerUse.noDriver": "Bu bilgisayarda Computer Use sürücüsü yok.",
  "error.computerUse.socketPathTooLong":
    "Computer Use soket yolu {length} karakterdir ve bu sistem {limit} karaktere izin verir.",
  "error.computerUse.socketDirectoryNotDirectory": "Computer Use soket dizini {path} bir dizin değil.",
  "error.computerUse.socketDirectoryOtherOwner": "Computer Use soket dizini {path} başka bir kullanıcıya ait.",
  "error.computerUse.socketDirectoryShared": "Computer Use soket dizini {path} diğer kullanıcılara açık.",
  "error.computerUse.socketNotReady": "{seconds} saniye içinde bir bağlantıyı kabul etmedi. {reason}",
} as const satisfies PartialTranslation<typeof source>;
