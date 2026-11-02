import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/import";

export const messages = {
  "error.import.manifestNotJson": "{manifest}이(가) 올바른 JSON이 아니에요.",
  "error.import.notAgentExport": "{manifest}은(는) OpenBot 에이전트 내보내기 파일이 아니에요.",
  "error.import.newerExportSkill":
    "더 최신 내보내기 스킬로 만든 파일이에요. OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.import.noAgents": "내보내기 파일에 에이전트가 없어요.",
  "error.import.tooManyAgents": "내보내기 파일에 에이전트가 {limit}개를 넘게 들어 있어요.",
  "error.import.tooManyChannels": "내보내기 파일에 채널이 {limit}개를 넘게 들어 있어요.",
  "error.import.channelSkipped": "{name}: 내보내기 파일에 이 채널의 에이전트가 없어서 채널을 건너뛰었어요.",
  "error.import.membersLeftOut": "{name}: 이 내보내기 파일에서 에이전트가 아닌 멤버는 제외했어요.",
  "error.import.leadNotMember": "{name}: 리드가 멤버가 아니어서 채널에 리드가 없어요.",
  "error.import.routineLimit": "{name}: 처음 {limit}개의 루틴만 가져왔어요.",
  "error.import.routineInvalid":
    '{name}: 루틴 "{routine}"은(는) 이름, 텍스트 또는 일정이 올바르지 않아서 건너뛰었어요.',
  "error.import.memoriesSkipped": "{name}: 비어 있거나 {limit}자보다 긴 메모리 {skipped}개를 건너뛰었어요.",
  "error.import.memoryLimit": "{name}: 처음 {limit}개의 메모리만 가져왔어요.",
  "error.import.manifestMissing": "내보내기 파일에 {manifest}이(가) 있어야 해요.",
  "error.import.skillFolderMissing": "{name}: 스킬 폴더 {skill}에 SKILL.md가 없어요.",
  "error.import.avatarSkipped": "{name}: 아바타가 512 KB 이하의 PNG, JPEG 또는 WebP가 아니어서 건너뛰었어요.",
  "error.import.exportClosed": "내보내기 파일이 더 이상 열려 있지 않아요. 다시 선택해 주세요.",
  "error.import.agentNotInExport": "선택한 항목에 내보내기 파일에 없는 에이전트가 있어요.",
  "error.import.channelNotInExport": "선택한 항목에 내보내기 파일에 없는 채널이 있어요.",
  "error.import.serverAgentLimit": "서버당 에이전트는 최대 {limit}개까지 가능해요.",
  "error.import.exportChanged": "확인한 후 내보내기 파일이 변경되었어요. 다시 선택해 주세요.",
  "error.import.noMembersImported": "이 채널의 에이전트를 하나도 가져오지 못했어요.",
  "error.import.leadNotImported": "{name}: 리드를 가져오지 못해서 리드가 없어요.",
  "error.import.routineSkipped": '{name}: 루틴 "{routine}"을(를) 건너뛰었어요. {reason}',
  "error.import.fileRenamed": "{name}: {file}이(가) 이미 있어서 이 사본을 {saved}(으)로 저장했어요.",
  "error.import.fileSkipped": "{name}: 파일 {file}을(를) 건너뛰었어요. {reason}",
  "error.import.chooseZip": ".zip 파일을 선택해 주세요.",
  "error.import.zipTooLarge": "내보내기 파일은 500 MB 이하의 .zip이어야 해요.",
  "error.import.unsafeFile": "내보내기 파일에 안전하지 않은 파일이 있어요: {name}",
  "error.import.expandedTooLarge": "내보내기 파일은 압축을 풀었을 때 500 MB 이하, 파일 {limit}개 이하여야 해요.",
  "error.import.zipInvalid":
    "선택한 파일이 올바른 .zip이 아니에요. Grok Bot이 아직 저장 중이라면 잠시 기다린 후 다시 선택해 주세요.",
  "error.import.empty": "내보내기 파일이 비어 있어요.",
  "error.import.remoteZipTooLarge": "참여 중인 서버로 가져오려면 내보내기 파일이 100 MB 이하의 .zip이어야 해요.",
  "error.import.hostBusy": "서버가 다른 내보내기 파일을 읽고 있어요. 몇 분 후 다시 시도해 주세요.",
  "error.import.skillKept":
    '{name}: 서버에 이미 스킬 "{skill}"이(가) 있어서 에이전트가 그 스킬을 사용해요. 관리자에게 업데이트를 요청해 주세요.',
  "error.import.hermesNoProfiles":
    "이 폴더에는 Hermes 프로필이 없어요. config.yaml 또는 SOUL.md가 있는 Hermes 폴더를 선택해 주세요.",
  "error.import.hermesClosed": "Hermes 프로필이 더 이상 열려 있지 않아요. 다시 읽어 주세요.",
  "error.import.hermesProfileMissing": "선택한 항목에 읽지 않은 Hermes 프로필이 있어요.",
  "error.import.hermesSoulLong":
    "{name}: SOUL.md가 {limit}자보다 길어서 지침에는 앞부분만 유지했어요. 전체 파일은 imported/hermes/SOUL.md에 있어요.",
  "error.import.hermesSkillSkipped": '{name}: 스킬 "{skill}"을(를) 건너뛰었어요. {reason}',
  "error.import.hermesSkillCodeAdded": "프로필을 읽은 후에 코드가 추가되었어요. 허용하려면 프로필을 다시 읽어 주세요.",
  "error.import.hermesLinkNotSaved":
    "{name}: 이 프로필에서 만든 에이전트를 OpenBot이 저장하지 못해서, 다음 가져오기에서는 새 에이전트로 추가돼요.",
  "error.import.transferRemoteTooLarge":
    "참여 중인 서버용 이전 파일은 100 MB 이하여야 해요. 워크스페이스 파일을 끄거나 에이전트를 더 적게 내보내 주세요.",
  "error.import.transferNotFile": "이 파일은 OpenBot 이전 파일이 아니에요.",
  "error.import.transferNewer":
    "더 최신 버전의 OpenBot으로 만든 파일이에요. OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.import.transferEmpty": "파일에 에이전트도 설정도 없어요.",
  "error.import.transferTooLarge":
    "이전 파일은 2 GB 이하, 파일 50,000개 이하여야 해요. 워크스페이스 파일을 끄거나 에이전트를 더 적게 내보내 주세요.",
  "error.import.transferAgentInvalid": "파일의 에이전트 {number}이(가) 올바르지 않아서 건너뛰었어요.",
  "error.import.transferSettingsInvalid": "파일의 앱 설정이 올바르지 않아서 가져오지 않았어요.",
  "error.import.transferModelMissing":
    '{name}: 모델 "{model}"을(를) 아직 여기서 사용할 수 없어서 에이전트가 기본 모델을 사용해요. 제공자가 준비되면 모델을 다시 선택해 주세요.',
  "error.import.transferSettingSkipped": "{name}을(를) 가져오지 않았어요. {reason}",
  "error.import.transferRoutineFlowSkipped": "가져오기에서 루틴 플로우 하나를 제외했어요. {reason}",
  "error.import.transferCustomAgentCommand":
    '{name}: 커스텀 에이전트는 명령을 실행하므로 가져오지 않았어요. 명령 "{command}"을(를) 확인한 후 설정에서 에이전트를 다시 추가해 주세요.',
  "error.import.transferSkillLimit":
    "{name}: 에이전트는 스킬을 {limit}개까지 가질 수 있어서, 스킬 {total}개 중 처음 {limit}개만 파일에 있어요.",
  "error.import.transferFilesGone": "내보내는 동안 파일 {number}개가 삭제되어 파일에 포함되지 않았어요.",
  "error.import.transferProviderKey": "{name}: 설정에서 API 키를 다시 입력해 주세요.",
  "error.import.transferAgentEnv": "{name}: 설정에서 {names} 값을 다시 입력해 주세요.",
  "error.import.transferMcpValues":
    "{name}: MCP 서버를 꺼진 상태로 추가했어요. 명령을 확인하고 값과 전체 주소를 다시 입력한 후 MCP 설정에서 켜 주세요.",
  "error.import.transferValuesCleared":
    "{name}: 비밀 정보가 들어 있을 수 있는 값을 인수 또는 주소에서 제거했어요. 설정에서 다시 입력해 주세요.",
  "error.import.transferSharedKept": "공유 폴더의 파일 {number}개는 이미 여기에 있어서 그대로 두었어요.",
} as const satisfies PartialTranslation<typeof source>;
