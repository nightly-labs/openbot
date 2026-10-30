import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/dialog";

export const messages = {
  // Native file pickers.
  "dialog.chooseSiteDirectory": "정적 사이트 폴더 선택",
  "dialog.chooseAgentFolder": "{agent}의 폴더 선택",
  "dialog.chooseAgentExclusion": "{agent}이(가) 변경하면 안 되는 폴더 선택",
  "dialog.chooseSkill": "스킬 폴더 또는 ZIP 선택",
  "dialog.filter.skillPackages": "스킬 패키지",
  "dialog.filter.images": "이미지",
  "dialog.filter.supportedFiles": "지원되는 파일",
  "dialog.filter.attachment": "첨부 파일",
  "dialog.filter.zipArchive": "ZIP 압축 파일",
  "dialog.filter.jsonDocument": "JSON 문서",
  "dialog.chooseAgentExport": "에이전트 내보내기 파일 선택",
  "dialog.chooseHermesFolder": "Hermes 폴더 선택",
  "dialog.filter.agentExports": "에이전트 내보내기 파일",
  "dialog.saveExportSkill": "내보내기 스킬 저장",
  "dialog.saveTransfer": "전송 파일 저장",
  "dialog.chooseTransfer": "전송 파일 선택",
  "dialog.filter.transfer": "OpenBot 전송 파일",
  "dialog.chooseExternalLinkApp": "브라우저 선택",
  "dialog.filter.applications": "응용 프로그램",
} as const satisfies PartialTranslation<typeof source>;
