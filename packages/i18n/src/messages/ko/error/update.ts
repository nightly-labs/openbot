import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  // Updater state the user reads.
  "error.update.unsupported": "설치된 데스크톱 빌드에서만 업데이트할 수 있어요.",
  "error.update.notReady": "설치할 업데이트가 아직 준비되지 않았어요.",
  "error.update.restartFailed": "OpenBot이 업데이트를 설치하기 위해 다시 시작하지 못했어요.",
  "error.update.downloadStalled": "업데이트 다운로드가 응답하지 않아요. 다시 시도해 주세요.",
  "error.update.installFailed": "업데이트를 설치할 수 없었어요. OpenBot을 종료한 후 다시 열고 다시 시도해 주세요.",
  "error.update.downloadFailed": "업데이트를 다운로드할 수 없었어요. 다시 시도해 주세요.",
  "error.update.checkFailed": "업데이트를 확인할 수 없었어요. 다시 시도해 주세요.",
  "error.update.checkStalled": "업데이트 확인이 응답하지 않아요. 다시 시도해 주세요.",
  "error.update.checkOffline": "업데이트 서비스에 연결할 수 없어요. 인터넷 연결을 확인한 후 다시 시도해 주세요.",
  "error.update.checkUnavailable": "업데이트 서비스가 응답하지 않아요. OpenBot이 몇 분 후에 자동으로 다시 시도해요.",
  "error.update.checkNoRelease":
    "이 플랫폼용으로 게시된 업데이트가 없어요. OpenBot이 몇 분 후에 자동으로 다시 시도해요.",
  "error.update.managedByNix": "이 OpenBot은 Nix로 업데이트를 설치해요. Nix로 업데이트해 주세요.",
  "error.update.managedByHost":
    "이 Mac의 업데이트는 호스트가 설치해요. 호스트의 유지 관리가 실행될 때까지 업데이트는 준비된 상태로 남아요.",
  "error.update.siblingSession":
    "이 애플리케이션에서 다른 OpenBot 세션이 아직 실행 중이에요. 다른 모든 macOS 사용자 계정에서 OpenBot을 종료한 후 업데이트를 다시 설치해 주세요.",
  "error.update.siblingSessionSameAccount":
    "이 사용자 계정에서 다른 OpenBot 프로세스가 아직 실행 중이에요. 종료한 후 업데이트를 다시 설치해 주세요.",
  "error.update.siblingCheckFailed": "다른 OpenBot 세션을 확인할 수 없었어요. 설치하기 전에 다시 시도해 주세요.",
  // A joined server's admin reads these from the host.
  "error.update.remoteDisabled": "이 컴퓨터에서는 서버 관리자의 업데이트가 꺼져 있어요.",
  "error.update.restartStarted": "OpenBot이 업데이트를 설치하기 위해 이미 다시 시작하고 있어요.",
  "error.update.alreadyRestarting": "OpenBot이 이미 다시 시작하고 있어요.",
} as const satisfies PartialTranslation<typeof source>;
