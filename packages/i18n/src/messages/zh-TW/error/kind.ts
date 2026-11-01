import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

/** The sentence for each kind `classifyUserError` decides. `@openbot/user-errors` owns the mapping. */
export const messages = {
  "error.kind.network": "無法連線，請檢查網路後重試。",
  "error.kind.timeout": "請求超時。重試前請先確認該操作是否已完成。",
  "error.kind.storage": "儲存空間不足。請先在執行 OpenBot 的電腦上釋放一些空間，然後重試。",
  "error.kind.filePermission": "OpenBot 沒有權限完成該操作。請檢查檔案或資料夾權限後重試。",
  "error.kind.notFound": "找不到所需的檔案或資料夾。請恢復它或選擇另一個，然後重試。",
  "error.kind.readOnly": "該資料夾為只讀。請選擇可寫入的資料夾後重試。",
  "error.kind.conflict": "已存在同名專案。請換一個名稱後重試。",
  "error.kind.auth": "身分驗證失敗。請檢查帳號或伺服器連線後重試。",
  "error.kind.permission": "你沒有權限完成該操作，請向所有者申請訪問權限。",
  "error.kind.rateLimit": "請求過於頻繁，請稍等片刻後重試。",
  "error.kind.service": "服務暫時不可用，請稍等片刻後重試。",
} as const satisfies PartialTranslation<typeof source>;
