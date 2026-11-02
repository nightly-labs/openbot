import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/plugin";

export const messages = {
  "plugin.link.website": "웹사이트",
  "plugin.link.privacyPolicy": "개인정보 처리방침",
  "plugin.link.terms": "서비스 약관",
  "plugin.copyLink": "링크 복사",
  "plugin.askPrompt": "{name}에게 질문: {prompt}",
  "plugin.section.skills": "스킬",
  "plugin.section.information": "정보",
  "plugin.info.developer": "개발자",
  "plugin.info.category": "카테고리",
  "plugin.info.version": "버전",
  "plugin.uninstallDialog.title": "{name} 연결을 해제할까요?",
  "plugin.uninstallDialog.description":
    "{name}이(가) 이 컴퓨터에 설치한 항목이 삭제돼요. 이 호스트나 이 에이전트의 다른 항목은 바뀌지 않아요.",
  "plugin.uninstallDialog.confirm": "연결 해제",
  "plugin.uninstallDialog.appsLabel": "삭제할 앱, {number}개",
  "plugin.uninstallDialog.appsTitle": "이 호스트에서 삭제되는 앱",
  "plugin.uninstallDialog.appsNote":
    "앱의 도구를 더 이상 사용할 수 없고, OpenBot이 앱을 위해 보관한 로그인 정보도 삭제돼요.",
  "plugin.uninstallDialog.skillsLabel": "삭제할 스킬, {number}개",
  "plugin.uninstallDialog.skillsTitle": "{agentName}에서 삭제되는 스킬",
} as const satisfies PartialTranslation<typeof source>;
