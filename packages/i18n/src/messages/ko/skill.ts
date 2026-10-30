import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/skill";

export const messages = {
  "skill.title": "스킬",
  "skill.close": "스킬 닫기",
  "skill.detailsDescription": "{name} 상세 정보",
  "skill.assignedDescription": "{name}에 할당된 스킬",
  "skill.addFromMarketplace": "마켓플레이스에서 추가",
  "skill.limitReached":
    "이 에이전트는 스킬 {limit}개 한도에 도달했어요. 다른 스킬을 추가하려면 먼저 하나를 제거해 주세요.",
  "skill.managedOnHost": "이 에이전트의 스킬은 호스트에서 관리해요.",
  "skill.loading": "스킬을 불러오는 중…",
  "skill.loadingDetails": "상세 정보를 불러오는 중…",
  "skill.emptyEnabled": "이 에이전트에는 사용 중인 스킬이 없어요.",
  "skill.emptyAssigned": "이 에이전트에는 아직 할당된 스킬이 없어요.",
  "skill.folderSkill": "OpenBot이 설치한 스킬이 아니에요. {location}에서 편집하거나 제거해 주세요.",
  "skill.moreFor": "{name}의 더 보기",
  "skill.update": "업데이트",
  "skill.updateName": "{name} 업데이트",
  "skill.enableName": "{name} 사용",
  "skill.repair": "복구",
  "skill.uninstall": "삭제",
  "skill.version": "v{version}",
  "skill.versionUpdate": "v{installed} · v{available} 사용 가능",

  "skill.loadFailed": "스킬을 불러올 수 없어요.",
  "skill.loadDetailsFailed": "스킬 상세 정보를 불러올 수 없어요.",
  "skill.enableFailed": "스킬을 사용 설정할 수 없어요.",
  "skill.disableFailed": "스킬을 사용 중지할 수 없어요.",
  "skill.removeFailed": "스킬을 제거할 수 없어요.",
  "skill.updateFailed": "스킬을 업데이트할 수 없어요.",

  "skill.confirm.replaceTitle": "로컬 변경 사항을 바꿀까요?",
  "skill.confirm.removeTitle": "이 스킬을 제거할까요?",
  "skill.confirm.replaceBody":
    "스킬을 업데이트하면 로컬 파일이 최신 스킬 패키지로 바뀌어요. 이 스킬 폴더에서 편집한 내용은 사라져요.",
  "skill.confirm.removeModifiedBody":
    "이 스킬은 에이전트 워크스페이스에 로컬 변경 사항이 있어요. 제거하면 해당 파일이 삭제돼요. 기존 채팅 메시지는 그대로 남아요.",
  "skill.confirm.removeBody": "OpenBot이 에이전트에서 이 스킬을 제거해요. 채팅 기록은 그대로 남아요.",
  "skill.confirm.replace": "스킬 바꾸기",
  "skill.confirm.remove": "스킬 제거",

  "skill.unavailable.readOnly": "원격 스킬은 읽기 전용이에요.",
  "skill.unavailable.add": "이 스킬을 추가하면 사용해 볼 수 있어요.",
  "skill.unavailable.repair": "이 스킬을 복구하면 사용해 볼 수 있어요.",
  "skill.unavailable.updateVersion": "이 스킬을 업데이트하면 이 버전을 사용해 볼 수 있어요.",
  "skill.unavailable.updateRevision": "이 스킬을 업데이트하면 이 리비전을 사용해 볼 수 있어요.",
  "skill.unavailable.saving": "스킬 저장이 끝난 후 사용해 보세요.",
  "skill.unavailable.composer": "에이전트 입력창을 사용할 수 없어요.",

  "skill.toolbar.source": "스킬 출처",
  "skill.toolbar.all": "전체",
  "skill.toolbar.local": "로컬",
  "skill.toolbar.enabled": "사용 중",
  "skill.toolbar.create": "스킬 만들기",

  "skill.local.loadFailed": "로컬 스킬을 불러올 수 없어요.",
  "skill.local.toggleFailed": "스킬 상태를 변경할 수 없어요.",
  "skill.local.addFailed": "로컬 스킬을 추가할 수 없어요.",
  "skill.local.back": "로컬 스킬로 돌아가기",
  "skill.local.added": "추가됨",
  "skill.local.add": "스킬 추가",
  "skill.local.loading": "로컬 스킬을 불러오는 중…",
  "skill.local.empty": "아직 로컬 스킬이 없어요.",

  "skill.preview.label": "{name} 미리보기",
  "skill.preview.creator": "만든 사람: {name}",
  "skill.preview.examplePrompt": "이 스킬을 사용할 수 있게 도와줘.",
  "skill.preview.try": "스킬 사용해 보기",
  "skill.preview.linkFailed": "링크를 열 수 없어요.",

  "skill.marketplace.changed": { other: "에이전트 {count}개에서 {name}을(를) 변경했어요." },
  "skill.marketplace.updated": { other: "에이전트 {count}개에서 {name}을(를) 업데이트했어요." },
  "skill.marketplace.undone": "{name} 변경을 되돌렸어요.",
  "skill.marketplace.confirmAgents": "에이전트: {agents}.",
  "skill.marketplace.limitReason": "에이전트 하나에 스킬을 {limit}개까지 추가할 수 있어요.",
  "skill.marketplace.cannotRemove": "OpenBot은 기본 제공 스킬과 직접 설치하지 않은 스킬을 제거할 수 없어요.",
} as const satisfies PartialTranslation<typeof source>;
