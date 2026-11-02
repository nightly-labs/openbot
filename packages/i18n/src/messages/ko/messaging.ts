import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "Slack이 이 워크스페이스에서 더 이상 OpenBot을 허용하지 않아요. 앱이 삭제되었을 수 있어요. 워크스페이스를 다시 연결해 주세요.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot이 이 컴퓨터에 저장된 토큰을 읽을 수 없어요. 워크스페이스 연결을 해제한 다음 다시 연결해 주세요.",
  "messaging.help.relay_unavailable":
    "OpenBot이 이 컴퓨터에서 Slack 이벤트를 받을 수 없어요. 로그인하고 서버 설정에서 이 컴퓨터에 이름을 지정한 다음 OpenBot을 열어 두세요.",
  "messaging.discordHelp.invalid_token":
    "Discord가 이 Discord 서버에서 더 이상 OpenBot을 허용하지 않아요. 앱이 제거되었을 수 있어요. Discord 서버를 다시 연결해 주세요.",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot이 이 컴퓨터에 저장된 토큰을 읽을 수 없어요. Discord 서버 연결을 해제한 다음 다시 연결해 주세요.",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot이 이 컴퓨터에서 Discord 이벤트를 받을 수 없어요. 로그인하고 서버 설정에서 이 컴퓨터에 이름을 지정한 다음 OpenBot을 열어 두세요.",
} as const satisfies PartialTranslation<typeof source>;
