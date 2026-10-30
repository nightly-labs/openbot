import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  // Computer Use driver and permission window errors.
  "error.computerUse.noAppToDrag": "이 OpenBot 빌드에는 끌어올 애플리케이션이 없어요.",
  "error.computerUse.helpWindowChanged": "끌기를 시작하기 전에 권한 도움말 창이 바뀌었어요.",
  "error.computerUse.noAppToShow": "이 OpenBot 빌드에는 표시할 애플리케이션이 없어요.",
  "error.computerUse.noDriver": "이 컴퓨터에는 컴퓨터 제어 드라이버가 없어요.",
  "error.computerUse.socketPathTooLong":
    "컴퓨터 제어 소켓 경로가 {length}자인데, 이 시스템은 {limit}자까지만 허용해요.",
  "error.computerUse.socketDirectoryNotDirectory": "컴퓨터 제어 소켓 디렉터리 {path}은(는) 디렉터리가 아니에요.",
  "error.computerUse.socketDirectoryOtherOwner": "컴퓨터 제어 소켓 디렉터리 {path}은(는) 다른 사용자의 소유예요.",
  "error.computerUse.socketDirectoryShared": "컴퓨터 제어 소켓 디렉터리 {path}은(는) 다른 사용자에게 열려 있어요.",
  "error.computerUse.socketNotReady": "{seconds}초 안에 연결을 받지 못했어요. {reason}",
} as const satisfies PartialTranslation<typeof source>;
