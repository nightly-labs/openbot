import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/vault";

export const messages = {
  // The Vault of this computer: its encrypted file and the items that the user saves in it.
  "error.vault.unavailable": "這臺電腦沒有金鑰儲存，因此保險庫無法儲存專案。",
  "error.vault.unreadable": "保險庫檔案無法讀取。請重置保險庫後再使用。",
  "error.vault.tooLarge": "保險庫已滿。請刪除一些專案，然後重試。",
  "error.vault.itemMissing": "該專案已不在保險庫中。",
  "error.vault.valueTooLong": "某個值過長。",
  "error.vault.websiteInvalid": "請填寫 HTTPS 網站地址。",
  "error.vault.passwordRequired": "請填寫密碼。",
  "error.vault.cardNumberInvalid": "請填寫有效的卡號。",
  "error.vault.securityCodeInvalid": "請填寫 3 位或 4 位的安全碼。",
  "error.vault.expiryInvalid": "請填寫有效的到期月份和年份。",
  "error.vault.contactEmpty": "請填寫姓名、地址、電話號碼或電子郵件地址。",
  "error.vault.contactMissing": "該帳單聯絡人已不在保險庫中。",
  "error.vault.csvInvalid": "該檔案不是 CSV 格式的密碼匯出檔案。",
  "error.vault.csvTooLarge": "CSV 檔案過大。",
} as const satisfies PartialTranslation<typeof source>;
