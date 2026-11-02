import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  // Computer Use driver and permission window errors.
  "error.computerUse.noAppToDrag": "該版本的 OpenBot 沒有可拖動的應用。",
  "error.computerUse.helpWindowChanged": "權限幫助視窗在拖動開始前發生了變化。",
  "error.computerUse.noAppToShow": "該版本的 OpenBot 沒有可顯示的應用。",
  "error.computerUse.noDriver": "這臺電腦沒有 Computer Use 驅動。",
  "error.computerUse.socketPathTooLong": "Computer Use 套接字路徑為 {length} 個字元，而該系統允許 {limit} 個。",
  "error.computerUse.socketDirectoryNotDirectory": "Computer Use 套接字目錄 {path} 不是目錄。",
  "error.computerUse.socketDirectoryOtherOwner": "Computer Use 套接字目錄 {path} 屬於其他使用者。",
  "error.computerUse.socketDirectoryShared": "Computer Use 套接字目錄 {path} 對其他使用者開放。",
  "error.computerUse.socketNotReady": "它在 {seconds} 秒內沒有接受連線。{reason}",
} as const satisfies PartialTranslation<typeof source>;
