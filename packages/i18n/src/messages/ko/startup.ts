import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot을 시작할 수 없어요",
  "startup.failedBody":
    "{message}\n\n로컬 데이터는 초기화되거나 덮어쓰이지 않았어요. 복구 방법은 문제 해결 가이드를 확인해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
