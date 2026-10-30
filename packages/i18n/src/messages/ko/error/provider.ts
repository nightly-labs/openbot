import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.mcpConfig":
    "OpenBot이 Codex 구성에 MCP 서버를 등록할 수 없었어요. Codex config.toml이 올바르고 쓰기 가능한지 확인한 후 OpenBot을 다시 시작하세요.",
  "error.provider.computerUseConfig":
    "OpenBot이 Codex 구성에 컴퓨터 제어를 등록할 수 없었어요. Codex config.toml이 올바르고 쓰기 가능한지 확인한 후 OpenBot을 다시 시작하세요. 에이전트 설정에서 컴퓨터 제어를 끄면 그 기능 없이 계속할 수 있어요.",
  "error.provider.codexUnresponsive": "Codex가 응답하지 않아 OpenBot이 프로세스를 종료했습니다.",
  "error.provider.acpUnresponsive": "{provider}가 제시간에 응답하지 않아 OpenBot이 프로세스를 종료했습니다.",
  "error.provider.endpointsReadOnly":
    "저장된 엔드포인트가 더 새로운 버전의 OpenBot에서 작성되었거나 파일을 읽을 수 없어요. 변경하려면 OpenBot을 업데이트하세요.",
  "error.provider.endpointNoSecureStorage":
    "이 컴퓨터에는 보안 저장소가 없어서 API 키나 헤더를 저장할 수 없어요. 제거하거나 자격 증명이 필요 없는 엔드포인트를 사용하세요.",
  "error.provider.endpointDuplicate":
    "이 제공자 ID의 엔드포인트가 이미 저장되어 있어요. 먼저 제거하거나 다른 ID를 사용하세요.",
  "error.provider.endpointNotSaved": "이 엔드포인트는 저장되지 않았어요. 목록을 새로 고친 후 다시 시도해 주세요.",
  "error.provider.endpointKeyForNewAddress":
    "주소의 호스트나 포트가 바뀌었어요. 저장된 값이 새 주소로 전송되지 않도록 API 키와 헤더를 다시 입력하세요.",
  "error.provider.endpointSecretUnreadable":
    "이 컴퓨터에서 저장된 API 키와 헤더를 읽을 수 없어요. 아무것도 잃지 않도록 API 키와 헤더를 다시 입력하세요.",
  "error.provider.discoveryTimeout": "{host}이(가) 제시간에 응답하지 않았어요.",
  "error.provider.discoveryUnreachable": "OpenBot이 {host}에 연결할 수 없었어요.",
  "error.provider.discoveryRedirect": "{host}이(가) 리디렉션을 보냈어요. 서버의 최종 주소를 입력하세요.",
  "error.provider.discoveryRefused": "{host}이(가) 요청을 거부했어요. API 키와 헤더를 확인하세요.",
  "error.provider.discoveryHttp": "{host}이(가) HTTP {status}(으)로 응답했어요.",
  "error.provider.discoveryTooLarge": "{host}의 모델 목록이 너무 커요.",
  "error.provider.discoveryInvalid": "{host}이(가) OpenAI 호환 모델 목록을 보내지 않았어요.",
  "error.provider.detectionSettingsReadOnly":
    "감지 설정이 더 새로운 버전의 OpenBot에서 작성되었거나 파일을 읽을 수 없어요. 변경하려면 OpenBot을 업데이트하세요.",
  "error.provider.detectionEntryInvalid":
    "주소는 비밀번호가 없는 http:// 또는 https:// URL이어야 하고, 폴더는 절대 경로여야 해요.",
  "error.provider.detectionEntriesTooMany": "주소나 폴더가 너무 많아요.",
  "error.provider.credentialFileUnreadable": "제공자 자격 증명 파일을 읽을 수 없어요.",
  "error.provider.credentialFileTooLarge": "제공자 자격 증명 파일이 너무 커요.",
  "error.provider.archiveSpecialFile": "런타임 아카이브에 링크 또는 특수 파일이 있어요.",
  "error.provider.archiveUnsafePath": "런타임 아카이브에 안전하지 않은 경로가 있어요.",
  "error.provider.runtimeSpecialFile": "런타임에 링크 또는 특수 파일이 있어요.",
  "error.provider.codexArchivePath": "Codex 아카이브에 예상하지 못한 경로가 있어요.",
  "error.provider.codexVersionUnexpected": "예상하지 못한 Codex 런타임 버전이에요.",
  "error.provider.claudeArchivePath": "Claude 아카이브에 예상하지 못한 경로가 있어요.",
  "error.provider.claudePackageMismatch": "Claude 패키지가 런타임 카탈로그와 일치하지 않아요.",
  "error.provider.claudeChecksum": "Claude 런타임 체크섬이 일치하지 않아요.",
  "error.provider.claudeLicenseChecksum": "Claude 라이선스 체크섬이 일치하지 않아요.",
  "error.provider.opencodeArchivePath": "OpenCode 아카이브에 예상하지 못한 경로가 있어요.",
  "error.provider.opencodePackageMismatch": "OpenCode 패키지가 런타임 카탈로그와 일치하지 않아요.",
  "error.provider.opencodeChecksum": "OpenCode 런타임 체크섬이 일치하지 않아요.",
  "error.provider.opencodeLicenseChecksum": "OpenCode 라이선스 체크섬이 일치하지 않아요.",
  "error.provider.grokChecksum": "Grok 런타임 체크섬이 일치하지 않아요.",
  "error.provider.grokLicenseChecksum": "Grok 라이선스 체크섬이 일치하지 않아요.",
  "error.provider.grokNoticesChecksum": "Grok 고지문 체크섬이 일치하지 않아요.",
  "error.provider.bunArchivePath": "Bun 아카이브에 예상하지 못한 경로가 있어요.",
  "error.provider.bunPackageMismatch": "Bun 패키지가 런타임 카탈로그와 일치하지 않아요.",
  "error.provider.bunChecksum": "Bun 런타임 체크섬이 일치하지 않아요.",
  "error.provider.bunLicenseChecksum": "Bun 라이선스 체크섬이 일치하지 않아요.",
  "error.provider.bunxDamaged": "Bun 패키지 관리자 실행기가 없거나 손상되었어요.",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot이 제공자 릴리스 소스에 연결할 수 없었어요. 연결을 확인한 후 다시 시도해 주세요.",
  "error.provider.runtimesUnsupported": "이 플랫폼에서는 제공자 런타임을 사용할 수 없어요.",
  "error.provider.closing": "OpenBot이 종료되는 중이에요.",
  "error.provider.removeWhileOn": "다운로드를 삭제하기 전에 제공자를 끄세요.",
  "error.provider.removeWhileDownloading": "다운로드가 끝난 뒤 삭제하세요.",
  "error.provider.removeIncomplete": "다른 프로그램이 이 CLI의 파일을 사용하고 있어요. 닫은 뒤 다시 시도하세요.",
  "error.provider.cliOverride": "OpenBot에서 업데이트하기 전에 명시적인 CLI 경로 재정의를 제거하세요.",
  "error.provider.runtimeUpdateIncomplete": "런타임 업데이트가 완료되지 않았어요.",
  "error.provider.downloadHttp": "런타임 다운로드가 HTTP {status}(으)로 실패했어요.",
  "error.provider.downloadNoData": "런타임 다운로드에서 데이터가 반환되지 않았어요.",
  "error.provider.downloadSize": "런타임 다운로드의 크기가 예상과 달라요.",
  "error.provider.downloadIntegrity": "런타임 다운로드가 무결성 검사에 실패했어요.",
  "error.provider.runtimeReplacing": "다른 인스턴스가 런타임을 교체하는 중이어서 설치할 수 없었어요.",
  "error.provider.runtimeFilesInUse":
    "다른 프로그램이 런타임 파일을 열고 있어서 설치할 수 없었어요. 해당 프로그램을 닫은 후 다시 시도해 주세요.",
  "error.provider.metadataHttp": "런타임 메타데이터 다운로드가 HTTP {status}(으)로 실패했어요.",
  "error.provider.metadataIntegrity": "런타임 메타데이터가 무결성 검사에 실패했어요.",
  "error.provider.diskSpace": "이 제공자를 설치할 디스크 공간이 부족해요.",
  "error.provider.unexpectedVersion": "제공자 런타임이 예상하지 못한 버전을 반환했어요.",
  "error.provider.metadataNoData": "런타임 메타데이터 다운로드에서 데이터가 반환되지 않았어요.",
  "error.provider.metadataTooLarge": "런타임 메타데이터가 너무 커요.",
  "error.provider.requestFailed": "OpenBot이 {url}을(를) 다운로드할 수 없었어요. {reason}",
  "error.provider.installRecordMismatch": "런타임 설치 기록이 일치하지 않아요.",
  "error.provider.runtimeChecksum": "제공자 런타임 체크섬이 일치하지 않아요.",
  "error.provider.codexReleaseShape": "Codex 릴리스의 형식이 예상과 달라요.",
  "error.provider.codexReleaseNoDownload": "Codex 릴리스에 이 컴퓨터용으로 검증할 수 있는 다운로드가 없어요.",
  "error.provider.claudeReleaseShape": "Claude 릴리스의 형식이 예상과 달라요.",
  "error.provider.grokReleaseVersion": "Grok 릴리스의 버전이 예상과 달라요.",
  "error.provider.blockedListShape": "차단된 버전 목록의 형식이 예상과 달라요.",
  "error.provider.releaseNoDownload": "{name} 릴리스에 검증할 수 있는 다운로드가 없어요.",
  "error.provider.releaseSizeUnknown": "릴리스 다운로드의 크기를 알 수 없어요.",
  "error.provider.releaseMetadataNotObject": "릴리스 메타데이터가 JSON 객체가 아니에요.",
  "error.provider.releaseCheckHttp": "릴리스 확인이 HTTP {status}(으)로 실패했어요.",
  "error.provider.releaseMetadataTooLarge": "릴리스 메타데이터가 너무 커요.",
  "error.provider.idInvalid": "제공자 ID는 소문자, 숫자, `-` 또는 `_`만 사용할 수 있어요.",
  "error.provider.baseUrlInvalid": "기본 URL이 올바른 URL이 아니에요.",
  "error.provider.baseUrlProtocol": "기본 URL은 http:// 또는 https://로 시작해야 해요.",
  "error.provider.baseUrlCredentials":
    "기본 URL에는 사용자 이름이나 비밀번호를 넣을 수 없어요. 자격 증명은 헤더에 넣으세요.",
  "error.provider.modelsRequired": "모델이 하나 이상 필요해요.",
  "error.provider.modelsTooMany": "모델이 너무 많아요.",
  "error.provider.modelIdCharacter": "모델 ID에 사용할 수 없는 문자가 있어요.",
  "error.provider.modelIdDuplicate": "모델 두 개의 ID가 같아요.",
  "error.provider.contextWindowInvalid": "모델의 컨텍스트 창은 {min}에서 {max} 사이의 정수 토큰 수여야 해요.",
  "error.provider.headersTooMany": "헤더가 너무 많아요.",
  "error.provider.headerNameCharacter": "헤더 이름에 HTTP에서 허용하지 않는 문자가 있어요.",
  "error.provider.headerNameTooLong": "헤더 이름이 너무 길어요.",
  "error.provider.headerNameDuplicate": "헤더 두 개의 이름이 같아요.",
  "error.provider.headerValueInvalid": "헤더 값이 없거나 너무 길어요.",
  "error.provider.headerValueMissing": "헤더 {name}의 값을 입력하세요.",
  "error.provider.apiKeyTooLong": "API 키가 너무 길어요.",
  "error.provider.localOnly": "제공자는 에이전트를 실행하는 컴퓨터에서만 변경할 수 있어요.",
  "error.provider.keyRequired": "제공자 키가 필요해요.",
  "error.provider.keyTooLong": "제공자 키가 너무 길어요.",
  "error.provider.keyInvalidCharacters": "제공자 키에 공백이나 키에 쓸 수 없는 문자가 있어요.",
  "error.provider.noModel": "선택한 제공자에 사용할 수 있는 모델이 없어요.",
  "error.provider.noModelNamed": "{provider}에 사용할 수 있는 모델이 없어요.",
  "error.provider.acpNoModels": "ACP CLI가 ACP 모델을 알리지 않았어요. OpenBot은 대체 모델을 추측하지 않아요.",
  "error.provider.endpointRemoveBusy":
    "이 엔드포인트를 제거하기 전에 진행 중인 턴과 대기열이 끝날 때까지 기다려 주세요.",
  "error.provider.codexOutdated": "Codex CLI {version}이(가) 너무 오래되었어요. OpenBot에는 0.156.0 이상이 필요해요.",
  "error.provider.codexNotStarted": "Codex CLI를 찾았지만 시작할 수 없었어요.",
  "error.provider.codexNotStartedHint":
    "Codex CLI를 찾았지만 시작할 수 없었어요. 새 터미널에서 `codex --version`을 실행해 보세요.",
  "error.provider.codexManagedNotStarted":
    "ChatGPT를 다운로드했지만 시작할 수 없었어요. OpenBot에서 다시 다운로드하세요.",
  "error.provider.codexMissing": "ChatGPT가 다운로드되지 않았어요. 계속하려면 OpenBot에서 다운로드하세요.",
  "error.provider.codexConfigIgnored": {
    other:
      "Codex가 구성에서 설정 {count}개를 무시했어요: {settings}. 수정하거나 제거하고, 아니면 Codex를 업데이트하세요.",
  },
  "error.provider.codexConfigIgnoredUnnamed": {
    other: "Codex가 구성에서 설정 {count}개를 무시했어요. 수정하거나 제거하고, 아니면 Codex를 업데이트하세요.",
  },
  "error.provider.claudeOutdated":
    "Claude Code {version}이(가) 너무 오래되었어요. OpenBot에는 2.1.232 이상이 필요해요.",
  "error.provider.claudeNotStarted": "Claude CLI를 찾았지만 시작할 수 없었어요.",
  "error.provider.claudeNotStartedHint":
    "Claude CLI를 찾았지만 시작할 수 없었어요. 새 터미널에서 `claude --version`을 실행해 보세요.",
  "error.provider.claudeManagedNotStarted":
    "Claude를 다운로드했지만 시작할 수 없었어요. OpenBot에서 다시 다운로드하세요.",
  "error.provider.claudeMissing": "Claude가 다운로드되지 않았어요. 계속하려면 OpenBot에서 다운로드하세요.",
  "error.provider.grokOutdated": "Grok CLI {version}이(가) 너무 오래되었어요. OpenBot에는 1.0.5 이상이 필요해요.",
  "error.provider.grokNotStarted": "Grok CLI를 찾았지만 시작할 수 없었어요.",
  "error.provider.grokNotStartedHint":
    "Grok CLI를 찾았지만 시작할 수 없었어요. 새 터미널에서 `grok --version`을 실행해 보세요.",
  "error.provider.grokMissing": "Grok이 다운로드되지 않았어요. 계속하려면 OpenBot에서 다운로드하세요.",
  "error.provider.opencodeNotStarted":
    "OpenCode를 시작할 수 없었어요. 터미널에서 `opencode --version`을 실행해 보세요.",
  "error.provider.opencodeMissing": "OpenCode가 다운로드되지 않았어요. 계속하려면 OpenBot에서 다운로드하세요.",
  "error.provider.codexVersionUnreadable": "Codex CLI 버전을 읽을 수 없어요.",
  "error.provider.claudeVersionUnreadable": "Claude CLI 버전을 읽을 수 없어요.",
  "error.provider.grokVersionUnreadable": "Grok CLI 버전을 읽을 수 없어요.",
  "error.provider.opencodeVersionUnreadable": "OpenCode CLI 버전을 읽을 수 없어요.",
  "error.provider.bunVersionUnreadable": "Bun 런타임 버전을 읽을 수 없어요.",
  "error.provider.connectBeforeProfile": "프로필을 생성하기 전에 선택한 제공자를 연결하세요.",
  "error.provider.cliNotReady": "{provider} CLI가 준비되지 않았거나 로그인되어 있지 않아요.",
  "error.provider.cliTimedOut":
    "{provider}이(가) 제시간에 응답하지 않았어요. 컴퓨터가 바쁜 것 같아요. OpenBot이 다시 시도할게요.",
  "error.provider.cliTimedOutRefresh":
    "{provider}이(가) 제시간에 응답하지 않았어요. 컴퓨터가 바쁜 것 같아요. 제공자를 새로 고쳐 다시 시도해 주세요.",
  "error.provider.acpStartTimedOut":
    "{provider}이(가) {seconds}초 안에 시작을 마치지 못했어요. 컴퓨터가 바쁜 것 같아요.",
  "error.provider.acpModelsTimedOut":
    "{provider}이(가) {seconds}초 안에 모델 목록을 가져오지 못했어요. 컴퓨터가 바쁜 것 같아요.",
  "error.provider.startStopped":
    "{provider}이(가) 연속으로 여러 번 시작되지 않아 OpenBot이 시도를 멈췄어요. 제공자를 새로 고쳐 다시 시도해 주세요.",
  "error.provider.tempDiskSpace":
    "{provider}을(를) 시작하려면 디스크 여유 공간이 1GB 이상 필요해요. 공간을 확보한 후 제공자를 새로 고치세요.",
  "error.provider.noCodeSignIn": "{provider}은(는) 코드로 로그인할 수 없어요.",
  "error.provider.codeLoginNoLink": "제공자가 로그인 링크를 표시하지 않았어요. 다시 시도해 주세요.",
  "error.provider.hostSignInEnded": "{provider} 로그인이 완료되지 않았어요. 다시 시도해 주세요.",
  "error.provider.codeLoginNotWaiting": "코드를 기다리는 로그인이 없어요. 로그인을 다시 시작하세요.",
  "error.provider.codeLoginBadCode": "로그인 페이지에 표시된 코드를 붙여넣으세요.",
  "error.provider.codeLoginRefused": "제공자가 코드를 수락하지 않았어요. 로그인을 다시 시작하세요.",
  "error.provider.codeLoginUnsupported":
    "이 서버는 붙여넣은 코드로 로그인할 수 없어요. 서버 컴퓨터의 브라우저에서 로그인하세요.",
  "error.provider.cliBusyRetry": "{provider} CLI가 턴을 처리하는 중이에요. 끝날 때까지 기다린 후 다시 시도해 주세요.",
  "error.provider.cliSigningIn": "{provider} CLI가 로그인하는 중이에요. 로그인을 마치거나 취소한 후 업데이트하세요.",
  "error.provider.cliBusyUpdate": "{provider} CLI가 턴을 처리하는 중이에요. 끝날 때까지 기다린 후 업데이트하세요.",
  "error.provider.cliSelectFailed": "OpenBot이 설치된 관리형 CLI를 선택할 수 없었어요.",
  "error.provider.noAuthenticatedAccount": "{provider}이(가) 인증된 계정을 반환하지 않았어요.",
  "error.provider.signInExpired": "{provider} 로그인이 만료되었어요. 계속하려면 다시 로그인하세요.",
  "error.provider.cliActivateFailed": "OpenBot이 관리형 CLI를 활성화할 수 없었어요.",
  "error.provider.cliBusyReconnect": "{provider} CLI가 턴을 처리하는 중이에요. 끝날 때까지 기다린 후 다시 연결하세요.",
  "error.provider.cliBusySignOut":
    "{provider} CLI가 턴을 처리하고 있습니다. 끝날 때까지 기다린 다음 연결을 해제하세요.",
  "error.provider.opencodeCredentialsRejected":
    "모델 제공자가 API 키를 거부했어요. 설정에서 OpenCode 키를 수정하거나 `opencode auth login`으로 제공자 키를 수정하세요. 그런 다음 다시 시도하거나 다른 모델을 선택하세요.\n{detail}",
  "error.provider.opencodeAuthRequired":
    'OpenCode에 모델 제공자 "{provider}"의 로그인 정보가 없어요. 무료 라벨이 있는 모델을 선택하거나 제공자를 연결하세요. OpenCode 설정에 OpenCode Go 키를 붙여넣거나 터미널에서 `opencode auth login`을 실행하면 돼요. 그런 다음 다시 시도해 주세요.',
  "error.provider.opencodeAuthRequiredUnknown":
    "OpenCode에 이 모델 제공자의 로그인 정보가 없어요. 무료 라벨이 있는 모델을 선택하거나 제공자를 연결하세요. OpenCode 설정에 OpenCode Go 키를 붙여넣거나 터미널에서 `opencode auth login`을 실행하면 돼요. 그런 다음 다시 시도해 주세요.",
  "error.provider.opencodeKeyExpired":
    "OpenCode API 키가 만료되었어요. OpenCode Console에서 새 키를 만들어 OpenCode 설정에 붙여넣은 후 다시 시도해 주세요.",
  "error.provider.opencodeServiceFailure":
    "로컬 서비스 오류로 OpenCode가 이 턴을 완료하지 못했어요. 다시 시도해 주세요. 오류가 계속되면 설정에서 OpenCode를 다시 연결하세요.",
  "error.provider.opencodeRateLimited":
    "모델 제공자가 속도 제한 때문에 요청을 거부했어요. 몇 분 기다리거나 다른 모델을 선택한 후 다시 시도해 주세요.\n{detail}",
  "error.provider.opencodeBilling":
    "모델 제공자가 계정 결제 문제 때문에 요청을 거부했어요. 기다려도 해결되지 않아요. 제공자 계정에 결제 수단이나 잔액을 추가하거나 다른 모델을 선택하세요.\n{detail}",
  "error.provider.opencodeInvalidUpload":
    "OpenCode의 모델 제공자가 올바르지 않은 업로드 요청이라고 알렸어요. 다른 모델을 선택해 계속하세요. 저장된 루틴을 다시 만들기 전에 확인하세요.\n{detail}",
  "error.provider.opencodeUnreadableContent":
    "이 모델은 이 채팅의 파일이나 이미지를 읽을 수 없어요. 파일을 읽을 수 있는 모델을 선택한 후 메시지를 다시 보내세요.",
  "error.provider.opencodeFreeLimit":
    "OpenCode 무료 모델이 사용 한도에 도달했어요. 모든 무료 모델이 이 한도를 함께 사용해요. 계속하려면 OpenCode 설정에 OpenCode Go 키를 붙여넣거나 다른 제공자의 모델을 선택하세요.",
  "error.provider.opencodeProviderFailed":
    "모델 제공자 쪽에서 오류가 났어요. 회원님의 연결 문제가 아니에요. 나중에 다시 시도하거나 다른 모델을 선택하세요.\n{detail}",
  "error.provider.opencodeNetwork":
    "OpenCode가 모델 제공자에 연결할 수 없었어요. OpenBot을 실행하는 컴퓨터의 네트워크 연결을 확인한 후 다시 시도해 주세요.\n{detail}",
  "error.provider.opencodeDatabaseNewer":
    "더 새로운 OpenCode 버전이 데이터베이스를 변경해서 OpenCode가 데이터베이스를 열 수 없었어요. OpenCode를 버전 2 이상으로 업데이트한 후 다시 시도해 주세요.",
  "error.provider.opencodeNoAnswer": "OpenCode 모델이 답변 없이 턴을 끝냈어요. 다시 시도하거나 다른 모델을 선택하세요.",
  "error.provider.opencodeReasoningWithoutAnswer":
    "OpenCode 모델이 추론만 하고 답변 없이 턴을 끝냈어요. 다시 시도하거나 다른 모델을 선택하세요.",
  "error.provider.chatgptPageFailed": "OpenBot이 ChatGPT 연결 페이지를 열 수 없었어요.",
  "error.provider.noneReady": "준비된 에이전트 제공자가 없어요.",
  "error.provider.claudeTurnActive": "컨텍스트를 새로 고치기 전에 진행 중인 Claude 턴이 끝날 때까지 기다려 주세요.",
  "error.provider.codexLoginRequired": "Codex에는 ChatGPT 구독 로그인이 필요해요. `codex login`을 실행하세요.",
  "error.provider.cliUpdateFailed": "OpenBot이 {provider} CLI를 업데이트할 수 없었어요. {reason}",
  "error.provider.tryAgain": "다시 시도해 주세요.",
  "error.provider.noAgentProcess": "{provider}에서 이 에이전트를 위해 실행 중인 프로세스가 없어요.",
  "error.provider.stoppedBeforeAgentProcess": "에이전트의 프로세스가 시작되기 전에 {provider}이(가) 중지되었어요.",
  "error.provider.archiveUnreadable": "런타임 아카이브를 읽을 수 없거나 지원하지 않는 형식이에요.",
  "error.provider.antigravityArchivePath": "Gemini 아카이브에 예상하지 못한 파일이 있어요.",
  "error.provider.antigravityChecksum": "Gemini 런타임 체크섬이 일치하지 않아요.",
  "error.provider.antigravityReleaseShape": "Gemini 릴리스의 형식이 예상과 달라요.",
  "error.provider.antigravityMissing": "Gemini가 다운로드되지 않았어요. 계속하려면 OpenBot에서 다운로드하세요.",
  "error.provider.antigravityNotStarted": "Gemini 서버를 찾았지만 버전을 읽을 수 없어요.",
  "error.provider.antigravityVersionUnreadable": "Gemini 서버 버전을 읽을 수 없어요.",
  "error.provider.antigravitySignIn": "Gemini를 사용하려면 Google로 로그인하세요.",
  "error.provider.antigravityRateLimited":
    "속도 제한 또는 요금제 할당량에 도달해서 Gemini가 요청을 거부했어요. 몇 분 기다리거나 다른 모델을 선택한 후 다시 시도해 주세요.\n{detail}",
  "error.provider.antigravityQuotaReached":
    "Google에 따르면 Gemini 사용 한도에 도달했어요. 한도가 모델별일 수 있어서 요금제의 사용량 페이지에는 더 많이 남아 있을 수 있어요. 다른 Gemini 모델을 선택하거나 초기화될 때까지 기다리세요.\n{detail}",
  "error.provider.antigravityModelUnavailable":
    "Gemini가 지금은 이 모델을 사용할 수 없어요. 다른 모델을 선택한 후 다시 시도해 주세요.\n{detail}",
  "error.provider.antigravityServiceFailure":
    "Google의 Gemini 서비스가 요청을 완료하지 못했어요. 몇 분 후 다시 시도해 주세요.\n{detail}",
  "error.provider.cursorArchivePath": "Cursor 아카이브에 예상하지 못한 파일이 있어요.",
  "error.provider.cursorChecksum": "Cursor 런타임 체크섬이 일치하지 않아요.",
  "error.provider.cursorReleaseShape": "Cursor 릴리스의 형식이 예상과 달라요.",
  "error.provider.cursorMissing": "Cursor가 다운로드되지 않았어요. 계속하려면 OpenBot에서 다운로드하세요.",
  "error.provider.cursorNotStarted": "Cursor 에이전트를 찾았지만 버전을 읽을 수 없어요.",
  "error.provider.cursorVersionUnreadable": "Cursor 에이전트 버전을 읽을 수 없어요.",
  "error.provider.cursorSignIn": "Cursor를 사용하려면 Cursor로 로그인하거나 CURSOR_API_KEY를 설정하세요.",
  "error.provider.clineArchivePath": "Cline 아카이브에 예상하지 못한 경로가 있어요.",
  "error.provider.clinePackageMismatch": "Cline 패키지가 런타임 카탈로그와 일치하지 않아요.",
  "error.provider.clineChecksum": "Cline 런타임 체크섬이 일치하지 않아요.",
  "error.provider.clineLicenseChecksum": "Cline 라이선스 체크섬이 일치하지 않아요.",
  "error.provider.clineMissing": "Cline이 다운로드되지 않았어요. 계속하려면 OpenBot에서 다운로드하세요.",
  "error.provider.clineOutdated": "Cline CLI {version}이(가) 너무 오래되었어요. OpenBot에는 3.0.68 이상이 필요해요.",
  "error.provider.clineNotStarted": "Cline을 시작할 수 없었어요. 터미널에서 `cline --version`을 실행해 보세요.",
  "error.provider.clineVersionUnreadable": "Cline CLI 버전을 읽을 수 없어요.",
  "error.provider.clineSignIn": "Cline을 사용하려면 Cline으로 로그인하거나 CLINE_API_KEY를 설정하세요.",
  "error.provider.usageLimitReached": "계정이 사용 한도에 도달했어요.",
  "error.provider.foreignReasoning":
    "다른 계정이나 API 키가 받은 추론이라서 {provider}이(가) 이 채팅의 이전 추론을 수락하지 않았어요. OpenBot이 채팅 기록으로 새 {provider} 세션을 시작했어요. 다시 시도해 주세요.",
  "error.provider.opencodeSessionRejected":
    "OpenCode가 원인을 알리지 않고 요청을 거부했어요. 긴 채팅이나 모델 변경 후에 발생할 수 있어요. OpenBot이 채팅 기록으로 새 OpenCode 세션을 시작했어요. 다시 시도해 주세요. 오류가 계속되면 다른 모델이나 낮은 강도를 선택하세요.",
  "error.provider.museMcpStartupFault":
    "Muse가 MCP 서버를 시작하지 못해서 이 세션에서 MCP를 차단했어요. OpenBot이 채팅 기록으로 새 Muse 세션을 시작했어요. 다시 시도해 주세요. 오류가 계속되면 이 에이전트의 컴퓨터 제어 또는 실패한 MCP 서버를 끄세요.",
  "error.provider.grokSignIn": "Grok을 사용하려면 `grok login`을 실행하거나 XAI_API_KEY를 설정하세요.",
  "error.provider.acpSignInTimedOut": "로그인 시간이 초과되었어요.",
  "error.provider.acpSignInStopped": "로그인이 완료되기 전에 중단되었어요.",
  "error.provider.geminiBrowserUnavailable":
    "Gemini가 로그인 페이지를 열 수 없었어요. 브라우저와 xdg-utils를 설치한 후 이 호스트의 데스크톱 세션에서 연결하세요. 데스크톱이 없는 서버에서는 이 로그인을 완료할 수 없어요.",
  "error.provider.geminiBrowserOpenFailed":
    "Gemini가 브라우저에서 로그인 페이지를 열 수 없었어요. 기본 브라우저를 확인한 후 다시 연결하세요.",
  "error.provider.acpSignInFailed": "로그인이 완료되지 않았어요.",
  "error.provider.acpSignInFailedReason": "로그인이 완료되지 않았어요: {reason}",
  "error.provider.acpSignInMethodMissing":
    "이 제공자는 이 컴퓨터에서 이 로그인 방식을 제공하지 않아요. 제공자를 업데이트한 후 다시 시도해 주세요.",
  "error.provider.httpsSignInLinkOnly": "브라우저에서는 HTTPS 로그인 링크만 열 수 있어요.",
  "error.provider.geminiKeyRefused":
    "Gemini가 저장된 API 키를 거부했어요. 설정에서 키를 교체하거나 제거한 후 다시 연결하세요.",
  "error.provider.keyProviderRefused":
    "{provider}가 저장된 API 키를 거부했어요. 설정에서 키를 교체하거나 제거한 후 다시 시도하세요.",
  "error.provider.keyProviderNoBalance":
    "저장된 API 키의 {provider} 계정에 잔액이 없어요. 계정에 크레딧을 추가한 후 다시 시도하세요.",
  "error.provider.messageTooLarge":
    "{provider}이(가) {limit}MB보다 큰 메시지를 보내서 OpenBot이 {provider}을(를) 중지했어요.",
  "error.provider.customAgentIdInvalid":
    "에이전트 ID는 소문자, 숫자, `-`만 사용할 수 있고 기본 제공 제공자의 ID와 같을 수 없어요.",
  "error.provider.customAgentEnvInvalid":
    "변수 이름은 문자, 숫자, `_`만 사용할 수 있고 숫자로 시작할 수 없어요. 이름은 한 번씩만, 최대 16개까지 사용하세요.",
  "error.provider.customAgentCommandInvalid":
    "명령은 전체 경로, ~/로 시작하는 경로, 또는 공백이 없는 명령 이름이어야 해요.",
  "error.provider.customAgentArgsInvalid": "인수에는 줄바꿈을 넣을 수 없어요. 인수는 최대 32개까지 사용하세요.",
  "error.provider.customAgentWindowsScript":
    ".cmd 또는 .bat 명령의 인수에는 문자, 숫자, - _ . , : = @ + / \\ 만 사용할 수 있어요.",
  "error.provider.customAgentNotFound": "OpenBot이 {command}을(를) 찾을 수 없어요. 명령의 전체 경로를 입력하세요.",
  "error.provider.customAgentCheckTimedOut": "에이전트가 20초 안에 응답하지 않았어요.",
  "error.provider.customAgentCheckStopped": "에이전트가 응답하기 전에 중지되었어요.",
  "error.provider.customAgentProtocolVersion":
    "에이전트가 ACP 버전 {version}을(를) 사용해요. OpenBot은 버전 1을 사용해요.",
  "error.provider.customAgentCheckFailed": "에이전트가 ACP 에이전트로 응답하지 않았어요.",
  "error.provider.customAgentRemoveBusy":
    "이 사용자 지정 에이전트를 제거하기 전에 진행 중인 턴과 대기열이 끝날 때까지 기다려 주세요.",
  "error.provider.customAgentNone": "저장된 사용자 지정 에이전트가 없어요.",
  "error.provider.customAgentMissing": "이 사용자 지정 에이전트는 지금 저장되어 있지 않아요. 다른 모델을 선택하세요.",
  "error.provider.customAgentSignIn": "에이전트 자체 명령으로 로그인한 후 다시 시도해 주세요.",
  "error.provider.customAgentsReadOnly":
    "저장된 사용자 지정 에이전트가 더 새로운 버전의 OpenBot에서 작성되었거나 파일을 읽을 수 없어요. 변경하려면 OpenBot을 업데이트하세요.",
  "error.provider.customAgentNoSecureStorage":
    "이 컴퓨터에는 보안 저장소가 없어서 환경 값을 저장할 수 없어요. 제거한 후 다시 시도해 주세요.",
  "error.provider.customAgentNotSaved":
    "이 사용자 지정 에이전트는 저장되지 않았어요. 목록을 새로 고친 후 다시 시도해 주세요.",
  "error.provider.customAgentTooMany": "사용자 지정 에이전트는 최대 {count}개까지 저장할 수 있어요.",
  "error.provider.customAgentEnvValueMissing": "{name}의 값을 입력하세요.",
  "error.provider.off": "OpenBot에서 {provider}이(가) 꺼져 있어요. 먼저 제공자 설정에서 켜세요.",
  "error.provider.inUse":
    "에이전트가 {provider}을(를) 사용 중이에요. 이 제공자를 끄기 전에 에이전트의 모델을 변경하세요.",
  "error.provider.useBusy": "제공자 확인이나 로그인이 끝날 때까지 기다린 후 다시 시도해 주세요.",
  "error.provider.useSettingsReadOnly": "저장된 제공자 설정을 읽을 수 없어요. 변경하기 전에 OpenBot을 업데이트하세요.",
  "error.provider.useChangeFailed": "OpenBot이 제공자 설정을 변경할 수 없었어요.",
  "error.provider.accountsUnsupported": "{provider}은(는) 계정을 하나만 둘 수 있어요.",
  "error.provider.accountNeedsConnection": "다른 계정을 추가하기 전에 {provider}을(를) 연결하세요.",
  "error.provider.usageResetUnsupported": "{provider}은(는) 사용 한도를 초기화할 수 없어요.",
  "error.provider.signOutUnsupported": "OpenBot은 {provider} 로그인의 연결을 해제할 수 없습니다.",
  "error.provider.usageResetNotConnected": "사용량을 초기화하기 전에 이 {provider} 계정에 다시 로그인하세요.",
  "error.provider.accountLimit": "{provider}은(는) 계정을 최대 {limit}개까지 둘 수 있어요.",
  "error.provider.accountNotFound": "이 {provider} 계정이 이 컴퓨터에 없어요. 새로 고친 후 다시 시도해 주세요.",
  "error.provider.accountAlreadyAdded": "이 {provider} 계정은 이미 연결되어 있어요.",
  "error.provider.accountDefault": "첫 번째 {provider} 계정은 제거할 수 없어요.",
  "error.provider.accountUsesKey":
    "이 {provider} 계정은 저장된 API 키를 사용하므로 로그인이 없어요. 키는 서버 설정 → 제공자에서 변경하세요.",
  "error.provider.accountInUse": "이 계정을 사용하는 에이전트가 작업 중이에요. 에이전트가 멈춘 후 다시 시도해 주세요.",
  "error.provider.accountsReadOnly": "저장된 제공자 계정을 읽을 수 없어요. 변경하기 전에 OpenBot을 업데이트하세요.",
  "error.provider.accountSignedOut": "이 {provider} 계정은 로그아웃되었어요. 다시 로그인하세요.",
  "error.provider.sessionSettingUnavailable": "현재 제공자 세션에서는 이 설정을 사용할 수 없어요.",
  "error.provider.sessionSettingInvalid": "이 설정에 사용할 수 없는 값이에요.",
  "error.provider.sessionSettingsBusy": "세션 설정을 변경하기 전에 현재 턴이 끝날 때까지 기다려 주세요.",
  "error.provider.piOutdated":
    "Pi {version}이(가) 너무 오래되었어요. 네이티브 RPC 및 MCP 지원을 위해 Pi 1.1.0 이상을 설치하세요.",
  "error.provider.nativeMissing": "{provider} CLI가 설치되어 있지 않아요. 설정에서 다운로드하세요.",
  "error.provider.nativeNotStarted": "{provider} CLI를 시작할 수 없었어요.",
  "error.provider.nativeVersionUnreadable": "{provider} CLI 버전을 읽을 수 없었어요.",
  "error.provider.piSessionBusy": "현재 Pi 턴이 끝날 때까지 기다려 주세요.",
  "error.provider.piStopped": "Pi가 실행 중이 아니에요. Pi를 연결한 후 다시 시도해 주세요.",
  "error.provider.piSessionMissing": "이 컴퓨터에서 Pi 세션 파일을 사용할 수 없어요.",
  "error.provider.piResumeCancelled": "Pi가 세션 재개를 취소했어요. 다시 시도해 주세요.",
  "error.provider.piSessionIdentity": "Pi가 다른 세션을 반환했어요. 저장된 세션은 교체되지 않았어요.",
  "error.provider.piModelInvalid": "제공자가 포함된 Pi 모델을 선택하세요.",
  "error.provider.piToolInvalid": "도구가 올바르지 않은 결과를 반환했어요.",
  "error.provider.piSignIn": "호스트 컴퓨터의 Pi에서 /login을 사용하세요. 로그인이 끝나면 Pi를 닫으세요.",
  "error.provider.museBusy": "Muse 세션이 바빠요.",
  "error.provider.museStopped": "Muse 클라이언트가 실행 중이 아니에요.",
  "error.provider.museUnexpectedProvider": "Muse가 예상하지 못한 모델 제공자를 반환했어요.",
  "error.provider.museNoActiveTurn": "Muse에 방향을 지시할 진행 중인 턴이 없어요.",
  "error.provider.museInvalidProtocol": "Muse가 올바르지 않은 프로토콜 응답을 반환했어요.",
  "error.provider.museNotStarted": "Muse가 시작되지 않았어요.",
  "error.provider.museNativeWindows": "Muse에는 Windows용 네이티브 실행 파일이 필요해요.",
  "error.provider.museStartTimeout": "Muse 초기화 시간이 초과되었어요.",
  "error.provider.museStartStopped": "Muse가 초기화 중에 중지되었어요.",
  "error.provider.museProtocolVersion": "지원하지 않는 Muse 프로토콜 버전이에요.",
  "error.provider.museHistoryRequired": "Muse는 세션 기록을 유지해야 해요.",
  "error.provider.museRequestUnsupported": "지원하지 않는 Muse 서버 요청이에요.",
  "error.provider.museConnectionFailed": "Muse 연결에 실패했어요. 대화를 재개해서 저장된 기록을 복구하세요.",
  "error.provider.museUnknownSession": "알 수 없는 Muse 세션이에요.",
  "error.provider.museInvalidToolResult": "올바르지 않은 OpenBot 도구 결과예요.",
  "error.provider.museMcpRequired": "Muse는 세션 MCP 서버를 지원해야 해요.",
  "error.provider.museSessionMismatch": "Muse가 다른 세션을 반환했어요.",
  "error.provider.museCompactRejected": "Muse가 압축을 수락하지 않았어요.",
  "error.provider.museTurnMismatch": "Muse가 다른 턴을 반환했어요.",
  "error.provider.museHistoryMismatch": "Muse 기록이 세션을 넘나들었어요.",
  "error.provider.museRecoveryFailed": "Muse가 누락된 이벤트를 복구할 수 없었어요.",
  "error.provider.museHistoryStalled": "Muse 기록 커서가 진행되지 않았어요.",
  "error.provider.museApprovalUnavailable": "Muse가 이 승인 응답을 제공하지 않았어요.",
  "error.provider.museHistoryOwner": "Muse 기록이 다른 세션에 속해 있어요.",
  "error.provider.museHistoryMissing": "Muse가 세션 기록을 반환하지 않았어요.",
  "error.provider.museEmptyInput": "Muse에는 텍스트나 이미지가 필요해요.",
  "error.provider.museMethodUnsupported": "Muse가 {method}을(를) 지원하지 않아요.",
  "error.provider.museTurnFailed": "Muse 턴에 실패했어요.",
  "error.provider.museProfileUnsupported":
    "Muse는 외부 도구에 접근하지 않고는 프로필을 생성할 수 없어요. 다른 제공자로 프로필을 생성한 후 에이전트에 Muse를 선택하세요.",
  "error.provider.museAuthUnverified":
    "Muse 인증이 확인되지 않았어요. 호스트 컴퓨터에서 연결하거나 Meta API 키를 설정하세요.",
  "error.provider.museSignIn": "계속하려면 호스트 컴퓨터에서 Muse에 로그인하세요.",
  "error.provider.inceptionSignIn": "계속하려면 Inception API 키를 추가하세요.",
  "error.provider.deepseekSignIn": "계속하려면 DeepSeek API 키를 추가하세요.",
  "error.provider.openrouterSignIn": "계속하려면 OpenRouter API 키를 추가하세요.",
  "error.provider.terminalLoginFailed":
    "로그인 터미널을 열 수 없었어요. 이 호스트에서 제공자 CLI를 열어 로그인한 후 제공자를 새로 고치세요.",
  "error.provider.nativeArchiveInvalid": "제공자 다운로드에 올바른 설치 파일이 없어요.",
  "error.provider.nativeChecksum": "제공자 설치 파일이 무결성 검사를 통과하지 못했어요.",
  "error.provider.registryUnavailable": "ACP 레지스트리를 사용할 수 없어요. 다시 시도해 주세요.",
  "error.provider.registryInvalid": "ACP 레지스트리가 올바르지 않은 데이터를 반환했어요.",
  "error.provider.registryMissing": "이 에이전트는 ACP 레지스트리에 없어요.",
  "error.provider.registryBusy": "이 에이전트의 설치가 이미 진행 중이에요.",
  "error.provider.registryCancelled": "에이전트 설치가 취소되었어요.",
  "error.provider.registryPrerequisite": "이 에이전트를 설치하기 전에 호스트에 {tool}을(를) 설치하세요.",
  "error.provider.registryBindingChanged": "설치 중에 사용자 지정 에이전트가 변경되었어요. 다시 시도해 주세요.",
  "error.provider.registryInstallFailed": "에이전트 설치에 실패했어요. 이전 설치는 변경되지 않았어요.",
  "error.provider.registryRemoveBusy":
    "에이전트를 제거하기 전에 에이전트 설치와 진행 중인 ACP 작업이 끝날 때까지 기다려 주세요.",
} as const satisfies PartialTranslation<typeof source>;
