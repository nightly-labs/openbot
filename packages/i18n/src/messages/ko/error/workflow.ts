import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "이 워크플로는 더 이상 존재하지 않아요.",
  "error.workflow.versionMissing": "이 버전의 워크플로는 더 이상 존재하지 않아요.",
  "error.workflow.annotation": "텍스트, 메모, 도형에는 연결을 추가할 수 없어요.",
  "error.workflow.port": "단계가 이 유형의 입력을 받을 수 없어요.",
  "error.workflow.branch": "‘예’와 ‘아니요’ 연결은 조건에만 있을 수 있어요.",
  "error.workflow.conditionBranch": "조건에서 나가는 각 연결은 ‘예’ 또는 ‘아니요’여야 해요.",
  "error.workflow.duplicateEdge": "이 두 단계에는 이미 이 연결이 있어요.",
  "error.workflow.serverTooOld":
    "이 서버는 워크플로를 지원하지 않아요. 서버를 실행하는 컴퓨터에서 OpenBot을 업데이트하세요.",
  "error.workflow.nodeUnsupported": "이 버전의 OpenBot은 아직 이미지, 파일, 메시지 단계를 실행할 수 없어요.",
  "error.workflow.interrupted": "이 단계가 실행되는 동안 OpenBot이 중지됐어요. 다시 실행해 주세요.",
  "error.workflow.agentMissing": "이 단계의 에이전트를 선택하세요.",
  "error.workflow.handoffFailed": "OpenBot이 이 단계를 에이전트에 보내지 못했어요.",
  "error.workflow.agentStepEnded": "에이전트가 답하기 전에 이 단계의 메시지가 삭제됐어요.",
  "error.workflow.conditionUnclear": "모델이 ‘예’ 또는 ‘아니요’로 답하지 않았어요.",
  "error.workflow.modelFailed": "모델이 답할 수 없었어요. 단계를 다시 실행해 주세요.",
  "error.workflow.modelBusy": "다른 모델 요청이 실행 중이에요. 잠시 후 단계를 다시 실행해 주세요.",
  "error.workflow.stepMissing": "이 단계는 더 이상 존재하지 않아요.",
  "error.workflow.nodeMissing": "이 단계는 워크플로에 없어요.",
  "error.workflow.runMissing": "이 실행은 더 이상 존재하지 않아요.",
  "error.workflow.notRetryable": "실패했거나 중지된 단계만 다시 실행할 수 있어요.",
  "error.workflow.noDecision": "이 단계는 결정을 기다리고 있지 않아요.",
  "error.workflow.outputPlaceMissing": "이 출력의 메시징 위치를 선택하세요.",
  "error.workflow.outputConnectionOff": "이 출력의 메시징 연결이 꺼져 있거나 삭제됐어요. 위치를 다시 선택하세요.",
  "error.workflow.outputNotRunning": "메시징 연결이 지금 실행되고 있지 않아요. 실행될 때 다시 시도해 주세요.",
  "error.workflow.outputRefused": "위치에서 게시를 거부했어요. OpenBot이 그곳에 게시할 수 있는지 확인하세요.",
  "error.workflow.outputUncertain":
    "게시가 도중에 멈췄어요. 일부가 이미 그 위치에 있을 수 있어요. 다시 시도하기 전에 확인하세요.",
  "error.workflow.tooLarge":
    "이 워크플로는 너무 커서 저장할 수 없어요. 그림이나 긴 텍스트를 일부 삭제한 후 다시 시도해 주세요.",
  "error.workflow.tooLargeToSend":
    "이 워크플로는 너무 커서 다른 컴퓨터로 보낼 수 없어요. 서버를 실행하는 컴퓨터에서 여세요.",
  "error.workflow.webhookMissing": "이 단계는 웹훅 트리거가 아니에요. 워크플로를 저장한 후 다시 시도해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
