import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "컴퓨터 제어 드라이버가 시작되지 않았어요. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "컴퓨터 제어 드라이버가 응답하기 전에 중지되었어요.",
  "status.computerUse.driverNoAnswer": "컴퓨터 제어 드라이버가 응답하지 않았어요. {reason}",
  "status.computerUse.driverStopped": "컴퓨터 제어 드라이버가 중지되었어요.",
  "status.computerUse.unsupported": "컴퓨터 제어는 macOS, Windows, Linux에서 사용할 수 있어요.",
  "status.computerUse.driverMissing": "이 OpenBot 빌드에는 컴퓨터 제어 드라이버가 없어요.",
  "status.computerUse.progressActing": "이 컴퓨터의 앱을 사용하는 중…",
  "status.computerUse.progressDeciding": "앱에서 다음 단계를 결정하는 중…",
} as const satisfies PartialTranslation<typeof source>;
