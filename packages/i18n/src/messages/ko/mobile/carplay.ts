import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "고정됨",
  "mobile.carplay.new": "새 항목",
  "mobile.carplay.agents": "에이전트",
  "mobile.carplay.noAgents": "아직 에이전트가 없습니다",
  "mobile.carplay.locked": "iPhone에서 OpenBot 잠금을 해제하세요",
  "mobile.carplay.signedOut": "iPhone에서 OpenBot에 로그인하세요",
  "mobile.carplay.voice.listening": "듣는 중…",
  "mobile.carplay.voice.muted": "음소거됨",
  "mobile.carplay.voice.thinking": "{name} 생각하는 중",
  "mobile.carplay.voice.offline": "서버가 오프라인입니다",
  "mobile.carplay.voice.unavailable": "iPhone에서 음성을 설정하세요",
} as const satisfies PartialTranslation<typeof source>;
