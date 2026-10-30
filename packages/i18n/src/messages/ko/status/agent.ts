import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside": "에이전트의 워크스페이스, 공유 폴더, 임시 폴더 밖에 있는 {path}에 써요.",
  "status.agent.contextCleared": "컨텍스트를 지웠어요. 여기서 새 채팅이 시작돼요.",
  "status.agent.modelSwitchedForLimit": "사용 한도에 도달했어요. {model}(으)로 전환했어요.",
  "status.agent.modelReturnedAfterLimit": "사용 한도가 끝났어요. {model}(으)로 다시 전환했어요.",
  "status.agent.modelSwitchedForError": "제공자 오류가 발생했어요. {model}(으)로 전환했어요.",
  "status.agent.modelReturnedAfterError": "제공자 오류 후 {model}(으)로 다시 전환했어요.",
  "status.agent.marketplaceSuggested": "마켓플레이스 앱을 추천했어요: {app}.",
  "status.agent.channelMemberAdded": "{agent} 에이전트가 {member} 멤버를 채널에 추가했어요. {person} 님이 요청했어요.",
  "status.agent.channelMemberRemoved":
    "{agent} 에이전트가 {member} 멤버를 채널에서 제거했어요. {person} 님이 요청했어요.",
  "status.agent.channelInstructionsChanged": "{agent} 에이전트가 채널 지침을 변경했어요. {person} 님이 요청했어요.",
  "status.agent.channelRoutineCreated": "{agent} 에이전트가 루틴 {routine}을(를) 만들었어요. {person} 님이 요청했어요.",
  "status.agent.channelRoutineUpdated": "{agent} 에이전트가 루틴 {routine}을(를) 변경했어요. {person} 님이 요청했어요.",
  "status.agent.channelRoutineDeleted": "{agent} 에이전트가 루틴 {routine}을(를) 삭제했어요. {person} 님이 요청했어요.",
  "status.agent.screenCaptureScreen": "메인 화면을 캡처해서 이미지를 에이전트의 모델에 보내요.",
  "status.agent.screenCaptureChannel":
    "이미지가 {channel} 채널에 표시되고, 이 채널을 읽는 서버의 모든 멤버가 볼 수 있어요.",
  "status.agent.screenCaptureDisplay": "디스플레이 {name}을(를) 캡처해서 이미지를 에이전트의 모델에 보내요.",
  "status.agent.screenCaptureWindow": "창 {name}을(를) 캡처해서 이미지를 에이전트의 모델에 보내요.",
  "status.agent.screenCaptureRegion":
    "화면의 {x}, {y} 위치에서 {width} × {height} 포인트 영역을 캡처해서 이미지를 에이전트의 모델에 보내요.",
  "status.agent.screenCaptureProgress": "화면 캡처를 요청하는 중…",
  "status.agent.screenCaptureReviewing": "화면 캡처를 확인하는 중…",
  "status.agent.browserOpening": "웹 페이지를 여는 중…",
  "status.agent.browserReading": "웹 페이지를 읽는 중…",
  "status.agent.browserClicking": "웹 페이지를 클릭하는 중…",
  "status.agent.browserTyping": "웹 페이지에 입력하는 중…",
  "status.agent.browserActing": "웹 페이지를 사용하는 중…",
  "status.agent.browserReviewing": "웹 페이지를 확인하는 중…",
  "status.agent.memoriesSearching": "메모리를 검색하는 중…",
  "status.agent.memoriesSearched": {
    other: "메모리를 검색했어요: {count}개 찾음",
  },
  "status.agent.memoriesUpdating": "메모리를 업데이트하는 중…",
  "status.agent.skillUsing": "스킬 {name}을(를) 사용하는 중…",
  "status.agent.skillReading": "스킬을 읽는 중…",
  "status.agent.memoryChanges": "메모리: {saved}개 저장, {updated}개 업데이트, {forgotten}개 삭제.",
  "status.agent.memoryChangesWithConflicts":
    "메모리: {saved}개 저장, {updated}개 업데이트, {forgotten}개 삭제, {notChanged}개는 다른 스레드가 먼저 변경해서 변경 안 됨.",
  "status.agent.mcpServerAdd":
    "MCP 서버 {name}을(를) 추가해요: {target}. 이 서버의 모든 에이전트가 해당 도구를 사용할 수 있어요. OpenBot이 연결을 테스트해요.",
  "status.agent.mcpServerChange":
    "MCP 서버 {name}을(를) {target}(으)로 변경해요. 이 서버의 모든 에이전트가 해당 도구를 사용할 수 있어요. OpenBot이 연결을 테스트해요.",
  "status.agent.mcpServerEnable": "이 서버의 모든 에이전트에 MCP 서버 {name}을(를) 켜요.",
  "status.agent.mcpServerDisable": "이 서버의 모든 에이전트에 MCP 서버 {name}을(를) 꺼요.",
  "status.agent.mcpServerRemove": "이 서버의 모든 에이전트에서 MCP 서버 {name}과(와) 로그인 정보를 제거해요.",
  "status.agent.mcpSignInRequested": "MCP 서버 {name}에 로그인이 필요해요. 서버 설정의 MCP에서 로그인해 주세요.",
  "status.agent.planContinues": "계획에 남은 단계가 있어요. 에이전트가 계속해요 ({current}/{limit}).",
} as const satisfies PartialTranslation<typeof source>;
