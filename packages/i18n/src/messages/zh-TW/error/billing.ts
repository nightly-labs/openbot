import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "無法更改伺服器套餐，請重新整理帳單後重試。",
  "error.billing.confirmMismatch": "請輸入伺服器名稱以確認刪除。",
  "error.billing.restartBusy": "伺服器當前無法重啟，請一分鐘後再試。",
  "error.billing.planRequired": "該伺服器的套餐已結束，請續費後啟動伺服器。",
  "error.billing.planSoldOut": "該套餐已售罄，請選擇其他套餐。",
  // License errors.
  "error.billing.licenseExists": "該帳號已有許可證，請改為更改其使用者數。",
  "error.billing.licenseCurrency": "許可證必須使用你其他套餐的幣種。",
  "error.billing.planCurrency": "新套餐必須使用你其他套餐的幣種。",
  "error.billing.licenseUsersInUse": "許可證的使用者數不能少於當前正在使用的人數。",
  "error.billing.licensePaymentFailed": "新增使用者的付款失敗。請更新付款方式後重試。",
  "error.billing.licenseUnavailable": "許可證暫時不可用。",
  "error.billing.licenseOneUser": "該許可證只包含 1 位使用者。如需新增使用者，請改為團隊版。",
  "error.billing.licensePlanChange": "該許可證無法改為該套餐。請取消它，然後購買新套餐。",
  "error.billing.noLicense": "該帳號沒有許可證。",
  // Billing errors that the desktop and web clients make.
  "error.billing.invalidRequest": "帳單請求無效。",
  "error.billing.invalidResponse": "帳單響應無效。",
  "error.billing.notStripePage": "該帳單頁面不是 Stripe 頁面。",
} as const satisfies PartialTranslation<typeof source>;
