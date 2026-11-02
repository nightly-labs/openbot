import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/queue";

export const messages = {
  "queue.label": "메시지 대기열",
  "queue.moved": "대기 중인 메시지를 {total}개 중 {position}번째로 옮겼어요.",
  "queue.attachment": "첨부 파일",
  "queue.hold.named": "대기 중 - {name}이(가) {channel}에서 작업 중이에요",
  "queue.hold.unnamed": "대기 중 - 이 에이전트가 {channel}에서 작업 중이에요",
  "queue.item.label": "대기 중인 메시지 {position}: {preview}",
  "queue.item.labelEditing": "대기 중인 메시지 {position}, 편집 중: {preview}",
  "queue.item.editing": "편집 중",
  "queue.item.steerLabel": "대기 중인 메시지 {position}에 방향 지시",
  "queue.item.steerTooltip": "메시지로 방향 지시",
  "queue.item.steering": "방향 지시 중",
  "queue.item.steer": "방향 지시",
  "queue.item.notSteered": "방향 지시 안 됨",
  "queue.item.steerFallback.providerUnsupported":
    "이 제공자는 실행 중인 턴에 방향 지시를 할 수 없어서 메시지가 대기열에서 기다려요.",
  "queue.item.steerFallback.steerFailed": "방향 지시에 실패해서 메시지가 대기열에서 기다려요.",
  "queue.item.runAsTask": "새 스레드에서 실행",
  "queue.item.runAsTaskLabel": "대기 중인 메시지 {position}을(를) 새 스레드에서 실행",
  "queue.item.deleteLabel": "대기 중인 메시지 {position} 삭제",
  "queue.item.deleteTooltip": "메시지 삭제",
  "queue.item.editLabel": "대기 중인 메시지 {position} 편집",
  "queue.item.editTooltip": "메시지 편집",
  "queue.deleteHeld.title": "대기 중인 메시지를 삭제할까요?",
  "queue.deleteHeld.body": "다른 기기에서 이 메시지를 편집하고 있어요. 에이전트가 이 메시지를 받지 못해요.",
  "queue.deleteHeld.keep": "유지",
} as const satisfies PartialTranslation<typeof source>;
