import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot을 시작할 수 없어요",
  "startup.failedBody":
    "{message}\n\n로컬 데이터는 초기화되거나 덮어쓰이지 않았어요. 복구 방법은 문제 해결 가이드를 확인해 주세요.",
  "startup.archiveChangedTitle": "OpenBot 파일이 변경됨",
  "startup.archiveChangedBody":
    "다른 프로그램이 OpenBot 파일 app.asar를 변경했습니다. OpenBot은 지금 실행 중이지만 종료하면 다시 열리지 않습니다.\n\n복구하려면 OpenBot을 다시 설치하세요. 로컬 데이터는 그대로 유지됩니다.",
  "startup.archiveChangedDownload": "OpenBot 다운로드",
} as const satisfies PartialTranslation<typeof source>;
