import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld": "이 서버는 CRM을 지원하지 않아요. 서버를 실행하는 컴퓨터에서 OpenBot을 업데이트하세요.",
  "error.crm.tooLargeToSend": "이 CRM 페이지는 너무 커서 이 클라이언트로 보낼 수 없어요.",
  "error.crm.customerMissing": "이 고객은 더 이상 존재하지 않아요.",
  "error.crm.planMissing": "이 요금제는 더 이상 존재하지 않아요.",
  "error.crm.paymentMissing": "이 결제는 더 이상 존재하지 않아요.",
  "error.crm.tagMissing": "이 태그는 더 이상 존재하지 않아요.",
  "error.crm.statusMissing": "이 상태는 더 이상 존재하지 않아요.",
  "error.crm.proposalMissing": "이 제안은 더 이상 존재하지 않거나 이미 결정되었어요.",
  "error.crm.tagExists": "이 이름의 태그가 이미 있어요.",
  "error.crm.statusExists": "이 이름의 상태가 이미 있어요.",
  "error.crm.builtinStatus": "기본 상태는 이름을 바꾸거나 삭제할 수 없어요.",
  "error.crm.tooManyStatuses": "CRM의 상태 수가 최대예요. 먼저 상태를 삭제하세요.",
  "error.crm.tooManyTags": "CRM의 태그 수가 최대예요. 먼저 태그를 삭제하세요.",
  "error.crm.tooManyPlans": "이 고객의 요금제 수가 최대예요. 먼저 요금제를 삭제하세요.",
  "error.crm.paymentPaid": "이 결제는 지불 완료로 표시되어 있어요. 먼저 미지불로 표시하세요.",
  "error.crm.splitTotal": "각 부분의 합계가 결제 금액과 같아야 해요.",
  "error.crm.planEndsBeforeStart": "요금제는 시작하기 전에 끝날 수 없어요.",
  "error.crm.currencyInUse": "요금제나 결제가 있는 고객의 통화는 바꿀 수 없어요.",
  "error.crm.badCursor": "이 페이지는 더 이상 유효하지 않아요. 목록을 다시 불러오세요.",
  "error.crm.invalidChange": "이 변경은 유효하지 않아요.",
  "error.crm.agentNotAllowed":
    "이 에이전트는 CRM을 사용할 수 없어요. 소유자나 관리자가 허용할 수 있어요: CRM 페이지를 열고 제안을 클릭한 다음, 에이전트 수 버튼을 클릭하고 이 에이전트를 켜세요.",
  "error.crm.tooManyProposals": "결정을 기다리는 제안이 너무 많아요. 사람이 결정할 때까지 기다리세요.",
  "error.crm.amountInvalid": "금액을 129.00처럼 숫자로 입력하세요.",
  "error.crm.amountDecimals": "{currency}에 비해 금액의 소수 자릿수가 너무 많아요.",
  "error.crm.fieldPrivate": "이 필드는 비공개예요. 에이전트는 이 필드를 읽거나 이 필드로 필터링할 수 없어요.",
  "error.crm.sourceOwned":
    "이 행은 Stripe에서 관리해요. Stripe에서 변경하세요. CRM은 다음 동기화 때 변경 사항을 받아요.",
  "error.crm.sourceConnected": "Stripe가 이미 이 CRM에 연결되어 있어요.",
  "error.crm.sourceMissing": "이 Stripe 연결은 더 이상 없어요.",
  "error.crm.sourceSecretKey":
    "이 키는 Stripe 계정을 변경할 수 있는 비밀 키예요. 읽기 권한만 있는 제한된 키를 만드세요.",
  "error.crm.sourceInvalidKey": "Stripe에서 이 키를 받아들이지 않아요. 제한된 키를 다시 복사하세요.",
  "error.crm.sourcePermission":
    "이 키로는 고객, 인보이스, 구독, 이벤트, 제품을 읽을 수 없어요. 이들에 대한 읽기 권한을 주세요.",
  "error.crm.sourceRateLimited": "Stripe에 요청이 너무 많았어요. 1분 후에 다시 시도하세요.",
  "error.crm.sourceNetwork": "OpenBot이 Stripe에 연결할 수 없어요. 인터넷 연결을 확인하세요.",
  "error.crm.sourceFailed": "Stripe에서 OpenBot이 읽을 수 없는 응답을 보냈어요. 나중에 다시 시도하세요.",
  "error.crm.sourceKeySaveFailed": "OpenBot이 이 컴퓨터에 Stripe 키를 저장할 수 없어요.",
  "error.crm.off": "CRM이 꺼져 있습니다. 소유자 또는 관리자가 서버 설정 > 실험적 기능에서 켤 수 있습니다.",
  "error.crm.settingsSaveFailed": "OpenBot이 이 서버에 CRM 설정을 저장할 수 없습니다.",
} as const satisfies PartialTranslation<typeof source>;
