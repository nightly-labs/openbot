import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "모든 에이전트 중지",
  "menu.checkForUpdates": "업데이트 확인…",
  "menu.preferences": "설정…",
  "menu.actualSize": "실제 크기",
  "menu.zoomIn": "확대",
  "menu.zoomOut": "축소",
  "menu.copyLink": "링크 복사",
  "menu.trayOpen": "OpenBot 열기",
  "menu.trayQuit": "OpenBot 종료",
  "menu.trayTooltip": "OpenBot",
  "menu.undo": "실행 취소",
  "menu.redo": "다시 실행",
  "menu.cut": "잘라내기",
  "menu.copy": "복사",
  "menu.paste": "붙여넣기",
  "menu.pasteAndMatchStyle": "붙여넣고 스타일 일치시키기",
  "menu.delete": "삭제",
  "menu.selectAll": "모두 선택",
} as const satisfies PartialTranslation<typeof source>;
