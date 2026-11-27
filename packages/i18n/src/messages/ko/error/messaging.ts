import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/messaging";

export const messages = {
  "error.messaging.notConnected": "이 Slack 워크스페이스가 연결되어 있지 않아요.",
  "error.messaging.unsupported": "이 컴퓨터는 Slack에 연결할 수 없어요.",
  "error.messaging.relayUnavailable":
    "OpenBot이 이 컴퓨터에서 Slack 이벤트를 받을 수 없어요. 로그인하고 이 컴퓨터에 이름을 지정한 다음 다시 시도해 주세요.",
  "error.messaging.discordNotConnected": "이 Discord 서버가 연결되어 있지 않아요.",
  "error.messaging.discordUnsupported": "이 컴퓨터는 Discord에 연결할 수 없어요.",
  "error.messaging.discordRelayUnavailable":
    "OpenBot이 이 컴퓨터에서 Discord 이벤트를 받을 수 없어요. 로그인하고 이 컴퓨터에 이름을 지정한 다음 다시 시도해 주세요.",
  "error.messaging.discordRolesUnsupported":
    "OpenBot이 아직 Discord 역할을 나열할 수 없어요. 나중에 다시 시도해 주세요.",
  "error.messaging.telegramNotConnected": "이 Telegram 채팅이 연결되어 있지 않아요.",
  "error.messaging.telegramUnsupported": "이 컴퓨터는 Telegram에 연결할 수 없어요.",
  "error.messaging.telegramRelayUnavailable":
    "OpenBot이 이 컴퓨터에서 Telegram에 연결할 수 없어요. 로그인하고 이 컴퓨터에 이름을 지정한 다음 다시 시도해 주세요.",
  "error.messaging.telegramRelayUnreachable":
    "OpenBot이 이 컴퓨터에서 서비스에 연결할 수 없어요. 인터넷 연결, VPN, 프록시 또는 방화벽을 확인한 다음 다시 시도해 주세요.",
  "error.messaging.telegramRelayCertificate":
    "이 컴퓨터에서 OpenBot 서비스에 보안 연결을 만들 수 없습니다. HTTPS 트래픽을 검사하는 보안 소프트웨어나 이 컴퓨터의 잘못된 날짜와 시간이 원인일 수 있습니다. 확인한 후 다시 시도하세요.",
  "error.messaging.telegramServiceUnavailable":
    "지금은 OpenBot이 Telegram을 연결할 수 없어요. 나중에 다시 시도해 주세요.",
  "error.messaging.whatsappNotConnected": "이 WhatsApp 번호가 연결되어 있지 않아요.",
  "error.messaging.whatsappUnsupported": "이 컴퓨터는 WhatsApp에 연결할 수 없어요.",
  "error.messaging.whatsappTooManySenders": "WhatsApp 번호 하나에 연락처와 그룹을 최대 200개까지 허용할 수 있어요.",
  "error.messaging.whatsappNumberNotFound":
    "이 번호에는 WhatsApp 계정이 없습니다. +44 7700 900123처럼 국가 코드를 포함해 입력하세요.",
  "error.messaging.whatsappSenderNotFound": "이 연락처나 그룹은 더 이상 목록에 없습니다.",
  "error.messaging.whatsappRequestEnded":
    "이 요청은 끝났어요. 새 코드를 받으려면 상대에게 다시 메시지를 보내 달라고 하세요.",
  "error.messaging.memoryLimit":
    "연결된 워크스페이스는 메모리를 최대 {limit}개까지 가질 수 있어요. 먼저 하나를 삭제해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
