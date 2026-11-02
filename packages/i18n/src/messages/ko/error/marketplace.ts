import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "로컬 시간대가 올바르지 않아요.",
  "error.marketplace.installedAgentMissing": "설치된 에이전트가 더 이상 없어요.",
  "error.marketplace.differentListing": "이 로컬 에이전트는 다른 마켓플레이스 에이전트에서 설치되었어요.",
  "error.marketplace.marketplaceAvatarInvalid": "마켓플레이스 에이전트의 아바타가 올바르지 않아요.",
  "error.marketplace.shareCardInvalid": "공유 카드가 올바르지 않아요.",
  "error.marketplace.cannotPublish": "이 에이전트는 게시할 수 없어요.",
  "error.marketplace.templateName": {
    other: "에이전트 이름을 1~{count}자로 지정해 주세요.",
  },
  "error.marketplace.templateRole": {
    other: "역할이 {count}자를 넘어요. 줄여 주세요.",
  },
  "error.marketplace.templateNoInstructions": "게시하기 전에 이 에이전트에 지침을 추가해 주세요.",
  "error.marketplace.templateInstructions": {
    other: "지침이 {count}자를 넘어요. 줄여 주세요.",
  },
  "error.marketplace.templateAvatar": "이 에이전트의 아바타가 올바르지 않아요. 에이전트 설정에서 다시 선택해 주세요.",
  "error.marketplace.templateSkills": {
    other: "에이전트당 스킬은 최대 {count}개까지 게시할 수 있어요. 일부를 삭제해 주세요.",
  },
  "error.marketplace.templateLocalSkills": {
    other: "에이전트당 로컬 스킬은 최대 {count}개까지 게시할 수 있어요. 일부를 삭제해 주세요.",
  },
  "error.marketplace.templateSkill": '"{name}" 스킬을 게시할 수 없어요. 이름과 SKILL.md를 확인해 주세요.',
  "error.marketplace.templateRoutines": {
    other: "에이전트당 루틴은 최대 {count}개까지 게시할 수 있어요. 일부를 삭제해 주세요.",
  },
  "error.marketplace.templateRoutine": {
    other: '"{name}" 루틴에는 {count}자 이내의 이름과 지침이 필요해요.',
  },
  "error.marketplace.templateRoutineNoName": "이름 없음",
  "error.marketplace.templateTooLarge": "이 에이전트는 너무 커서 게시할 수 없어요. 지침, 스킬 또는 루틴을 줄여 주세요.",
  "error.marketplace.linkInvalid": "에이전트 링크가 올바르지 않아요.",
  "error.marketplace.changedSinceOpened":
    "이 에이전트가 열어본 이후에 변경되었어요. 링크를 다시 열어 새 버전을 확인해 주세요.",
  "error.marketplace.skillNameConflict":
    '이미 "{name}"이라는 다른 로컬 스킬이 있어요. 이름을 바꾸거나 삭제한 다음 이 에이전트를 다시 추가해 주세요.',
  "error.marketplace.avatarInvalid": "에이전트 아바타가 올바르지 않아요.",
  "error.marketplace.secretInName": "게시하기 전에 이름에서 시크릿이나 이메일 주소를 제거해 주세요.",
  "error.marketplace.secretInTitle": "게시하기 전에 제목에서 시크릿이나 이메일 주소를 제거해 주세요.",
  "error.marketplace.secretInInstructions": "게시하기 전에 지침에서 시크릿이나 이메일 주소를 제거해 주세요.",
  "error.marketplace.secretInRoutine": '게시하기 전에 "{name}" 루틴에서 시크릿이나 이메일 주소를 제거해 주세요.',
  "error.marketplace.secretInSkill": '게시하기 전에 "{name}" 스킬에서 시크릿이나 이메일 주소를 제거해 주세요.',
  "error.marketplace.catalogLoadFailed": "마켓플레이스를 불러오지 못했어요. 다시 시도해 주세요.",
  "error.marketplace.templateUnreadable": "공유된 에이전트를 읽지 못했어요. 소유자가 삭제했을 수 있어요.",
} as const satisfies PartialTranslation<typeof source>;
