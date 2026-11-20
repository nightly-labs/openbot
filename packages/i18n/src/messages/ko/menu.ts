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
  "menu.copyImage": "이미지 복사",
  "menu.quit": "OpenBot 종료",
  "menu.quitConfirmTitle": "OpenBot을 종료할까요?",
  "menu.quitConfirmBody": "OpenBot을 다시 열 때까지 에이전트와 루틴이 멈춥니다.",
  "menu.quitConfirm": "종료",
  "menu.quitHint": "종료하려면 ⌘Q를 길게 누르거나 두 번 누르세요",
  "menu.closeWorkingTitle": { other: "에이전트 {count}개가 아직 작업 중이에요" },
  "menu.closeWorkingBody":
    "OpenBot을 종료하면 에이전트가 멈춰요. 작업이 끝나도록 계속 실행해 두세요. 창을 다시 보려면 OpenBot을 여세요.",
  "menu.closeKeepRunning": "계속 실행",
  "menu.trayOpen": "OpenBot 열기",
  "menu.trayQuit": "OpenBot 종료",
  "menu.trayTooltip": "OpenBot",
  "menu.hideDynamicIsland": "Dynamic Island 숨기기",
  "menu.undo": "실행 취소",
  "menu.redo": "다시 실행",
  "menu.cut": "잘라내기",
  "menu.copy": "복사",
  "menu.paste": "붙여넣기",
  "menu.pasteAndMatchStyle": "붙여넣고 스타일 일치시키기",
  "menu.delete": "삭제",
  "menu.selectAll": "모두 선택",
} as const satisfies PartialTranslation<typeof source>;
