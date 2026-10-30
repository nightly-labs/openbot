import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "테이블",
  "sharedTable.description": "에이전트가 작업 사이에 보관하는 내용과, 각 레코드 세트를 시작한 에이전트예요",
  "sharedTable.close": "테이블 닫기",
  "sharedTable.loading": "테이블을 불러오는 중…",
  "sharedTable.empty":
    "아직 테이블이 없어요. 작업에서 턴 사이에 레코드가 필요하면 에이전트가 직접 만들고, 모든 에이전트가 사용할 수 있어요.",
  "sharedTable.loadFailed": "테이블을 불러올 수 없어요.",
  "sharedTable.deleteFailed": "삭제할 수 없어요.",
  "sharedTable.madeOutside": "OpenBot 밖에서 만들어짐 · 모든 에이전트가 삭제할 수 있어요",
  "sharedTable.keptBy": "{name}이(가) 보관 중",
  "sharedTable.keptByDeleted": "더 이상 없는 에이전트가 보관 중",
  "sharedTable.deleteName": "{name} 삭제",
  "sharedTable.confirmDelete": "모든 에이전트에서 삭제할까요? 레코드를 복구할 수 없어요.",
  "sharedTable.notCounted": "집계되지 않음",
  "sharedTable.records": { other: "레코드 {count}개" },
} as const satisfies PartialTranslation<typeof source>;
