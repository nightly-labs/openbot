import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/vault";

export const messages = {
  // The Vault of this computer: its encrypted file and the items that the user saves in it.
  "error.vault.unavailable": "这台电脑没有密钥存储，因此保险库无法保存项目。",
  "error.vault.unreadable": "保险库文件无法读取。请重置保险库后再使用。",
  "error.vault.tooLarge": "保险库已满。请删除一些项目，然后重试。",
  "error.vault.itemMissing": "该项目已不在保险库中。",
  "error.vault.valueTooLong": "某个值过长。",
  "error.vault.websiteInvalid": "请填写 HTTPS 网站地址。",
  "error.vault.passwordRequired": "请填写密码。",
  "error.vault.cardNumberInvalid": "请填写有效的卡号。",
  "error.vault.securityCodeInvalid": "请填写 3 位或 4 位的安全码。",
  "error.vault.expiryInvalid": "请填写有效的到期月份和年份。",
  "error.vault.contactEmpty": "请填写姓名、地址、电话号码或邮箱地址。",
  "error.vault.contactMissing": "该账单联系人已不在保险库中。",
  "error.vault.csvInvalid": "该文件不是 CSV 格式的密码导出文件。",
  "error.vault.csvTooLarge": "CSV 文件过大。",
} as const satisfies PartialTranslation<typeof source>;
