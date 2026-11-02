import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  // Errors from the OpenBot account service.
  "error.auth.serviceUnavailable":
    "OpenBot이 계정 서비스에 연결하지 못했어요. API가 실행 중인지 확인한 후 다시 시도해 주세요.",
  "error.auth.networkBlocked":
    "이 네트워크의 방화벽 또는 프록시가 OpenBot의 {host} 접속을 막았어요. 네트워크 관리자에게 {host} 허용을 요청한 후 다시 시도해 주세요.",
  "error.auth.signInFirst": "먼저 OpenBot에 로그인해 주세요.",
  "error.auth.signInRequired": "로그인이 필요해요.",
  "error.auth.accountChangedDuringRegister": "이 서버를 등록하는 동안 로그인한 계정이 바뀌었어요.",
  "error.auth.hostCredentialUnavailable": "원격 호스트 자격 증명을 사용할 수 없어요. 호스트를 다시 등록해 주세요.",
  "error.auth.codeNotVerified": "로그인 코드를 확인할 수 없었어요.",
  "error.auth.serviceError": "계정 서비스에서 오류가 발생했어요.",
  "error.auth.serviceUnreachable":
    "OpenBot이 계정 서비스에 연결하지 못했어요. 연결 상태를 확인한 후 다시 시도해 주세요.",
  "error.auth.serviceTimeout": "계정 서비스가 제때 응답하지 않았어요. 다시 시도해 주세요.",
  "error.auth.serviceStatus": "계정 서비스에서 오류({status})가 발생했어요. 나중에 다시 시도해 주세요.",
  "error.auth.invalidHostedServer": "계정 서비스가 올바르지 않은 호스팅 서버를 반환했어요.",
  "error.auth.codeNotSent": "OpenBot이 로그인 코드를 보내지 못했어요.",
  "error.auth.deliveryTimeout":
    "OpenBot이 전송 여부를 제때 확인하지 못했어요. 코드가 도착할 수도 있으니, 다시 보내기 전에 전송 여부를 확인해 주세요.",
  "error.auth.deliveryInterrupted":
    "OpenBot이 전송을 확인하기 전에 연결이 끊어졌어요. 코드를 또 보내지 않도록 전송 여부를 확인해 주세요.",
  "error.auth.deliveryUnknown":
    "OpenBot이 로그인 코드가 전송되었는지 확인하지 못했어요. 다시 보내기 전에 전송 여부를 확인해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
