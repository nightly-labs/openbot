import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "이 OpenBot을 WebRTC 접속용으로 등록했어요.",
  "status.host.keyRotated": "서버 키가 바뀌었어요. 페어링된 기기는 그대로 유지돼요.",
  "status.host.identityUpdated": "서버 ID를 업데이트했어요.",
  "status.host.starting": "WebRTC 호스트를 시작하는 중…",
  "status.host.ready": "이 OpenBot은 WebRTC 연결을 받을 준비가 됐어요.",
  "status.host.stopping": "이 OpenBot을 비공개로 전환하는 중…",
  "status.host.private": "이 OpenBot은 비공개예요.",
} as const satisfies PartialTranslation<typeof source>;
