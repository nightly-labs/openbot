import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "사이트 디렉터리의 절대 경로를 선택해 주세요.",
  "error.site.rootSymlink": "호스팅 사이트에서는 심볼릭 링크를 사용할 수 없어요.",
  "error.site.notDirectory": "사이트 소스는 디렉터리여야 해요.",
  "error.site.outsideWorkspace": "사이트는 이 에이전트의 워크스페이스 또는 OpenBot Shared 안에 있어야 해요.",
  "error.site.packageJsonInvalid": "사이트의 package.json이 올바르지 않아요.",
  "error.site.astroServerOutput": "Astro는 정적 출력을 사용해야 해요.",
  "error.site.astroAdapter": "Astro 서버 어댑터와 React 통합은 사용할 수 없어요.",
  "error.site.astroApiRoutes": "Astro API 라우트와 서버 액션은 사용할 수 없어요.",
  "error.site.astroMiddleware": "Astro 미들웨어와 서버 소스는 사용할 수 없어요.",
  "error.site.astroNotBuilt": "먼저 Astro 프로젝트를 빌드해 주세요. 기존 dist/ 디렉터리가 필요해요.",
  "error.site.astroDistNotDirectory": "Astro dist/는 실제 디렉터리여야 해요.",
  "error.site.astroDistOutside": "Astro dist/는 프로젝트 디렉터리 안에 있어야 해요.",
  "error.site.directoryOutsideRoot": "사이트 디렉터리는 소스 루트 안에 있어야 해요.",
  "error.site.siteTooLarge": "사이트가 2 MB 제한을 초과했어요.",
  "error.site.missingIndex": "사이트 루트에 index.html이 있어야 해요.",
  "error.site.symlink": "심볼릭 링크는 사용할 수 없어요: {name}",
  "error.site.unsupportedEntry": "지원하지 않는 사이트 항목이에요: {name}",
  "error.site.tooManyFiles": "사이트에는 파일을 최대 {limit}개까지 넣을 수 있어요.",
  "error.site.hiddenFile": "숨김 파일은 사용할 수 없어요: {path}",
  "error.site.unsafePath": "허용되지 않는 파일 경로예요: {path}",
  "error.site.secretFile": "자격 증명, 개인 키, 서버 소스는 사용할 수 없어요: {path}",
  "error.site.fileType": "허용되지 않는 파일 형식이에요: {path}",
  "error.site.fileOutsideRoot": "사이트 파일은 소스 루트 안에 있어야 해요: {path}",
  "error.site.fileTooLarge": "파일이 1 MB 제한을 초과했어요: {path}",
  "error.site.serverLimit": {
    other:
      "이 서버는 활성 사이트 한도({count}개)에 도달했어요. 다른 사이트를 게시하려면 사이트를 삭제하거나 사이트가 더 많은 요금제의 클라우드 서버를 사용하세요.",
  },
  "error.site.unlinkedLimit": {
    other:
      "이 컴퓨터는 서버가 아니고, 계정이 활성 사이트 한도({count}개)에 도달했어요. 다른 사이트를 게시하려면 사이트를 삭제하거나 사이트가 더 많은 요금제의 클라우드 서버를 사용하세요.",
  },
} as const satisfies PartialTranslation<typeof source>;
