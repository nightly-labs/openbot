import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  // Computer Use driver and permission window errors.
  "error.computerUse.noAppToDrag": "该版本的 OpenBot 没有可拖动的应用。",
  "error.computerUse.helpWindowChanged": "权限帮助窗口在拖动开始前发生了变化。",
  "error.computerUse.noAppToShow": "该版本的 OpenBot 没有可显示的应用。",
  "error.computerUse.noDriver": "这台电脑没有 Computer Use 驱动。",
  "error.computerUse.socketPathTooLong": "Computer Use 套接字路径为 {length} 个字符，而该系统允许 {limit} 个。",
  "error.computerUse.socketDirectoryNotDirectory": "Computer Use 套接字目录 {path} 不是目录。",
  "error.computerUse.socketDirectoryOtherOwner": "Computer Use 套接字目录 {path} 属于其他用户。",
  "error.computerUse.socketDirectoryShared": "Computer Use 套接字目录 {path} 对其他用户开放。",
  "error.computerUse.socketNotReady": "它在 {seconds} 秒内没有接受连接。{reason}",
} as const satisfies PartialTranslation<typeof source>;
