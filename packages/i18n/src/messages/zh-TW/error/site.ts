import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  // Hosted site errors.
  "error.site.absolutePath": "請選擇站點目錄的絕對路徑。",
  "error.site.rootSymlink": "託管站點不允許使用符號連結。",
  "error.site.notDirectory": "站點源必須是一個目錄。",
  "error.site.outsideWorkspace": "站點必須位於該助理的工作區或 OpenBot 共享資料夾內。",
  "error.site.packageJsonInvalid": "站點的 package.json 無效。",
  "error.site.astroServerOutput": "Astro 必須使用靜態輸出。",
  "error.site.astroAdapter": "不允許使用 Astro 服務端介面卡和 React 整合。",
  "error.site.astroApiRoutes": "不允許使用 Astro API 路由和服務端操作。",
  "error.site.astroMiddleware": "不允許使用 Astro 中介軟體和服務端原始碼。",
  "error.site.astroNotBuilt": "請先構建 Astro 專案，需要已存在的 dist/ 目錄。",
  "error.site.astroDistNotDirectory": "Astro 的 dist/ 必須是真實目錄。",
  "error.site.astroDistOutside": "Astro 的 dist/ 必須位於專案目錄內。",
  "error.site.directoryOutsideRoot": "站點目錄必須位於源根目錄內。",
  "error.site.siteTooLarge": "站點超過了 2 MB 的上限。",
  "error.site.missingIndex": "站點根目錄必須包含 index.html。",
  "error.site.symlink": "不允許使用符號連結：{name}",
  "error.site.unsupportedEntry": "不支援的站點條目：{name}",
  "error.site.tooManyFiles": "一個站點最多包含 {limit} 個檔案。",
  "error.site.hiddenFile": "不允許包含隱藏檔案：{path}",
  "error.site.unsafePath": "不允許使用該檔案路徑：{path}",
  "error.site.secretFile": "不允許包含憑據、私鑰或服務端原始碼：{path}",
  "error.site.fileType": "不允許使用該檔案型別：{path}",
  "error.site.fileOutsideRoot": "站點檔案必須位於源根目錄內：{path}",
  "error.site.fileTooLarge": "某個檔案超過了 1 MB 上限：{path}",
  "error.site.serverLimit": {
    one: "該伺服器已達到 {count} 個活躍站點的上限。要釋出其他站點，請刪除一個站點，或使用站點更多方案的雲伺服器。",
    other: "該伺服器已達到 {count} 個活躍站點的上限。要釋出其他站點，請刪除一個站點，或使用站點更多方案的雲伺服器。",
  },
  "error.site.unlinkedLimit": {
    one: "該電腦不是伺服器，其帳戶已達到 {count} 個活躍站點的上限。要釋出其他站點，請刪除一個站點，或使用站點更多方案的雲伺服器。",
    other:
      "該電腦不是伺服器，其帳戶已達到 {count} 個活躍站點的上限。要釋出其他站點，請刪除一個站點，或使用站點更多方案的雲伺服器。",
  },
} as const satisfies PartialTranslation<typeof source>;
