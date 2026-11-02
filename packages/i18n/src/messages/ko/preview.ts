import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "파일 미리 보기",
  "preview.panel.resize": "파일 미리 보기 크기 조절",
  "preview.panel.copy": "파일 텍스트 복사",
  "preview.panel.openExternally": "외부 앱에서 파일 열기",
  "preview.panel.download": "파일 다운로드",
  "preview.panel.reveal": "Finder에서 파일 보기",
  "preview.panel.close": "파일 미리 보기 닫기",
  "preview.panel.back": "뒤로",
  "preview.panel.rawMarkdown": "Markdown 소스 보기",
  "preview.panel.rawHtml": "HTML 소스 보기",
  "preview.panel.wrapLines": "긴 줄 줄바꿈",
  "preview.folder.empty": "이 폴더는 비어 있어요.",
  "preview.folder.truncated": "처음 {limit}개 항목만 표시해요.",
  "preview.truncated": "{limit}자 이후는 미리 보기에서 잘렸어요.",
  "preview.unavailable": "미리 볼 수 없어요.",
  "preview.unsupported.title": "미리 볼 수 없음",
  "preview.unsupported.description": "이 파일 형식은 기본 앱에서 열 수 있어요.",
  "preview.unsupported.openExternally": "외부 앱에서 열기",
  "preview.spreadsheet.readFailed": "이 스프레드시트를 읽을 수 없어요.",
  "preview.spreadsheet.truncated": "처음 {rows}행, {columns}열까지만 미리 볼 수 있어요.",
} as const satisfies PartialTranslation<typeof source>;
