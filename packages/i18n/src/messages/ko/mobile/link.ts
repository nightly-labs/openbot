import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot에서 연결하지 못했어요. 다시 시도해 주세요.",
  "mobile.link.invite.signInTitle": "로그인하여 이 서버에 참여",
  "mobile.link.invite.signInDescription":
    "컴퓨터의 OpenBot에서 QR 코드를 스캔하세요. 그런 다음 초대를 확인할 수 있어요.",
  "mobile.link.invite.cancel": "초대 취소",
  "mobile.link.pairing.title": "이 휴대폰 연결",
  "mobile.link.pairing.alreadySignedIn": "이미 로그인되어 있어요. 다른 계정을 연결하려면 설정에서 로그아웃하세요.",
  "mobile.link.pairing.description": "데스크톱에서 이 모바일 연결 링크를 요청한 경우에만 계속하세요.",
  "mobile.link.pairing.accountService": "이 링크는 OpenBot 계정 서비스가 아니라 {origin}의 계정 서비스에 연결돼요.",
  "mobile.link.pairing.connect": "연결",
  "mobile.link.plugin.title": "플러그인 페이지 열기",
  "mobile.link.plugin.description": "OpenBot 웹사이트에서 이 플러그인을 확인하세요.",
  "mobile.link.plugin.openFailed": "플러그인 페이지를 열지 못했어요.",
  "mobile.link.plugin.view": "플러그인 보기",
  "mobile.link.unavailable.title": "사용할 수 없는 링크",
  "mobile.link.unavailable.description":
    "이 링크가 올바르지 않거나, 더 이상 사용할 수 없거나, 모바일에서 지원되지 않아요.",
  "mobile.link.template.signInTitle": "로그인하여 이 에이전트 추가",
  "mobile.link.template.signInDescription":
    "컴퓨터의 OpenBot에서 QR 코드를 스캔하세요. 그런 다음 에이전트를 추가하기 전에 확인할 수 있어요.",
  "mobile.link.template.loading": "에이전트 불러오는 중…",
  "mobile.link.template.creator": "{name} 제작",
  "mobile.link.template.section.instructions": "지침",
  "mobile.link.template.section.skills": "스킬",
  "mobile.link.template.section.noSkills": "스킬이 없어요.",
  "mobile.link.template.section.routines": "루틴",
  "mobile.link.template.section.noRoutines": "루틴이 없어요.",
  "mobile.link.template.skill.local": "로컬 스킬 (SKILL.md만)",
  "mobile.link.template.skill.marketplace": "마켓플레이스 스킬, 버전 {version}",
  "mobile.link.template.server.title": "서버에 추가",
  "mobile.link.template.server.footer": "소유자나 관리자인 서버만 표시돼요.",
  "mobile.link.template.server.updateRequired": "공유된 에이전트를 추가하려면 이 서버의 OpenBot을 업데이트해 주세요.",
  "mobile.link.template.server.none": "공유된 에이전트를 추가하려면 서버의 소유자나 관리자여야 해요.",
  "mobile.link.template.install.action": "에이전트 추가",
  "mobile.link.template.install.pending": "추가 중…",
  "mobile.link.template.install.failed": "에이전트를 추가하지 못했어요.",
  "mobile.link.template.notFound.title": "에이전트를 찾을 수 없어요",
  "mobile.link.template.notFound.description": "공유된 에이전트가 없거나 제작자가 게시를 취소했어요.",
  "mobile.link.template.error.title": "에이전트를 불러오지 못했어요",
  "mobile.link.template.error.loadFailed": "공유된 에이전트를 읽지 못했어요. 다시 시도해 주세요.",
  "mobile.link.template.error.unsupported":
    "이 서버는 공유된 에이전트를 추가할 수 없어요. 서버를 실행하는 컴퓨터에서 OpenBot을 업데이트해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
