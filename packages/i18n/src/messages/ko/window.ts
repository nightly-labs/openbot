import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot 로컬 호스트",
  "window.localClientTitle": "OpenBot 로컬 클라이언트",
  "window.computerUsePermissionTitle": "컴퓨터 제어 켜기",
  "window.controls.label": "창",
  "window.controls.minimize": "최소화",
  "window.controls.maximize": "최대화",
  "window.controls.restore": "이전 크기로 복원",
  "window.controls.close": "닫기",
} as const satisfies PartialTranslation<typeof source>;
