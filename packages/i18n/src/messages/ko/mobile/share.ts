import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "공유하려면 로그인",
  "mobile.share.signInDescription":
    "컴퓨터의 OpenBot에서 QR 코드를 스캔하세요. 그러면 공유한 내용을 받을 에이전트를 고를 수 있어요.",
  "mobile.share.reading": "공유한 내용을 읽는 중…",
  "mobile.share.readFailed": "OpenBot이 공유한 내용을 읽지 못했어요. 다시 공유해 주세요.",
  "mobile.share.content": "공유할 내용",
  "mobile.share.footer": "채팅이 열리고 메시지 입력란에 이 내용이 들어가요. 보내기 전에는 아무것도 전송되지 않아요.",
  "mobile.share.lastUsed": "최근 사용",
  "mobile.share.noAgents": "에이전트 없음",
  "mobile.share.chooseAgent": "에이전트 선택",
  "mobile.share.action": "{name}에게 공유",
  "mobile.share.extension.send": "보내기",
  "mobile.share.extension.footer": "OpenBot이 지금 이 내용을 에이전트에게 보냅니다. 앱은 열리지 않습니다.",
  "mobile.share.extension.sending": "{name}에게 보내는 중…",
  "mobile.share.extension.sent": "{name}에게 보냄",
  "mobile.share.extension.failed": "OpenBot이 이 내용을 보내지 못했습니다. 앱을 열어 거기에서 보내세요.",
  "mobile.share.extension.unconfirmed": "서버가 메시지를 확인하지 않았습니다. 다시 보내기 전에 채팅을 확인하세요.",
  "mobile.share.extension.openApp": "OpenBot 열기",
} as const satisfies PartialTranslation<typeof source>;
