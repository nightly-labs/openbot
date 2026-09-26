import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  // Hosted site errors.
  "error.site.absolutePath": "サイトのディレクトリには絶対パスを指定してください。",
  "error.site.rootSymlink": "ホストするサイトではシンボリックリンクを使用できません。",
  "error.site.notDirectory": "サイトのソースはディレクトリである必要があります。",
  "error.site.outsideWorkspace":
    "サイトはこのエージェントのワークスペースまたは OpenBot Shared の中にある必要があります。",
  "error.site.packageJsonInvalid": "サイトの package.json が無効です。",
  "error.site.astroServerOutput": "Astro では静的出力を使用する必要があります。",
  "error.site.astroAdapter": "Astro のサーバーアダプターと React 連携は使用できません。",
  "error.site.astroApiRoutes": "Astro の API ルートとサーバーアクションは使用できません。",
  "error.site.astroMiddleware": "Astro のミドルウェアとサーバーのソースは使用できません。",
  "error.site.astroNotBuilt": "先に Astro プロジェクトをビルドしてください。既存の dist/ ディレクトリが必要です。",
  "error.site.astroDistNotDirectory": "Astro の dist/ は実際のディレクトリである必要があります。",
  "error.site.astroDistOutside": "Astro の dist/ はプロジェクトのディレクトリ内にある必要があります。",
  "error.site.directoryOutsideRoot": "サイトのディレクトリはソースのルート内にある必要があります。",
  "error.site.siteTooLarge": "サイトが 2 MB の上限を超えています。",
  "error.site.missingIndex": "サイトのルートには index.html が必要です。",
  "error.site.symlink": "シンボリックリンクは使用できません: {name}",
  "error.site.unsupportedEntry": "対応していないサイトの項目です: {name}",
  "error.site.tooManyFiles": "サイトに含められるファイルは {limit} 個までです。",
  "error.site.hiddenFile": "隠しファイルは使用できません: {path}",
  "error.site.secretFile": "認証情報、秘密鍵、サーバーのソースは使用できません: {path}",
  "error.site.fileType": "この種類のファイルは使用できません: {path}",
  "error.site.fileOutsideRoot": "サイトのファイルはソースのルート内にある必要があります: {path}",
  "error.site.fileTooLarge": "1 MB の上限を超えるファイルがあります: {path}",
} as const satisfies PartialTranslation<typeof source>;
