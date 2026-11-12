import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  "startup.failedTitle": "OpenBot을 시작할 수 없어요",
  "startup.failedBody":
    "{message}\n\n로컬 데이터는 초기화되거나 덮어쓰이지 않았어요. 복구 방법은 문제 해결 가이드를 확인해 주세요.",
  "startup.archiveChangedTitle": "OpenBot 파일이 변경됨",
  "startup.archiveChangedBody":
    "다른 프로그램이 OpenBot 파일 app.asar를 변경했습니다. OpenBot은 지금 실행 중이지만 종료하면 다시 열리지 않습니다.\n\n복구하려면 OpenBot을 다시 설치하세요. 로컬 데이터는 그대로 유지됩니다.",
  "startup.archiveChangedDownload": "OpenBot 다운로드",
  "startup.filesDamagedBody":
    "일부 OpenBot 파일이 손상되었거나 없습니다.\n\n복구하려면 OpenBot을 다시 설치하세요. 로컬 데이터는 그대로 유지됩니다.",
  "startup.newerDataUpdatingTitle": "OpenBot 업데이트 중",
  "startup.newerDataUpdatingBody":
    "더 새로운 버전의 OpenBot이 데이터를 저장했습니다. OpenBot이 최신 버전을 설치한 후 다시 열립니다.\n\n로컬 데이터는 초기화되거나 덮어쓰이지 않았습니다.",
  "startup.newerDataTitle": "최신 OpenBot을 설치하세요",
  "startup.newerDataBody":
    "더 새로운 버전의 OpenBot이 데이터를 저장했으며, 이 버전({version})으로는 열 수 없습니다. 데이터를 열려면 최신 버전을 설치하세요.\n\n로컬 데이터는 초기화되거나 덮어쓰이지 않았습니다.",
  "startup.newerDataDownload": "OpenBot 다운로드",
  "startup.newerDataGuide": "가이드 열기",
  "startup.newerDataQuit": "종료",
  "startup.recoveryWindowTitle": "OpenBot 복구",
  "startup.recoveryTitle": "OpenBot이 열리지 않았습니다",
  "startup.recoveryBody": {
    other:
      "OpenBot {version}이(가) 열리기 전에 {count}번 연속으로 멈췄습니다. 로컬 데이터는 초기화되거나 덮어쓰이지 않았습니다.",
  },
  "startup.recoveryHint":
    "다시 시도하거나 마지막으로 열린 버전을 설치하세요. 도움이 필요하면 진단 정보를 내보내고 보고서와 함께 파일을 보내세요.",
  "startup.recoveryRetry": "다시 시도",
  "startup.recoveryPreviousVersion": "이전 버전 다운로드",
  "startup.recoveryExportDiagnostics": "진단 정보 내보내기",
  "startup.recoveryOpenDataFolder": "데이터 폴더 열기",
  "startup.recoveryQuit": "종료",
  "startup.recoveryDiagnosticsSaved": "진단 파일을 저장했습니다.",
  "startup.recoveryActionFailed": "OpenBot이 이 작업을 하지 못했습니다.",
} as const satisfies PartialTranslation<typeof source>;
