import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot 로컬 호스트",
  "window.localClientTitle": "OpenBot 로컬 클라이언트",
  "window.computerUsePermissionTitle": "컴퓨터 제어 켜기",
  "window.rendererStoppedTitle": "OpenBot이 작동을 멈췄어요",
  "window.rendererStoppedBody": "창이 여러 번 멈췄어요. 채팅은 저장되어 있고 에이전트는 계속 작업해요.",
  "window.rendererStoppedReload": "다시 불러오기",
  "window.minimize": "최소화",
  "window.maximize": "최대화",
  "window.restore": "복원",
} as const satisfies PartialTranslation<typeof source>;
