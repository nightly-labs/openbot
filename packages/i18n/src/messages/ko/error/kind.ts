import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "연결할 수 없어요. 네트워크 연결을 확인한 후 다시 시도해 주세요.",
  "error.kind.timeout": "요청 시간이 너무 오래 걸렸어요. 다시 시도하기 전에 작업이 완료되었는지 확인해 주세요.",
  "error.kind.storage": "저장 공간이 부족해요. OpenBot을 실행 중인 컴퓨터의 공간을 확보한 후 다시 시도해 주세요.",
  "error.kind.filePermission":
    "OpenBot에 이 작업을 할 권한이 없어요. 파일 또는 폴더 권한을 확인한 후 다시 시도해 주세요.",
  "error.kind.notFound": "필요한 파일 또는 폴더를 찾을 수 없어요. 복원하거나 다른 항목을 선택한 후 다시 시도해 주세요.",
  "error.kind.readOnly": "이 폴더는 읽기 전용이에요. 쓸 수 있는 폴더를 선택한 후 다시 시도해 주세요.",
  "error.kind.conflict": "같은 이름의 항목이 이미 있어요. 다른 이름을 선택한 후 다시 시도해 주세요.",
  "error.kind.auth": "인증에 실패했어요. 계정 또는 서버 연결을 확인한 후 다시 시도해 주세요.",
  "error.kind.permission": "이 작업을 할 권한이 없어요. 소유자에게 접근 권한을 요청하세요.",
  "error.kind.rateLimit": "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
  "error.kind.service": "서비스를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
