import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "선택",
  "mobile.shared.crop.label": "사진 자르기",
  "mobile.shared.crop.hint": "드래그해서 사진을 옮기고, 핀치로 크기를 조절하세요.",
  "mobile.shared.splash.loading": "계정 불러오는 중",
  "mobile.shared.photo.openFailed": "이 사진을 열 수 없어요. 다시 시도해 주세요.",
  "mobile.shared.photo.tooLarge": "OpenBot이 이 사진을 충분히 작게 만들 수 없어요. 더 단순한 사진을 선택해 주세요.",
  "mobile.shared.save.changes": "변경 사항 저장",
} as const satisfies PartialTranslation<typeof source>;
