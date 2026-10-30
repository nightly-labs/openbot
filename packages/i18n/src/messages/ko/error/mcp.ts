import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "이 주소는 이름으로 접근할 수 없어요.",
  "error.mcp.redirectGetOnly": "이 주소는 GET 요청에만 응답해요.",
  "error.mcp.redirectNotSignIn": "이 주소는 로그인 과정에 속하지 않아요.",
  "error.mcp.redirectRefused": "로그인이 거부되었어요. OpenBot으로 돌아가 다시 시도해 주세요.",
  "error.mcp.redirectNoSignIn": "대기 중인 로그인이 없어요. 이미 종료되었을 수 있어요.",
  "error.mcp.redirectSignedIn": "OpenBot에 로그인했어요. 이 창을 닫아도 돼요.",
  "error.mcp.signInFileUnreadable": "MCP 로그인 파일을 읽을 수 없어요.",
  "error.mcp.signInFileTooLarge": "MCP 로그인 파일이 너무 커요.",
  "error.mcp.unsupported": "이 서버는 MCP 서버를 지원하지 않아요.",
  "error.mcp.signInOnHost": "MCP 서버 로그인은 호스트 컴퓨터의 OpenBot에서만 할 수 있어요.",
  "error.mcp.signInAppUnsupported": "이 서버는 로그인 앱을 지원하지 않아요. 호스트에서 OpenBot을 업데이트해 주세요.",
  "error.mcp.redirectRelayed": "OpenBot이 로그인 정보를 서버로 보냈어요. 이 창을 닫아도 돼요.",
  "error.mcp.relayEnded": "이 로그인이 종료되었어요. 다시 시작해 주세요.",
  "error.mcp.relayNoState": "서버의 로그인 페이지가 돌아올 주소를 보호하지 않아서 OpenBot이 이 컴퓨터에서 열지 않아요.",
  "error.mcp.relayAddressInvalid": "이 로그인의 마지막 주소가 아니에요. 브라우저에서 전체 주소를 복사해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
