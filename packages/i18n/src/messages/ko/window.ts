import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot 로컬 호스트",
  "window.localClientTitle": "OpenBot 로컬 클라이언트",
  "window.computerUsePermissionTitle": "컴퓨터 제어 켜기",
} as const satisfies PartialTranslation<typeof source>;
